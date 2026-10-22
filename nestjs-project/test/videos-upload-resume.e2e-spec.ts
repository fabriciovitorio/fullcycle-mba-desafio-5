import { expect, jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { PutObjectCommand, UploadPartCommand } from '@aws-sdk/client-s3';
import request from 'supertest';
import { STORAGE, type StoragePort } from '../src/storage/storage.port';
import { StorageError } from '../src/storage/storage.error';
import { Video } from '../src/videos/entities/video.entity';
import { VideoProcessingOutbox } from '../src/videos/entities/video-processing-outbox.entity';
import { VideoUploadCompletionService } from '../src/videos/video-upload-completion.service';
import { buildSwaggerDocument } from '../src/swagger/swagger-document';
import {
  createVideosHttpFixture,
  type VideosHttpFixture,
} from './helpers/videos-http.fixture';

interface ResumeBody {
  video: {
    id: string;
    slug: string;
    status: string;
    errorCode: string | null;
    createdAt: string;
    updatedAt: string;
  };
  upload: {
    partSizeBytes: number;
    partCount: number;
    expiresAt: string;
    parts: { partNumber: number; sizeBytes: number; etag: string }[];
  };
}
interface ErrorBody {
  statusCode: number;
  error?: string;
  message: string | string[];
}

describe('GET /videos/:id/upload (e2e)', () => {
  let fixture: VideosHttpFixture;
  let owner: Awaited<ReturnType<VideosHttpFixture['owner']>>;
  let other: Awaited<ReturnType<VideosHttpFixture['owner']>>;
  const media = readFileSync(join(__dirname, 'fixtures/upload-small.mp4'));
  const jpeg = readFileSync(join(__dirname, 'fixtures/upload-thumbnail.jpg'));
  const partSize = 67_108_864;

  beforeAll(async () => {
    fixture = await createVideosHttpFixture();
  });
  beforeEach(async () => {
    await fixture.clean();
    owner = await fixture.owner();
    other = await fixture.owner();
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await fixture.clean();
  });
  afterAll(async () => {
    await fixture?.close();
  });

  async function initialize(sizeBytes = media.length): Promise<Video> {
    const response = await request(fixture.app.getHttpServer())
      .post('/videos/uploads')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({
        title: 'Resume test',
        fileName: 'original.mp4',
        contentType: 'video/mp4',
        sizeBytes,
      })
      .expect(201);
    const body = response.body as ResumeBody;
    return stored(body.video.id);
  }
  async function stored(id: string): Promise<Video> {
    return fixture.source
      .getRepository(Video)
      .createQueryBuilder('video')
      .addSelect('video.upload_id')
      .where({ id })
      .getOneOrFail();
  }
  function get(id: string, token = owner.token) {
    return request(fixture.app.getHttpServer())
      .get(`/videos/${id}/upload`)
      .set('Authorization', `Bearer ${token}`);
  }
  async function outboxCount() {
    return fixture.source.getRepository(VideoProcessingOutbox).count();
  }

  async function upload(row: Video, size: number) {
    function* chunks() {
      const block = Buffer.alloc(64 * 1024);
      let remaining = size;
      while (remaining > 0) {
        const length = Math.min(remaining, block.length);
        yield block.subarray(0, length);
        remaining -= length;
      }
    }
    const stream =
      size === media.length ? Readable.from([media]) : Readable.from(chunks());
    try {
      return await fixture.storage.client.send(
        new UploadPartCommand({
          Bucket: fixture.storage.config.bucket,
          Key: row.source_key,
          UploadId: row.upload_id!,
          PartNumber: 1,
          ContentLength: size,
          Body: stream,
        }),
      );
    } finally {
      stream.destroy();
    }
  }

  it('1.1 should return real streamed parts and preserve identity, session and absolute expiry on replay', async () => {
    const row = await initialize(partSize + media.length);
    const uploaded = await upload(row, partSize);
    const authoritative = await fixture.storage.storage.listParts(
      row.source_key,
      row.upload_id!,
    );
    expect(authoritative).toEqual([
      { partNumber: 1, size: partSize, etag: uploaded.ETag },
    ]);
    const sessions = await fixture.storage.uploads(row.source_key);
    expect(sessions).toHaveLength(1);
    expect(await outboxCount()).toBe(0);
    const first = await get(row.id).expect(200);
    const body = first.body as ResumeBody;
    expect(body.video).toEqual({
      id: row.id,
      slug: row.slug,
      status: 'draft',
      errorCode: null,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    });
    expect(body.upload).toEqual({
      partSizeBytes: partSize,
      partCount: 2,
      expiresAt: row.upload_expires_at.toISOString(),
      parts: [{ partNumber: 1, sizeBytes: partSize, etag: uploaded.ETag }],
    });
    expect(body.upload.parts.some((part) => part.partNumber === 2)).toBe(false);
    const replay = await get(row.id).expect(200);
    expect(replay.body as ResumeBody).toEqual(body);
    expect(await stored(row.id)).toEqual(row);
    expect(await fixture.storage.uploads(row.source_key)).toEqual(sessions);
    expect(await outboxCount()).toBe(0);
    expect(first.text).not.toContain(row.source_key);
    expect(first.text).not.toContain(row.upload_id);
  }, 30000);

  it('1.2 should hide the owner session from a different channel without storage access or leaks', async () => {
    const row = await initialize();
    const list = jest.spyOn(
      fixture.module.get<StoragePort>(STORAGE),
      'listParts',
    );
    const head = jest.spyOn(
      fixture.module.get<StoragePort>(STORAGE),
      'headObject',
    );
    const response = await get(row.id, other.token).expect(404);
    expect(response.body as ErrorBody).toMatchObject({
      statusCode: 404,
      error: 'VIDEO_NOT_FOUND',
    });
    expect(list).not.toHaveBeenCalled();
    expect(head).not.toHaveBeenCalled();
    expect(response.text).not.toContain(row.source_key);
    expect(response.text).not.toContain(row.upload_id);
    expect(response.body).not.toHaveProperty('upload');
    expect(await stored(row.id)).toEqual(row);
  });

  it('1.3 should require real JWT authentication without returning parts or permissions', async () => {
    const row = await initialize();
    const missing = await request(fixture.app.getHttpServer())
      .get(`/videos/${row.id}/upload`)
      .expect(401);
    const invalid = await get(row.id, 'invalid.jwt').expect(401);
    for (const response of [missing, invalid])
      expect(response.body as ErrorBody).toEqual({
        statusCode: 401,
        message: 'Unauthorized',
      });
    expect(await stored(row.id)).toEqual(row);
  });

  it('1.4 should return UPLOAD_EXPIRED without renewing the draft or session when no source exists', async () => {
    const row = await initialize();
    await expect(
      fixture.storage.storage.headObject(row.source_key),
    ).rejects.toMatchObject({ kind: 'object_not_found' });
    await fixture.source
      .getRepository(Video)
      .update(row.id, { upload_expires_at: new Date(Date.now() - 1000) });
    const expired = await stored(row.id);
    const sessions = await fixture.storage.uploads(row.source_key);
    for (let index = 0; index < 2; index++) {
      const response = await get(row.id).expect(410);
      expect(response.body as ErrorBody).toMatchObject({
        statusCode: 410,
        error: 'UPLOAD_EXPIRED',
      });
    }
    expect(await stored(row.id)).toEqual(expired);
    expect(await fixture.storage.uploads(row.source_key)).toEqual(sessions);
    expect(await outboxCount()).toBe(0);
  });

  it('1.5 should reject malformed UUID through the inherited validation filter before storage', async () => {
    const list = jest.spyOn(
      fixture.module.get<StoragePort>(STORAGE),
      'listParts',
    );
    const response = await get('identificador-invalido').expect(400);
    expect(response.body as ErrorBody).toMatchObject({
      statusCode: 400,
      error: 'VALIDATION_ERROR',
      message: expect.any(Array),
    });
    expect(list).not.toHaveBeenCalled();
  });

  it.each(['processing', 'ready'] as const)(
    '1.5 should reject owner %s state with consistent real media fixtures',
    async (status) => {
      const row = await initialize();
      await upload(row, media.length);
      const completion = fixture.module.get(VideoUploadCompletionService);
      await completion.complete(owner.user.id, row.id);
      if (status === 'ready') {
        const playback = fixture.storage.key('resume-playback.mp4');
        const thumbnail = fixture.storage.key('resume-thumbnail.jpg');
        for (const [Key, Body, ContentType] of [
          [playback, media, 'video/mp4'],
          [thumbnail, jpeg, 'image/jpeg'],
        ] as const)
          await fixture.storage.client.send(
            new PutObjectCommand({
              Bucket: fixture.storage.config.bucket,
              Key,
              Body,
              ContentType,
            }),
          );
        await fixture.source.getRepository(Video).update(row.id, {
          status: 'ready',
          playback_key: playback,
          thumbnail_key: thumbnail,
          duration_seconds: 0.2,
          metadata: {
            container: 'mp4',
            videoCodec: 'h264',
            audioCodec: null,
            width: 32,
            height: 32,
            frameRate: 10,
          },
        });
        await fixture.source
          .getRepository(VideoProcessingOutbox)
          .update({ video_id: row.id }, { completed_at: new Date() });
      }
      const before = await stored(row.id);
      const response = await get(row.id).expect(409);
      expect(response.body as ErrorBody).toMatchObject({
        statusCode: 409,
        error: 'INVALID_VIDEO_STATE',
      });
      expect(await stored(row.id)).toEqual(before);
      expect(await outboxCount()).toBe(1);
      expect(
        (await fixture.storage.storage.headObject(row.source_key))
          .contentLength,
      ).toBe(media.length);
    },
  );

  it('should return VIDEO_NOT_FOUND for an absent UUID or authenticated user without channel', async () => {
    const row = await initialize();
    const noChannel = await fixture.owner(false);
    for (const [id, token] of [
      [randomUUID(), owner.token],
      [row.id, noChannel.token],
    ]) {
      const response = await get(id, token).expect(404);
      expect(response.body as ErrorBody).toMatchObject({
        error: 'VIDEO_NOT_FOUND',
      });
    }
  });

  it('should distinguish an expired but already completed source from a lost upload', async () => {
    const row = await initialize();
    await upload(row, media.length);
    const parts = await fixture.storage.storage.listParts(
      row.source_key,
      row.upload_id!,
    );
    await fixture.storage.storage.completeMultipartUpload(
      row.source_key,
      row.upload_id!,
      parts,
    );
    await fixture.source
      .getRepository(Video)
      .update(row.id, { upload_expires_at: new Date(Date.now() - 1000) });
    const before = await stored(row.id);
    const response = await get(row.id).expect(409);
    expect(response.body as ErrorBody).toMatchObject({
      error: 'UPLOAD_OPERATION_IN_PROGRESS',
    });
    expect(await stored(row.id)).toEqual(before);
    expect(await outboxCount()).toBe(0);
  });

  it('should sanitize storage failure as 503 without creating another session or intention', async () => {
    const row = await initialize();
    const sessions = await fixture.storage.uploads(row.source_key);
    jest
      .spyOn(fixture.module.get<StoragePort>(STORAGE), 'listParts')
      .mockRejectedValueOnce(new StorageError('unavailable'));
    const response = await get(row.id).expect(503);
    expect(response.body as ErrorBody).toMatchObject({
      statusCode: 503,
      error: 'STORAGE_UNAVAILABLE',
    });
    expect(await fixture.storage.uploads(row.source_key)).toEqual(sessions);
    expect(await stored(row.id)).toEqual(row);
    expect(await outboxCount()).toBe(0);
  });

  it('should allow 120 resumes per minute and reject request 121 through the real guard', async () => {
    const row = await initialize();
    const sessions = await fixture.storage.uploads(row.source_key);
    for (let index = 0; index < 120; index++) await get(row.id).expect(200);
    const response = await get(row.id).expect(429);
    expect(response.body as ErrorBody).toEqual({
      statusCode: 429,
      message: 'ThrottlerException: Too Many Requests',
    });
    expect(await fixture.storage.uploads(row.source_key)).toEqual(sessions);
    expect(await stored(row.id)).toEqual(row);
    expect(await outboxCount()).toBe(0);
  }, 30000);

  it('should document UUID, JWT, read-only success and all expected error schemas', () => {
    const document = buildSwaggerDocument(fixture.app);
    const operation = document.paths['/videos/{id}/upload'].get!;
    expect(operation.parameters).toContainEqual(
      expect.objectContaining({
        name: 'id',
        in: 'path',
        required: true,
        schema: { type: 'string', format: 'uuid' },
      }),
    );
    expect(operation.security).toEqual([{ 'access-token': [] }]);
    expect(operation.requestBody).toBeUndefined();
    expect(operation.responses['200']).toMatchObject({
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/VideoUploadResumeDto' },
        },
      },
    });
    for (const status of ['400', '401', '404', '409', '410', '429', '503'])
      expect(operation.responses[status]).toMatchObject({
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ApiErrorEnvelope' },
          },
        },
      });
  });
});
