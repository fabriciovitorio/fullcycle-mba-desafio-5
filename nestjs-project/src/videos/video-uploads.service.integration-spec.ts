import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  AbortMultipartUploadCommand,
  DeleteObjectCommand,
  ListMultipartUploadsCommand,
} from '@aws-sdk/client-s3';
import { ChannelsService } from '../channels/channels.service';
import { User } from '../users/entities/user.entity';
import {
  createTestDataSource,
  cleanAllTables,
} from '../test/create-test-data-source';
import { TEST_ENTITIES } from '../test/test-entities';
import {
  createStorageFixture,
  type StorageFixture,
} from '../test/storage.fixture';
import { STORAGE, type StoragePort } from '../storage/storage.port';
import { StorageError } from '../storage/storage.error';
import { Video } from './entities/video.entity';
import { VideosModule } from './videos.module';
import { VideoUploadsService } from './video-uploads.service';
import { VideosRepository } from './videos.repository';

describe('VideoUploadsService (integration)', () => {
  let module: TestingModule;
  let source: DataSource;
  let service: VideoUploadsService;
  let repository: VideosRepository;
  let storage: StoragePort;
  let auxiliary: StorageFixture;
  let owner: { userId: string; channelId: string };
  let other: { userId: string; channelId: string };
  const bytes = Buffer.from('actual-real-part');
  const input = {
    title: ' My video ',
    fileName: 'original.mp4',
    contentType: 'video/mp4',
    sizeBytes: bytes.length,
  };

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot(createTestDataSource(TEST_ENTITIES).options),
        VideosModule,
      ],
    }).compile();
    source = module.get(DataSource);
    service = module.get(VideoUploadsService);
    repository = module.get(VideosRepository);
    storage = module.get<StoragePort>(STORAGE);
    auxiliary = await createStorageFixture();
  });

  async function createOwner(withChannel = true) {
    const user = await source.getRepository(User).save({
      email: `upload-${randomUUID()}@example.com`,
      password: 'test-only',
    });
    const channel = withChannel
      ? await module.get(ChannelsService).createChannel(user.id, user.email)
      : null;
    return { userId: user.id, channelId: channel?.id ?? '' };
  }

  beforeEach(async () => {
    await cleanAllTables(source);
    owner = await createOwner();
    other = await createOwner();
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    // This serial suite owns only rows inserted after its beforeEach cleanup.
    for (const video of await source.getRepository(Video).find()) {
      const uploads = await auxiliary.client.send(
        new ListMultipartUploadsCommand({
          Bucket: auxiliary.config.bucket,
          Prefix: video.source_key,
        }),
      );
      if (uploads.IsTruncated)
        throw new Error('Unexpected fixture multipart pagination');
      for (const upload of uploads.Uploads ?? []) {
        if (upload.Key === video.source_key)
          await auxiliary.client.send(
            new AbortMultipartUploadCommand({
              Bucket: auxiliary.config.bucket,
              Key: video.source_key,
              UploadId: upload.UploadId,
            }),
          );
      }
      await auxiliary.client.send(
        new DeleteObjectCommand({
          Bucket: auxiliary.config.bucket,
          Key: video.source_key,
        }),
      );
    }
    await cleanAllTables(source);
  });
  afterAll(async () => {
    try {
      await auxiliary?.cleanup();
    } finally {
      await module?.close();
    }
  });

  async function storedVideo(id: string): Promise<Video> {
    const value = await repository.findUploadForOwner(id, owner.channelId);
    if (!value) throw new Error('Expected persisted owner video');
    return value;
  }

  async function uploadPart(id: string) {
    const { parts } = await service.signParts(owner.userId, id, [1]);
    expect(parts[0].headers['Content-Length']).toBe(String(bytes.length));
    const response = await fetch(parts[0].url, {
      method: 'PUT',
      headers: parts[0].headers,
      body: bytes,
    });
    expect(response.status).toBe(200);
    await response.arrayBuffer();
    return response.headers.get('etag');
  }

  it('should commit draft/identity and initialization claim before creating any real S3 session', async () => {
    const create = jest
      .spyOn(storage, 'createMultipartUpload')
      .mockImplementationOnce(async (key, type) => {
        const persisted = await source
          .getRepository(Video)
          .findOneByOrFail({ source_key: key });
        expect(persisted.status).toBe('draft');
        expect(persisted.slug).toMatch(/^[0-9a-f]{24}$/);
        expect(persisted.upload_operation).toBe('initializing');
        expect(persisted.operation_token).not.toBeNull();
        expect(persisted.channel_id).toBe(owner.channelId);
        create.mockRestore();
        return storage.createMultipartUpload(key, type);
      });
    const result = await service.initialize(owner.userId, input);
    const row = await storedVideo(result.video.id);
    expect(row.title).toBe('My video');
    expect(row.upload_id).toBeTruthy();
    expect(row.upload_operation).toBeNull();
    expect(row.upload_expires_at).toEqual(result.upload.expiresAt);
    expect(result.video.slug).toBe(row.slug);
    expect(JSON.stringify(result)).not.toMatch(
      /source_key|upload_id|channel_id|bucket/,
    );
    expect(
      await storage.listParts(row.source_key, row.upload_id ?? ''),
    ).toEqual([]);
  });

  it('should resume real uploaded bytes with the same ID/slug and no extra S3 session', async () => {
    const initial = await service.initialize(owner.userId, input);
    const etag = await uploadPart(initial.video.id);
    const resumed = await service.resume(owner.userId, initial.video.id);
    const repeated = await service.resume(owner.userId, initial.video.id);
    expect(resumed.video.id).toBe(initial.video.id);
    expect(resumed.video.slug).toBe(initial.video.slug);
    expect(repeated).toEqual(resumed);
    expect(resumed.upload.parts).toEqual([
      { partNumber: 1, sizeBytes: bytes.length, etag },
    ]);
    expect(await source.getRepository(Video).count()).toBe(1);
    const row = await storedVideo(initial.video.id);
    const sessions = await auxiliary.client.send(
      new ListMultipartUploadsCommand({
        Bucket: auxiliary.config.bucket,
        Prefix: row.source_key,
      }),
    );
    expect(sessions.Uploads).toHaveLength(1);
  });

  it('should hide owner session and permissions from another actual channel', async () => {
    const initial = await service.initialize(owner.userId, input);
    const list = jest.spyOn(storage, 'listParts');
    await expect(
      service.resume(other.userId, initial.video.id),
    ).rejects.toMatchObject({ errorCode: 'VIDEO_NOT_FOUND', httpStatus: 404 });
    await expect(
      service.signParts(other.userId, initial.video.id, [1]),
    ).rejects.toMatchObject({ errorCode: 'VIDEO_NOT_FOUND' });
    expect(list).not.toHaveBeenCalled();
    expect((await storedVideo(initial.video.id)).channel_id).toBe(
      owner.channelId,
    );
  });

  it('should distinguish missing channel for creation from missing private video', async () => {
    const noChannel = await createOwner(false);
    await expect(
      service.initialize(noChannel.userId, input),
    ).rejects.toMatchObject({ errorCode: 'CHANNEL_NOT_FOUND' });
    await expect(
      service.resume(noChannel.userId, randomUUID()),
    ).rejects.toMatchObject({ errorCode: 'VIDEO_NOT_FOUND' });
    expect(await source.getRepository(Video).count()).toBe(0);
  });

  it('should refuse expired sessions without aborting or destroying a recoverable draft', async () => {
    const initial = await service.initialize(owner.userId, input);
    await source
      .getRepository(Video)
      .update(initial.video.id, { upload_expires_at: new Date(0) });
    await expect(
      service.resume(owner.userId, initial.video.id),
    ).rejects.toMatchObject({ errorCode: 'UPLOAD_EXPIRED', httpStatus: 410 });
    await expect(
      service.signParts(owner.userId, initial.video.id, [1]),
    ).rejects.toMatchObject({ errorCode: 'UPLOAD_EXPIRED' });
    const row = await storedVideo(initial.video.id);
    expect(row.status).toBe('draft');
    expect(
      await storage.listParts(row.source_key, row.upload_id ?? ''),
    ).toEqual([]);
  });

  it('should preserve already completed S3 bytes across expiry while awaiting DB reconciliation', async () => {
    const initial = await service.initialize(owner.userId, input);
    await uploadPart(initial.video.id);
    const row = await storedVideo(initial.video.id);
    const parts = await storage.listParts(row.source_key, row.upload_id ?? '');
    await storage.completeMultipartUpload(
      row.source_key,
      row.upload_id ?? '',
      parts,
    );
    await source
      .getRepository(Video)
      .update(row.id, { upload_expires_at: new Date(0) });
    await expect(service.resume(owner.userId, row.id)).rejects.toMatchObject({
      errorCode: 'UPLOAD_OPERATION_IN_PROGRESS',
    });
    await expect(
      service.signParts(owner.userId, row.id, [1]),
    ).rejects.toMatchObject({ errorCode: 'UPLOAD_OPERATION_IN_PROGRESS' });
    expect((await storage.headObject(row.source_key)).contentLength).toBe(
      bytes.length,
    );
    expect((await storedVideo(row.id)).status).toBe('draft');
  });

  it.each(['rememberUploadSession', 'attachUploadSession'] as const)(
    'should abort the real multipart and persist initialization failure after real SQL error in %s',
    async (method) => {
      jest.spyOn(repository, method).mockImplementationOnce(async () => {
        await source.query('SELECT si0351_missing_column');
        return false;
      });
      await expect(service.initialize(owner.userId, input)).rejects.toThrow(
        /si0351_missing_column/,
      );
      const row = await source
        .getRepository(Video)
        .findOneByOrFail({ channel_id: owner.channelId });
      expect(row.status).toBe('error');
      expect(row.error_code).toBe('UPLOAD_INITIALIZATION_FAILED');
      expect(row.upload_operation).toBeNull();
      const sessions = await auxiliary.client.send(
        new ListMultipartUploadsCommand({
          Bucket: auxiliary.config.bucket,
          Prefix: row.source_key,
        }),
      );
      expect(sessions.Uploads ?? []).toEqual([]);
    },
  );

  it('should retain the persisted upload ID and claim if compensating abort is unavailable', async () => {
    jest
      .spyOn(repository, 'attachUploadSession')
      .mockImplementationOnce(async () => {
        await source.query('SELECT si0351_missing_column');
        return false;
      });
    jest
      .spyOn(storage, 'abortMultipartUpload')
      .mockRejectedValueOnce(new StorageError('unavailable'));
    await expect(service.initialize(owner.userId, input)).rejects.toMatchObject(
      { errorCode: 'STORAGE_UNAVAILABLE' },
    );
    const [row] = await source.getRepository(Video).find();
    const pending = await storedVideo(row.id);
    expect(pending.upload_id).toBeTruthy();
    expect(pending.status).toBe('draft');
    expect(pending.upload_operation).toBe('initializing');
    expect(
      await storage.listParts(row.source_key, pending.upload_id ?? ''),
    ).toEqual([]);
    await expect(
      service.signParts(owner.userId, row.id, [1]),
    ).rejects.toMatchObject({ errorCode: 'UPLOAD_OPERATION_IN_PROGRESS' });
  });

  it('should retain an identifiable initializing draft for a remote create whose response was lost', async () => {
    const create = jest
      .spyOn(storage, 'createMultipartUpload')
      .mockImplementationOnce(async (key, type) => {
        create.mockRestore();
        await storage.createMultipartUpload(key, type);
        throw new StorageError('unavailable');
      });
    await expect(service.initialize(owner.userId, input)).rejects.toMatchObject(
      { errorCode: 'STORAGE_UNAVAILABLE' },
    );
    const [row] = await source.getRepository(Video).find();
    const pending = await storedVideo(row.id);
    expect(pending.upload_id).toBeNull();
    expect(pending.upload_operation).toBe('initializing');
    const sessions = await auxiliary.client.send(
      new ListMultipartUploadsCommand({
        Bucket: auxiliary.config.bucket,
        Prefix: row.source_key,
      }),
    );
    expect(sessions.Uploads).toHaveLength(1);
    await expect(service.resume(owner.userId, row.id)).rejects.toMatchObject({
      errorCode: 'UPLOAD_OPERATION_IN_PROGRESS',
    });
  });

  it('should recover a successful DB attachment whose response was lost without aborting it', async () => {
    const attach = jest
      .spyOn(repository, 'attachUploadSession')
      .mockImplementationOnce(async (...args) => {
        attach.mockRestore();
        expect(await repository.attachUploadSession(...args)).toBe(true);
        throw new Error('Response lost after commit');
      });
    const result = await service.initialize(owner.userId, input);
    expect((await storedVideo(result.video.id)).upload_operation).toBeNull();
    await uploadPart(result.video.id);
    expect(
      (await service.resume(owner.userId, result.video.id)).upload.parts[0]
        .sizeBytes,
    ).toBe(bytes.length);
  });

  it('should refuse a stale initializer without aborting the session after claim ownership changes', async () => {
    const create = jest
      .spyOn(storage, 'createMultipartUpload')
      .mockImplementationOnce(async (key, type) => {
        create.mockRestore();
        const uploadId = await storage.createMultipartUpload(key, type);
        await source.getRepository(Video).update(
          { source_key: key },
          {
            operation_token: randomUUID(),
            operation_expires_at: new Date(0),
          },
        );
        return uploadId;
      });
    const abort = jest.spyOn(storage, 'abortMultipartUpload');
    await expect(service.initialize(owner.userId, input)).rejects.toMatchObject(
      { errorCode: 'UPLOAD_OPERATION_IN_PROGRESS' },
    );
    expect(abort).not.toHaveBeenCalled();
    const [row] = await source.getRepository(Video).find();
    expect(row.status).toBe('draft');
    expect(row.upload_operation).toBe('initializing');
    const sessions = await auxiliary.client.send(
      new ListMultipartUploadsCommand({
        Bucket: auxiliary.config.bucket,
        Prefix: row.source_key,
      }),
    );
    expect(sessions.Uploads).toHaveLength(1);
  });

  it('should refuse incompatible state and active operation before granting any new part permission', async () => {
    const initial = await service.initialize(owner.userId, input);
    await source.getRepository(Video).update(initial.video.id, {
      upload_operation: 'completing',
      operation_token: randomUUID(),
      operation_expires_at: new Date(Date.now() + 60000),
    });
    await expect(
      service.signParts(owner.userId, initial.video.id, [1]),
    ).rejects.toMatchObject({ errorCode: 'UPLOAD_OPERATION_IN_PROGRESS' });
    await source.getRepository(Video).update(initial.video.id, {
      status: 'error',
      error_code: 'UPLOAD_ABORTED',
    });
    await expect(
      service.signParts(owner.userId, initial.video.id, [1]),
    ).rejects.toMatchObject({ errorCode: 'INVALID_VIDEO_STATE' });
  });
});
