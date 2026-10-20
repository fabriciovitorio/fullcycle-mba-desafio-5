import { jest } from '@jest/globals';
import { Inject, Injectable, Module } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { S3Client } from '@aws-sdk/client-s3';
import storageConfig from '../config/storage.config';
import {
  createStorageFixture,
  type StorageFixture,
} from '../test/storage.fixture';
import { StorageModule } from './storage.module';
import { S3_CLIENT, S3_SIGNING_CLIENT } from './storage.constants';
import { STORAGE, type StoragePort } from './storage.port';
import {
  STORAGE_SIGNING,
  type StorageSigningPort,
} from './storage-signing.port';
import {
  STORAGE_FILES,
  type StorageFileTransferPort,
} from './storage-file-transfer.port';
import { S3StorageService } from './s3-storage.service';
import { StorageSigningService } from './storage-signing.service';
import { StorageFileTransferService } from './storage-file-transfer.service';

@Injectable()
class StorageConsumer {
  constructor(
    @Inject(STORAGE) readonly control: StoragePort,
    @Inject(STORAGE_SIGNING) readonly signing: StorageSigningPort,
    @Inject(STORAGE_FILES) readonly files: StorageFileTransferPort,
  ) {}
}

@Module({
  imports: [StorageModule],
  providers: [StorageConsumer],
  exports: [StorageConsumer],
})
class StorageConsumerModule {}

describe('StorageModule (integration)', () => {
  let fixture: StorageFixture;
  let module: TestingModule;
  let closed: boolean;
  let consumer: StorageConsumer;
  beforeEach(async () => {
    fixture = await createStorageFixture({
      publicEndpoint: 'http://streamtube-test-minio-1:9000',
    });
    module = await Test.createTestingModule({
      imports: [StorageConsumerModule],
    })
      .overrideProvider(storageConfig.KEY)
      .useValue(fixture.config)
      .compile();
    closed = false;
    consumer = module.get(StorageConsumer);
  });
  afterEach(async () => {
    try {
      if (!closed) await module?.close();
    } finally {
      jest.restoreAllMocks();
      await fixture?.cleanup();
    }
  });

  it('should export each port once and configure distinct internal and consumer clients', async () => {
    expect(consumer.control).toBe(module.get(S3StorageService));
    expect(consumer.signing).toBe(module.get(StorageSigningService));
    expect(consumer.files).toBe(module.get(StorageFileTransferService));
    const internal = module.get<S3Client>(S3_CLIENT);
    const signing = module.get<S3Client>(S3_SIGNING_CLIENT);
    expect(internal).not.toBe(signing);
    expect(await internal.config.endpoint?.()).toMatchObject({
      hostname: 'minio',
      port: 9000,
    });
    expect(await signing.config.endpoint?.()).toMatchObject({
      hostname: 'streamtube-test-minio-1',
      port: 9000,
    });
    expect(internal.config.forcePathStyle).toBe(true);
    expect(await internal.config.requestChecksumCalculation()).toBe(
      'WHEN_REQUIRED',
    );
    expect(await signing.config.responseChecksumValidation()).toBe(
      'WHEN_REQUIRED',
    );
  });

  it('should write through the real consumer origin and list through the internal endpoint', async () => {
    const key = fixture.key();
    const uploadId = await consumer.control.createMultipartUpload(
      key,
      'video/mp4',
    );
    const signed = await consumer.signing.signUploadPart({
      key,
      uploadId,
      partNumber: 1,
      sizeBytes: 4,
      sessionExpiresAt: new Date(Date.now() + 60000),
    });
    expect(new URL(signed.url).origin).toBe(fixture.config.publicEndpoint);
    const put = await fetch(signed.url, {
      method: 'PUT',
      headers: signed.headers,
      body: Buffer.from('real'),
    });
    expect(put.status).toBe(200);
    await put.arrayBuffer();
    const parts = await consumer.control.listParts(key, uploadId);
    expect(parts).toEqual([
      { partNumber: 1, size: 4, etag: put.headers.get('etag') },
    ]);
    await consumer.control.completeMultipartUpload(key, uploadId, parts);
    const get = await consumer.signing.signGetObject({
      key,
      contentType: 'video/mp4',
      disposition: 'inline',
    });
    expect(new URL(get.url).origin).toBe(fixture.config.publicEndpoint);
    const response = await fetch(get.url);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('real');
  });

  it('should close both distinct clients exactly once when the consumer module closes', async () => {
    const internal = jest.spyOn(module.get<S3Client>(S3_CLIENT), 'destroy');
    const signing = jest.spyOn(
      module.get<S3Client>(S3_SIGNING_CLIENT),
      'destroy',
    );
    await module.close();
    closed = true;
    expect(internal).toHaveBeenCalledTimes(1);
    expect(signing).toHaveBeenCalledTimes(1);
  });
});
