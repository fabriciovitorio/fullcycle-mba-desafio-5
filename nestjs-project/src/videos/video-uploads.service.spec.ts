import { jest } from '@jest/globals';
import { Test, type TestingModule } from '@nestjs/testing';
import { ChannelsService } from '../channels/channels.service';
import { Channel } from '../channels/entities/channel.entity';
import videosConfig from '../config/videos.config';
import { STORAGE, type StoragePort } from '../storage/storage.port';
import {
  STORAGE_SIGNING,
  type StorageSigningPort,
} from '../storage/storage-signing.port';
import { StorageError } from '../storage/storage.error';
import { Video, type VideoStatus } from './entities/video.entity';
import { VideosRepository } from './videos.repository';
import { VideoUploadsService } from './video-uploads.service';
import { VIDEO_LIMITS } from './videos.constants';

type RepositoryMock = jest.Mocked<
  Pick<
    VideosRepository,
    | 'createDraft'
    | 'claimUpload'
    | 'rememberUploadSession'
    | 'attachUploadSession'
    | 'findUploadForOwner'
    | 'failUpload'
  >
>;

function video(overrides: Partial<Video> = {}): Video {
  return Object.assign(
    new Video(),
    {
      id: 'video-id',
      slug: '0123456789abcdef01234567',
      channel_id: 'channel-id',
      title: 'Video',
      original_file_name: 'original.mp4',
      declared_content_type: 'video/mp4',
      declared_size_bytes: String(VIDEO_LIMITS.PART_SIZE_BYTES + 7),
      source_key: 'videos/video-id/source',
      upload_id: 'upload-id',
      status: 'draft',
      error_code: null,
      upload_operation: null,
      operation_token: null,
      operation_expires_at: null,
      upload_expires_at: new Date(Date.now() + 86400000),
      created_at: new Date(),
      updated_at: new Date(),
    },
    overrides,
  );
}

