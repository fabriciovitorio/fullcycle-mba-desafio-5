import { Inject, Injectable } from '@nestjs/common';
import { ChannelsService } from '../channels/channels.service';
import {
  STORAGE,
  type StorageObject,
  type StoragePart,
  type StoragePort,
} from '../storage/storage.port';
import { StorageError } from '../storage/storage.error';
import type { Video, VideoUploadOperation } from './entities/video.entity';
import type { VideoUploadStatus } from './video-uploads.types';
import { videoStatus } from './video-status.mapper';
import { VideosRepository, type UploadClaim } from './videos.repository';
import {
  VIDEO_LIMITS,
  VIDEO_UPLOAD,
  VIDEO_UPLOAD_FAILURES,
} from './videos.constants';
import {
  InvalidVideoStateException,
  StorageUnavailableException,
  UploadExpiredException,
  UploadIncompleteException,
  UploadOperationInProgressException,
  UploadSizeMismatchException,
  VideoNotFoundException,
} from './videos.exceptions';

type UploadFailure = { readonly code: string; readonly message: string };

@Injectable()
export class VideoUploadCompletionService {
  constructor(
    private readonly channels: ChannelsService,
    private readonly videos: VideosRepository,
    @Inject(STORAGE) private readonly storage: StoragePort,
  ) {}

  async complete(
    userId: string,
    id: string,
  ): Promise<{ video: VideoUploadStatus }> {
    const video = await this.owned(userId, id, true);
    if (this.isCompleted(video)) return { video: videoStatus(video) };
    this.assertDraft(video);
    const claim = await this.claim(video, 'completing');
    if (claim.video.error_code === VIDEO_UPLOAD_FAILURES.SIZE_MISMATCH.code) {
      await this.cleanupMismatch(claim);
      throw new UploadSizeMismatchException();
    }
    const existing = await this.head(claim.video);
    if (existing) return this.commitObject(claim, existing);
    if (claim.previousOperation === 'aborting') {
      const expired =
        claim.video.error_code === VIDEO_UPLOAD_FAILURES.EXPIRED.code;
      await this.operation(claim, 'aborting');
      const recovered = await this.finishAbort(
        claim,
        expired ? VIDEO_UPLOAD_FAILURES.EXPIRED : VIDEO_UPLOAD_FAILURES.ABORTED,
      );
      if (recovered) return recovered;
      if (expired) throw new UploadExpiredException();
      throw new InvalidVideoStateException();
    }
    if (claim.video.upload_expires_at.getTime() <= Date.now()) {
      await this.rememberFailure(claim, VIDEO_UPLOAD_FAILURES.EXPIRED);
      await this.operation(claim, 'aborting');
      const recovered = await this.finishAbort(
        claim,
        VIDEO_UPLOAD_FAILURES.EXPIRED,
      );
      if (recovered) return recovered;
      throw new UploadExpiredException();
    }
    if (!claim.video.upload_id) throw new StorageUnavailableException();
    let parts: StoragePart[];
    try {
      parts = await this.storage.listParts(
        claim.video.source_key,
        claim.video.upload_id,
      );
    } catch (error: unknown) {
      if (!(error instanceof StorageError)) throw error;
      const recovered = await this.head(claim.video);
      if (recovered) return this.commitObject(claim, recovered);
      throw new StorageUnavailableException();
    }
    const validation = this.validateParts(claim.video, parts);
    if (validation === 'size') {
      await this.rememberFailure(claim, VIDEO_UPLOAD_FAILURES.SIZE_MISMATCH);
      await this.cleanupMismatch(claim);
      throw new UploadSizeMismatchException();
    }
    if (validation === 'incomplete') {
      await this.release(claim);
      throw new UploadIncompleteException();
    }
    await this.assertClaim(claim, VIDEO_UPLOAD.COMPENSATION_WINDOW_MS);
    try {
      await this.storage.completeMultipartUpload(
        claim.video.source_key,
        claim.video.upload_id,
        parts,
      );
    } catch (error: unknown) {
      if (!(error instanceof StorageError)) throw error;
      const recovered = await this.head(claim.video);
      if (recovered) return this.commitObject(claim, recovered);
      throw new StorageUnavailableException();
    }
    const object = await this.head(claim.video);
    if (!object) throw new StorageUnavailableException();
    return this.commitObject(claim, object);
  }

