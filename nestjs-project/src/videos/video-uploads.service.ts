import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { ChannelsService } from '../channels/channels.service';
import videosConfig from '../config/videos.config';
import { STORAGE, type StoragePort } from '../storage/storage.port';
import {
  STORAGE_SIGNING,
  type StorageSigningPort,
} from '../storage/storage-signing.port';
import { StorageError } from '../storage/storage.error';
import { videoStatus } from './video-status.mapper';
import type { Video } from './entities/video.entity';
import { VideosRepository, type UploadClaim } from './videos.repository';
import { VIDEO_LIMITS, VIDEO_UPLOAD } from './videos.constants';
import {
  ChannelNotFoundException,
  InvalidVideoStateException,
  StorageUnavailableException,
  UploadExpiredException,
  UploadOperationInProgressException,
  VideoNotFoundException,
  VideoUploadValidationException,
} from './videos.exceptions';
import type {
  CreateVideoUpload,
  VideoUploadInitialization,
  VideoUploadPermissions,
  VideoUploadResume,
  VideoUploadSession,
  VideoUploadStatus,
} from './video-uploads.types';

function isNumberArray(value: unknown): value is readonly number[] {
  return (
    Array.isArray(value) &&
    value.every((part: unknown) => typeof part === 'number')
  );
}

@Injectable()
export class VideoUploadsService {
  constructor(
    private readonly channels: ChannelsService,
    private readonly videos: VideosRepository,
    @Inject(STORAGE) private readonly storage: StoragePort,
    @Inject(STORAGE_SIGNING) private readonly signing: StorageSigningPort,
    @Inject(videosConfig.KEY)
    private readonly config: ConfigType<typeof videosConfig>,
  ) {}

  async initialize(
    userId: string,
    input: CreateVideoUpload,
  ): Promise<VideoUploadInitialization> {
    this.validateInput(input);
    const channel = await this.channels.findByUserId(userId);
    if (!channel) throw new ChannelNotFoundException();
    const expiresAt = new Date(
      Date.now() + this.config.uploadTtlSeconds * 1000,
    );
    const draft = await this.videos.createDraft({
      channelId: channel.id,
      title: input.title.trim(),
      originalFileName: input.fileName,
      declaredContentType: input.contentType,
      declaredSizeBytes: String(input.sizeBytes),
      uploadExpiresAt: expiresAt,
    });
    const claim = await this.videos.claimUpload(
      draft.id,
      channel.id,
      'initializing',
      VIDEO_UPLOAD.OPERATION_LEASE_MS,
    );
    if (!claim || claim.requiresReconciliation)
      throw new UploadOperationInProgressException();
    let uploadId: string | undefined;
    try {
      uploadId = await this.storage.createMultipartUpload(
        draft.source_key,
        input.contentType,
      );
      if (
        !(await this.videos.rememberUploadSession(
          draft.id,
          channel.id,
          claim.token,
          uploadId,
          expiresAt,
        ))
      )
        throw new UploadOperationInProgressException();
      if (
        !(await this.videos.attachUploadSession(
          draft.id,
          channel.id,
          claim.token,
          uploadId,
          expiresAt,
        ))
      )
        throw new UploadOperationInProgressException();
      const current = await this.videos.findUploadForOwner(
        draft.id,
        channel.id,
      );
      if (
        !current ||
        current.status !== 'draft' ||
        current.upload_operation ||
        current.upload_id !== uploadId
      )
        throw new UploadOperationInProgressException();
      await this.assertSession(current);
      return this.initialization(current);
    } catch (error: unknown) {
      // A create timeout without an ID remains initializing: the remote session may exist.
      if (uploadId) {
        const recovered = await this.compensateInitialization(claim, uploadId);
        if (recovered) {
          await this.assertSession(recovered);
          return this.initialization(recovered);
        }
      }
      if (error instanceof StorageError)
        throw new StorageUnavailableException();
      throw error;
    }
  }

  async resume(userId: string, id: string): Promise<VideoUploadResume> {
    const video = await this.ownedSession(userId, id);
    const parts = await this.readParts(video);
    const current = await this.assertCurrentSession(video);
    return {
      video: this.status(current),
      upload: {
        ...this.session(current),
        parts: parts.map((part) => ({
          partNumber: part.partNumber,
          sizeBytes: part.size,
          etag: part.etag,
        })),
      },
    };
  }

  async signParts(
    userId: string,
    id: string,
    partNumbers: readonly number[],
  ): Promise<VideoUploadPermissions> {
    const video = await this.ownedSession(userId, id);
    const { partCount } = this.session(video);
    if (
      !isNumberArray(partNumbers) ||
      partNumbers.length < 1 ||
      partNumbers.length > VIDEO_LIMITS.MAX_PARTS_PER_REQUEST ||
      new Set(partNumbers).size !== partNumbers.length ||
      partNumbers.some(
        (part) => !Number.isInteger(part) || part < 1 || part > partCount,
      )
    )
      throw new VideoUploadValidationException();
    await this.readParts(video);
    await this.assertCurrentSession(video);
    const parts: VideoUploadPermissions['parts'] = [];
    for (const partNumber of partNumbers) {
      const sizeBytes = Math.min(
        VIDEO_LIMITS.PART_SIZE_BYTES,
        Number(video.declared_size_bytes) -
          (partNumber - 1) * VIDEO_LIMITS.PART_SIZE_BYTES,
      );
      try {
        const signed = await this.signing.signUploadPart({
          key: video.source_key,
          uploadId: this.uploadId(video),
          partNumber,
          sizeBytes,
          sessionExpiresAt: video.upload_expires_at,
        });
        parts.push({ partNumber, ...signed });
      } catch (error: unknown) {
        if (error instanceof StorageError) {
          if (video.upload_expires_at.getTime() <= Date.now())
            throw new UploadExpiredException();
          throw new StorageUnavailableException();
        }
        throw error;
      }
    }
    await this.assertCurrentSession(video);
    return { parts };
  }

