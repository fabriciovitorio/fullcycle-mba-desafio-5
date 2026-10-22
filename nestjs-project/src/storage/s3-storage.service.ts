import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListPartsCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import storageConfig from '../config/storage.config';
import {
  S3_CLIENT,
  S3_STORAGE_OPTIONS,
  STORAGE_LIMITS,
  type S3StorageOptions,
} from './storage.constants';
import type {
  CompletedStoragePart,
  StorageObject,
  StoragePart,
  StoragePort,
} from './storage.port';
import { StorageError } from './storage.error';
import { withStorageOperation } from './storage-operation';

@Injectable()
export class S3StorageService implements StoragePort, OnModuleDestroy {
  constructor(
    @Inject(S3_CLIENT) private readonly client: S3Client,
    @Inject(storageConfig.KEY)
    private readonly config: ConfigType<typeof storageConfig>,
    @Inject(S3_STORAGE_OPTIONS) private readonly options: S3StorageOptions,
  ) {
    if (
      !Number.isSafeInteger(options.operationTimeoutMs) ||
      options.operationTimeoutMs < 1 ||
      !Number.isSafeInteger(options.listPartsPageSize) ||
      options.listPartsPageSize < 1 ||
      options.listPartsPageSize > STORAGE_LIMITS.LIST_PARTS_PAGE_SIZE
    )
      throw new RangeError('Invalid storage operation options');
  }

  onModuleDestroy(): void {
    this.client.destroy();
  }

  async createMultipartUpload(
    key: string,
    contentType: string,
    callerSignal?: AbortSignal,
  ): Promise<string> {
    return this.run(async (signal) => {
      const output = await this.client.send(
        new CreateMultipartUploadCommand({
          Bucket: this.config.bucket,
          Key: key,
          ContentType: contentType,
        }),
        { abortSignal: signal },
      );
      if (!output.UploadId) throw new StorageError('invalid_response');
      return output.UploadId;
    }, callerSignal);
  }

  async listParts(key: string, uploadId: string): Promise<StoragePart[]> {
    return this.run(async (signal) => {
      const parts: StoragePart[] = [];
      let marker: string | undefined;
      let lastPart = 0;
      while (true) {
        const page = await this.client.send(
          new ListPartsCommand({
            Bucket: this.config.bucket,
            Key: key,
            UploadId: uploadId,
            MaxParts: this.options.listPartsPageSize,
            PartNumberMarker: marker,
          }),
          { abortSignal: signal },
        );
        if (typeof page.IsTruncated !== 'boolean')
          throw new StorageError('invalid_response');
        for (const part of page.Parts ?? []) {
          if (
            !Number.isInteger(part.PartNumber) ||
            part.PartNumber === undefined ||
            part.PartNumber <= lastPart ||
            part.PartNumber > STORAGE_LIMITS.MAX_MULTIPART_PARTS ||
            !part.ETag ||
            part.Size === undefined ||
            !Number.isSafeInteger(part.Size) ||
            part.Size < 0
          )
            throw new StorageError('invalid_response');
          parts.push({
            partNumber: part.PartNumber,
            etag: part.ETag,
            size: part.Size,
          });
          lastPart = part.PartNumber;
        }
        if (!page.IsTruncated) return parts;
        const next = page.NextPartNumberMarker;
        if (
          !next ||
          !/^\d+$/.test(next) ||
          Number(next) <= Number(marker ?? '0') ||
          Number(next) > STORAGE_LIMITS.MAX_MULTIPART_PARTS ||
          parts.length >= STORAGE_LIMITS.MAX_MULTIPART_PARTS
        )
          throw new StorageError('invalid_response');
        marker = next;
      }
    });
  }

  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: readonly CompletedStoragePart[],
    callerSignal?: AbortSignal,
  ): Promise<StorageObject> {
    if (
      parts.length < 1 ||
      parts.length > STORAGE_LIMITS.MAX_MULTIPART_PARTS ||
      parts.some(
        (part, index) =>
          !Number.isInteger(part.partNumber) ||
          part.partNumber < 1 ||
          part.partNumber > STORAGE_LIMITS.MAX_MULTIPART_PARTS ||
          !part.etag ||
          (index > 0 && part.partNumber <= parts[index - 1].partNumber),
      )
    )
      throw new StorageError('invalid_multipart');
    return this.run(async (signal) => {
      await this.client.send(
        new CompleteMultipartUploadCommand({
          Bucket: this.config.bucket,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: {
            Parts: parts.map((part) => ({
              PartNumber: part.partNumber,
              ETag: part.etag,
            })),
          },
        }),
        { abortSignal: signal },
      );
      // Re-read authoritative storage length; complete responses do not contain it.
      return this.head(key, signal);
    }, callerSignal);
  }

  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    await this.run(async (signal) => {
      await this.client.send(
        new AbortMultipartUploadCommand({
          Bucket: this.config.bucket,
          Key: key,
          UploadId: uploadId,
        }),
        { abortSignal: signal },
      );
    });
  }

  async headObject(key: string): Promise<StorageObject> {
    return this.run((signal) => this.head(key, signal));
  }

  async deleteObject(key: string): Promise<void> {
    await this.run(async (signal) => {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }),
        { abortSignal: signal },
      );
    });
  }

  private async head(key: string, signal: AbortSignal): Promise<StorageObject> {
    try {
      const output = await this.client.send(
        new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }),
        { abortSignal: signal },
      );
      if (
        output.ContentLength === undefined ||
        !Number.isSafeInteger(output.ContentLength) ||
        output.ContentLength < 0 ||
        !output.ETag
      )
        throw new StorageError('invalid_response');
      return {
        contentLength: output.ContentLength,
        etag: output.ETag,
        contentType: output.ContentType,
      };
    } catch (error: unknown) {
      if (
        error instanceof S3ServiceException &&
        (error.name === 'NoSuchKey' ||
          (error.name === 'NotFound' && error.$metadata.httpStatusCode === 404))
      )
        throw new StorageError('object_not_found');
      throw error;
    }
  }

  private async run<T>(
    work: (signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    return withStorageOperation(work, this.options.operationTimeoutMs, signal);
  }
}
