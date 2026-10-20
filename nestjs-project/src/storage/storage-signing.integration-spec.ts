import { PutObjectCommand } from '@aws-sdk/client-s3';
import {
  createStorageFixture,
  type StorageFixture,
} from '../test/storage.fixture';

describe('Storage signing (integration)', () => {
  let fixture: StorageFixture;
  beforeEach(async () => {
    fixture = await createStorageFixture();
  });
  afterEach(async () => {
    await fixture?.cleanup();
  });

  it('should sign exact part length and reject a divergent real PUT before completion', async () => {
    const key = fixture.key();
    const uploadId = await fixture.storage.createMultipartUpload(
      key,
      'video/mp4',
    );
    const data = Buffer.from('actual signed part bytes');
    const deadline = new Date(Date.now() + 60000);
    const signed = await fixture.signing.signUploadPart({
      key,
      uploadId,
      partNumber: 1,
      sizeBytes: data.length,
      sessionExpiresAt: deadline,
    });
    const url = new URL(signed.url);
    expect(url.origin).toBe(fixture.config.publicEndpoint);
    expect(url.searchParams.get('X-Amz-SignedHeaders')?.split(';')).toContain(
      'content-length',
    );
    expect(Number(url.searchParams.get('X-Amz-Expires'))).toBeLessThanOrEqual(
      60,
    );
    expect(signed.expiresAt.getTime()).toBeLessThanOrEqual(deadline.getTime());
    const response = await fetch(signed.url, {
      method: 'PUT',
      headers: signed.headers,
      body: data,
    });
    expect(response.status).toBe(200);
    await response.arrayBuffer();
    expect(await fixture.storage.listParts(key, uploadId)).toEqual([
      { partNumber: 1, size: data.length, etag: response.headers.get('etag') },
    ]);
    const wrong = Buffer.from('wrong');
    const rejected = await fetch(signed.url, {
      method: 'PUT',
      headers: { 'Content-Length': String(wrong.length) },
      body: wrong,
    });
    expect(rejected.status).toBe(403);
    await rejected.arrayBuffer();
    const parts = await fixture.storage.listParts(key, uploadId);
    expect(parts[0].size).toBe(data.length);
    await fixture.storage.completeMultipartUpload(key, uploadId, parts);
    const ended = await fetch(signed.url, {
      method: 'PUT',
      headers: signed.headers,
      body: data,
    });
    expect(ended.status).toBe(404);
    await ended.arrayBuffer();
  });

  it('should cap TTL at 900 seconds and refuse expired sessions or invalid part requests', async () => {
    const request = {
      key: fixture.key(),
      uploadId: 'not-contacted-by-signing',
      partNumber: 1,
      sizeBytes: 1,
      sessionExpiresAt: new Date(Date.now() + 86400000),
    };
    const signed = await fixture.signing.signUploadPart(request);
    expect(Number(new URL(signed.url).searchParams.get('X-Amz-Expires'))).toBe(
      900,
    );
    for (const invalid of [
      { sessionExpiresAt: new Date(Date.now() - 1) },
      { sessionExpiresAt: new Date(NaN) },
      { partNumber: 0 },
      { partNumber: 10001 },
      { sizeBytes: 0 },
      { sizeBytes: 67108865 },
    ])
      await expect(
        fixture.signing.signUploadPart({ ...request, ...invalid }),
      ).rejects.toMatchObject({ kind: 'invalid_request' });
  });

  it('should enforce real URL expiry at the storage destination', async () => {
    await fixture.cleanup();
    fixture = await createStorageFixture({ signedUrlTtlSeconds: 1 });
    const key = fixture.key();
    const uploadId = await fixture.storage.createMultipartUpload(
      key,
      'video/mp4',
    );
    const signed = await fixture.signing.signUploadPart({
      key,
      uploadId,
      partNumber: 1,
      sizeBytes: 1,
      sessionExpiresAt: new Date(Date.now() + 60000),
    });
    const waitMs = Math.max(0, signed.expiresAt.getTime() - Date.now()) + 1100;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    const expired = await fetch(signed.url, {
      method: 'PUT',
      headers: signed.headers,
      body: Buffer.from('a'),
    });
    expect(expired.status).toBe(403);
    await expired.arrayBuffer();
    expect(await fixture.storage.listParts(key, uploadId)).toEqual([]);
  });

  it('should serve full, ordinary and suffix ranges with inline disposition and reject invalid ranges', async () => {
    const key = fixture.key();
    const bytes = Buffer.from('0123456789');
    await fixture.client.send(
      new PutObjectCommand({
        Bucket: fixture.config.bucket,
        Key: key,
        Body: bytes,
        ContentType: 'video/mp4',
      }),
    );
    const signed = await fixture.signing.signGetObject({
      key,
      contentType: 'video/mp4',
      disposition: 'inline',
    });
    expect(
      new URL(signed.url).searchParams.get('X-Amz-SignedHeaders')?.split(';'),
    ).not.toContain('range');
    const full = await fetch(signed.url);
    expect(full.status).toBe(200);
    expect(full.headers.get('content-disposition')).toBe('inline');
    expect(full.headers.get('content-type')).toBe('video/mp4');
    expect(Buffer.from(await full.arrayBuffer())).toEqual(bytes);
    for (const [range, contentRange, expected] of [
      ['bytes=2-5', 'bytes 2-5/10', '2345'],
      ['bytes=-3', 'bytes 7-9/10', '789'],
    ]) {
      const partial = await fetch(signed.url, { headers: { Range: range } });
      expect(partial.status).toBe(206);
      expect(partial.headers.get('content-range')).toBe(contentRange);
      expect(await partial.text()).toBe(expected);
    }
    const invalid = await fetch(signed.url, {
      headers: { Range: 'bytes=100-200' },
    });
    expect(invalid.status).toBe(416);
    await invalid.arrayBuffer();
  });

  it('should preserve a safe unicode attachment basename and sign inline JPEG independently', async () => {
    const key = fixture.key();
    await fixture.client.send(
      new PutObjectCommand({
        Bucket: fixture.config.bucket,
        Key: key,
        Body: 'original-bytes',
      }),
    );
    const signed = await fixture.signing.signGetObject({
      key,
      contentType: 'video/mp4',
      disposition: 'attachment',
      fileName: '../pasta/ação\r\n".mp4',
    });
    const response = await fetch(signed.url);
    const disposition = response.headers.get('content-disposition') ?? '';
    expect(disposition).toMatch(/^attachment; filename="/);
    expect(disposition).toContain("filename*=UTF-8''a%C3%A7%C3%A3o___.mp4");
    expect(disposition).not.toMatch(/[\r\n]|pasta|\.\.\//);
    expect(await response.text()).toBe('original-bytes');
    const thumbnail = await fixture.signing.signGetObject({
      key,
      contentType: 'image/jpeg',
      disposition: 'inline',
    });
    const image = await fetch(thumbnail.url);
    expect(image.headers.get('content-type')).toBe('image/jpeg');
    expect(image.headers.get('content-disposition')).toBe('inline');
    await image.arrayBuffer();
    const unsigned = await fetch(
      `${fixture.config.endpoint}/${fixture.config.bucket}/${key}`,
    );
    expect(unsigned.status).toBe(403);
    await unsigned.arrayBuffer();
  });
});
