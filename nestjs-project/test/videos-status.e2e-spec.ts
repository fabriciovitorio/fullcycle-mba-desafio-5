import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import request from 'supertest';
import { Video, type VideoStatus } from '../src/videos/entities/video.entity';
import { VideoProcessingOutbox } from '../src/videos/entities/video-processing-outbox.entity';
import { VideosRepository } from '../src/videos/videos.repository';
import { buildSwaggerDocument } from '../src/swagger/swagger-document';
import {
  createVideosHttpFixture,
  type VideosHttpFixture,
} from './helpers/videos-http.fixture';

interface StatusBody {
  id: string;
  slug: string;
  status: VideoStatus;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
}
interface ErrorBody {
  statusCode: number;
  error?: string;
  message: string | string[];
}

describe('GET /videos/:id/status (e2e)', () => {
  let fixture: VideosHttpFixture;
  let owner: Awaited<ReturnType<VideosHttpFixture['owner']>>;
  let other: Awaited<ReturnType<VideosHttpFixture['owner']>>;
  const media = readFileSync(join(__dirname, 'fixtures/upload-small.mp4'));
  const jpeg = readFileSync(join(__dirname, 'fixtures/upload-thumbnail.jpg'));
  const states: VideoStatus[] = ['draft', 'processing', 'ready', 'error'];

  beforeAll(async () => {
    fixture = await createVideosHttpFixture();
  });
  beforeEach(async () => {
    await fixture.clean();
    owner = await fixture.owner();
    other = await fixture.owner();
  });
  afterEach(async () => {
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
  function status(id: string, token = owner.token) {
    return request(fixture.app.getHttpServer())
      .get(`/videos/${id}/status`)
      .set('Authorization', `Bearer ${token}`);
  }
  async function intentions(id: string) {
    return fixture.source
      .getRepository(VideoProcessingOutbox)
      .find({ where: { video_id: id } });
  }
  async function stateFixture(state: VideoStatus): Promise<Video> {
    const response = await request(fixture.app.getHttpServer())
      .post('/videos/uploads')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({
        title: 'Private status test',
        fileName: 'original.mp4',
        contentType: 'video/mp4',
        sizeBytes: media.length,
      })
      .expect(201);
    const row = await stored(
      (response.body as { video: { id: string } }).video.id,
    );
    if (state === 'draft') return row;
    const signed = await request(fixture.app.getHttpServer())
      .post(`/videos/${row.id}/upload/parts`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ partNumbers: [1] })
      .expect(200);
    const part = (
      signed.body as {
        parts: { url: string; headers: Record<string, string> }[];
      }
    ).parts[0];
    const put = await fetch(part.url, {
      method: 'PUT',
      headers: part.headers,
      body: media,
    });
    await put.arrayBuffer();
    expect(put.status).toBe(200);
    await request(fixture.app.getHttpServer())
      .post(`/videos/${row.id}/upload/completion`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(202);
    if (state === 'processing') return stored(row.id);
    if (state === 'ready') {
      const playback = fixture.storage.key('status-playback.mp4');
      const thumbnail = fixture.storage.key('status-thumbnail.jpg');
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
    } else {
      await fixture.source.getRepository(Video).update(row.id, {
        status: 'error',
        error_code: 'PROCESSING_FAILED',
        error_message: 'Video processing failed',
        processing_attempts: 3,
      });
    }
    // Consistent terminal fixture, without claiming a worker was executed.
    await fixture.source
      .getRepository(VideoProcessingOutbox)
      .update({ video_id: row.id }, { completed_at: new Date() });
    return stored(row.id);
  }
  async function expectMediaIntact(row: Video): Promise<void> {
    if (row.status === 'draft') {
      expect(await fixture.storage.uploads(row.source_key)).toHaveLength(1);
      return;
    }
    for (const [Key, expected] of [
      [row.source_key, media],
      [row.playback_key, media],
      [row.thumbnail_key, jpeg],
    ] as const) {
      if (!Key) continue;
      const object = await fixture.storage.client.send(
        new GetObjectCommand({ Bucket: fixture.storage.config.bucket, Key }),
      );
      expect(object.Body).toBeDefined();
      expect(Buffer.from(await object.Body!.transformToByteArray())).toEqual(
        expected,
      );
    }
  }

  it.each(states)(
    '1.1 should return exactly the owner projection in %s without changing persisted state',
    async (state) => {
      const row = await stateFixture(state);
      const outbox = await intentions(row.id);
      const response = await status(row.id).expect(200);
      const body = response.body as StatusBody;
      expect(body).toEqual({
        id: row.id,
        slug: row.slug,
        status: state,
        errorCode: state === 'error' ? 'PROCESSING_FAILED' : null,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
      });
      expect(new Date(body.createdAt).toISOString()).toBe(body.createdAt);
      expect(new Date(body.updatedAt).toISOString()).toBe(body.updatedAt);
      expect(await stored(row.id)).toEqual(row);
      expect(await intentions(row.id)).toEqual(outbox);
      await expectMediaIntact(row);
    },
  );

  it('1.2 should expose only a safe error code without messages, internal keys or diagnostics', async () => {
    const row = await stateFixture('error');
    const response = await status(row.id).expect(200);
    expect((response.body as StatusBody).errorCode).toBe('PROCESSING_FAILED');
    expect(Object.keys(response.body as StatusBody).sort()).toEqual([
      'createdAt',
      'errorCode',
      'id',
      'slug',
      'status',
      'updatedAt',
    ]);
    for (const internal of [
      row.source_key,
      row.error_message!,
      'upload_id',
      'stderr',
      'stack',
      'password',
      'credential',
    ])
      expect(response.text).not.toContain(internal);
    expect(await stored(row.id)).toEqual(row);
  });

  it('should suppress an unrecognized persisted error code without rewriting the record', async () => {
    const row = await stateFixture('error');
    await fixture.source
      .getRepository(Video)
      .update(row.id, { error_code: 'PRIVATE_DIAGNOSTIC_CODE' });
    const before = await stored(row.id);
    const response = await status(row.id).expect(200);
    expect((response.body as StatusBody).errorCode).toBeNull();
    expect(response.text).not.toContain('PRIVATE_DIAGNOSTIC_CODE');
    expect(await stored(row.id)).toEqual(before);
  });

  it('1.3 should require a valid JWT without revealing video information', async () => {
    const row = await stateFixture('draft');
    const missing = await request(fixture.app.getHttpServer())
      .get(`/videos/${row.id}/status`)
      .expect(401);
    const invalid = await status(row.id, 'invalid-token').expect(401);
    for (const response of [missing, invalid]) {
      expect(response.body as ErrorBody).toEqual({
        statusCode: 401,
        message: 'Unauthorized',
      });
      expect(response.text).not.toContain(row.slug);
    }
    expect(await stored(row.id)).toEqual(row);
  });

  it.each(states)(
    '1.4 should hide another channel private %s status even when media is ready',
    async (state) => {
      const row = await stateFixture(state);
      const outbox = await intentions(row.id);
      const response = await status(row.id, other.token).expect(404);
      expect(response.body as ErrorBody).toMatchObject({
        statusCode: 404,
        error: 'VIDEO_NOT_FOUND',
      });
      expect(response.text).not.toContain(row.slug);
      expect(await stored(row.id)).toEqual(row);
      expect(await intentions(row.id)).toEqual(outbox);
      await expectMediaIntact(row);
    },
  );

  it('1.5 should validate the UUID through the inherited validation filter', async () => {
    const row = await stateFixture('draft');
    const response = await status('invalid-id').expect(400);
    expect(response.body as ErrorBody).toMatchObject({
      statusCode: 400,
      error: 'VALIDATION_ERROR',
    });
    expect(Array.isArray((response.body as ErrorBody).message)).toBe(true);
    expect(await stored(row.id)).toEqual(row);
  });

  it('should hide absent videos and users without a channel', async () => {
    const row = await stateFixture('draft');
    const noChannel = await fixture.owner(false);
    for (const [id, token] of [
      [randomUUID(), owner.token],
      [row.id, noChannel.token],
    ]) {
      const response = await status(id, token).expect(404);
      expect(response.body as ErrorBody).toMatchObject({
        error: 'VIDEO_NOT_FOUND',
      });
    }
    expect(await stored(row.id)).toEqual(row);
  });

  it('should read an expired draft without expiring or reconciling its upload', async () => {
    const row = await stateFixture('draft');
    await fixture.source
      .getRepository(Video)
      .update(row.id, { upload_expires_at: new Date(Date.now() - 1000) });
    const before = await stored(row.id);
    const response = await status(row.id).expect(200);
    expect(response.body as StatusBody).toMatchObject({
      status: 'draft',
      errorCode: null,
    });
    expect(await stored(row.id)).toEqual(before);
    expect(await fixture.storage.uploads(row.source_key)).toHaveLength(1);
  });

  it('should read a draft with an active upload claim without changing or blocking the claim', async () => {
    const row = await stateFixture('draft');
    const claim = await fixture.module
      .get(VideosRepository)
      .claimUpload(row.id, row.channel_id, 'completing', 120_000);
    expect(claim).not.toBeNull();
    const before = await stored(row.id);
    await status(row.id).expect(200);
    expect(await stored(row.id)).toEqual(before);
    expect(await intentions(row.id)).toEqual([]);
  });

  it('should allow120 status reads and reject read121 through the real throttler', async () => {
    const row = await stateFixture('draft');
    for (let index = 0; index < 120; index++) await status(row.id).expect(200);
    const response = await status(row.id).expect(429);
    expect(response.body as ErrorBody).toEqual({
      statusCode: 429,
      message: 'ThrottlerException: Too Many Requests',
    });
    expect(await stored(row.id)).toEqual(row);
    expect(await intentions(row.id)).toEqual([]);
  }, 30000);

  it('should document the direct safe DTO with UUID/JWT and shared errors', () => {
    const operation = buildSwaggerDocument(fixture.app).paths[
      '/videos/{id}/status'
    ].get!;
    expect(operation.security).toEqual([{ 'access-token': [] }]);
    expect(operation.requestBody).toBeUndefined();
    expect(Object.keys(operation.responses).sort()).toEqual([
      '200',
      '400',
      '401',
      '404',
      '429',
    ]);
    expect(operation.responses['200']).toMatchObject({
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/VideoStatusDto' },
        },
      },
    });
    for (const code of ['400', '401', '404', '429'])
      expect(operation.responses[code]).toMatchObject({
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
