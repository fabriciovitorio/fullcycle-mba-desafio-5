import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import {
  GetObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import storageConfig from '../config/storage.config';
import videosConfig from '../config/videos.config';
import { VIDEO_LIMITS } from '../videos/videos.constants';
import { S3_SIGNING_CLIENT, STORAGE_LIMITS } from './storage.constants';
import { StorageError } from './storage.error';
import { withStorageOperation } from './storage-operation';
import type {
  GetObjectSigningRequest,
  SignedStorageUrl,
  SignedUploadPart,
  StorageSigningPort,
  UploadPartSigningRequest,
} from './storage-signing.port';

@Injectable()
export class StorageSigningService
  implements StorageSigningPort, OnModuleDestroy
{
  constructor(
    @Inject(S3_SIGNING_CLIENT) private readonly client: S3Client,
    @Inject(storageConfig.KEY)
    private readonly config: ConfigType<typeof storageConfig>,
    @Inject(videosConfig.KEY)
    private readonly videos: ConfigType<typeof videosConfig>,
  ) {}

  onModuleDestroy(): void {
    this.client.destroy();
  }

  async signUploadPart(
    request: UploadPartSigningRequest,
  ): Promise<SignedUploadPart> {
    if (
      !request.key ||
      !request.uploadId ||
      !Number.isInteger(request.partNumber) ||
      request.partNumber < 1 ||
      request.partNumber > STORAGE_LIMITS.MAX_MULTIPART_PARTS ||
      !Number.isSafeInteger(request.sizeBytes) ||
      request.sizeBytes < 1 ||
      request.sizeBytes > VIDEO_LIMITS.PART_SIZE_BYTES
    )
      throw new StorageError('invalid_request');
    const { signingDate, expiresIn, expiresAt } = this.expiration(
      request.sessionExpiresAt,
    );
    const url = await withStorageOperation(
      () =>
        getSignedUrl(
          this.client,
          new UploadPartCommand({
            Bucket: this.config.bucket,
            Key: request.key,
            UploadId: request.uploadId,
            PartNumber: request.partNumber,
            ContentLength: request.sizeBytes,
          }),
          {
            signingDate,
            expiresIn,
            signableHeaders: new Set(['content-length']),
          },
        ),
      STORAGE_LIMITS.OPERATION_TIMEOUT_MS,
    );
    return {
      url,
      expiresAt,
      headers: { 'Content-Length': String(request.sizeBytes) },
    };
  }

  async signGetObject(
    request: GetObjectSigningRequest,
  ): Promise<SignedStorageUrl> {
    if (
      !request.key ||
      !['inline', 'attachment'].includes(request.disposition) ||
      !['video/mp4', 'image/jpeg'].includes(request.contentType)
    )
      throw new StorageError('invalid_request');
    const { signingDate, expiresIn, expiresAt } = this.expiration();
    const url = await withStorageOperation(
      () =>
        getSignedUrl(
          this.client,
          new GetObjectCommand({
            Bucket: this.config.bucket,
            Key: request.key,
            ResponseContentType: request.contentType,
            ResponseContentDisposition: this.disposition(request),
          }),
          { signingDate, expiresIn },
        ),
      STORAGE_LIMITS.OPERATION_TIMEOUT_MS,
    );
    return { url, expiresAt };
  }

  private expiration(sessionExpiresAt?: Date) {
    const now = Date.now();
    const signingDate = new Date(Math.floor(now / 1000) * 1000);
    const sessionSeconds =
      sessionExpiresAt === undefined
        ? Infinity
        : Math.floor((sessionExpiresAt.getTime() - now) / 1000);
    const expiresIn = Math.min(
      this.videos.signedUrlTtlSeconds,
      VIDEO_LIMITS.MAX_SIGNED_URL_TTL_SECONDS,
      sessionSeconds,
    );
    if (!Number.isSafeInteger(expiresIn) || expiresIn < 1)
      throw new StorageError('invalid_request');
    return {
      signingDate,
      expiresIn,
      expiresAt: new Date(signingDate.getTime() + expiresIn * 1000),
    };
  }

  private disposition(request: GetObjectSigningRequest): string {
    if (request.disposition === 'inline' && !request.fileName) return 'inline';
    const base =
      (request.fileName ?? 'video.mp4')
        .replaceAll('\\', '/')
        .split('/')
        .pop() ?? '';
    const safe =
      Array.from(base, (char) => {
        const code = char.codePointAt(0) ?? 0;
        return code < 32 || code === 127 || char === '"' || char === '\\'
          ? '_'
          : char;
      })
        .slice(0, 255)
        .join('') || 'video.mp4';
    const ascii = safe.replace(/[^\x20-\x7e]/g, '_');
    const encoded = encodeURIComponent(safe).replace(
      /[!'()*]/g,
      (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
    );
    return `${request.disposition}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
  }
}
