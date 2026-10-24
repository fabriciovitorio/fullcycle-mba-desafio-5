import { expect, jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import request from 'supertest';
import { STORAGE, type StoragePort } from '../src/storage/storage.port';
import { StorageError } from '../src/storage/storage.error';
import { Video } from '../src/videos/entities/video.entity';
import { VideoProcessingOutbox } from '../src/videos/entities/video-processing-outbox.entity';
import { VideosRepository } from '../src/videos/videos.repository';
import { buildSwaggerDocument } from '../src/swagger/swagger-document';
import {
  createVideosHttpFixture,
  type VideosHttpFixture,
} from './helpers/videos-http.fixture';

interface Permission {
  partNumber: number;
  url: string;
  headers: { 'Content-Length': string };
}
interface ErrorBody {
  statusCode: number;
  error?: string;
  message: string | string[];
}

describe('DELETE /videos/:id/upload (e2e)', () => {
  let fixture: VideosHttpFixture;
  let owner: Awaited<ReturnType<VideosHttpFixture['owner']>>;
  let other: Awaited<ReturnType<VideosHttpFixture['owner']>>;
  const media = readFileSync(join(__dirname, 'fixtures/upload-small.mp4'));
  const jpeg = readFileSync(join(__dirname, 'fixtures/upload-thumbnail.jpg'));

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

  async function stored(id: string): Promise<Video> {
    return fixture.source
      .getRepository(Video)
      .createQueryBuilder('video')
      .addSelect('video.upload_id')
      .where({ id })
      .getOneOrFail();
  }
  async function initialize(): Promise<Video> {
    const response = await request(fixture.app.getHttpServer())
      .post('/videos/uploads')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({
        title: 'Abort test',
        fileName: 'original.mp4',
        contentType: 'video/mp4',
        sizeBytes: media.length,
      })
      .expect(201);
    return stored((response.body as { video: { id: string } }).video.id);
  }
  function abort(id: string, token = owner.token) {
    return request(fixture.app.getHttpServer())
      .delete(`/videos/${id}/upload`)
      .set('Authorization', `Bearer ${token}`);
  }
  async function put(part: Permission): Promise<void> {
    const response = await fetch(part.url, {
      method: 'PUT',
      headers: part.headers,
      body: media,
    });
    await response.arrayBuffer();
    expect(response.status).toBe(200);
  }
  async function upload(row: Video): Promise<Permission> {
    const response = await request(fixture.app.getHttpServer())
      .post(`/videos/${row.id}/upload/parts`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ partNumbers: [1] })
      .expect(200);
    const part = (response.body as { parts: Permission[] }).parts[0];
    await put(part);
    return part;
  }
  async function intentions(id: string) {
    return fixture.source
      .getRepository(VideoProcessingOutbox)
      .find({ where: { video_id: id } });
  }
  async function bytes(key: string): Promise<Buffer> {
    const response = await fixture.storage.client.send(
      new GetObjectCommand({ Bucket: fixture.storage.config.bucket, Key: key }),
    );
    expect(response.Body).toBeDefined();
    return Buffer.from(await response.Body!.transformToByteArray());
  }
  async function processing(): Promise<Video> {
    const row = await initialize();
    await upload(row);
    await request(fixture.app.getHttpServer())
      .post(`/videos/${row.id}/upload/completion`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(202);
    return stored(row.id);
  }

  it('1.1 should return empty204, retain the video as aborted and revoke an issued part URL', async () => {
    const row = await initialize();
    const part = await upload(row);
    expect(
      await fixture.storage.storage.listParts(row.source_key, row.upload_id!),
    ).toHaveLength(1);
    const response = await abort(row.id).expect(204);
    expect(response.text).toBe('');
    expect(response.headers['content-type']).toBeUndefined();
    const current = await stored(row.id);
    expect(current).toMatchObject({
      id: row.id,
      slug: row.slug,
      status: 'error',
      error_code: 'UPLOAD_ABORTED',
      upload_operation: null,
      playback_key: null,
      thumbnail_key: null,
    });
    expect(await fixture.source.getRepository(Video).count()).toBe(1);
    expect(await intentions(row.id)).toEqual([]);
    expect(await fixture.storage.uploads(row.source_key)).toEqual([]);
    await expect(
      fixture.storage.storage.listParts(row.source_key, row.upload_id!),
    ).rejects.toMatchObject({ kind: 'upload_not_found' });
    const revoked = await fetch(part.url, {
      method: 'PUT',
      headers: part.headers,
      body: media,
    });
    const xml = await revoked.text();
    expect(revoked.ok).toBe(false);
    expect(xml).toContain('NoSuchUpload');
    await expect(
      fixture.storage.storage.headObject(row.source_key),
    ).rejects.toMatchObject({
      kind: 'object_not_found',
    });
  });

  it('1.2 should replay empty204 without changing identity, timestamps or terminal error', async () => {
    const row = await initialize();
    await upload(row);
    await abort(row.id).expect(204);
    const before = await stored(row.id);
    const replay = await abort(row.id).expect(204);
    expect(replay.text).toBe('');
    expect(await stored(row.id)).toEqual(before);
    expect(await intentions(row.id)).toEqual([]);
    expect(await fixture.storage.uploads(row.source_key)).toEqual([]);
    expect(await fixture.source.getRepository(Video).count()).toBe(1);
  });

  it('1.3 should reject processing with409 and preserve the original and processing intention', async () => {
    const row = await processing();
    const outbox = await intentions(row.id);
    expect(outbox).toHaveLength(1);
    const response = await abort(row.id).expect(409);
    expect(response.body as ErrorBody).toMatchObject({
      error: 'INVALID_VIDEO_STATE',
    });
    expect(await stored(row.id)).toEqual(row);
    expect(await intentions(row.id)).toEqual(outbox);
    expect(await bytes(row.source_key)).toEqual(media);
  });

  it('1.3 should reject ready with409 and preserve all published bytes and processing budget', async () => {
    const row = await processing();
    const playback = fixture.storage.key('abort-playback.mp4');
    const thumbnail = fixture.storage.key('abort-thumbnail.jpg');
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
      processing_attempts: 1,
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
    const before = await stored(row.id);
    const outbox = await intentions(row.id);
    const response = await abort(row.id).expect(409);
    expect(response.body as ErrorBody).toMatchObject({
      error: 'INVALID_VIDEO_STATE',
    });
    expect(await stored(row.id)).toEqual(before);
    expect(await intentions(row.id)).toEqual(outbox);
    expect(await bytes(row.source_key)).toEqual(media);
    expect(await bytes(playback)).toEqual(media);
    expect(await bytes(thumbnail)).toEqual(jpeg);
  });

  it('1.4 should hide another channel video and leave its existing upload permission usable', async () => {
    const row = await initialize();
    const part = await upload(row);
    const response = await abort(row.id, other.token).expect(404);
    expect(response.body as ErrorBody).toMatchObject({
      error: 'VIDEO_NOT_FOUND',
    });
    expect(await stored(row.id)).toEqual(row);
    await put(part);
    expect(
      await fixture.storage.storage.listParts(row.source_key, row.upload_id!),
    ).toEqual([expect.objectContaining({ partNumber: 1, size: media.length })]);
    expect(await intentions(row.id)).toEqual([]);
  });

  it('1.5 should require a valid JWT without touching the draft session', async () => {
    const row = await initialize();
    await upload(row);
    const missing = await request(fixture.app.getHttpServer())
      .delete(`/videos/${row.id}/upload`)
      .expect(401);
    const invalid = await abort(row.id, 'invalid-token').expect(401);
    for (const response of [missing, invalid])
      expect(response.body as ErrorBody).toEqual({
        statusCode: 401,
        message: 'Unauthorized',
      });
    expect(await stored(row.id)).toEqual(row);
    expect(
      await fixture.storage.storage.listParts(row.source_key, row.upload_id!),
    ).toHaveLength(1);
  });

  it('1.5 should reject a malformed UUID through the inherited validation filter', async () => {
    const row = await initialize();
    const response = await abort('invalid-id').expect(400);
    expect(response.body as ErrorBody).toMatchObject({
      statusCode: 400,
      error: 'VALIDATION_ERROR',
    });
    expect(Array.isArray((response.body as ErrorBody).message)).toBe(true);
    expect(await stored(row.id)).toEqual(row);
  });

  it.each([{}, { uploadId: 'untrusted' }])(
    'should reject a supplied JSON body %j before aborting',
    async (body) => {
      const row = await initialize();
      await abort(row.id).send(body).expect(400);
      expect(await stored(row.id)).toEqual(row);
      expect(await fixture.storage.uploads(row.source_key)).toHaveLength(1);
    },
  );

  it('should reject an unparsed binary request body instead of ignoring it', async () => {
    const row = await initialize();
    await abort(row.id)
      .set('Content-Type', 'application/octet-stream')
      .send(media)
      .expect(400);
    expect(await stored(row.id)).toEqual(row);
  });

  it('should hide an absent video and an authenticated user without a channel', async () => {
    const row = await initialize();
    const noChannel = await fixture.owner(false);
    for (const [id, token] of [
      [randomUUID(), owner.token],
      [row.id, noChannel.token],
    ]) {
      const response = await abort(id, token).expect(404);
      expect(response.body as ErrorBody).toMatchObject({
        error: 'VIDEO_NOT_FOUND',
      });
    }
    expect(await stored(row.id)).toEqual(row);
  });

  it('should reject an active completion claim without changing the session', async () => {
    const row = await initialize();
    await fixture.module
      .get(VideosRepository)
      .claimUpload(row.id, row.channel_id, 'completing', 120000);
    const before = await stored(row.id);
    const response = await abort(row.id).expect(409);
    expect(response.body as ErrorBody).toMatchObject({
      error: 'UPLOAD_OPERATION_IN_PROGRESS',
    });
    expect(await stored(row.id)).toEqual(before);
    expect(await intentions(row.id)).toEqual([]);
  });

  it('should return503 without falsely confirming abort when storage is unavailable', async () => {
    const row = await initialize();
    const part = await upload(row);
    jest
      .spyOn(fixture.module.get<StoragePort>(STORAGE), 'abortMultipartUpload')
      .mockRejectedValueOnce(new StorageError('unavailable'));
    const response = await abort(row.id).expect(503);
    expect(response.body as ErrorBody).toMatchObject({
      statusCode: 503,
      error: 'STORAGE_UNAVAILABLE',
    });
    const current = await stored(row.id);
    expect(current).toMatchObject({
      id: row.id,
      slug: row.slug,
      status: 'draft',
      error_code: null,
      upload_operation: 'aborting',
    });
    expect(current.operation_expires_at).not.toBeNull();
    expect(await intentions(row.id)).toEqual([]);
    await put(part);
    expect(await fixture.storage.uploads(row.source_key)).toHaveLength(1);
  });

  it('should reconcile an already completed original instead of confirming a false abort', async () => {
    const row = await initialize();
    await upload(row);
    const parts = await fixture.storage.storage.listParts(
      row.source_key,
      row.upload_id!,
    );
    await fixture.storage.storage.completeMultipartUpload(
      row.source_key,
      row.upload_id!,
      parts,
    );
    const response = await abort(row.id).expect(409);
    expect(response.body as ErrorBody).toMatchObject({
      error: 'INVALID_VIDEO_STATE',
    });
    const current = await stored(row.id);
    expect(current).toMatchObject({
      id: row.id,
      slug: row.slug,
      status: 'processing',
      error_code: null,
    });
    expect(await intentions(row.id)).toHaveLength(1);
    expect(await bytes(row.source_key)).toEqual(media);
    expect(await fixture.storage.uploads(row.source_key)).toEqual([]);
  });

  it('should allow10 abort calls and reject call11 through the real route throttler', async () => {
    const row = await initialize();
    await upload(row);
    for (let index = 0; index < 10; index++) {
      const response = await abort(row.id).expect(204);
      expect(response.text).toBe('');
    }
    const before = await stored(row.id);
    const response = await abort(row.id).expect(429);
    expect(response.body as ErrorBody).toEqual({
      statusCode: 429,
      message: 'ThrottlerException: Too Many Requests',
    });
    expect(await stored(row.id)).toEqual(before);
    expect(await intentions(row.id)).toEqual([]);
    expect(await fixture.storage.uploads(row.source_key)).toEqual([]);
  });

  it('should document204 without content/schema, JWT, UUID and shared errors', () => {
    const operation = buildSwaggerDocument(fixture.app).paths[
      '/videos/{id}/upload'
    ].delete!;
    expect(operation.security).toEqual([{ 'access-token': [] }]);
    expect(operation.requestBody).toBeUndefined();
    expect(operation.responses['204']).toEqual({
      description: 'Upload aborted, or already aborted; no response body',
    });
    expect(operation.responses['200']).toBeUndefined();
    for (const status of ['400', '401', '404', '409', '413', '429', '503'])
      expect(operation.responses[status]).toMatchObject({
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ApiErrorEnvelope' },
          },
        },
      });
    expect(operation.parameters).toContainEqual(
      expect.objectContaining({
        name: 'id',
        in: 'path',
        required: true,
        schema: { type: 'string', format: 'uuid' },
      }),
    );
  });
});
