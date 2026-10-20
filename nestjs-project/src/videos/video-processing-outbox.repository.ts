import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, type EntityManager, In, IsNull, Not } from 'typeorm';
import { Video } from './entities/video.entity';
import { VideoProcessingOutbox } from './entities/video-processing-outbox.entity';
import { VIDEO_QUEUE } from './videos.constants';

export function assertLeaseDuration(milliseconds: number): void {
  if (!Number.isSafeInteger(milliseconds) || milliseconds <= 0) {
    throw new RangeError('Lease duration must be a positive safe integer');
  }
}

@Injectable()
export class VideoProcessingOutboxRepository {
  constructor(private readonly dataSource: DataSource) {}

  async createForVideo(manager: EntityManager, videoId: string): Promise<void> {
    if (!manager.queryRunner?.isTransactionActive) {
      throw new Error('Outbox insertion requires an active transaction');
    }
    const video = await manager.getRepository(Video).findOne({
      where: {
        id: videoId,
        status: 'processing',
        actual_size_bytes: Not(IsNull()),
      },
      lock: { mode: 'pessimistic_write' },
    });
    if (!video)
      throw new Error('Outbox requires a completed upload in processing');
    await manager.getRepository(VideoProcessingOutbox).insert({
      video_id: videoId,
      event_type: 'video.upload.completed',
      schema_version: VIDEO_QUEUE.SCHEMA_VERSION,
    });
  }

  async completeForVideo(
    manager: EntityManager,
    videoId: string,
  ): Promise<void> {
    if (!manager.queryRunner?.isTransactionActive) {
      throw new Error('Outbox completion requires an active transaction');
    }
    if (
      !(await manager
        .getRepository(Video)
        .existsBy({ id: videoId, status: In(['ready', 'error']) }))
    ) {
      throw new Error('Outbox completion requires a terminal video');
    }
    const result = await manager.getRepository(VideoProcessingOutbox).update(
      { video_id: videoId, completed_at: IsNull() },
      {
        completed_at: () => 'clock_timestamp()',
        locked_until: null,
        lock_token: null,
        last_error: null,
      },
    );
    if (result.affected !== 1)
      throw new Error('Active processing intent is missing');
  }

  async claimDispatch(
    limit: number,
    leaseMs: number,
  ): Promise<VideoProcessingOutbox[]> {
    assertLeaseDuration(leaseMs);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new RangeError(
        'Dispatch batch must contain between 1 and 100 records',
      );
    }
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(VideoProcessingOutbox);
      const rows = await repository
        .createQueryBuilder('outbox')
        .innerJoin('outbox.video', 'video', 'video.status = :status', {
          status: 'processing',
        })
        .where({ completed_at: IsNull() })
        .andWhere('outbox.next_attempt_at <= clock_timestamp()')
        .andWhere(
          '(outbox.lock_token IS NULL OR outbox.locked_until <= clock_timestamp())',
        )
        .orderBy('outbox.next_attempt_at', 'ASC')
        .addOrderBy('outbox.id', 'ASC')
        .limit(limit)
        .setLock('pessimistic_write', undefined, ['outbox'])
        .setOnLocked('skip_locked')
        .getMany();
      const claimed: VideoProcessingOutbox[] = [];
      for (const row of rows) {
        const token = randomUUID();
        await repository
          .createQueryBuilder()
          .update()
          .set({
            lock_token: token,
            locked_until: () =>
              "clock_timestamp() + (:leaseMs * interval '1 millisecond')",
            dispatch_attempts: () => 'dispatch_attempts + 1',
          })
          .where({ id: row.id })
          .setParameter('leaseMs', leaseMs)
          .execute();
        const saved = await repository.findOneByOrFail({ id: row.id });
        claimed.push(saved);
      }
      return claimed;
    });
  }

  async markDispatched(
    id: string,
    token: string,
    nextAttemptAt: Date,
  ): Promise<boolean> {
    const result = await this.dataSource
      .getRepository(VideoProcessingOutbox)
      .createQueryBuilder()
      .update()
      .set({
        dispatched_at: () => 'clock_timestamp()',
        next_attempt_at: nextAttemptAt,
        lock_token: null,
        locked_until: null,
        last_error: null,
      })
      .where({ id, lock_token: token, completed_at: IsNull() })
      .andWhere('locked_until > clock_timestamp()')
      .execute();
    return result.affected === 1;
  }

  async releaseDispatch(
    id: string,
    token: string,
    nextAttemptAt: Date,
  ): Promise<boolean> {
    const result = await this.dataSource
      .getRepository(VideoProcessingOutbox)
      .createQueryBuilder()
      .update()
      .set({
        next_attempt_at: nextAttemptAt,
        lock_token: null,
        locked_until: null,
        // Persist only a fixed diagnostic; raw queue errors may contain secrets.
        last_error: 'Dispatch failed',
      })
      .where({ id, lock_token: token, completed_at: IsNull() })
      .andWhere('locked_until > clock_timestamp()')
      .execute();
    return result.affected === 1;
  }
}
