import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, jest } from '@jest/globals';
import request from 'supertest';
import { ListMultipartUploadsCommand } from '@aws-sdk/client-s3';
import { Video } from '../src/videos/entities/video.entity';
import { VideoProcessingOutbox } from '../src/videos/entities/video-processing-outbox.entity';
import { STORAGE, type StoragePort } from '../src/storage/storage.port';
import { StorageError } from '../src/storage/storage.error';
import { buildSwaggerDocument } from '../src/swagger/swagger-document';
import {
  createVideosHttpFixture,
  type VideosHttpFixture,
} from './helpers/videos-http.fixture';

interface InitializationBody {
  video: {
    id: string;
    slug: string;
    status: string;
    errorCode: string | null;
    createdAt: string;
    updatedAt: string;
  };
  upload: { partSizeBytes: number; partCount: number; expiresAt: string };
}
interface ErrorBody {
  statusCode: number;
  error?: string;
  message: string | string[];
}

describe('POST /videos/uploads (e2e)', () => {
  let fixture: VideosHttpFixture;
  let owner: Awaited<ReturnType<VideosHttpFixture['owner']>>;
  let other: Awaited<ReturnType<VideosHttpFixture['owner']>>;
  const bytes = readFileSync(join(__dirname, 'fixtures/upload-small.mp4'));
  const input = {
    title: ' My first video ',
    fileName: 'original.mp4',
    contentType: 'video/mp4',
    sizeBytes: bytes.length,
  };

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

  function post(body: object = input, token = owner.token) {
    return request(fixture.app.getHttpServer())
      .post('/videos/uploads')
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  }
  async function resources() {
    // This MinIO build only lists all sessions or exact keys, not directory prefixes.
    const page = await fixture.storage.client.send(
      new ListMultipartUploadsCommand({
        Bucket: fixture.storage.config.bucket,
      }),
    );
    if (page.IsTruncated)
      throw new Error('Unexpected fixture multipart pagination');
    const uploads = (page.Uploads ?? []).filter((upload) =>
      upload.Key?.startsWith('videos/'),
    ).length;
    return {
      videos: await fixture.source.getRepository(Video).count(),
      uploads,
      outbox: await fixture.source.getRepository(VideoProcessingOutbox).count(),
    };
  }
  async function stored(id: string) {
    return fixture.source
      .getRepository(Video)
      .createQueryBuilder('video')
      .addSelect('video.upload_id')
      .where({ id })
      .getOneOrFail();
  }

  it('1.1 should create a persisted draft and multipart session in the authenticated channel only', async () => {
    const before = await resources();
    const started = Date.now();
    const response = await post().expect(201);
    const body = response.body as InitializationBody;
    expect(Object.keys(body).sort()).toEqual(['upload', 'video']);
    expect(Object.keys(body.video).sort()).toEqual([
      'createdAt',
      'errorCode',
      'id',
      'slug',
      'status',
      'updatedAt',
    ]);
    expect(Object.keys(body.upload).sort()).toEqual([
      'expiresAt',
      'partCount',
      'partSizeBytes',
    ]);
    expect(body.video.id).toMatch(/^[a-f0-9-]{36}$/);
    expect(body.video.slug).toMatch(/^[a-f0-9]{24}$/);
    expect(body.video.status).toBe('draft');
    expect(body.video.errorCode).toBeNull();
    for (const date of [
      body.video.createdAt,
      body.video.updatedAt,
      body.upload.expiresAt,
    ])
      expect(new Date(date).toISOString()).toBe(date);
    expect(body.upload.partSizeBytes).toBe(67_108_864);
    expect(body.upload.partCount).toBe(Math.ceil(bytes.length / 67_108_864));
    expect(Date.parse(body.upload.expiresAt)).toBeGreaterThan(started);
    expect(Date.parse(body.upload.expiresAt)).toBeLessThanOrEqual(
      started + 24 * 60 * 60 * 1000 + 5000,
    );
    const row = await stored(body.video.id);
    expect(row.channel_id).toBe(owner.channel?.id);
    expect(row.channel_id).not.toBe(other.channel?.id);
    expect(row.title).toBe('My first video');
    expect(row.declared_size_bytes).toBe(String(bytes.length));
    expect(row.upload_id).toEqual(expect.any(String));
    expect(row.upload_expires_at.toISOString()).toBe(body.upload.expiresAt);
    expect(row.upload_operation).toBeNull();
    const sessions = await fixture.storage.uploads(row.source_key);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].UploadId).toBe(row.upload_id);
    expect(await resources()).toEqual({
      videos: before.videos + 1,
      uploads: before.uploads + 1,
      outbox: before.outbox,
    });
    expect(response.text).not.toContain(row.source_key);
    expect(response.text).not.toContain(row.upload_id);
  });

  it('1.2 should accept the declared 10GB boundary without transferring binary bytes', async () => {
    const response = await post({ ...input, sizeBytes: 10_000_000_000 }).expect(
      201,
    );
    const body = response.body as InitializationBody;
    expect(body.video.status).toBe('draft');
    expect(body.upload.partCount).toBe(150);
    const row = await stored(body.video.id);
    expect(row.declared_size_bytes).toBe('10000000000');
    await expect(
      fixture.storage.storage.headObject(row.source_key),
    ).rejects.toMatchObject({ kind: 'object_not_found' });
    expect(
      await fixture.storage.storage.listParts(row.source_key, row.upload_id!),
    ).toEqual([]);
    expect(
      await fixture.source.getRepository(VideoProcessingOutbox).count(),
    ).toBe(0);
  });

  it('1.3 should reject above-limit size with the inherited validation envelope and no side effects', async () => {
    const before = await resources();
    const response = await post({ ...input, sizeBytes: 10_000_000_001 }).expect(
      400,
    );
    expect(response.body as ErrorBody).toMatchObject({
      statusCode: 400,
      error: 'VALIDATION_ERROR',
      message: expect.any(Array),
    });
    expect(await resources()).toEqual(before);
  });

  it('1.4 should reject a forged channelId rather than creating in either channel', async () => {
    const before = await resources();
    const response = await post({
      ...input,
      channelId: other.channel?.id,
    }).expect(400);
    expect(response.body as ErrorBody).toMatchObject({
      error: 'VALIDATION_ERROR',
      message: expect.arrayContaining([expect.stringContaining('channelId')]),
    });
    expect(await resources()).toEqual(before);
  });

  it('1.5 should reject missing and invalid JWTs using the real global guard', async () => {
    const before = await resources();
    const missing = await request(fixture.app.getHttpServer())
      .post('/videos/uploads')
      .send(input)
      .expect(401);
    const invalid = await post(input, 'invalid.jwt').expect(401);
    for (const response of [missing, invalid])
      expect(response.body as ErrorBody).toEqual({
        statusCode: 401,
        message: 'Unauthorized',
      });
    expect(await resources()).toEqual(before);
  });

  it('1.6 should allow ten distinct creations and reject the eleventh through the real throttler', async () => {
    const ids = new Set<string>();
    for (let index = 0; index < 10; index++) {
      const response = await post().expect(201);
      ids.add((response.body as InitializationBody).video.id);
    }
    expect(ids.size).toBe(10);
    const before = await resources();
    expect(before).toEqual({ videos: 10, uploads: 10, outbox: 0 });
    const response = await post().expect(429);
    expect(response.body as ErrorBody).toEqual({
      statusCode: 429,
      message: 'ThrottlerException: Too Many Requests',
    });
    expect(await resources()).toEqual(before);
    const rows = await fixture.source.getRepository(Video).find();
    expect(
      rows.every(
        (video) =>
          video.channel_id === owner.channel?.id && video.status === 'draft',
      ),
    ).toBe(true);
  });

  it('should return CHANNEL_NOT_FOUND when the authenticated user has no channel', async () => {
    const user = await fixture.owner(false);
    const before = await resources();
    const response = await post(input, user.token).expect(404);
    expect(response.body as ErrorBody).toMatchObject({
      statusCode: 404,
      error: 'CHANNEL_NOT_FOUND',
    });
    expect(await resources()).toEqual(before);
  });

  it('should enforce security-sensitive field constraints before creating any resources', async () => {
    const before = await resources();
    const invalid = [
      { title: '   ' },
      { fileName: '../movie.mp4' },
      { fileName: 'dir\\movie.mp4' },
      { fileName: 'movie\r\n.mp4' },
      { fileName: 'movie\x00.mp4' },
      { contentType: 'application/octet-stream' },
      { sizeBytes: '100' },
      { sizeBytes: 1.5 },
    ];
    for (const fields of invalid) {
      const response = await post({ ...input, ...fields }).expect(400);
      expect(response.body as ErrorBody).toMatchObject({
        error: 'VALIDATION_ERROR',
        message: expect.any(Array),
      });
    }
    expect(await resources()).toEqual(before);
  });

  it('should reject multipart bytes and control JSON above 64KiB without creating sessions', async () => {
    const before = await resources();
    await request(fixture.app.getHttpServer())
      .post('/videos/uploads')
      .set('Authorization', `Bearer ${owner.token}`)
      .attach('video', bytes, 'video.mp4')
      .expect(400);
    const response = await post({ ...input, title: 'x'.repeat(65_536) }).expect(
      413,
    );
    expect(response.body as ErrorBody).toMatchObject({
      statusCode: 413,
      error: 'Payload Too Large',
      message: expect.any(String),
    });
    expect(await resources()).toEqual(before);
  });

  it('should map an unconfirmed S3 initialization to sanitized 503 without returning success', async () => {
    jest
      .spyOn(fixture.module.get<StoragePort>(STORAGE), 'createMultipartUpload')
      .mockRejectedValueOnce(new StorageError('unavailable'));
    const response = await post().expect(503);
    expect(response.body as ErrorBody).toMatchObject({
      statusCode: 503,
      error: 'STORAGE_UNAVAILABLE',
    });
    const rows = await fixture.source.getRepository(Video).find();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('draft');
    expect(rows[0].upload_operation).toBe('initializing');
    expect(await resources()).toEqual({ videos: 1, uploads: 0, outbox: 0 });
    expect(response.text).not.toContain(rows[0].source_key);
  });

  it('should document the protected JSON operation and safe response/error schemas', () => {
    const document = buildSwaggerDocument(fixture.app);
    const operation = document.paths['/videos/uploads'].post!;
    expect(operation.security).toEqual([{ 'access-token': [] }]);
    expect(operation.responses['201']).toMatchObject({
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/VideoUploadInitializationDto' },
        },
      },
    });
    for (const status of ['400', '401', '404', '409', '413', '429', '503'])
      expect(operation.responses[status]).toMatchObject({
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ApiErrorEnvelope' },
          },
        },
      });
    expect(document.components?.schemas?.VideoStatusDto).toMatchObject({
      properties: {
        errorCode: { nullable: true },
        id: { format: 'uuid' },
        createdAt: { format: 'date-time' },
      },
    });
  });
});
