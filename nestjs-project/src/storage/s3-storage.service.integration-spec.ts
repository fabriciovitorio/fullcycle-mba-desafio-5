import { createHash, randomUUID } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  S3Client,
  UploadPartCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  AbortMultipartUploadCommand,
} from '@aws-sdk/client-s3';
import storageConfig from '../config/storage.config';
import { StorageModule } from './storage.module';
import { S3StorageService } from './s3-storage.service';
import { STORAGE, type StoragePort } from './storage.port';
import { StorageError } from './storage.error';
import { S3_CLIENT, S3_STORAGE_OPTIONS } from './storage.constants';

describe('S3StorageService (integration)', () => {
  let module: TestingModule;
  let storage: StoragePort;
  let client: S3Client;
  const keys = new Set<string>();
  const sessions: { key: string; uploadId: string }[] = [];
  let bucket: string;

  beforeAll(async () => {
    expect(process.env.STORAGE_BUCKET).toBe('streamtube-test-videos');
    expect(process.env.STORAGE_ENDPOINT).toBe('http://minio:9000');
    module = await Test.createTestingModule({ imports: [StorageModule] })
      .overrideProvider(S3_STORAGE_OPTIONS)
      .useValue({ operationTimeoutMs: 5000, listPartsPageSize: 1 })
      .compile();
    storage = module.get<StoragePort>(STORAGE);
    expect(storage).toBe(module.get(S3StorageService));
    const config = storageConfig();
    bucket = config.bucket;
    client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: config.credentials,
      forcePathStyle: config.forcePathStyle,
      requestChecksumCalculation: config.requestChecksumCalculation,
      responseChecksumValidation: config.responseChecksumValidation,
      maxAttempts: 1,
    });
  });

  afterAll(async () => {
    try {
      for (const session of sessions) {
        try {
          await client.send(
            new AbortMultipartUploadCommand({
              Bucket: bucket,
              Key: session.key,
              UploadId: session.uploadId,
            }),
          );
        } catch (error) {
          if (!(error instanceof Error) || error.name !== 'NoSuchUpload')
            throw error;
        }
      }
      for (const key of keys)
        await client.send(
          new DeleteObjectCommand({ Bucket: bucket, Key: key }),
        );
    } finally {
      client?.destroy();
      await module?.close();
    }
  });

  async function session(): Promise<{ key: string; uploadId: string }> {
    const key = `integration/si0341/${randomUUID()}/source`;
    keys.add(key);
    const uploadId = await storage.createMultipartUpload(key, 'video/mp4');
    const value = { key, uploadId };
    sessions.push(value);
    return value;
  }

  it('should list multiple real pages and complete exactly the uploaded bytes', async () => {
    const { key, uploadId } = await session();
    expect(await storage.listParts(key, uploadId)).toEqual([]);
    const first = Buffer.alloc(5 * 1024 * 1024, 0x61);
    const last = Buffer.from('last-part-real-bytes');
    const one = await client.send(
      new UploadPartCommand({
        Bucket: bucket,
        Key: key,
        UploadId: uploadId,
        PartNumber: 1,
        ContentLength: first.length,
        Body: first,
      }),
    );
    const two = await client.send(
      new UploadPartCommand({
        Bucket: bucket,
        Key: key,
        UploadId: uploadId,
        PartNumber: 2,
        ContentLength: last.length,
        Body: last,
      }),
    );
    const parts = await storage.listParts(key, uploadId);
    expect(parts).toEqual([
      { partNumber: 1, etag: one.ETag, size: first.length },
      { partNumber: 2, etag: two.ETag, size: last.length },
    ]);
    const result = await storage.completeMultipartUpload(key, uploadId, parts);
    expect(result.contentLength).toBe(first.length + last.length);
    expect(result.contentType).toBe('video/mp4');
    const object = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );
    if (!object.Body) throw new Error('Missing storage response body');
    const received = await object.Body.transformToByteArray();
    expect(received.byteLength).toBe(first.length + last.length);
    expect(createHash('sha256').update(received).digest('hex')).toBe(
      createHash('sha256').update(first).update(last).digest('hex'),
    );
    // A completed upload may be idempotently replayed, or be absent and reconciled
    // by its server-owned immutable object key. Other failures must propagate.
    try {
      expect(
        await storage.completeMultipartUpload(key, uploadId, parts),
      ).toEqual(result);
    } catch (error) {
      if (!(error instanceof StorageError) || error.kind !== 'upload_not_found')
        throw error;
      expect(await storage.headObject(key)).toEqual(result);
    }
  });

  it('should abort the actual upload and reject subsequent part writes with that upload id', async () => {
    const { key, uploadId } = await session();
    await client.send(
      new UploadPartCommand({
        Bucket: bucket,
        Key: key,
        UploadId: uploadId,
        PartNumber: 1,
        ContentLength: 4,
        Body: Buffer.from('part'),
      }),
    );
    await storage.abortMultipartUpload(key, uploadId);
    await expect(storage.listParts(key, uploadId)).rejects.toMatchObject({
      kind: 'upload_not_found',
    });
    await expect(
      client.send(
        new UploadPartCommand({
          Bucket: bucket,
          Key: key,
          UploadId: uploadId,
          PartNumber: 1,
          ContentLength: 4,
          Body: Buffer.from('part'),
        }),
      ),
    ).rejects.toMatchObject({ name: 'NoSuchUpload' });
    await expect(storage.headObject(key)).rejects.toMatchObject({
      kind: 'object_not_found',
    });
  });

  it('should reject an etag that differs from the actual stored part', async () => {
    const { key, uploadId } = await session();
    await client.send(
      new UploadPartCommand({
        Bucket: bucket,
        Key: key,
        UploadId: uploadId,
        PartNumber: 1,
        ContentLength: 4,
        Body: Buffer.from('part'),
      }),
    );
    await expect(
      storage.completeMultipartUpload(key, uploadId, [
        { partNumber: 1, etag: '"00000000000000000000000000000000"' },
      ]),
    ).rejects.toMatchObject({ kind: 'invalid_multipart' });
    await expect(storage.headObject(key)).rejects.toMatchObject({
      kind: 'object_not_found',
    });
  });

  it('should distinguish actual connection unavailability from a missing object', async () => {
    const config = storageConfig();
    const offline = new S3Client({
      endpoint: 'http://minio:1',
      region: config.region,
      credentials: config.credentials,
      forcePathStyle: true,
      maxAttempts: 1,
    });
    const unavailableModule = await Test.createTestingModule({
      imports: [StorageModule],
    })
      .overrideProvider(S3_CLIENT)
      .useValue(offline)
      .overrideProvider(S3_STORAGE_OPTIONS)
      .useValue({ operationTimeoutMs: 500, listPartsPageSize: 1 })
      .compile();
    try {
      await expect(
        unavailableModule.get<StoragePort>(STORAGE).headObject('missing'),
      ).rejects.toMatchObject({ kind: 'unavailable' });
    } finally {
      await unavailableModule.close();
    }
    await expect(
      storage.headObject(`integration/si0341/${randomUUID()}/absent`),
    ).rejects.toMatchObject({ kind: 'object_not_found' });
  });
});
