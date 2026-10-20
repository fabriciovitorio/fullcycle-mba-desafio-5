import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { open, rm } from 'node:fs/promises';
import { Readable, type Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  GetObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import storageConfig from '../config/storage.config';
import {
  S3_CLIENT,
  S3_STORAGE_OPTIONS,
  S3_TRANSFER_OPTIONS,
  STORAGE_LIMITS,
  type S3StorageOptions,
  type S3TransferOptions,
} from './storage.constants';
import { StorageCleanupError, StorageError } from './storage.error';
import { mapStorageError, withStorageOperation } from './storage-operation';
import {
  STORAGE,
  type CompletedStoragePart,
  type StorageObject,
  type StoragePort,
} from './storage.port';
import type { StorageFileTransferPort } from './storage-file-transfer.port';

@Injectable()
export class StorageFileTransferService implements StorageFileTransferPort {
  constructor(
    @Inject(S3_CLIENT) private readonly client: S3Client,
    @Inject(STORAGE) private readonly storage: StoragePort,
    @Inject(storageConfig.KEY)
    private readonly config: ConfigType<typeof storageConfig>,
    @Inject(S3_STORAGE_OPTIONS) private readonly operations: S3StorageOptions,
    @Inject(S3_TRANSFER_OPTIONS) private readonly options: S3TransferOptions,
  ) {
    if (
      !Number.isSafeInteger(options.partSizeBytes) ||
      options.partSizeBytes < STORAGE_LIMITS.MIN_PART_SIZE_BYTES ||
      options.partSizeBytes > STORAGE_LIMITS.MAX_PART_SIZE_BYTES ||
      !Number.isSafeInteger(options.transferTimeoutMs) ||
      options.transferTimeoutMs < 1
    )
      throw new RangeError('Invalid storage transfer options');
  }

  async downloadFile(
    key: string,
    destination: string,
    callerSignal?: AbortSignal,
  ): Promise<StorageObject> {
    return withStorageOperation(
      async (signal) => {
        // Exclusive creation protects unrelated files even when a transfer fails.
        const file = await open(destination, 'wx');
        let body: Readable | undefined;
        let output: Writable | undefined;
        let completed = false;
        try {
          output = file.createWriteStream({
            highWaterMark: STORAGE_LIMITS.STREAM_HIGH_WATER_MARK,
          });
          const response = await withStorageOperation(
            (requestSignal) =>
              this.client.send(
                new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
                { abortSignal: requestSignal },
              ),
            this.operations.operationTimeoutMs,
            signal,
          );
          if (!(response.Body instanceof Readable))
            throw new StorageError('invalid_response');
          body = response.Body;
          if (
            response.ContentLength === undefined ||
            !Number.isSafeInteger(response.ContentLength) ||
            response.ContentLength < 0 ||
            !response.ETag
          )
            throw new StorageError('invalid_response');
          await pipeline(body, output, { signal });
          const actual = await open(destination, 'r');
          try {
            if ((await actual.stat()).size !== response.ContentLength)
              throw new StorageError('invalid_response');
          } finally {
            await actual.close();
          }
          completed = true;
          return {
            contentLength: response.ContentLength,
            etag: response.ETag,
            contentType: response.ContentType,
          };
        } finally {
          if (body) await this.closeStream(body);
          if (output) await this.closeStream(output);
          await file.close();
          if (!completed) await this.removePartialFile(key, destination);
        }
      },
      this.options.transferTimeoutMs,
      callerSignal,
    );
  }

  async uploadFile(
    key: string,
    source: string,
    contentType: string,
    callerSignal?: AbortSignal,
  ): Promise<StorageObject> {
    return withStorageOperation(
      async (signal) => {
        const file = await open(source, 'r');
        let uploadId: string | undefined;
        let creating = false;
        let completed = false;
        let originalKind: StorageError['kind'] = 'operation_failed';
        try {
          const initial = await file.stat();
          const partCount = Math.ceil(
            initial.size / this.options.partSizeBytes,
          );
          if (
            !initial.isFile() ||
            !Number.isSafeInteger(initial.size) ||
            initial.size < 1 ||
            partCount > STORAGE_LIMITS.MAX_MULTIPART_PARTS
          )
            throw new StorageError('invalid_request');
          signal.throwIfAborted();
          creating = true;
          uploadId = await this.storage.createMultipartUpload(
            key,
            contentType,
            signal,
          );
          const parts: CompletedStoragePart[] = [];
          for (let partNumber = 1; partNumber <= partCount; partNumber++) {
            signal.throwIfAborted();
            const start = (partNumber - 1) * this.options.partSizeBytes;
            const size = Math.min(
              this.options.partSizeBytes,
              initial.size - start,
            );
            const partFile = await open(source, 'r');
            const current = await partFile.stat();
            if (current.ino !== initial.ino || current.dev !== initial.dev) {
              await partFile.close();
              throw new StorageError('invalid_request');
            }
            const body = partFile.createReadStream({
              start,
              end: start + size - 1,
              highWaterMark: STORAGE_LIMITS.STREAM_HIGH_WATER_MARK,
            });
            try {
              const response = await withStorageOperation(
                (requestSignal) =>
                  this.client.send(
                    new UploadPartCommand({
                      Bucket: this.config.bucket,
                      Key: key,
                      UploadId: uploadId,
                      PartNumber: partNumber,
                      ContentLength: size,
                      Body: body,
                    }),
                    { abortSignal: requestSignal },
                  ),
                this.operations.operationTimeoutMs,
                signal,
              );
              if (!response.ETag) throw new StorageError('invalid_response');
              parts.push({ partNumber, etag: response.ETag });
            } finally {
              await this.closeStream(body);
              await partFile.close();
            }
          }
          const final = await file.stat();
          if (final.size !== initial.size || final.mtimeMs !== initial.mtimeMs)
            throw new StorageError('invalid_request');
          const result = await this.storage.completeMultipartUpload(
            key,
            uploadId,
            parts,
            signal,
          );
          if (result.contentLength !== initial.size)
            throw new StorageError('invalid_response');
          completed = true;
          return result;
        } catch (error: unknown) {
          originalKind = callerSignal?.aborted
            ? 'cancelled'
            : mapStorageError(error, signal.aborted).kind;
          if (creating && !uploadId)
            throw new StorageCleanupError({ key }, originalKind);
          throw error;
        } finally {
          await file.close();
          if (uploadId && !completed)
            await this.abortUpload(key, uploadId, originalKind);
        }
      },
      this.options.transferTimeoutMs,
      callerSignal,
    );
  }

  private async removePartialFile(
    key: string,
    localPath: string,
  ): Promise<void> {
    try {
      await rm(localPath, { force: true });
    } catch {
      throw new StorageCleanupError({ key, localPath }, 'operation_failed');
    }
  }

  private async abortUpload(
    key: string,
    uploadId: string,
    originalKind: StorageError['kind'],
  ): Promise<void> {
    // Cleanup has its own deadline and cannot inherit an already cancelled signal.
    try {
      await this.storage.abortMultipartUpload(key, uploadId);
    } catch (error: unknown) {
      if (!(error instanceof StorageError) || error.kind !== 'upload_not_found')
        throw new StorageCleanupError({ key, uploadId }, originalKind);
    }
  }

  private async closeStream(stream: Readable | Writable): Promise<void> {
    if (stream.closed) return;
    const closed = new Promise<void>((resolve) =>
      stream.once('close', resolve),
    );
    stream.destroy();
    await closed;
  }
}