  async abort(userId: string, id: string): Promise<void> {
    const video = await this.owned(userId, id, true);
    if (
      video.status === 'error' &&
      video.error_code === VIDEO_UPLOAD_FAILURES.ABORTED.code
    )
      return;
    this.assertDraft(video);
    const claim = await this.claim(video, 'aborting');
    if (claim.video.error_code === VIDEO_UPLOAD_FAILURES.SIZE_MISMATCH.code) {
      await this.cleanupMismatch(claim);
      throw new InvalidVideoStateException();
    }
    const object = await this.head(claim.video);
    if (object) {
      await this.commitObject(claim, object);
      throw new InvalidVideoStateException();
    }
    if (await this.finishAbort(claim, VIDEO_UPLOAD_FAILURES.ABORTED))
      throw new InvalidVideoStateException();
  }

  async getStatus(userId: string, id: string): Promise<VideoUploadStatus> {
    return videoStatus(await this.owned(userId, id, false));
  }

  private async owned(
    userId: string,
    id: string,
    upload: boolean,
  ): Promise<Video> {
    const channel = await this.channels.findByUserId(userId);
    if (!channel) throw new VideoNotFoundException();
    const video = upload
      ? await this.videos.findUploadForOwner(id, channel.id)
      : await this.videos.findOwnedById(id, channel.id);
    if (!video) throw new VideoNotFoundException();
    return video;
  }

  private isCompleted(video: Video): boolean {
    return video.status === 'processing' || video.status === 'ready';
  }

  private assertDraft(video: Video): void {
    if (video.status !== 'draft') throw new InvalidVideoStateException();
    if (video.upload_operation === 'initializing')
      throw new UploadOperationInProgressException();
  }

  private async claim(
    video: Video,
    operation: VideoUploadOperation,
  ): Promise<UploadClaim> {
    const claim = await this.videos.claimUpload(
      video.id,
      video.channel_id,
      operation,
      VIDEO_UPLOAD.FINALIZATION_LEASE_MS,
    );
    if (!claim) throw new UploadOperationInProgressException();
    return claim;
  }

  private async assertClaim(
    claim: UploadClaim,
    minimumRemainingMs = 0,
  ): Promise<void> {
    const current = await this.videos.findUploadForOwner(
      claim.video.id,
      claim.video.channel_id,
    );
    if (
      !current ||
      current.status !== 'draft' ||
      current.operation_token !== claim.token ||
      current.upload_operation !== claim.video.upload_operation ||
      !current.operation_expires_at ||
      current.operation_expires_at.getTime() - Date.now() <= minimumRemainingMs
    )
      throw new UploadOperationInProgressException();
  }

  private async operation(
    claim: UploadClaim,
    operation: VideoUploadOperation,
  ): Promise<void> {
    if (claim.video.upload_operation === operation) return;
    if (
      !(await this.videos.changeUploadOperation(
        claim.video.id,
        claim.video.channel_id,
        claim.token,
        operation,
      ))
    )
      throw new UploadOperationInProgressException();
    claim.video.upload_operation = operation;
  }

  private async head(video: Video): Promise<StorageObject | null> {
    try {
      return await this.storage.headObject(video.source_key);
    } catch (error: unknown) {
      if (!(error instanceof StorageError)) throw error;
      if (error.kind === 'object_not_found') return null;
      throw new StorageUnavailableException();
    }
  }

  private validateParts(
    video: Video,
    parts: StoragePart[],
  ): 'valid' | 'incomplete' | 'size' {
    const size = Number(video.declared_size_bytes);
    const count = Math.ceil(size / VIDEO_LIMITS.PART_SIZE_BYTES);
    for (const part of parts) {
      if (
        !Number.isInteger(part.partNumber) ||
        part.partNumber < 1 ||
        part.partNumber > count ||
        !part.etag
      )
        return 'incomplete';
      const expected = Math.min(
        VIDEO_LIMITS.PART_SIZE_BYTES,
        size - (part.partNumber - 1) * VIDEO_LIMITS.PART_SIZE_BYTES,
      );
      if (!Number.isSafeInteger(part.size) || part.size !== expected)
        return 'size';
    }
    if (
      parts.length !== count ||
      parts.some((part, index) => part.partNumber !== index + 1)
    )
      return 'incomplete';
    return parts.reduce((total, part) => total + part.size, 0) === size
      ? 'valid'
      : 'size';
  }

