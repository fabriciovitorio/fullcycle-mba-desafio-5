import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, type EntityManager, QueryFailedError } from 'typeorm';
import {
  Video,
  type VideoMetadata,
  type VideoUploadOperation,
} from './entities/video.entity';
import {
  VideoProcessingOutboxRepository,
  assertLeaseDuration,
} from './video-processing-outbox.repository';
import {
  VIDEO_PERSISTENCE,
  VIDEO_QUEUE,
  VIDEO_SLUG_FACTORY,
  type VideoSlugFactory,
} from './videos.constants';
import { VideoIdGenerationFailedException } from './videos.exceptions';

export interface CreateVideoDraft {
  channelId: string;
  title: string;
  originalFileName: string;
  declaredContentType: string;
  declaredSizeBytes: string;
  uploadExpiresAt: Date;
}

export interface UploadClaim {
  video: Video;
  token: string;
  previousOperation: VideoUploadOperation | null;
  requiresReconciliation: boolean;
}

export interface ReadyVideo {
  durationSeconds: number;
  metadata: VideoMetadata;
  playbackKey: string;
  thumbnailKey: string;
}

type TerminalPatch = Pick<Video, 'status'> &
  Partial<
    Pick<
      Video,
      | 'duration_seconds'
      | 'metadata'
      | 'playback_key'
      | 'thumbnail_key'
      | 'error_code'
      | 'error_message'
    >
  >;

@Injectable()
export class VideosRepository {
  constructor(
    private readonly dataSource: DataSource,
    private readonly outbox: VideoProcessingOutboxRepository,
    @Inject(VIDEO_SLUG_FACTORY) private readonly slugFactory: VideoSlugFactory,
  ) {}

  async createDraft(
    input: CreateVideoDraft,
    manager?: EntityManager,
  ): Promise<Video> {
    if (!manager)
      return this.dataSource.transaction((transaction) =>
        this.createDraft(input, transaction),
      );
    if (!manager.queryRunner?.isTransactionActive)
      throw new Error('Draft creation requires an active transaction');
    const id = randomUUID();
    for (
      let attempt = 0;
      attempt < VIDEO_PERSISTENCE.MAX_SLUG_ATTEMPTS;
      attempt++
    ) {
      await manager.query('SAVEPOINT video_slug_attempt');
      try {
        const video = await manager.getRepository(Video).save({
          id,
          channel_id: input.channelId,
          title: input.title,
          original_file_name: input.originalFileName,
          declared_content_type: input.declaredContentType,
          declared_size_bytes: input.declaredSizeBytes,
          upload_expires_at: input.uploadExpiresAt,
          source_key: `videos/${id}/source`,
          slug: this.slugFactory(),
        });
        await manager.query('RELEASE SAVEPOINT video_slug_attempt');
        return video;
      } catch (error) {
        await manager.query('ROLLBACK TO SAVEPOINT video_slug_attempt');
        await manager.query('RELEASE SAVEPOINT video_slug_attempt');
        const driver: unknown =
          error instanceof QueryFailedError ? error.driverError : undefined;
        if (
          !driver ||
          typeof driver !== 'object' ||
          !('code' in driver) ||
          driver.code !== '23505' ||
          !('constraint' in driver) ||
          driver.constraint !== 'UQ_videos_slug'
        )
          throw error;
      }
    }
    throw new VideoIdGenerationFailedException();
  }

  async findOwnedById(id: string, channelId: string): Promise<Video | null> {
    return this.dataSource
      .getRepository(Video)
      .findOneBy({ id, channel_id: channelId });
  }

  async findUploadForOwner(
    id: string,
    channelId: string,
  ): Promise<Video | null> {
    return this.dataSource
      .getRepository(Video)
      .createQueryBuilder('video')
      .addSelect('video.upload_id')
      .where({ id, channel_id: channelId })
      .getOne();
  }

  async findReadyBySlug(slug: string): Promise<Video | null> {
    return this.dataSource
      .getRepository(Video)
      .findOneBy({ slug, status: 'ready' });
  }

