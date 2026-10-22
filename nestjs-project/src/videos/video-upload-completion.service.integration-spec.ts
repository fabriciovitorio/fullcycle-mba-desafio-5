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
import { VideoUploadCompletionService } from './video-upload-completion.service';
import { VideoProcessingOutbox } from './entities/video-processing-outbox.entity';
import { VideoProcessingOutboxRepository } from './video-processing-outbox.repository';
import { UploadPartCommand } from '@aws-sdk/client-s3';
import { VIDEO_TEST_METADATA } from '../test/video-persistence.fixture';
import { VideosRepository } from './videos.repository';

describe('VideoUploadCompletionService (integration)', () => {
  let module: TestingModule;
  let source: DataSource;
  let uploads: VideoUploadsService;
  let service: VideoUploadCompletionService;
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
    uploads = module.get(VideoUploadsService);
    service = module.get(VideoUploadCompletionService);
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
    const { parts } = await uploads.signParts(owner.userId, id, [1]);
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

  async function prepared(withPart = true) {
    const result = await uploads.initialize(owner.userId, input);
    if (withPart) await uploadPart(result.video.id);
    return storedVideo(result.video.id);
  }

  async function outboxCount(id: string): Promise<number> {
    return source
      .getRepository(VideoProcessingOutbox)
      .countBy({ video_id: id });
  }

  async function expireClaim(id: string): Promise<void> {
    await source
      .getRepository(Video)
      .update(id, { operation_expires_at: new Date(0) });
  }

  async function completeInStorage(row: Video): Promise<void> {
    const parts = await storage.listParts(row.source_key, row.upload_id ?? '');
    await storage.completeMultipartUpload(
      row.source_key,
      row.upload_id ?? '',
      parts,
    );
  }

  async function wrongObject(): Promise<Video> {
    const row = await prepared(false);
    const wrong = Buffer.concat([bytes, Buffer.from('!')]);
    await auxiliary.client.send(
      new UploadPartCommand({
        Bucket: auxiliary.config.bucket,
        Key: row.source_key,
        UploadId: row.upload_id ?? '',
        PartNumber: 1,
        Body: wrong,
        ContentLength: wrong.length,
      }),
    );
    return row;
  }

  function gate() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
      resolve = done;
    });
    return { promise, resolve };
  }

  it('should persist processing and one outbox only after authoritative real completion', async () => {
    const row = await prepared();
    const result = await service.complete(owner.userId, row.id);
    expect(result.video).toMatchObject({
      id: row.id,
      slug: row.slug,
      status: 'processing',
    });
    const persisted = await storedVideo(row.id);
    expect(persisted.actual_size_bytes).toBe(String(bytes.length));
    expect(persisted.upload_operation).toBeNull();
    expect(await outboxCount(row.id)).toBe(1);
    expect((await storage.headObject(row.source_key)).contentLength).toBe(
      bytes.length,
    );
    expect(Object.keys(result.video).sort()).toEqual([
      'createdAt',
      'errorCode',
      'id',
      'slug',
      'status',
      'updatedAt',
    ]);
  });

  it('should replay processing and ready with identical identity and no duplicate intention', async () => {
    const row = await prepared();
    const first = await service.complete(owner.userId, row.id);
    const [intent] = await source
      .getRepository(VideoProcessingOutbox)
      .findBy({ video_id: row.id });
    expect(await service.complete(owner.userId, row.id)).toEqual(first);
    await source.getRepository(Video).update(row.id, {
      status: 'ready',
      duration_seconds: 1,
      metadata: VIDEO_TEST_METADATA,
      playback_key: `videos/${row.id}/attempts/test/playback.mp4`,
      thumbnail_key: `videos/${row.id}/attempts/test/thumbnail.jpg`,
    });
    await source
      .getRepository(VideoProcessingOutbox)
      .update(intent.id, { completed_at: new Date() });
    expect((await service.complete(owner.userId, row.id)).video).toMatchObject({
      id: row.id,
      slug: row.slug,
      status: 'ready',
    });
    expect(
      (
        await source
          .getRepository(VideoProcessingOutbox)
          .findBy({ video_id: row.id })
      )[0].id,
    ).toBe(intent.id);
    expect(await outboxCount(row.id)).toBe(1);
  });

  it('should roll back video and outbox together on real SQL failure, then recover without reupload', async () => {
    const row = await prepared();
    const outbox = module.get(VideoProcessingOutboxRepository);
    const create = jest
      .spyOn(outbox, 'createForVideo')
      .mockImplementationOnce(async (manager, id) => {
        create.mockRestore();
        await outbox.createForVideo(manager, id);
        await manager.query('SELECT si0352_missing_column');
      });
    const complete = jest.spyOn(storage, 'completeMultipartUpload');
    await expect(service.complete(owner.userId, row.id)).rejects.toThrow(
      /si0352_missing_column/,
    );
    expect((await storedVideo(row.id)).status).toBe('draft');
    expect(await outboxCount(row.id)).toBe(0);
    expect((await storage.headObject(row.source_key)).contentLength).toBe(
      bytes.length,
    );
    const list = jest.spyOn(storage, 'listParts');
    expect((await service.complete(owner.userId, row.id)).video.status).toBe(
      'processing',
    );
    expect(list).not.toHaveBeenCalled();
    expect(complete).toHaveBeenCalledTimes(1);
    expect(await outboxCount(row.id)).toBe(1);
  });

  it('should recover an actual completed S3 request whose response is lost', async () => {
    const row = await prepared();
    const complete = jest
      .spyOn(storage, 'completeMultipartUpload')
      .mockImplementationOnce(async (...args) => {
        complete.mockRestore();
        await storage.completeMultipartUpload(...args);
        throw new StorageError('unavailable');
      });
    expect((await service.complete(owner.userId, row.id)).video.status).toBe(
      'processing',
    );
    expect(await outboxCount(row.id)).toBe(1);
  });

  it('should recover a real database commit whose response is lost', async () => {
    const row = await prepared();
    const complete = jest
      .spyOn(repository, 'completeUpload')
      .mockImplementationOnce(async (...args) => {
        complete.mockRestore();
        expect(await repository.completeUpload(...args)).toBe(true);
        throw new Error('Lost commit response');
      });
    expect((await service.complete(owner.userId, row.id)).video.status).toBe(
      'processing',
    );
    expect(await outboxCount(row.id)).toBe(1);
  });

  it('should recover a valid completed object before treating an expired draft as lost', async () => {
    const row = await prepared();
    await completeInStorage(row);
    await source
      .getRepository(Video)
      .update(row.id, { upload_expires_at: new Date(0) });
    expect((await service.complete(owner.userId, row.id)).video.status).toBe(
      'processing',
    );
    expect(await outboxCount(row.id)).toBe(1);
  });

  it('should leave an incomplete upload resumable and never create outbox until valid', async () => {
    const row = await prepared(false);
    await expect(service.complete(owner.userId, row.id)).rejects.toMatchObject({
      errorCode: 'UPLOAD_INCOMPLETE',
    });
    expect(await outboxCount(row.id)).toBe(0);
    expect((await storedVideo(row.id)).upload_operation).toBeNull();
    await uploadPart(row.id);
    expect((await service.complete(owner.userId, row.id)).video.status).toBe(
      'processing',
    );
    expect(await outboxCount(row.id)).toBe(1);
  });

  it('should abort divergent actual part sizes without completing or creating outbox', async () => {
    const row = await wrongObject();
    await expect(service.complete(owner.userId, row.id)).rejects.toMatchObject({
      errorCode: 'UPLOAD_SIZE_MISMATCH',
    });
    expect(await outboxCount(row.id)).toBe(0);
    expect(await storedVideo(row.id)).toMatchObject({
      status: 'error',
      error_code: 'UPLOAD_SIZE_MISMATCH',
    });
    await expect(
      storage.listParts(row.source_key, row.upload_id ?? ''),
    ).rejects.toMatchObject({ kind: 'upload_not_found' });
    await expect(storage.headObject(row.source_key)).rejects.toMatchObject({
      kind: 'object_not_found',
    });
  });

  it('should delete a divergent completed source via the real adapter and keep zero outbox', async () => {
    const row = await wrongObject();
    await completeInStorage(row);
    expect((await storage.headObject(row.source_key)).contentLength).toBe(
      bytes.length + 1,
    );
    await expect(service.complete(owner.userId, row.id)).rejects.toMatchObject({
      errorCode: 'UPLOAD_SIZE_MISMATCH',
    });
    await expect(storage.headObject(row.source_key)).rejects.toMatchObject({
      kind: 'object_not_found',
    });
    await storage.deleteObject(row.source_key); // Idempotent deletion of an absent object.
    expect(await outboxCount(row.id)).toBe(0);
  });

  it('should retain mismatch intent when deletion fails and retry actual cleanup after lease expiry', async () => {
    const row = await wrongObject();
    await completeInStorage(row);
    const remove = jest
      .spyOn(storage, 'deleteObject')
      .mockRejectedValueOnce(new StorageError('unavailable'));
    await expect(service.complete(owner.userId, row.id)).rejects.toMatchObject({
      errorCode: 'STORAGE_UNAVAILABLE',
    });
    expect(await storedVideo(row.id)).toMatchObject({
      status: 'draft',
      error_code: 'UPLOAD_SIZE_MISMATCH',
      upload_operation: 'completing',
    });
    expect((await storage.headObject(row.source_key)).contentLength).toBe(
      bytes.length + 1,
    );
    expect(await outboxCount(row.id)).toBe(0);
    remove.mockRestore();
    await expireClaim(row.id);
    await expect(service.complete(owner.userId, row.id)).rejects.toMatchObject({
      errorCode: 'UPLOAD_SIZE_MISMATCH',
    });
    expect((await storedVideo(row.id)).status).toBe('error');
    await expect(storage.headObject(row.source_key)).rejects.toMatchObject({
      kind: 'object_not_found',
    });
    expect(await outboxCount(row.id)).toBe(0);
  });

  it('should abort a real upload idempotently and preserve its terminal timestamps/code', async () => {
    const row = await prepared();
    await service.abort(owner.userId, row.id);
    const first = await service.getStatus(owner.userId, row.id);
    await service.abort(owner.userId, row.id);
    expect(await service.getStatus(owner.userId, row.id)).toEqual(first);
    expect(first).toMatchObject({
      status: 'error',
      errorCode: 'UPLOAD_ABORTED',
    });
    await expect(service.complete(owner.userId, row.id)).rejects.toMatchObject({
      errorCode: 'INVALID_VIDEO_STATE',
    });
    await expect(
      storage.listParts(row.source_key, row.upload_id ?? ''),
    ).rejects.toMatchObject({ kind: 'upload_not_found' });
    expect(await outboxCount(row.id)).toBe(0);
  });

  it('should reconcile a source completed before abort and never report it as aborted', async () => {
    const row = await prepared();
    await completeInStorage(row);
    await expect(service.abort(owner.userId, row.id)).rejects.toMatchObject({
      errorCode: 'INVALID_VIDEO_STATE',
    });
    expect(await storedVideo(row.id)).toMatchObject({
      status: 'processing',
      error_code: null,
    });
    expect(await outboxCount(row.id)).toBe(1);
  });

  it('should reconcile a remote completion that wins immediately before S3 abort', async () => {
    const row = await prepared();
    const abort = jest
      .spyOn(storage, 'abortMultipartUpload')
      .mockImplementationOnce(async (...args) => {
        abort.mockRestore();
        await completeInStorage(row);
        await storage.abortMultipartUpload(...args);
      });
    await expect(service.abort(owner.userId, row.id)).rejects.toMatchObject({
      errorCode: 'INVALID_VIDEO_STATE',
    });
    expect((await storedVideo(row.id)).status).toBe('processing');
    expect(await outboxCount(row.id)).toBe(1);
  });

  it('should fence abort while a completion owns its claim', async () => {
    const row = await prepared();
    const entered = gate();
    const proceed = gate();
    const list = jest
      .spyOn(storage, 'listParts')
      .mockImplementationOnce(async (...args) => {
        entered.resolve();
        await proceed.promise;
        list.mockRestore();
        return storage.listParts(...args);
      });
    const completing = service.complete(owner.userId, row.id);
    await entered.promise;
    try {
      await expect(service.abort(owner.userId, row.id)).rejects.toMatchObject({
        errorCode: 'UPLOAD_OPERATION_IN_PROGRESS',
      });
    } finally {
      proceed.resolve();
    }
    expect((await completing).video.status).toBe('processing');
    expect(await outboxCount(row.id)).toBe(1);
  });

  it('should fence completion while abort owns its claim', async () => {
    const row = await prepared();
    const entered = gate();
    const proceed = gate();
    const abort = jest
      .spyOn(storage, 'abortMultipartUpload')
      .mockImplementationOnce(async (...args) => {
        entered.resolve();
        await proceed.promise;
        abort.mockRestore();
        await storage.abortMultipartUpload(...args);
      });
    const aborting = service.abort(owner.userId, row.id);
    await entered.promise;
    try {
      await expect(
        service.complete(owner.userId, row.id),
      ).rejects.toMatchObject({ errorCode: 'UPLOAD_OPERATION_IN_PROGRESS' });
    } finally {
      proceed.resolve();
    }
    await aborting;
    expect((await storedVideo(row.id)).error_code).toBe('UPLOAD_ABORTED');
    expect(await outboxCount(row.id)).toBe(0);
  });

  it('should create only one intention with two concurrent completion requests', async () => {
    const row = await prepared();
    const results = await Promise.allSettled([
      service.complete(owner.userId, row.id),
      service.complete(owner.userId, row.id),
    ]);
    expect(results.some((result) => result.status === 'fulfilled')).toBe(true);
    for (const result of results) {
      if (result.status === 'rejected')
        expect(result.reason).toMatchObject({
          errorCode: 'UPLOAD_OPERATION_IN_PROGRESS',
        });
    }
    expect((await service.complete(owner.userId, row.id)).video.status).toBe(
      'processing',
    );
    expect(await outboxCount(row.id)).toBe(1);
  });

  it('should stop a stale claim before completing S3 or creating outbox', async () => {
    const row = await prepared();
    const list = jest
      .spyOn(storage, 'listParts')
      .mockImplementationOnce(async (...args) => {
        list.mockRestore();
        const parts = await storage.listParts(...args);
        await source
          .getRepository(Video)
          .update(row.id, { operation_token: randomUUID() });
        return parts;
      });
    await expect(service.complete(owner.userId, row.id)).rejects.toMatchObject({
      errorCode: 'UPLOAD_OPERATION_IN_PROGRESS',
    });
    await expect(storage.headObject(row.source_key)).rejects.toMatchObject({
      kind: 'object_not_found',
    });
    expect(await outboxCount(row.id)).toBe(0);
  });

  it('should retain completed S3 bytes when the DB claim expires and recover with a new token', async () => {
    const row = await prepared();
    const complete = jest
      .spyOn(storage, 'completeMultipartUpload')
      .mockImplementationOnce(async (...args) => {
        complete.mockRestore();
        const result = await storage.completeMultipartUpload(...args);
        await expireClaim(row.id);
        return result;
      });
    await expect(service.complete(owner.userId, row.id)).rejects.toMatchObject({
      errorCode: 'UPLOAD_OPERATION_IN_PROGRESS',
    });
    expect(await outboxCount(row.id)).toBe(0);
    expect((await storage.headObject(row.source_key)).contentLength).toBe(
      bytes.length,
    );
    expect((await service.complete(owner.userId, row.id)).video.status).toBe(
      'processing',
    );
    expect(await outboxCount(row.id)).toBe(1);
  });

  it('should recover an interrupted abort after actual SQL failure without processing remaining bytes', async () => {
    const row = await prepared();
    jest.spyOn(repository, 'failUpload').mockImplementationOnce(async () => {
      await source.query('SELECT si0352_missing_column');
      return false;
    });
    await expect(service.abort(owner.userId, row.id)).rejects.toThrow(
      /si0352_missing_column/,
    );
    expect((await storedVideo(row.id)).upload_operation).toBe('aborting');
    await expireClaim(row.id);
    await expect(service.complete(owner.userId, row.id)).rejects.toMatchObject({
      errorCode: 'INVALID_VIDEO_STATE',
    });
    expect((await storedVideo(row.id)).error_code).toBe('UPLOAD_ABORTED');
    expect(await outboxCount(row.id)).toBe(0);
  });

  it('should expire an uncompleted real session without creating outbox', async () => {
    const row = await prepared();
    await source
      .getRepository(Video)
      .update(row.id, { upload_expires_at: new Date(0) });
    await expect(service.complete(owner.userId, row.id)).rejects.toMatchObject({
      errorCode: 'UPLOAD_EXPIRED',
      httpStatus: 410,
    });
    expect((await storedVideo(row.id)).error_code).toBe('UPLOAD_EXPIRED');
    await expect(
      storage.listParts(row.source_key, row.upload_id ?? ''),
    ).rejects.toMatchObject({ kind: 'upload_not_found' });
    expect(await outboxCount(row.id)).toBe(0);
  });

  it('should hide foreign-channel operations and expose only safe owner status', async () => {
    const row = await prepared();
    const head = jest.spyOn(storage, 'headObject');
    for (const action of [
      () => service.complete(other.userId, row.id),
      () => service.abort(other.userId, row.id),
      () => service.getStatus(other.userId, row.id),
    ])
      await expect(action()).rejects.toMatchObject({
        errorCode: 'VIDEO_NOT_FOUND',
        httpStatus: 404,
      });
    await source.getRepository(Video).update(row.id, {
      status: 'error',
      error_code: 'internal stderr details',
      error_message: 'not public',
    });
    const status = await service.getStatus(owner.userId, row.id);
    expect(status).toMatchObject({
      id: row.id,
      status: 'error',
      errorCode: null,
    });
    expect(JSON.stringify(status)).not.toMatch(
      /stderr|source_key|upload_id|error_message|bucket/,
    );
    expect(head).not.toHaveBeenCalled();
  });
});
