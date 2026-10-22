import { jest } from '@jest/globals';
import { Test, type TestingModule } from '@nestjs/testing';
import { ChannelsService } from '../channels/channels.service';
import { Channel } from '../channels/entities/channel.entity';
import {
  STORAGE,
  type StorageObject,
  type StoragePort,
} from '../storage/storage.port';
import { StorageError } from '../storage/storage.error';
import { Video, type VideoStatus } from './entities/video.entity';
import { VideosRepository } from './videos.repository';
import { VideoUploadCompletionService } from './video-upload-completion.service';
import { VIDEO_LIMITS } from './videos.constants';

type Repo = jest.Mocked<
  Pick<
    VideosRepository,
    | 'findOwnedById'
    | 'findUploadForOwner'
    | 'claimUpload'
    | 'completeUpload'
    | 'releaseUpload'
    | 'failUpload'
    | 'rememberUploadFailure'
    | 'changeUploadOperation'
  >
>;

function video(overrides: Partial<Video> = {}): Video {
  return Object.assign(new Video(), {
    id: 'video-id',
    slug: '0123456789abcdef01234567',
    channel_id: 'channel-id',
    source_key: 'videos/video-id/source',
    upload_id: 'upload-id',
    declared_size_bytes: '16',
    upload_expires_at: new Date(Date.now() + 86400000),
    upload_operation: null,
    operation_token: null,
    operation_expires_at: null,
    status: 'draft',
    error_code: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  });
}