  private async rememberFailure(
    claim: UploadClaim,
    failure: UploadFailure,
  ): Promise<void> {
    if (
      !(await this.videos.rememberUploadFailure(
        claim.video.id,
        claim.video.channel_id,
        claim.token,
        failure.code,
        failure.message,
      ))
    )
      throw new UploadOperationInProgressException();
    claim.video.error_code = failure.code;
  }

  private async cleanupMismatch(claim: UploadClaim): Promise<void> {
    await this.abortSession(claim);
    const object = await this.head(claim.video);
    if (object) {
      await this.assertClaim(claim, VIDEO_UPLOAD.COMPENSATION_WINDOW_MS);
      try {
        await this.storage.deleteObject(claim.video.source_key);
      } catch (error: unknown) {
        if (error instanceof StorageError)
          throw new StorageUnavailableException();
        throw error;
      }
      if (await this.head(claim.video)) throw new StorageUnavailableException();
    }
    await this.fail(claim, VIDEO_UPLOAD_FAILURES.SIZE_MISMATCH);
  }

  private async abortSession(claim: UploadClaim): Promise<void> {
    await this.assertClaim(claim, VIDEO_UPLOAD.COMPENSATION_WINDOW_MS);
    if (!claim.video.upload_id) throw new StorageUnavailableException();
    try {
      await this.storage.abortMultipartUpload(
        claim.video.source_key,
        claim.video.upload_id,
      );
    } catch (error: unknown) {
      if (!(error instanceof StorageError)) throw error;
      if (error.kind !== 'upload_not_found')
        throw new StorageUnavailableException();
    }
  }

  private async finishAbort(
    claim: UploadClaim,
    failure: UploadFailure,
  ): Promise<{ video: VideoUploadStatus } | null> {
    await this.abortSession(claim);
    // A prior completion may have won at S3 before Abort reached the session.
    const object = await this.head(claim.video);
    if (object) return this.commitObject(claim, object);
    await this.fail(claim, failure);
    return null;
  }

  private async fail(
    claim: UploadClaim,
    failure: UploadFailure,
  ): Promise<void> {
    if (
      !(await this.videos.failUpload(
        claim.video.id,
        claim.video.channel_id,
        claim.token,
        failure.code,
        failure.message,
      ))
    )
      throw new UploadOperationInProgressException();
  }

  private async release(claim: UploadClaim): Promise<void> {
    if (
      !(await this.videos.releaseUpload(
        claim.video.id,
        claim.video.channel_id,
        claim.token,
      ))
    )
      throw new UploadOperationInProgressException();
  }

  private async commitObject(
    claim: UploadClaim,
    object: StorageObject,
  ): Promise<{ video: VideoUploadStatus }> {
    if (object.contentLength !== Number(claim.video.declared_size_bytes)) {
      await this.rememberFailure(claim, VIDEO_UPLOAD_FAILURES.SIZE_MISMATCH);
      await this.cleanupMismatch(claim);
      throw new UploadSizeMismatchException();
    }
    await this.operation(claim, 'completing');
    try {
      const committed = await this.videos.completeUpload(
        claim.video.id,
        claim.video.channel_id,
        claim.token,
        String(object.contentLength),
      );
      const current = await this.videos.findOwnedById(
        claim.video.id,
        claim.video.channel_id,
      );
      if (current && this.isCompleted(current))
        return { video: videoStatus(current) };
      if (!committed) throw new UploadOperationInProgressException();
      throw new StorageUnavailableException();
    } catch (error: unknown) {
      const current = await this.videos.findOwnedById(
        claim.video.id,
        claim.video.channel_id,
      );
      if (current && this.isCompleted(current))
        return { video: videoStatus(current) };
      // Only our live claim can be released. The known completed source is retained,
      // so a retry can reconcile HeadObject without sending the parts again.
      if (
        current?.status === 'draft' &&
        current.operation_token === claim.token
      )
        await this.release(claim);
      throw error;
    }
  }
}