  async claimUpload(
    id: string,
    channelId: string,
    operation: VideoUploadOperation,
    leaseMs: number,
  ): Promise<UploadClaim | null> {
    assertLeaseDuration(leaseMs);
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(Video);
      const video = await repository
        .createQueryBuilder('video')
        .addSelect('video.upload_id')
        .where({ id, channel_id: channelId, status: 'draft' })
        .setLock('pessimistic_write')
        .getOne();
      if (!video) return null;
      const [clock] = await manager.query<{ now: Date }[]>(
        'SELECT clock_timestamp() AS now',
      );
      if (
        video.upload_operation &&
        (!video.operation_expires_at || video.operation_expires_at > clock.now)
      )
        return null;
      const token = randomUUID();
      const previousOperation = video.upload_operation;
      await repository
        .createQueryBuilder()
        .update()
        .set({
          upload_operation: operation,
          operation_token: token,
          operation_expires_at: () =>
            "clock_timestamp() + (:leaseMs * interval '1 millisecond')",
        })
        .where({ id })
        .setParameter('leaseMs', leaseMs)
        .execute();
      const claimed = await repository
        .createQueryBuilder('video')
        .addSelect('video.upload_id')
        .where({ id })
        .getOneOrFail();
      // Acquiring an expired claim grants no permission to skip S3 reconciliation.
      // The session deadline alone also cannot discard an already completed object.
      return {
        video: claimed,
        token,
        previousOperation,
        requiresReconciliation: previousOperation !== null,
      };
    });
  }

  async rememberUploadSession(
    id: string,
    channelId: string,
    token: string,
    uploadId: string,
    expiresAt: Date,
  ): Promise<boolean> {
    const result = await this.uploadUpdate(
      this.dataSource.manager,
      id,
      channelId,
      token,
    )
      .andWhere('upload_operation = :operation', { operation: 'initializing' })
      .set({ upload_id: uploadId, upload_expires_at: expiresAt })
      .execute();
    return result.affected === 1;
  }

  async attachUploadSession(
    id: string,
    channelId: string,
    token: string,
    uploadId: string,
    expiresAt: Date,
  ): Promise<boolean> {
    const result = await this.uploadUpdate(
      this.dataSource.manager,
      id,
      channelId,
      token,
    )
      .andWhere('upload_operation = :operation', { operation: 'initializing' })
      .set({
        upload_id: uploadId,
        upload_expires_at: expiresAt,
        upload_operation: null,
        operation_token: null,
        operation_expires_at: null,
      })
      .execute();
    return result.affected === 1;
  }

  async releaseUpload(
    id: string,
    channelId: string,
    token: string,
  ): Promise<boolean> {
    const result = await this.uploadUpdate(
      this.dataSource.manager,
      id,
      channelId,
      token,
    )
      .set({
        upload_operation: null,
        operation_token: null,
        operation_expires_at: null,
      })
      .execute();
    return result.affected === 1;
  }

  async completeUpload(
    id: string,
    channelId: string,
    token: string,
    actualSizeBytes: string,
  ): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const result = await this.uploadUpdate(manager, id, channelId, token)
        .andWhere('upload_operation = :operation', { operation: 'completing' })
        .andWhere('declared_size_bytes = :actualSizeBytes', { actualSizeBytes })
        .set({
          status: 'processing',
          error_code: null,
          error_message: null,
          actual_size_bytes: actualSizeBytes,
          upload_operation: null,
          operation_token: null,
          operation_expires_at: null,
        })
        .execute();
      if (result.affected !== 1) return false;
      await this.outbox.createForVideo(manager, id);
      return true;
    });
  }

  async failUpload(
    id: string,
    channelId: string,
    token: string,
    code: string,
    message: string,
  ): Promise<boolean> {
    const result = await this.uploadUpdate(
      this.dataSource.manager,
      id,
      channelId,
      token,
    )
      .set({
        status: 'error',
        error_code: code,
        error_message: message,
        upload_operation: null,
        operation_token: null,
        operation_expires_at: null,
      })
      .execute();
    return result.affected === 1;
  }

  async changeUploadOperation(
    id: string,
    channelId: string,
    token: string,
    operation: VideoUploadOperation,
  ): Promise<boolean> {
    const result = await this.uploadUpdate(
      this.dataSource.manager,
      id,
      channelId,
      token,
    )
      .set({ upload_operation: operation })
      .execute();
    return result.affected === 1;
  }

  async rememberUploadFailure(
    id: string,
    channelId: string,
    token: string,
    code: string,
    message: string,
  ): Promise<boolean> {
    const result = await this.uploadUpdate(
      this.dataSource.manager,
      id,
      channelId,
      token,
    )
      .set({ error_code: code, error_message: message })
      .execute();
    return result.affected === 1;
  }

  async claimProcessing(id: string, leaseMs: number): Promise<Video | null> {
    assertLeaseDuration(leaseMs);
    return this.dataSource.transaction(async (manager) => {
      const token = randomUUID();
      const result = await manager
        .getRepository(Video)
        .createQueryBuilder()
        .update()
        .set({
          processing_token: token,
          processing_lease_until: () =>
            "clock_timestamp() + (:leaseMs * interval '1 millisecond')",
          processing_attempts: () => 'processing_attempts + 1',
        })
        .where({ id, status: 'processing' })
        .andWhere(
          '(processing_token IS NULL OR processing_lease_until <= clock_timestamp())',
        )
        .andWhere('processing_attempts < :maxAttempts', {
          maxAttempts: VIDEO_QUEUE.MAX_ATTEMPTS,
        })
        .setParameter('leaseMs', leaseMs)
        .execute();
      if (result.affected !== 1) return null;
      return manager
        .getRepository(Video)
        .findOneBy({ id, processing_token: token });
    });
  }

  async heartbeatProcessing(
    id: string,
    token: string,
    leaseMs: number,
  ): Promise<boolean> {
    assertLeaseDuration(leaseMs);
    const result = await this.processingUpdate(
      this.dataSource.manager,
      id,
      token,
    )
      .set({
        processing_lease_until: () =>
          "clock_timestamp() + (:leaseMs * interval '1 millisecond')",
      })
      .setParameter('leaseMs', leaseMs)
      .execute();
    return result.affected === 1;
  }

  async releaseProcessing(id: string, token: string): Promise<boolean> {
    const result = await this.processingUpdate(
      this.dataSource.manager,
      id,
      token,
    )
      .set({ processing_token: null, processing_lease_until: null })
      .execute();
    return result.affected === 1;
  }

  async finishReady(
    id: string,
    token: string,
    output: ReadyVideo,
  ): Promise<boolean> {
    const prefix = `videos/${id}/attempts/${token}/`;
    if (
      output.playbackKey !== `${prefix}playback.mp4` ||
      output.thumbnailKey !== `${prefix}thumbnail.jpg`
    ) {
      throw new Error(
        'Derived keys must belong to the current processing attempt',
      );
    }
    return this.finishProcessing(id, token, {
      status: 'ready',
      duration_seconds: output.durationSeconds,
      metadata: output.metadata,
      playback_key: output.playbackKey,
      thumbnail_key: output.thumbnailKey,
      error_code: null,
      error_message: null,
    });
  }

  async finishError(
    id: string,
    token: string,
    code: string,
    message: string,
  ): Promise<boolean> {
    return this.finishProcessing(id, token, {
      status: 'error',
      error_code: code,
      error_message: message,
    });
  }

  private async finishProcessing(
    id: string,
    token: string,
    patch: TerminalPatch,
  ): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      // Check the deadline after waiting for any existing row lock, not before it.
      await manager
        .getRepository(Video)
        .createQueryBuilder('video')
        .where({ id })
        .setLock('pessimistic_write')
        .getOne();
      const result = await this.processingUpdate(manager, id, token)
        .set({ ...patch, processing_token: null, processing_lease_until: null })
        .execute();
      if (result.affected !== 1) return false;
      await this.outbox.completeForVideo(manager, id);
      return true;
    });
  }

  private uploadUpdate(
    manager: EntityManager,
    id: string,
    channelId: string,
    token: string,
  ) {
    return manager
      .getRepository(Video)
      .createQueryBuilder()
      .update()
      .where({
        id,
        channel_id: channelId,
        status: 'draft',
        operation_token: token,
      })
      .andWhere('operation_expires_at > clock_timestamp()');
  }

  private processingUpdate(manager: EntityManager, id: string, token: string) {
    return manager
      .getRepository(Video)
      .createQueryBuilder()
      .update()
      .where({ id, status: 'processing', processing_token: token })
      .andWhere('processing_lease_until > clock_timestamp()');
  }
}