describe('VideoUploadCompletionService', () => {
  let module: TestingModule;
  let service: VideoUploadCompletionService;
  let current: Video;
  let object: StorageObject | null;
  let repository: Repo;
  let channels: jest.Mocked<Pick<ChannelsService, 'findByUserId'>>;
  let storage: jest.Mocked<
    Pick<
      StoragePort,
      | 'headObject'
      | 'listParts'
      | 'completeMultipartUpload'
      | 'abortMultipartUpload'
      | 'deleteObject'
    >
  >;
  beforeEach(async () => {
    current = video();
    object = null;
    repository = {
      findOwnedById: jest
        .fn<VideosRepository['findOwnedById']>()
        .mockImplementation(() => Promise.resolve(current)),
      findUploadForOwner: jest
        .fn<VideosRepository['findUploadForOwner']>()
        .mockImplementation(() => Promise.resolve(current)),
      claimUpload: jest
        .fn<VideosRepository['claimUpload']>()
        .mockImplementation((_id, _channel, operation) => {
          const previousOperation = current.upload_operation;
          current = video({
            ...current,
            upload_operation: operation,
            operation_token: 'token',
            operation_expires_at: new Date(Date.now() + 180000),
          });
          return Promise.resolve({
            video: video({ ...current }),
            token: 'token',
            previousOperation,
            requiresReconciliation: previousOperation !== null,
          });
        }),
      completeUpload: jest
        .fn<VideosRepository['completeUpload']>()
        .mockImplementation(() => {
          current = video({
            ...current,
            status: 'processing',
            upload_operation: null,
            operation_token: null,
            error_code: null,
          });
          return Promise.resolve(true);
        }),
      releaseUpload: jest
        .fn<VideosRepository['releaseUpload']>()
        .mockImplementation(() => {
          current = video({
            ...current,
            upload_operation: null,
            operation_token: null,
          });
          return Promise.resolve(true);
        }),
      failUpload: jest
        .fn<VideosRepository['failUpload']>()
        .mockImplementation((_id, _channel, _token, code) => {
          current = video({
            ...current,
            status: 'error',
            error_code: code,
            upload_operation: null,
            operation_token: null,
          });
          return Promise.resolve(true);
        }),
      rememberUploadFailure: jest
        .fn<VideosRepository['rememberUploadFailure']>()
        .mockImplementation((_id, _channel, _token, code) => {
          current.error_code = code;
          return Promise.resolve(true);
        }),
      changeUploadOperation: jest
        .fn<VideosRepository['changeUploadOperation']>()
        .mockImplementation((_id, _channel, _token, operation) => {
          current.upload_operation = operation;
          return Promise.resolve(true);
        }),
    };
    channels = {
      findByUserId: jest
        .fn<ChannelsService['findByUserId']>()
        .mockResolvedValue(Object.assign(new Channel(), { id: 'channel-id' })),
    };
    storage = {
      headObject: jest
        .fn<StoragePort['headObject']>()
        .mockImplementation(() =>
          object
            ? Promise.resolve(object)
            : Promise.reject(new StorageError('object_not_found')),
        ),
      listParts: jest
        .fn<StoragePort['listParts']>()
        .mockResolvedValue([{ partNumber: 1, size: 16, etag: 'actual-etag' }]),
      completeMultipartUpload: jest
        .fn<StoragePort['completeMultipartUpload']>()
        .mockImplementation(() => {
          object = { contentLength: 16, etag: 'completed' };
          return Promise.resolve(object);
        }),
      abortMultipartUpload: jest
        .fn<StoragePort['abortMultipartUpload']>()
        .mockResolvedValue(undefined),
      deleteObject: jest
        .fn<StoragePort['deleteObject']>()
        .mockImplementation(() => {
          object = null;
          return Promise.resolve();
        }),
    };
    module = await Test.createTestingModule({
      providers: [
        VideoUploadCompletionService,
        { provide: ChannelsService, useValue: channels },
        { provide: VideosRepository, useValue: repository },
        { provide: STORAGE, useValue: storage },
      ],
    }).compile();
    service = module.get(VideoUploadCompletionService);
  });
  afterEach(async () => {
    await module.close();
  });

  it('should complete authoritative etags then persist exact length using its claim', async () => {
    const result = await service.complete('jwt-sub', 'video-id');
    expect(channels.findByUserId).toHaveBeenCalledWith('jwt-sub');
    expect(repository.findUploadForOwner).toHaveBeenCalledWith(
      'video-id',
      'channel-id',
    );
    expect(storage.completeMultipartUpload).toHaveBeenCalledWith(
      'videos/video-id/source',
      'upload-id',
      [{ partNumber: 1, size: 16, etag: 'actual-etag' }],
    );
    expect(repository.completeUpload).toHaveBeenCalledWith(
      'video-id',
      'channel-id',
      'token',
      '16',
    );
    expect(result.video).toMatchObject({
      id: 'video-id',
      status: 'processing',
    });
    expect(
      storage.completeMultipartUpload.mock.invocationCallOrder[0],
    ).toBeLessThan(repository.completeUpload.mock.invocationCallOrder[0]);
  });

  it.each(['processing', 'ready'] as const)(
    'should replay %s without storage or a new claim',
    async (status) => {
      current.status = status;
      expect((await service.complete('user', current.id)).video).toMatchObject({
        id: current.id,
        slug: current.slug,
        status,
      });
      expect(repository.claimUpload).not.toHaveBeenCalled();
      expect(storage.headObject).not.toHaveBeenCalled();
      expect(repository.completeUpload).not.toHaveBeenCalled();
    },
  );

  it('should recover a completed source even after the session expires', async () => {
    current.upload_expires_at = new Date(0);
    object = { contentLength: 16, etag: 'existing' };
    expect((await service.complete('user', current.id)).video.status).toBe(
      'processing',
    );
    expect(storage.listParts).not.toHaveBeenCalled();
    expect(storage.completeMultipartUpload).not.toHaveBeenCalled();
    expect(storage.abortMultipartUpload).not.toHaveBeenCalled();
  });

  it('should reconcile a complete response lost at S3', async () => {
    storage.completeMultipartUpload.mockImplementationOnce(() => {
      object = { contentLength: 16, etag: 'existing' };
      return Promise.reject(new StorageError('unavailable'));
    });
    expect((await service.complete('user', current.id)).video.status).toBe(
      'processing',
    );
  });

  it('should retain the completed object and release only its claim on DB rollback', async () => {
    repository.completeUpload.mockRejectedValueOnce(new Error('SQL failure'));
    await expect(service.complete('user', current.id)).rejects.toThrow(
      'SQL failure',
    );
    expect(object?.contentLength).toBe(16);
    expect(repository.releaseUpload).toHaveBeenCalledWith(
      current.id,
      current.channel_id,
      'token',
    );
    expect(storage.deleteObject).not.toHaveBeenCalled();
    expect((await service.complete('user', current.id)).video.status).toBe(
      'processing',
    );
    expect(storage.completeMultipartUpload).toHaveBeenCalledTimes(1);
  });

  it('should recognize a DB commit whose response was lost', async () => {
    repository.completeUpload.mockImplementationOnce(() => {
      current.status = 'processing';
      return Promise.reject(new Error('Lost commit response'));
    });
    expect((await service.complete('user', current.id)).video.status).toBe(
      'processing',
    );
    expect(repository.releaseUpload).not.toHaveBeenCalled();
  });

  it.each([
    { parts: [] },
    { parts: [{ partNumber: 2, size: 16, etag: 'extra' }] },
    {
      parts: [
        { partNumber: 1, size: 16, etag: 'one' },
        { partNumber: 1, size: 16, etag: 'duplicate' },
      ],
    },
  ])(
    'should release an incomplete or invalid sequence without completing (%j)',
    async ({ parts }) => {
      storage.listParts.mockResolvedValue(parts);
      await expect(service.complete('user', current.id)).rejects.toMatchObject({
        errorCode: 'UPLOAD_INCOMPLETE',
        httpStatus: 409,
      });
      expect(repository.releaseUpload).toHaveBeenCalled();
      expect(repository.completeUpload).not.toHaveBeenCalled();
      expect(storage.completeMultipartUpload).not.toHaveBeenCalled();
    },
  );

  it('should validate each full and final part size and order', async () => {
    current.declared_size_bytes = String(VIDEO_LIMITS.PART_SIZE_BYTES + 7);
    storage.listParts.mockResolvedValue([
      { partNumber: 2, size: 7, etag: 'two' },
      { partNumber: 1, size: VIDEO_LIMITS.PART_SIZE_BYTES, etag: 'one' },
    ]);
    await expect(service.complete('user', current.id)).rejects.toMatchObject({
      errorCode: 'UPLOAD_INCOMPLETE',
    });
    expect(repository.completeUpload).not.toHaveBeenCalled();
  });

  it('should persist size-failure intent before abort and never create processing', async () => {
    storage.listParts.mockResolvedValue([
      { partNumber: 1, size: 17, etag: 'wrong' },
    ]);
    await expect(service.complete('user', current.id)).rejects.toMatchObject({
      errorCode: 'UPLOAD_SIZE_MISMATCH',
    });
    expect(
      repository.rememberUploadFailure.mock.invocationCallOrder[0],
    ).toBeLessThan(storage.abortMultipartUpload.mock.invocationCallOrder[0]);
    expect(current).toMatchObject({
      status: 'error',
      error_code: 'UPLOAD_SIZE_MISMATCH',
    });
    expect(repository.completeUpload).not.toHaveBeenCalled();
  });

  it('should delete an already completed source with wrong authoritative size', async () => {
    object = { contentLength: 17, etag: 'wrong' };
    await expect(service.complete('user', current.id)).rejects.toMatchObject({
      errorCode: 'UPLOAD_SIZE_MISMATCH',
    });
    expect(storage.deleteObject).toHaveBeenCalledWith(current.source_key);
    expect(object).toBeNull();
    expect(repository.completeUpload).not.toHaveBeenCalled();
  });

  it('should leave a durable mismatch marker if cleanup is unavailable', async () => {
    object = { contentLength: 17, etag: 'wrong' };
    storage.deleteObject.mockRejectedValue(new StorageError('unavailable'));
    await expect(service.complete('user', current.id)).rejects.toMatchObject({
      errorCode: 'STORAGE_UNAVAILABLE',
    });
    expect(current).toMatchObject({
      status: 'draft',
      error_code: 'UPLOAD_SIZE_MISMATCH',
      upload_operation: 'completing',
    });
    expect(repository.failUpload).not.toHaveBeenCalled();
    expect(repository.completeUpload).not.toHaveBeenCalled();
  });

  it('should continue mismatch cleanup after an expired operation without rehabilitating the object', async () => {
    current.error_code = 'UPLOAD_SIZE_MISMATCH';
    current.upload_operation = 'completing';
    current.operation_expires_at = new Date(0);
    object = { contentLength: 16, etag: 'must-not-process' };
    await expect(service.complete('user', current.id)).rejects.toMatchObject({
      errorCode: 'UPLOAD_SIZE_MISMATCH',
    });
    expect(object).toBeNull();
    expect(repository.completeUpload).not.toHaveBeenCalled();
  });

  it('should expire only an uncompleted source and persist the safe expiry code', async () => {
    current.upload_expires_at = new Date(0);
    await expect(service.complete('user', current.id)).rejects.toMatchObject({
      errorCode: 'UPLOAD_EXPIRED',
      httpStatus: 410,
    });
    expect(current).toMatchObject({
      status: 'error',
      error_code: 'UPLOAD_EXPIRED',
    });
    expect(repository.completeUpload).not.toHaveBeenCalled();
  });

  it('should leave an unconfirmed S3 completion pending for reconciliation', async () => {
    storage.completeMultipartUpload.mockRejectedValue(
      new StorageError('unavailable'),
    );
    await expect(service.complete('user', current.id)).rejects.toMatchObject({
      errorCode: 'STORAGE_UNAVAILABLE',
    });
    expect(current.upload_operation).toBe('completing');
    expect(repository.releaseUpload).not.toHaveBeenCalled();
  });

  it('should abort idempotently without changing UPLOAD_ABORTED on replay', async () => {
    await service.abort('user', current.id);
    const result = current;
    await service.abort('user', current.id);
    expect(current).toBe(result);
    expect(current).toMatchObject({
      status: 'error',
      error_code: 'UPLOAD_ABORTED',
    });
    expect(storage.abortMultipartUpload).toHaveBeenCalledTimes(1);
    expect(repository.failUpload).toHaveBeenCalledTimes(1);
  });

  it('should reconcile a completed object on abort instead of claiming abortion', async () => {
    object = { contentLength: 16, etag: 'completed' };
    await expect(service.abort('user', current.id)).rejects.toMatchObject({
      errorCode: 'INVALID_VIDEO_STATE',
    });
    expect(current.status).toBe('processing');
    expect(storage.abortMultipartUpload).not.toHaveBeenCalled();
    expect(repository.changeUploadOperation).toHaveBeenCalledWith(
      current.id,
      current.channel_id,
      'token',
      'completing',
    );
  });

  it('should check Head again after NoSuchUpload during abort', async () => {
    storage.abortMultipartUpload.mockImplementationOnce(() => {
      object = { contentLength: 16, etag: 'completed-concurrently' };
      return Promise.reject(new StorageError('upload_not_found'));
    });
    await expect(service.abort('user', current.id)).rejects.toMatchObject({
      errorCode: 'INVALID_VIDEO_STATE',
    });
    expect(current.status).toBe('processing');
    expect(repository.failUpload).not.toHaveBeenCalled();
  });

  it('should retain an interrupted abort intent when completion takes its expired claim', async () => {
    current.upload_operation = 'aborting';
    current.operation_expires_at = new Date(0);
    storage.abortMultipartUpload.mockRejectedValue(
      new StorageError('unavailable'),
    );
    await expect(service.complete('user', current.id)).rejects.toMatchObject({
      errorCode: 'STORAGE_UNAVAILABLE',
    });
    expect(current.upload_operation).toBe('aborting');
    expect(repository.completeUpload).not.toHaveBeenCalled();
  });

  it('should finish an interrupted abort without completing the remaining parts', async () => {
    current.upload_operation = 'aborting';
    current.operation_expires_at = new Date(0);
    await expect(service.complete('user', current.id)).rejects.toMatchObject({
      errorCode: 'INVALID_VIDEO_STATE',
    });
    expect(current.error_code).toBe('UPLOAD_ABORTED');
    expect(storage.completeMultipartUpload).not.toHaveBeenCalled();
  });

  it.each(['processing', 'ready', 'error'] as const)(
    'should reject incompatible abort in %s',
    async (status) => {
      current.status = status;
      current.error_code = status === 'error' ? 'PROCESSING_FAILED' : null;
      await expect(service.abort('user', current.id)).rejects.toMatchObject({
        errorCode: 'INVALID_VIDEO_STATE',
      });
      expect(repository.claimUpload).not.toHaveBeenCalled();
    },
  );

  it('should reject a live competing claim without any storage access', async () => {
    repository.claimUpload.mockResolvedValue(null);
    await expect(service.complete('user', current.id)).rejects.toMatchObject({
      errorCode: 'UPLOAD_OPERATION_IN_PROGRESS',
    });
    await expect(service.abort('user', current.id)).rejects.toMatchObject({
      errorCode: 'UPLOAD_OPERATION_IN_PROGRESS',
    });
    expect(storage.headObject).not.toHaveBeenCalled();
  });

  it('should stop destructive actions when the claim token changes during storage reads', async () => {
    storage.listParts.mockImplementationOnce(() => {
      current.operation_token = 'replacement';
      return Promise.resolve([{ partNumber: 1, size: 16, etag: 'actual' }]);
    });
    await expect(service.complete('user', current.id)).rejects.toMatchObject({
      errorCode: 'UPLOAD_OPERATION_IN_PROGRESS',
    });
    expect(storage.completeMultipartUpload).not.toHaveBeenCalled();
    expect(storage.abortMultipartUpload).not.toHaveBeenCalled();
  });

  it('should not finalize or delete a valid source after a failed DB fence', async () => {
    object = { contentLength: 16, etag: 'completed' };
    repository.completeUpload.mockImplementationOnce(() => {
      current.operation_token = 'new-token';
      return Promise.resolve(false);
    });
    await expect(service.complete('user', current.id)).rejects.toMatchObject({
      errorCode: 'UPLOAD_OPERATION_IN_PROGRESS',
    });
    expect(storage.deleteObject).not.toHaveBeenCalled();
    expect(repository.releaseUpload).not.toHaveBeenCalled();
  });

  it('should hide absent and foreign-channel videos for completion, abort and status', async () => {
    repository.findOwnedById.mockResolvedValue(null);
    repository.findUploadForOwner.mockResolvedValue(null);
    for (const action of [
      () => service.complete('other', current.id),
      () => service.abort('other', current.id),
      () => service.getStatus('other', current.id),
    ])
      await expect(action()).rejects.toMatchObject({
        errorCode: 'VIDEO_NOT_FOUND',
      });
    channels.findByUserId.mockResolvedValue(null);
    await expect(
      service.complete('missing-channel', current.id),
    ).rejects.toMatchObject({ errorCode: 'VIDEO_NOT_FOUND' });
    expect(storage.headObject).not.toHaveBeenCalled();
  });

  it.each<VideoStatus>(['draft', 'processing', 'ready', 'error'])(
    'should project private %s status without storage or diagnostics',
    async (status) => {
      current.status = status;
      current.error_code = 'internal stderr with credentials';
      const result = await service.getStatus('user', current.id);
      expect(result).toMatchObject({
        id: current.id,
        slug: current.slug,
        status,
        errorCode: null,
      });
      expect(Object.keys(result).sort()).toEqual([
        'createdAt',
        'errorCode',
        'id',
        'slug',
        'status',
        'updatedAt',
      ]);
      expect(storage.headObject).not.toHaveBeenCalled();
    },
  );

  it('should retain documented persisted error codes only', async () => {
    current.status = 'error';
    current.error_code = 'PROCESSING_TIMEOUT';
    expect((await service.getStatus('user', current.id)).errorCode).toBe(
      'PROCESSING_TIMEOUT',
    );
  });

  it('should propagate unexpected failures without an invented successful result', async () => {
    storage.listParts.mockRejectedValue(new Error('unexpected'));
    await expect(service.complete('user', current.id)).rejects.toThrow(
      'unexpected',
    );
    expect(repository.completeUpload).not.toHaveBeenCalled();
  });
});
