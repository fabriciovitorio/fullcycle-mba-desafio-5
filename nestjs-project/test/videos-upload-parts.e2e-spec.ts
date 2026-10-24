import { expect, jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { STORAGE, type StoragePort } from '../src/storage/storage.port';
import {
  STORAGE_SIGNING,
  type StorageSigningPort,
} from '../src/storage/storage-signing.port';
import { StorageError } from '../src/storage/storage.error';
import { Video } from '../src/videos/entities/video.entity';
import { VideoProcessingOutbox } from '../src/videos/entities/video-processing-outbox.entity';
import { VideosRepository } from '../src/videos/videos.repository';
import { VideoUploadCompletionService } from '../src/videos/video-upload-completion.service';
import { buildSwaggerDocument } from '../src/swagger/swagger-document';
import {
  createVideosHttpFixture,
  type VideosHttpFixture,
} from './helpers/videos-http.fixture';

interface PermissionBody {
  parts: {
    partNumber: number;
    url: string;
    expiresAt: string;
    headers: { 'Content-Length': string };
  }[];
}
interface ErrorBody {
  statusCode: number;
  error?: string;
  message: string | string[];
}

describe('POST /videos/:id/upload/parts (e2e)', () => {
  let fixture: VideosHttpFixture;
  let owner: Awaited<ReturnType<VideosHttpFixture['owner']>>;
  let other: Awaited<ReturnType<VideosHttpFixture['owner']>>;
  const media = readFileSync(join(__dirname, 'fixtures/upload-small.mp4'));
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

  async function stored(id: string): Promise<Video> {
    return fixture.source
      .getRepository(Video)
      .createQueryBuilder('video')
      .addSelect('video.upload_id')
      .where({ id })
      .getOneOrFail();
  }
  async function initialize(
    sizeBytes = partSize + media.length,
  ): Promise<Video> {
    const response = await request(fixture.app.getHttpServer())
      .post('/videos/uploads')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({
        title: 'Part permissions',
        fileName: 'original.mp4',
        contentType: 'video/mp4',
        sizeBytes,
      })
      .expect(201);
    return stored((response.body as { video: { id: string } }).video.id);
  }
  function sign(
    id: string,
    body: object = { partNumbers: [1, 2] },
    token = owner.token,
  ) {
    return request(fixture.app.getHttpServer())
      .post(`/videos/${id}/upload/parts`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  }
  async function assertUnchanged(row: Video) {
    expect(await stored(row.id)).toEqual(row);
    const sessions = await fixture.storage.uploads(row.source_key);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].UploadId).toBe(row.upload_id);
    expect(
      await fixture.source.getRepository(VideoProcessingOutbox).count(),
    ).toBe(0);
  }

  it('1.1 should sign requested parts with exact lengths/deadlines and upload directly using the returned URL', async () => {
    const row = await initialize();
    const started = Date.now();
    const response = await sign(row.id).expect(200);
    const body = response.body as PermissionBody;
    expect(Object.keys(body)).toEqual(['parts']);
    expect(body.parts.map((part) => part.partNumber)).toEqual([1, 2]);
    expect(body.parts.map((part) => part.headers)).toEqual([
      { 'Content-Length': String(partSize) },
      { 'Content-Length': String(media.length) },
    ]);
    for (const part of body.parts) {
      expect(Object.keys(part).sort()).toEqual([
        'expiresAt',
        'headers',
        'partNumber',
        'url',
      ]);
      const url = new URL(part.url);
      expect(url.origin).toBe(fixture.storage.config.publicEndpoint);
      expect(url.searchParams.get('X-Amz-SignedHeaders')?.split(';')).toContain(
        'content-length',
      );
      expect(Boolean(url.searchParams.get('X-Amz-Signature'))).toBe(true);
      expect(Number(url.searchParams.get('X-Amz-Expires'))).toBeLessThanOrEqual(
        900,
      );
      expect(Date.parse(part.expiresAt)).toBeGreaterThan(started);
      expect(Date.parse(part.expiresAt)).toBeLessThanOrEqual(started + 900_000);
      expect(Date.parse(part.expiresAt)).toBeLessThanOrEqual(
        row.upload_expires_at.getTime(),
      );
    }
    const last = body.parts[1];
    const upload = await fetch(last.url, {
      method: 'PUT',
      headers: last.headers,
      body: media,
    });
    await upload.arrayBuffer();
    expect(upload.status).toBe(200);
    const etag = upload.headers.get('etag');
    expect(etag).not.toBeNull();
    expect(
      await fixture.storage.storage.listParts(row.source_key, row.upload_id!),
    ).toEqual([{ partNumber: 2, size: media.length, etag }]);
    await assertUnchanged(row);
  });

  it.each([
    ['duplicates', { partNumbers: [1, 1] }],
    ['empty batch', { partNumbers: [] }],
    [
      'batch above fifty',
      { partNumbers: Array.from({ length: 51 }, (_, index) => index + 1) },
    ],
    ['outside actual partCount', { partNumbers: [3] }],
    ['zero', { partNumbers: [0] }],
    ['fraction', { partNumbers: [1.5] }],
    ['numeric string', { partNumbers: ['1'] }],
    ['missing array', {}],
    ['forged storage field', { partNumbers: [1], upload_id: 'untrusted' }],
  ])(
    '1.2 should reject %s without granting permissions or changing the session',
    async (_name, body) => {
      const row = await initialize();
      const response = await sign(row.id, body).expect(400);
      expect(response.body as ErrorBody).toMatchObject({
        statusCode: 400,
        error: 'VALIDATION_ERROR',
      });
      expect(response.body).not.toHaveProperty('parts');
      expect(
        await fixture.storage.storage.listParts(row.source_key, row.upload_id!),
      ).toEqual([]);
      await assertUnchanged(row);
    },
  );

  it('1.3 should hide foreign video permissions before invoking the signer', async () => {
    const row = await initialize();
    const signer = jest.spyOn(
      fixture.module.get<StorageSigningPort>(STORAGE_SIGNING),
      'signUploadPart',
    );
    const response = await sign(
      row.id,
      { partNumbers: [1] },
      other.token,
    ).expect(404);
    expect(response.body as ErrorBody).toMatchObject({
      statusCode: 404,
      error: 'VIDEO_NOT_FOUND',
    });
    expect(response.body).not.toHaveProperty('parts');
    expect(response.text).not.toContain(row.upload_id);
    expect(signer).not.toHaveBeenCalled();
    await assertUnchanged(row);
  });

  it('1.4 should require missing and invalid JWTs to be rejected by the inherited guard', async () => {
    const row = await initialize();
    const absent = await request(fixture.app.getHttpServer())
      .post(`/videos/${row.id}/upload/parts`)
      .send({ partNumbers: [1] })
      .expect(401);
    const invalid = await sign(
      row.id,
      { partNumbers: [1] },
      'invalid.jwt',
    ).expect(401);
    for (const response of [absent, invalid])
      expect(response.body as ErrorBody).toEqual({
        statusCode: 401,
        message: 'Unauthorized',
      });
    await assertUnchanged(row);
  });

  it.each(['completing', 'aborting'] as const)(
    '1.5 should reject a live %s claim without signing a URL',
    async (operation) => {
      const row = await initialize();
      const claim = await fixture.module
        .get(VideosRepository)
        .claimUpload(row.id, row.channel_id, operation, 120_000);
      expect(claim).not.toBeNull();
      const before = await stored(row.id);
      const signer = jest.spyOn(
        fixture.module.get<StorageSigningPort>(STORAGE_SIGNING),
        'signUploadPart',
      );
      const response = await sign(row.id).expect(409);
      expect(response.body as ErrorBody).toMatchObject({
        error: 'UPLOAD_OPERATION_IN_PROGRESS',
      });
      expect(response.body).not.toHaveProperty('parts');
      expect(signer).not.toHaveBeenCalled();
      await assertUnchanged(before);
    },
  );

  it('1.6 should validate UUID through the inherited validation envelope', async () => {
    const response = await sign('identificador-invalido', {
      partNumbers: [1],
    }).expect(400);
    expect(response.body as ErrorBody).toMatchObject({
      statusCode: 400,
      error: 'VALIDATION_ERROR',
      message: expect.any(Array),
    });
  });

  it('1.6 should reject expired draft without renewing any permission or session', async () => {
    const row = await initialize();
    await fixture.source
      .getRepository(Video)
      .update(row.id, { upload_expires_at: new Date(Date.now() - 1000) });
    const before = await stored(row.id);
    const response = await sign(row.id).expect(410);
    expect(response.body as ErrorBody).toMatchObject({
      statusCode: 410,
      error: 'UPLOAD_EXPIRED',
    });
    expect(response.body).not.toHaveProperty('parts');
    await assertUnchanged(before);
  });

  it('should cap signature lifetime by the remaining absolute session duration', async () => {
    const row = await initialize();
    const deadline = new Date(Date.now() + 120_000);
    await fixture.source
      .getRepository(Video)
      .update(row.id, { upload_expires_at: deadline });
    const response = await sign(row.id).expect(200);
    for (const part of (response.body as PermissionBody).parts) {
      expect(Date.parse(part.expiresAt)).toBeLessThanOrEqual(
        deadline.getTime(),
      );
      expect(
        Number(new URL(part.url).searchParams.get('X-Amz-Expires')),
      ).toBeLessThanOrEqual(120);
    }
  });

  it('should accept fifty valid distinct permissions and reject fifty-one even with enough parts', async () => {
    const row = await initialize(50 * partSize + 1);
    const parts = Array.from({ length: 51 }, (_, index) => index + 1);
    const accepted = await sign(row.id, {
      partNumbers: parts.slice(0, 50),
    }).expect(200);
    expect(
      (accepted.body as PermissionBody).parts.map((part) => part.partNumber),
    ).toEqual(parts.slice(0, 50));
    const rejected = await sign(row.id, { partNumbers: parts }).expect(400);
    expect(rejected.body as ErrorBody).toMatchObject({
      error: 'VALIDATION_ERROR',
      message: expect.any(Array),
    });
    await assertUnchanged(row);
  });

  it('should reject a direct PUT whose actual byte length differs from the signed requirement', async () => {
    const row = await initialize();
    const permission = (await sign(row.id, { partNumbers: [2] }).expect(200))
      .body as PermissionBody;
    const part = permission.parts[0];
    const wrong = Buffer.concat([media, Buffer.from('x')]);
    const response = await fetch(part.url, {
      method: 'PUT',
      headers: { 'Content-Length': String(wrong.length) },
      body: wrong,
    });
    await response.arrayBuffer();
    expect(response.status).toBe(403);
    expect(
      await fixture.storage.storage.listParts(row.source_key, row.upload_id!),
    ).toEqual([]);
    await assertUnchanged(row);
  });

  it('should hide absent videos and users without a channel', async () => {
    const row = await initialize();
    const noChannel = await fixture.owner(false);
    for (const [id, token] of [
      [randomUUID(), owner.token],
      [row.id, noChannel.token],
    ]) {
      const response = await sign(id, { partNumbers: [1] }, token).expect(404);
      expect(response.body as ErrorBody).toMatchObject({
        error: 'VIDEO_NOT_FOUND',
      });
    }
    await assertUnchanged(row);
  });

  it('should reject processing and aborted sessions instead of granting fresh permissions', async () => {
    const row = await initialize(media.length);
    const body = (await sign(row.id, { partNumbers: [1] }).expect(200))
      .body as PermissionBody;
    const upload = await fetch(body.parts[0].url, {
      method: 'PUT',
      headers: body.parts[0].headers,
      body: media,
    });
    await upload.arrayBuffer();
    expect(upload.status).toBe(200);
    const completion = fixture.module.get(VideoUploadCompletionService);
    await completion.complete(owner.user.id, row.id);
    const processing = await sign(row.id, { partNumbers: [1] }).expect(409);
    expect(processing.body as ErrorBody).toMatchObject({
      error: 'INVALID_VIDEO_STATE',
    });
    const aborted = await initialize();
    await completion.abort(owner.user.id, aborted.id);
    const terminal = await sign(aborted.id).expect(409);
    expect(terminal.body as ErrorBody).toMatchObject({
      error: 'INVALID_VIDEO_STATE',
    });
    expect(
      await fixture.source.getRepository(VideoProcessingOutbox).count(),
    ).toBe(1);
  });

  it('should return sanitized storage failure without exposing partial permissions', async () => {
    const row = await initialize();
    jest
      .spyOn(fixture.module.get<StoragePort>(STORAGE), 'listParts')
      .mockRejectedValueOnce(new StorageError('unavailable'));
    const response = await sign(row.id).expect(503);
    expect(response.body as ErrorBody).toMatchObject({
      statusCode: 503,
      error: 'STORAGE_UNAVAILABLE',
    });
    expect(response.body).not.toHaveProperty('parts');
    await assertUnchanged(row);
  });

  it('should enforce 120 signing requests per minute with the real throttler', async () => {
    const row = await initialize();
    for (let index = 0; index < 120; index++)
      await sign(row.id, { partNumbers: [2] }).expect(200);
    const response = await sign(row.id, { partNumbers: [2] }).expect(429);
    expect(response.body as ErrorBody).toEqual({
      statusCode: 429,
      message: 'ThrottlerException: Too Many Requests',
    });
    await assertUnchanged(row);
  }, 30000);

  it('should document the protected JSON operation, UUID and shared error envelopes', () => {
    const operation = buildSwaggerDocument(fixture.app).paths[
      '/videos/{id}/upload/parts'
    ].post!;
    expect(operation.security).toEqual([{ 'access-token': [] }]);
    expect(operation.parameters).toContainEqual(
      expect.objectContaining({
        name: 'id',
        in: 'path',
        required: true,
        schema: { type: 'string', format: 'uuid' },
      }),
    );
    expect(operation.responses['200']).toMatchObject({
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/VideoUploadPermissionsDto' },
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
