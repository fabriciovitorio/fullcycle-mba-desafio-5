import { expect, jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  GetObjectCommand,
  PutObjectCommand,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
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

interface CompletionBody {
  video: {
    id: string;
    slug: string;
    status: string;
    errorCode: string | null;
    createdAt: string;
    updatedAt: string;
  };
}
interface ErrorBody {
  statusCode: number;
  error?: string;
  message: string | string[];
}
interface PermissionsBody {
  parts: {
    partNumber: number;
    url: string;
    headers: { 'Content-Length': string };
  }[];
}

describe('POST /videos/:id/upload/completion (e2e)', () => {
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
  async function initialize(sizeBytes = media.length): Promise<Video> {
    const response = await request(fixture.app.getHttpServer())
      .post('/videos/uploads')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({
        title: 'Completion test',
        fileName: 'original.mp4',
        contentType: 'video/mp4',
        sizeBytes,
      })
      .expect(201);
    return stored((response.body as CompletionBody).video.id);
  }
  function complete(id: string, token = owner.token) {
    return request(fixture.app.getHttpServer())
      .post(`/videos/${id}/upload/completion`)
      .set('Authorization', `Bearer ${token}`);
  }
  async function upload(row: Video, partNumber = 1) {
    const response = await request(fixture.app.getHttpServer())
      .post(`/videos/${row.id}/upload/parts`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ partNumbers: [partNumber] })
      .expect(200);
    const part = (response.body as PermissionsBody).parts[0];
    const put = await fetch(part.url, {
      method: 'PUT',
      headers: part.headers,
      body: media,
    });
    await put.arrayBuffer();
    expect(put.status).toBe(200);
  }
  async function intentions(id: string) {
    return fixture.source
      .getRepository(VideoProcessingOutbox)
      .find({ where: { video_id: id } });
  }

  it('1.1 should return202 and persist the exact original and one processing intention', async () => {
    const row = await initialize();
    await upload(row);
    const response = await complete(row.id).expect(202);
    const body = response.body as CompletionBody;
    expect(Object.keys(body)).toEqual(['video']);
    expect(Object.keys(body.video).sort()).toEqual([
      'createdAt',
      'errorCode',
      'id',
      'slug',
      'status',
      'updatedAt',
    ]);
    expect(body.video).toMatchObject({
      id: row.id,
      slug: row.slug,
      status: 'processing',
      errorCode: null,
    });
    const current = await stored(row.id);
    expect(current.status).toBe('processing');
    expect(current.actual_size_bytes).toBe(String(media.length));
    expect(body.video.updatedAt).toBe(current.updated_at.toISOString());
    expect(
      (await fixture.storage.storage.headObject(row.source_key)).contentLength,
    ).toBe(Number(row.declared_size_bytes));
    const original = await fixture.storage.client.send(
      new GetObjectCommand({
        Bucket: fixture.storage.config.bucket,
        Key: row.source_key,
      }),
    );
    expect(original.Body).toBeDefined();
    expect(Buffer.from(await original.Body!.transformToByteArray())).toEqual(
      media,
    );
    expect(await intentions(row.id)).toHaveLength(1);
    expect(await fixture.storage.uploads(row.source_key)).toEqual([]);
    expect(response.text).not.toContain(row.source_key);
    expect(response.text).not.toContain(row.upload_id);
  });

  it('1.2 should replay202 in processing with stable identity, timestamps and exactly one intention', async () => {
    const row = await initialize();
    await upload(row);
    const first = await complete(row.id).expect(202);
    const before = await stored(row.id);
    const outbox = await intentions(row.id);
    const replay = await complete(row.id).expect(202);
    expect(replay.body as CompletionBody).toEqual(first.body as CompletionBody);
    expect(await stored(row.id)).toEqual(before);
    expect(await intentions(row.id)).toEqual(outbox);
    expect(outbox).toHaveLength(1);
    expect(await fixture.source.getRepository(Video).count()).toBe(1);
    expect(await fixture.storage.uploads(row.source_key)).toEqual([]);
  });

  it('1.3 should replay200 for a consistent ready fixture without changing published keys or budget', async () => {
    const row = await initialize();
    await upload(row);
    await complete(row.id).expect(202);
    const playback = fixture.storage.key('completion-playback.mp4');
    const thumbnail = fixture.storage.key('completion-thumbnail.jpg');
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
    const response = await complete(row.id).expect(200);
    expect((response.body as CompletionBody).video).toMatchObject({
      id: row.id,
      slug: row.slug,
      status: 'ready',
      errorCode: null,
    });
    expect(await stored(row.id)).toEqual(before);
    expect(await intentions(row.id)).toEqual(outbox);
    expect(outbox).toHaveLength(1);
    expect(outbox[0].completed_at).not.toBeNull();
    expect(await fixture.storage.uploads(row.source_key)).toEqual([]);
    expect(
      (await fixture.storage.storage.headObject(playback)).contentLength,
    ).toBe(media.length);
    expect(
      (await fixture.storage.storage.headObject(thumbnail)).contentLength,
    ).toBe(jpeg.length);
  });

  it('1.4 should reject a missing part with UPLOAD_INCOMPLETE while leaving the session resumable', async () => {
    const row = await initialize(67_108_864 + media.length);
    await upload(row, 2);
    const parts = await fixture.storage.storage.listParts(
      row.source_key,
      row.upload_id!,
    );
    const response = await complete(row.id).expect(409);
    expect(response.body as ErrorBody).toMatchObject({
      statusCode: 409,
      error: 'UPLOAD_INCOMPLETE',
    });
    const current = await stored(row.id);
    expect(current.status).toBe('draft');
    expect(current.slug).toBe(row.slug);
    expect(current.upload_id).toBe(row.upload_id);
    expect(current.upload_operation).toBeNull();
    expect(await intentions(row.id)).toEqual([]);
    expect(
      await fixture.storage.storage.listParts(row.source_key, row.upload_id!),
    ).toEqual(parts);
    const resumed = await request(fixture.app.getHttpServer())
      .get(`/videos/${row.id}/upload`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);
    expect(
      (
        resumed.body as { upload: { parts: { partNumber: number }[] } }
      ).upload.parts.map((part) => part.partNumber),
    ).toEqual([2]);
  });

  it('1.5 should reject real divergent bytes and leave no processing intention or published object', async () => {
    const row = await initialize();
    const wrong = Buffer.concat([media, Buffer.from('x')]);
    await fixture.storage.client.send(
      new UploadPartCommand({
        Bucket: fixture.storage.config.bucket,
        Key: row.source_key,
        UploadId: row.upload_id!,
        PartNumber: 1,
        ContentLength: wrong.length,
        Body: wrong,
      }),
    );
    expect(
      (
        await fixture.storage.storage.listParts(row.source_key, row.upload_id!)
      )[0].size,
    ).toBe(wrong.length);
    const response = await complete(row.id).expect(409);
    expect(response.body as ErrorBody).toMatchObject({
      statusCode: 409,
      error: 'UPLOAD_SIZE_MISMATCH',
    });
    const current = await stored(row.id);
    expect(current.status).toBe('error');
    expect(current.error_code).toBe('UPLOAD_SIZE_MISMATCH');
    expect(current.playback_key).toBeNull();
    expect(current.thumbnail_key).toBeNull();
    expect(await intentions(row.id)).toEqual([]);
    expect(await fixture.storage.uploads(row.source_key)).toEqual([]);
    await expect(
      fixture.storage.storage.headObject(row.source_key),
    ).rejects.toMatchObject({ kind: 'object_not_found' });
  });

  it('1.6 should hide foreign resources and enforce real JWT authentication without mutating the draft', async () => {
    const row = await initialize();
    await upload(row);
    const foreign = await complete(row.id, other.token).expect(404);
    expect(foreign.body as ErrorBody).toMatchObject({
      error: 'VIDEO_NOT_FOUND',
    });
    const missing = await request(fixture.app.getHttpServer())
      .post(`/videos/${row.id}/upload/completion`)
      .expect(401);
    const invalid = await complete(row.id, 'invalid.jwt').expect(401);
    for (const response of [missing, invalid])
      expect(response.body as ErrorBody).toEqual({
        statusCode: 401,
        message: 'Unauthorized',
      });
    expect(await stored(row.id)).toEqual(row);
    expect(await intentions(row.id)).toEqual([]);
    expect(await fixture.storage.uploads(row.source_key)).toHaveLength(1);
  });

  it('1.6 should reject malformed UUID through VALIDATION_ERROR', async () => {
    const response = await complete('identificador-invalido').expect(400);
    expect(response.body as ErrorBody).toMatchObject({
      statusCode: 400,
      error: 'VALIDATION_ERROR',
      message: expect.any(Array),
    });
  });

  it.each([{}, { etags: ['client-etag'] }, { sizeBytes: 1 }])(
    'should reject supplied JSON body %# before touching a valid upload',
    async (body) => {
      const row = await initialize();
      await upload(row);
      const response = await complete(row.id).send(body).expect(400);
      expect(response.body as ErrorBody).toMatchObject({
        error: 'VALIDATION_ERROR',
        message: expect.any(Array),
      });
      expect(await stored(row.id)).toEqual(row);
      expect(await intentions(row.id)).toEqual([]);
    },
  );

  it('should reject an unparsed non-JSON body instead of ignoring client payload', async () => {
    const row = await initialize();
    await upload(row);
    const response = await complete(row.id)
      .set('Content-Type', 'application/octet-stream')
      .send(media)
      .expect(400);
    expect(response.body as ErrorBody).toMatchObject({
      error: 'VALIDATION_ERROR',
    });
    expect(await stored(row.id)).toEqual(row);
    expect(await intentions(row.id)).toEqual([]);
  });

  it('should return410 for an expired uncompleted upload without creating outbox', async () => {
    const row = await initialize();
    await fixture.source
      .getRepository(Video)
      .update(row.id, { upload_expires_at: new Date(Date.now() - 1000) });
    const response = await complete(row.id).expect(410);
    expect(response.body as ErrorBody).toMatchObject({
      error: 'UPLOAD_EXPIRED',
    });
    expect((await stored(row.id)).error_code).toBe('UPLOAD_EXPIRED');
    expect(await intentions(row.id)).toEqual([]);
  });

  it('should reject a competing claim and return no false202', async () => {
    const row = await initialize();
    await upload(row);
    expect(
      await fixture.module
        .get(VideosRepository)
        .claimUpload(row.id, row.channel_id, 'aborting', 120_000),
    ).not.toBeNull();
    const before = await stored(row.id);
    const response = await complete(row.id).expect(409);
    expect(response.body as ErrorBody).toMatchObject({
      error: 'UPLOAD_OPERATION_IN_PROGRESS',
    });
    expect(await stored(row.id)).toEqual(before);
    expect(await intentions(row.id)).toEqual([]);
  });

  it('should hide absent videos and authenticated users without channels', async () => {
    const row = await initialize();
    const noChannel = await fixture.owner(false);
    for (const [id, token] of [
      [randomUUID(), owner.token],
      [row.id, noChannel.token],
    ]) {
      const response = await complete(id, token).expect(404);
      expect(response.body as ErrorBody).toMatchObject({
        error: 'VIDEO_NOT_FOUND',
      });
    }
    expect(await stored(row.id)).toEqual(row);
  });

  it('should map typed storage failure to503 without accepting processing', async () => {
    const row = await initialize();
    await upload(row);
    jest
      .spyOn(fixture.module.get<StoragePort>(STORAGE), 'headObject')
      .mockRejectedValueOnce(new StorageError('unavailable'));
    const response = await complete(row.id).expect(503);
    expect(response.body as ErrorBody).toMatchObject({
      error: 'STORAGE_UNAVAILABLE',
    });
    expect((await stored(row.id)).status).toBe('draft');
    expect(await intentions(row.id)).toEqual([]);
  });

  it('should allow120 completion requests and reject request121 through the real throttler', async () => {
    const row = await initialize();
    await upload(row);
    await complete(row.id).expect(202);
    for (let index = 1; index < 120; index++)
      await complete(row.id).expect(202);
    const response = await complete(row.id).expect(429);
    expect(response.body as ErrorBody).toEqual({
      statusCode: 429,
      message: 'ThrottlerException: Too Many Requests',
    });
    expect(await intentions(row.id)).toHaveLength(1);
  }, 30000);

  it('should document both success statuses with UUID/JWT and no request body', () => {
    const operation = buildSwaggerDocument(fixture.app).paths[
      '/videos/{id}/upload/completion'
    ].post!;
    expect(operation.security).toEqual([{ 'access-token': [] }]);
    expect(operation.requestBody).toBeUndefined();
    for (const status of ['200', '202'])
      expect(operation.responses[status]).toMatchObject({
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/VideoUploadCompletionDto' },
          },
        },
      });
    for (const status of [
      '400',
      '401',
      '404',
      '409',
      '410',
      '413',
      '429',
      '503',
    ])
      expect(operation.responses[status]).toMatchObject({
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ApiErrorEnvelope' },
          },
        },
      });
  });
});
