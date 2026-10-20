import { jest } from '@jest/globals';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  S3Client,
  S3ServiceException,
  ListPartsCommand,
  CompleteMultipartUploadCommand,
} from '@aws-sdk/client-s3';
import storageConfig from '../config/storage.config';
import { S3StorageService } from './s3-storage.service';
import { S3_CLIENT, S3_STORAGE_OPTIONS } from './storage.constants';
import { StorageError } from './storage.error';

type PromiseSend = (
  command: Parameters<S3Client['send']>[0],
  options?: { abortSignal?: AbortSignal },
) => Promise<unknown>;

const spyOnSend = (client: S3Client) => {
  const promiseClient: { send: PromiseSend } = client;
  return jest.spyOn(promiseClient, 'send');
};

describe('S3StorageService', () => {
  let module: TestingModule;
  let service: S3StorageService;
  let client: S3Client;
  let send: ReturnType<typeof spyOnSend>;
  const config = { bucket: 'unit-test-bucket' };

  function sdkError(name: string, status: number): S3ServiceException {
    return new S3ServiceException({
      name,
      $fault: status >= 500 ? 'server' : 'client',
      $metadata: { httpStatusCode: status },
      message: 'Do not expose access-key secret-key private-host',
    });
  }

  beforeEach(async () => {
    client = new S3Client({
      region: 'us-east-1',
      credentials: {
        accessKeyId: 'unit-only',
        secretAccessKey: 'unit-only-secret',
      },
    });
    send = spyOnSend(client);
    module = await Test.createTestingModule({
      providers: [
        S3StorageService,
        { provide: S3_CLIENT, useValue: client },
        { provide: storageConfig.KEY, useValue: config },
        {
          provide: S3_STORAGE_OPTIONS,
          useValue: { operationTimeoutMs: 1000, listPartsPageSize: 1 },
        },
      ],
    }).compile();
    service = module.get(S3StorageService);
  });
  afterEach(async () => {
    await module?.close();
    jest.restoreAllMocks();
  });

  it('should create a multipart session with only the configured bucket and supplied key/type', async () => {
    send.mockResolvedValueOnce({ UploadId: 'session' });
    expect(
      await service.createMultipartUpload('videos/id/source', 'video/mp4'),
    ).toBe('session');
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        input: {
          Bucket: config.bucket,
          Key: 'videos/id/source',
          ContentType: 'video/mp4',
        },
      }),
      expect.objectContaining({
        abortSignal: expect.any(AbortSignal) as unknown,
      }),
    );
  });

  it('should follow storage pagination markers and preserve authoritative part sizes and etags', async () => {
    send
      .mockImplementationOnce(() =>
        Promise.resolve({
          IsTruncated: true,
          NextPartNumberMarker: '1',
          Parts: [{ PartNumber: 1, ETag: '"one"', Size: 5242880 }],
        }),
      )
      .mockImplementationOnce(() =>
        Promise.resolve({
          IsTruncated: false,
          Parts: [{ PartNumber: 2, ETag: '"two"', Size: 3 }],
        }),
      );
    expect(await service.listParts('key', 'upload')).toEqual([
      { partNumber: 1, etag: '"one"', size: 5242880 },
      { partNumber: 2, etag: '"two"', size: 3 },
    ]);
    expect(send.mock.calls[1][0]).toBeInstanceOf(ListPartsCommand);
    expect(send.mock.calls[1][0]).toMatchObject({
      input: { PartNumberMarker: '1', MaxParts: 1, UploadId: 'upload' },
    });
  });

  it.each([
    { IsTruncated: true },
    { IsTruncated: true, NextPartNumberMarker: 'not-a-marker' },
    { IsTruncated: true, NextPartNumberMarker: '0' },
    { IsTruncated: false, Parts: [{ PartNumber: 1, Size: 1 }] },
    { IsTruncated: false, Parts: [{ PartNumber: 1, ETag: 'etag' }] },
    { IsTruncated: false, Parts: [{ PartNumber: 1, Size: -1, ETag: 'etag' }] },
    {
      IsTruncated: false,
      Parts: [
        { PartNumber: 2, Size: 1, ETag: 'two' },
        { PartNumber: 1, Size: 1, ETag: 'one' },
      ],
    },
  ])(
    'should reject malformed or nonadvancing storage pagination (%j)',
    async (response) => {
      send.mockResolvedValueOnce(response);
      await expect(service.listParts('key', 'upload')).rejects.toMatchObject({
        kind: 'invalid_response',
      });
    },
  );

  it('should allow a newly created session with no parts', async () => {
    send.mockResolvedValueOnce({ IsTruncated: false });
    expect(await service.listParts('key', 'upload')).toEqual([]);
  });

  it('should complete using exact etags and return a subsequent authoritative head', async () => {
    send
      .mockResolvedValueOnce({ ETag: 'complete-etag' })
      .mockImplementationOnce(() =>
        Promise.resolve({
          ETag: 'head-etag',
          ContentLength: 42,
          ContentType: 'video/mp4',
        }),
      );
    expect(
      await service.completeMultipartUpload('key', 'upload', [
        { partNumber: 1, etag: 'exact-etag' },
      ]),
    ).toEqual({
      contentLength: 42,
      etag: 'head-etag',
      contentType: 'video/mp4',
    });
    expect(send.mock.calls[0][0]).toBeInstanceOf(
      CompleteMultipartUploadCommand,
    );
    expect(send.mock.calls[0][0]).toMatchObject({
      input: {
        MultipartUpload: { Parts: [{ PartNumber: 1, ETag: 'exact-etag' }] },
      },
    });
  });

  it('should reject unordered completion without sending a request', async () => {
    await expect(
      service.completeMultipartUpload('key', 'upload', [
        { partNumber: 2, etag: 'two' },
        { partNumber: 1, etag: 'one' },
      ]),
    ).rejects.toMatchObject({ kind: 'invalid_multipart' });
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    ['NoSuchUpload', 404, 'upload_not_found'],
    ['InvalidPart', 400, 'invalid_multipart'],
    ['InvalidPartOrder', 400, 'invalid_multipart'],
    ['AccessDenied', 403, 'operation_failed'],
    ['NoSuchBucket', 404, 'operation_failed'],
    ['ServiceUnavailable', 503, 'unavailable'],
  ])(
    'should translate %s without leaking SDK diagnostics',
    async (name, status, kind) => {
      send.mockImplementationOnce(() => {
        throw sdkError(String(name), Number(status));
      });
      try {
        await service.listParts('key', 'upload');
        throw new Error('Expected failure');
      } catch (error) {
        expect(error).toBeInstanceOf(StorageError);
        expect(error).toMatchObject({ kind });
        if (error instanceof Error)
          expect(error.message).not.toMatch(/secret|access-key|private-host/);
      }
    },
  );

  it('should distinguish missing object from denied access and missing session', async () => {
    send.mockImplementationOnce(() => {
      throw sdkError('NotFound', 404);
    });
    await expect(service.headObject('key')).rejects.toMatchObject({
      kind: 'object_not_found',
    });
    send.mockImplementationOnce(() => {
      throw sdkError('AccessDenied', 403);
    });
    await expect(service.headObject('key')).rejects.toMatchObject({
      kind: 'operation_failed',
    });
  });

  it('should reject missing create/head output instead of inventing a session or size', async () => {
    send.mockImplementationOnce(() => Promise.resolve({}));
    await expect(
      service.createMultipartUpload('key', 'video/mp4'),
    ).rejects.toMatchObject({ kind: 'invalid_response' });
    send.mockResolvedValueOnce({ ETag: 'etag' });
    await expect(service.headObject('key')).rejects.toMatchObject({
      kind: 'invalid_response',
    });
  });

  it.each([
    Object.assign(new Error('private endpoint'), { code: 'ECONNREFUSED' }),
    { name: 'Error', code: 'ECONNREFUSED' },
    new Error('AWS SDK error wrapper for Error: connect ECONNREFUSED minio:1'),
  ])(
    'should translate native and foreign-realm transport errors (%j)',
    async (failure) => {
      send.mockRejectedValueOnce(failure);
      await expect(
        service.abortMultipartUpload('key', 'upload'),
      ).rejects.toMatchObject({ kind: 'unavailable' });
    },
  );

  it('should propagate an unknown SDK wrapper as an operation failure', async () => {
    send.mockRejectedValueOnce(
      new Error('AWS SDK error wrapper for Error: unexpected failure'),
    );
    await expect(service.headObject('key')).rejects.toMatchObject({
      kind: 'operation_failed',
    });
  });

  it('should abort a pending SDK request at the operation deadline', async () => {
    module.get<{ operationTimeoutMs: number }>(
      S3_STORAGE_OPTIONS,
    ).operationTimeoutMs = 10;
    send.mockImplementationOnce(() => {
      const options = send.mock.calls[0][1];
      if (
        !options ||
        typeof options === 'function' ||
        !('abortSignal' in options) ||
        !(options.abortSignal instanceof AbortSignal)
      )
        throw new Error('Missing abort signal');
      const signal = options.abortSignal;
      return new Promise<never>((_resolve, reject) => {
        signal.addEventListener(
          'abort',
          () =>
            reject(
              Object.assign(new Error('Request aborted'), {
                name: 'AbortError',
              }),
            ),
          { once: true },
        );
      });
    });
    await expect(service.listParts('key', 'upload')).rejects.toMatchObject({
      kind: 'unavailable',
    });
  });

  it('should destroy its client when the module closes', async () => {
    const destroy = jest.spyOn(client, 'destroy');
    await module.close();
    expect(destroy).toHaveBeenCalledTimes(1);
    destroy.mockRestore();
  });
});
