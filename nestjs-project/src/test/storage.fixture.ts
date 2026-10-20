import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import {
  AbortMultipartUploadCommand,
  DeleteObjectCommand,
  ListMultipartUploadsCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import storageConfig from '../config/storage.config';
import videosConfig from '../config/videos.config';
import { StorageModule } from '../storage/storage.module';
import {
  S3_CLIENT,
  S3_STORAGE_OPTIONS,
  S3_TRANSFER_OPTIONS,
} from '../storage/storage.constants';
import { STORAGE, type StoragePort } from '../storage/storage.port';
import {
  STORAGE_SIGNING,
  type StorageSigningPort,
} from '../storage/storage-signing.port';
import {
  STORAGE_FILES,
  type StorageFileTransferPort,
} from '../storage/storage-file-transfer.port';

export async function createStorageFixture(
  options: { publicEndpoint?: string; signedUrlTtlSeconds?: number } = {},
) {
  if (
    process.env.STORAGE_BUCKET !== 'streamtube-test-videos' ||
    process.env.STORAGE_ENDPOINT !== 'http://minio:9000'
  )
    throw new Error(
      'Storage integration tests require the dedicated Docker test bucket',
    );
  const config = {
    ...storageConfig(),
    ...(options.publicEndpoint
      ? { publicEndpoint: options.publicEndpoint }
      : {}),
  };
  const videoConfig = {
    ...videosConfig(),
    ...(options.signedUrlTtlSeconds === undefined
      ? {}
      : { signedUrlTtlSeconds: options.signedUrlTtlSeconds }),
  };
  const module = await Test.createTestingModule({ imports: [StorageModule] })
    .overrideProvider(storageConfig.KEY)
    .useValue(config)
    .overrideProvider(videosConfig.KEY)
    .useValue(videoConfig)
    .overrideProvider(S3_STORAGE_OPTIONS)
    .useValue({ operationTimeoutMs: 5000, listPartsPageSize: 1000 })
    .overrideProvider(S3_TRANSFER_OPTIONS)
    .useValue({ partSizeBytes: 5 * 1024 * 1024, transferTimeoutMs: 15000 })
    .compile();
  const client = module.get<S3Client>(S3_CLIENT);
  const storage = module.get<StoragePort>(STORAGE);
  const signing = module.get<StorageSigningPort>(STORAGE_SIGNING);
  const files = module.get<StorageFileTransferPort>(STORAGE_FILES);
  const prefix = `integration/si0342/${randomUUID()}/`;
  const keys = new Set<string>();
  function key(name: string = randomUUID()): string {
    const value = prefix + name;
    keys.add(value);
    return value;
  }
  async function uploads(value: string) {
    const result = await client.send(
      new ListMultipartUploadsCommand({ Bucket: config.bucket, Prefix: value }),
    );
    if (result.IsTruncated)
      throw new Error('Unexpected test cleanup pagination');
    return (result.Uploads ?? []).filter((upload) => upload.Key === value);
  }
  async function cleanup(): Promise<void> {
    try {
      for (const value of keys) {
        for (const upload of await uploads(value))
          await client.send(
            new AbortMultipartUploadCommand({
              Bucket: config.bucket,
              Key: value,
              UploadId: upload.UploadId,
            }),
          );
        await client.send(
          new DeleteObjectCommand({ Bucket: config.bucket, Key: value }),
        );
      }
    } finally {
      await module.close();
    }
  }
  return {
    module,
    client,
    storage,
    signing,
    files,
    config,
    key,
    uploads,
    cleanup,
  };
}

export type StorageFixture = Awaited<ReturnType<typeof createStorageFixture>>;