describe('VideoUploadsService', () => {
  let module: TestingModule;
  let service: VideoUploadsService;
  let repository: RepositoryMock;
  let channels: jest.Mocked<Pick<ChannelsService, 'findByUserId'>>;
  let storage: jest.Mocked<
    Pick<
      StoragePort,
      | 'createMultipartUpload'
      | 'listParts'
      | 'abortMultipartUpload'
      | 'headObject'
    >
  >;
  let signing: jest.Mocked<Pick<StorageSigningPort, 'signUploadPart'>>;
  const input = {
    title: ' Video ',
    fileName: 'original.mp4',
    contentType: 'video/mp4',
    sizeBytes: VIDEO_LIMITS.PART_SIZE_BYTES + 7,
  };
  function pending(overrides: Partial<Video> = {}): Video {
    return video({
      upload_id: 'upload-id',
      upload_operation: 'initializing',
      operation_token: 'token',
      operation_expires_at: new Date(Date.now() + 120000),
      ...overrides,
    });
  }
  beforeEach(async () => {
    repository = {
      createDraft: jest
        .fn<VideosRepository['createDraft']>()
        .mockResolvedValue(video({ upload_id: null })),
      claimUpload: jest
        .fn<VideosRepository['claimUpload']>()
        .mockResolvedValue({
          video: pending(),
          token: 'token',
          previousOperation: null,
          requiresReconciliation: false,
        }),
      rememberUploadSession: jest
        .fn<VideosRepository['rememberUploadSession']>()
        .mockResolvedValue(true),
      attachUploadSession: jest
        .fn<VideosRepository['attachUploadSession']>()
        .mockResolvedValue(true),
      findUploadForOwner: jest
        .fn<VideosRepository['findUploadForOwner']>()
        .mockImplementation(() => Promise.resolve(video())),
      failUpload: jest
        .fn<VideosRepository['failUpload']>()
        .mockResolvedValue(true),
    };
    channels = {
      findByUserId: jest
        .fn<ChannelsService['findByUserId']>()
        .mockResolvedValue(Object.assign(new Channel(), { id: 'channel-id' })),
    };
    storage = {
      createMultipartUpload: jest
        .fn<StoragePort['createMultipartUpload']>()
        .mockResolvedValue('upload-id'),
      listParts: jest
        .fn<StoragePort['listParts']>()
        .mockResolvedValue([{ partNumber: 1, size: 10, etag: 'actual-etag' }]),
      abortMultipartUpload: jest
        .fn<StoragePort['abortMultipartUpload']>()
        .mockResolvedValue(undefined),
      headObject: jest
        .fn<StoragePort['headObject']>()
        .mockRejectedValue(new StorageError('object_not_found')),
    };
    signing = {
      signUploadPart: jest
        .fn<StorageSigningPort['signUploadPart']>()
        .mockResolvedValue({
          url: 'https://signed.example.test/permission',
          expiresAt: new Date(),
          headers: { 'Content-Length': '7' },
        }),
    };
    module = await Test.createTestingModule({
      providers: [
        VideoUploadsService,
        { provide: ChannelsService, useValue: channels },
        { provide: VideosRepository, useValue: repository },
        { provide: STORAGE, useValue: storage },
        { provide: STORAGE_SIGNING, useValue: signing },
        { provide: videosConfig.KEY, useValue: videosConfig() },
      ],
    }).compile();
    service = module.get(VideoUploadsService);
  });
  afterEach(async () => {
    await module.close();
  });

  it('should persist draft and claim before S3 and return only a domain projection', async () => {
    const result = await service.initialize('jwt-sub', input);
    expect(channels.findByUserId).toHaveBeenCalledWith('jwt-sub');
    expect(repository.createDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: 'channel-id',
        title: 'Video',
        declaredSizeBytes: String(input.sizeBytes),
      }),
    );
    expect(repository.createDraft.mock.invocationCallOrder[0]).toBeLessThan(
      storage.createMultipartUpload.mock.invocationCallOrder[0],
    );
    expect(repository.claimUpload.mock.invocationCallOrder[0]).toBeLessThan(
      storage.createMultipartUpload.mock.invocationCallOrder[0],
    );
    expect(
      repository.rememberUploadSession.mock.invocationCallOrder[0],
    ).toBeLessThan(repository.attachUploadSession.mock.invocationCallOrder[0]);
    expect(result.upload).toMatchObject({
      partCount: 2,
      partSizeBytes: 67108864,
    });
    expect(Object.keys(result.video).sort()).toEqual([
      'createdAt',
      'errorCode',
      'id',
      'slug',
      'status',
      'updatedAt',
    ]);
    expect(JSON.stringify(result)).not.toMatch(
      /source_key|upload_id|channel_id|bucket/,
    );
    expect(signing.signUploadPart).not.toHaveBeenCalled();
  });

  it('should accept the exact 10GB limit without reading or allocating the video', async () => {
    repository.findUploadForOwner.mockResolvedValue(
      video({ declared_size_bytes: '10000000000' }),
    );
    expect(
      (await service.initialize('user', { ...input, sizeBytes: 10000000000 }))
        .upload.partCount,
    ).toBe(150);
    expect(repository.createDraft).toHaveBeenCalledWith(
      expect.objectContaining({ declaredSizeBytes: '10000000000' }),
    );
  });

  it.each([
    { sizeBytes: 0 },
    { sizeBytes: -1 },
    { sizeBytes: 1.5 },
    { sizeBytes: 10000000001 },
    { title: ' ' },
    { title: 'a'.repeat(201) },
    { fileName: '../video.mp4' },
    { fileName: 'a\r\n.mp4' },
    { fileName: 'a\u0000.mp4' },
    { contentType: 'video/webm' },
  ])(
    'should reject invalid initialization input before any dependency access (%j)',
    async (invalid) => {
      await expect(
        service.initialize('user', { ...input, ...invalid }),
      ).rejects.toMatchObject({
        errorCode: 'VALIDATION_ERROR',
        httpStatus: 400,
      });
      expect(channels.findByUserId).not.toHaveBeenCalled();
      expect(repository.createDraft).not.toHaveBeenCalled();
      expect(storage.createMultipartUpload).not.toHaveBeenCalled();
    },
  );

  it('should refuse initialization without a channel', async () => {
    channels.findByUserId.mockResolvedValue(null);
    await expect(service.initialize('user', input)).rejects.toMatchObject({
      errorCode: 'CHANNEL_NOT_FOUND',
    });
    expect(repository.createDraft).not.toHaveBeenCalled();
  });

  it('should leave a recognizable draft if S3 initialization cannot be confirmed', async () => {
    storage.createMultipartUpload.mockRejectedValue(
      new StorageError('unavailable'),
    );
    await expect(service.initialize('user', input)).rejects.toMatchObject({
      errorCode: 'STORAGE_UNAVAILABLE',
      httpStatus: 503,
    });
    expect(repository.rememberUploadSession).not.toHaveBeenCalled();
    expect(repository.failUpload).not.toHaveBeenCalled();
    expect(storage.abortMultipartUpload).not.toHaveBeenCalled();
  });

  it('should not call S3 if draft persistence fails or its claim is unavailable', async () => {
    repository.createDraft.mockRejectedValueOnce(new Error('database failure'));
    await expect(service.initialize('user', input)).rejects.toThrow(
      'database failure',
    );
    repository.claimUpload.mockResolvedValue(null);
    await expect(service.initialize('user', input)).rejects.toMatchObject({
      errorCode: 'UPLOAD_OPERATION_IN_PROGRESS',
    });
    expect(storage.createMultipartUpload).not.toHaveBeenCalled();
  });

  it('should compensate a failed session attachment with abort then guarded terminal error', async () => {
    repository.attachUploadSession.mockRejectedValue(new Error('SQL failure'));
    repository.findUploadForOwner.mockResolvedValue(pending());
    await expect(service.initialize('user', input)).rejects.toThrow(
      'SQL failure',
    );
    expect(storage.abortMultipartUpload).toHaveBeenCalledWith(
      'videos/video-id/source',
      'upload-id',
    );
    expect(repository.failUpload).toHaveBeenCalledWith(
      'video-id',
      'channel-id',
      'token',
      'UPLOAD_INITIALIZATION_FAILED',
      expect.any(String),
    );
    expect(
      storage.abortMultipartUpload.mock.invocationCallOrder[0],
    ).toBeLessThan(repository.failUpload.mock.invocationCallOrder[0]);
  });

  it('should retain pending initialization if compensation abort fails', async () => {
    repository.attachUploadSession.mockRejectedValue(new Error('SQL failure'));
    repository.findUploadForOwner.mockResolvedValue(pending());
    storage.abortMultipartUpload.mockRejectedValue(
      new StorageError('unavailable'),
    );
    await expect(service.initialize('user', input)).rejects.toMatchObject({
      errorCode: 'STORAGE_UNAVAILABLE',
    });
    expect(repository.failUpload).not.toHaveBeenCalled();
  });

  it('should recover a committed attachment after its response fails without aborting it', async () => {
    repository.attachUploadSession.mockRejectedValue(
      new Error('Response lost'),
    );
    const result = await service.initialize('user', input);
    expect(result.video.id).toBe('video-id');
    expect(storage.abortMultipartUpload).not.toHaveBeenCalled();
  });

  it('should not turn a committed but expired initialization into success during recovery', async () => {
    repository.attachUploadSession.mockRejectedValue(
      new Error('Response lost'),
    );
    repository.findUploadForOwner.mockResolvedValue(
      video({ upload_expires_at: new Date(0) }),
    );
    await expect(service.initialize('user', input)).rejects.toMatchObject({
      errorCode: 'UPLOAD_EXPIRED',
    });
    expect(storage.abortMultipartUpload).not.toHaveBeenCalled();
  });

  it('should not abort or overwrite a session after losing the claim', async () => {
    repository.rememberUploadSession.mockResolvedValue(false);
    repository.findUploadForOwner.mockResolvedValue(
      pending({ operation_token: 'new-owner' }),
    );
    await expect(service.initialize('user', input)).rejects.toMatchObject({
      errorCode: 'UPLOAD_OPERATION_IN_PROGRESS',
    });
    expect(storage.abortMultipartUpload).not.toHaveBeenCalled();
    expect(repository.failUpload).not.toHaveBeenCalled();
  });

  it('should resume authoritative parts without changing the identity', async () => {
    const result = await service.resume('user', 'video-id');
    expect(repository.findUploadForOwner).toHaveBeenCalledWith(
      'video-id',
      'channel-id',
    );
    expect(result.video).toMatchObject({
      id: 'video-id',
      slug: '0123456789abcdef01234567',
    });
    expect(result.upload.parts).toEqual([
      { partNumber: 1, sizeBytes: 10, etag: 'actual-etag' },
    ]);
    expect(storage.createMultipartUpload).not.toHaveBeenCalled();
  });

  it('should compute the exact full and final sizes from persisted bytes', async () => {
    expect(
      (await service.signParts('user', 'video-id', [2, 1])).parts.map(
        (part) => part.partNumber,
      ),
    ).toEqual([2, 1]);
    expect(signing.signUploadPart).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        partNumber: 2,
        sizeBytes: 7,
        uploadId: 'upload-id',
      }),
    );
    expect(signing.signUploadPart).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ partNumber: 1, sizeBytes: 67108864 }),
    );
  });

  it.each(
    [
      [],
      [1, 1],
      [0],
      [3],
      [1.2],
      Array.from({ length: 51 }, (_, index) => index + 1),
    ].map((partNumbers) => ({ partNumbers })),
  )(
    'should reject an invalid batch without storage/signing access (%j)',
    async ({ partNumbers: numbers }) => {
      await expect(
        service.signParts('user', 'video-id', numbers),
      ).rejects.toMatchObject({ errorCode: 'VALIDATION_ERROR' });
      expect(storage.listParts).not.toHaveBeenCalled();
      expect(signing.signUploadPart).not.toHaveBeenCalled();
    },
  );

  it('should hide another channel or absent channel before touching storage', async () => {
    repository.findUploadForOwner.mockResolvedValue(null);
    await expect(
      service.resume('other-user', 'video-id'),
    ).rejects.toMatchObject({ errorCode: 'VIDEO_NOT_FOUND' });
    await expect(
      service.signParts('other-user', 'video-id', [1]),
    ).rejects.toMatchObject({ errorCode: 'VIDEO_NOT_FOUND' });
    channels.findByUserId.mockResolvedValue(null);
    await expect(
      service.resume('no-channel', 'video-id'),
    ).rejects.toMatchObject({ errorCode: 'VIDEO_NOT_FOUND' });
    expect(storage.listParts).not.toHaveBeenCalled();
    expect(signing.signUploadPart).not.toHaveBeenCalled();
  });

  it.each<VideoStatus>(['processing', 'ready', 'error'])(
    'should refuse %s before storage access',
    async (status) => {
      repository.findUploadForOwner.mockResolvedValue(video({ status }));
      await expect(
        service.signParts('user', 'video-id', [1]),
      ).rejects.toMatchObject({ errorCode: 'INVALID_VIDEO_STATE' });
      expect(storage.listParts).not.toHaveBeenCalled();
      expect(signing.signUploadPart).not.toHaveBeenCalled();
    },
  );

  it('should require reconciliation for an expired operation instead of issuing permissions', async () => {
    repository.findUploadForOwner.mockResolvedValue(
      pending({ operation_expires_at: new Date(0) }),
    );
    await expect(
      service.signParts('user', 'video-id', [1]),
    ).rejects.toMatchObject({ errorCode: 'UPLOAD_OPERATION_IN_PROGRESS' });
    expect(storage.listParts).not.toHaveBeenCalled();
    expect(signing.signUploadPart).not.toHaveBeenCalled();
  });

  it('should distinguish expired session from already completed source without deleting either', async () => {
    repository.findUploadForOwner.mockResolvedValue(
      video({ upload_expires_at: new Date(0) }),
    );
    await expect(
      service.signParts('user', 'video-id', [1]),
    ).rejects.toMatchObject({ errorCode: 'UPLOAD_EXPIRED', httpStatus: 410 });
    storage.headObject.mockResolvedValue({
      contentLength: 7,
      etag: 'completed',
    });
    await expect(service.resume('user', 'video-id')).rejects.toMatchObject({
      errorCode: 'UPLOAD_OPERATION_IN_PROGRESS',
    });
    expect(storage.abortMultipartUpload).not.toHaveBeenCalled();
    expect(signing.signUploadPart).not.toHaveBeenCalled();
  });

  it('should reject a concurrent state change discovered after ListParts', async () => {
    repository.findUploadForOwner
      .mockResolvedValueOnce(video())
      .mockResolvedValue(video({ status: 'processing' }));
    await expect(
      service.signParts('user', 'video-id', [1]),
    ).rejects.toMatchObject({ errorCode: 'INVALID_VIDEO_STATE' });
    expect(signing.signUploadPart).not.toHaveBeenCalled();
  });

  it('should map typed storage failure and preserve unexpected errors', async () => {
    storage.listParts.mockRejectedValueOnce(new StorageError('unavailable'));
    await expect(service.resume('user', 'video-id')).rejects.toMatchObject({
      errorCode: 'STORAGE_UNAVAILABLE',
    });
    signing.signUploadPart.mockRejectedValueOnce(
      new StorageError('operation_failed'),
    );
    await expect(
      service.signParts('user', 'video-id', [1]),
    ).rejects.toMatchObject({ errorCode: 'STORAGE_UNAVAILABLE' });
    storage.listParts.mockRejectedValueOnce(new Error('unexpected'));
    await expect(service.resume('user', 'video-id')).rejects.toThrow(
      'unexpected',
    );
  });
});