  private async ownedSession(userId: string, id: string): Promise<Video> {
    const channel = await this.channels.findByUserId(userId);
    if (!channel) throw new VideoNotFoundException();
    const video = await this.videos.findUploadForOwner(id, channel.id);
    if (!video) throw new VideoNotFoundException();
    await this.assertSession(video);
    return video;
  }

  private async assertSession(video: Video): Promise<void> {
    if (video.status !== 'draft') throw new InvalidVideoStateException();
    // Even an expired operation must be reconciled before a new permission is granted.
    if (video.upload_operation || !video.upload_id)
      throw new UploadOperationInProgressException();
    if (video.upload_expires_at.getTime() <= Date.now()) {
      if (await this.hasSourceObject(video))
        throw new UploadOperationInProgressException();
      throw new UploadExpiredException();
    }
  }

  private async assertCurrentSession(previous: Video): Promise<Video> {
    const current = await this.videos.findUploadForOwner(
      previous.id,
      previous.channel_id,
    );
    if (!current) throw new VideoNotFoundException();
    await this.assertSession(current);
    if (current.upload_id !== previous.upload_id)
      throw new UploadOperationInProgressException();
    return current;
  }

  private async readParts(video: Video) {
    try {
      return await this.storage.listParts(
        video.source_key,
        this.uploadId(video),
      );
    } catch (error: unknown) {
      if (error instanceof StorageError) {
        if (
          error.kind === 'upload_not_found' &&
          (await this.hasSourceObject(video))
        )
          throw new UploadOperationInProgressException();
        throw new StorageUnavailableException();
      }
      throw error;
    }
  }

  private async hasSourceObject(video: Video): Promise<boolean> {
    try {
      await this.storage.headObject(video.source_key);
      return true;
    } catch (error: unknown) {
      if (error instanceof StorageError) {
        if (error.kind === 'object_not_found') return false;
        throw new StorageUnavailableException();
      }
      throw error;
    }
  }

  private async compensateInitialization(
    claim: UploadClaim,
    uploadId: string,
  ): Promise<Video | null> {
    const video = await this.videos.findUploadForOwner(
      claim.video.id,
      claim.video.channel_id,
    );
    if (
      video?.status === 'draft' &&
      !video.upload_operation &&
      video.upload_id === uploadId
    )
      return video; // Attach committed although its response failed; never abort a usable session.
    if (
      !video ||
      video.status !== 'draft' ||
      video.upload_operation !== 'initializing' ||
      video.operation_token !== claim.token ||
      !video.operation_expires_at ||
      video.operation_expires_at.getTime() - Date.now() <
        VIDEO_UPLOAD.COMPENSATION_WINDOW_MS ||
      (video.upload_id !== null && video.upload_id !== uploadId)
    )
      return null;
    try {
      await this.storage.abortMultipartUpload(video.source_key, uploadId);
    } catch (error: unknown) {
      if (!(error instanceof StorageError)) throw error;
      if (error.kind !== 'upload_not_found')
        throw new StorageUnavailableException();
      if (await this.hasSourceObject(video))
        throw new UploadOperationInProgressException();
    }
    if (
      !(await this.videos.failUpload(
        video.id,
        video.channel_id,
        claim.token,
        VIDEO_UPLOAD.INITIALIZATION_FAILURE_CODE,
        VIDEO_UPLOAD.INITIALIZATION_FAILURE_MESSAGE,
      ))
    )
      throw new UploadOperationInProgressException();
    return null;
  }

  private uploadId(video: Video): string {
    if (!video.upload_id) throw new UploadOperationInProgressException();
    return video.upload_id;
  }

  private initialization(video: Video): VideoUploadInitialization {
    return { video: this.status(video), upload: this.session(video) };
  }

  private session(video: Video): VideoUploadSession {
    return {
      partSizeBytes: VIDEO_LIMITS.PART_SIZE_BYTES,
      partCount: Math.ceil(
        Number(video.declared_size_bytes) / VIDEO_LIMITS.PART_SIZE_BYTES,
      ),
      expiresAt: video.upload_expires_at,
    };
  }

  private status(video: Video): VideoUploadStatus {
    return videoStatus(video);
  }

  private validateInput(input: CreateVideoUpload): void {
    if (
      typeof input.title !== 'string' ||
      input.title.trim().length < 1 ||
      input.title.trim().length > 200 ||
      typeof input.fileName !== 'string' ||
      input.fileName.length < 1 ||
      input.fileName.length > 255 ||
      input.fileName.includes(String.fromCharCode(0)) ||
      /[\\/\r\n]/.test(input.fileName) ||
      input.contentType !== 'video/mp4' ||
      !Number.isSafeInteger(input.sizeBytes) ||
      input.sizeBytes < 1 ||
      input.sizeBytes > VIDEO_LIMITS.MAX_SIZE_BYTES
    )
      throw new VideoUploadValidationException();
  }
}
