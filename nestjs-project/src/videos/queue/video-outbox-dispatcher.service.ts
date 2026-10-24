import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { VideoProcessingReconciler } from './video-processing-reconciler.service';
import { VideoProcessingOutboxRepository } from '../video-processing-outbox.repository';
import { VIDEO_QUEUE } from '../videos.constants';
import {
  VIDEO_DISPATCH,
  type VideoProcessingJob,
} from './video-queue.constants';

@Injectable()
export class VideoOutboxDispatcher
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(VideoOutboxDispatcher.name);
  private timer?: ReturnType<typeof setTimeout>;
  private active?: Promise<void>;
  private started = false;
  private stopping = false;

  constructor(
    private readonly outbox: VideoProcessingOutboxRepository,
    @InjectQueue(VIDEO_QUEUE.NAME)
    private readonly queue: Queue<VideoProcessingJob>,
    private readonly reconciler: VideoProcessingReconciler,
  ) {}

  onApplicationBootstrap(): void {
    if (this.started || this.stopping) return;
    this.started = true;
    this.schedule(0);
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    try {
      await this.active;
    } catch {
      // Shutdown is a background boundary; the open intent remains retryable.
      this.logger.error('Video dispatch failed during shutdown');
    }
  }

  async dispatch(): Promise<void> {
    if (this.stopping) return;
    if (this.active) return this.active;
    this.active = this.run();
    try {
      await this.active;
    } finally {
      this.active = undefined;
    }
  }

  private schedule(delay: number): void {
    this.timer = setTimeout(() => {
      void this.cycle();
    }, delay);
    this.timer.unref();
  }

  private async cycle(): Promise<void> {
    try {
      await this.dispatch();
    } catch {
      // Native timer boundary: log sanitized failure and retry from the outbox.
      this.logger.error('Video outbox dispatch failed; retry scheduled');
    } finally {
      if (!this.stopping) this.schedule(VIDEO_DISPATCH.TICK_MS);
    }
  }

  private async run(): Promise<void> {
    const rows = await this.outbox.claimDispatch(
      VIDEO_DISPATCH.BATCH_SIZE,
      VIDEO_DISPATCH.LEASE_MS,
    );
    for (const row of rows) {
      if (!row.lock_token) throw new Error('Dispatch claim has no token');
      try {
        await this.waitForProducer();
        const recovery = await this.reconciler.reconcileClaim(row);
        if (recovery.action === 'terminal') continue;
        if (recovery.action === 'defer') {
          if (
            !(await this.outbox.deferDispatch(
              row.id,
              row.lock_token,
              new Date(Date.now() + VIDEO_DISPATCH.RECHECK_MS),
            ))
          )
            throw new Error('Dispatch claim could not be deferred');
          continue;
        }
        await this.queue.add(
          VIDEO_QUEUE.JOB_NAME,
          {
            schemaVersion: VIDEO_QUEUE.SCHEMA_VERSION,
            videoId: row.video_id,
          },
          {
            jobId: `video-${row.video_id}`,
            attempts: recovery.attempts,
            backoff: {
              type: 'exponential',
              delay: VIDEO_QUEUE.BACKOFF_DELAY_MS,
            },
            removeOnComplete: false,
            removeOnFail: false,
          },
        );
        if (
          !(await this.outbox.markDispatched(
            row.id,
            row.lock_token,
            new Date(Date.now() + VIDEO_DISPATCH.RECHECK_MS),
          ))
        )
          throw new Error('Dispatch claim ownership was lost');
      } catch (error: unknown) {
        try {
          if (
            !(await this.outbox.releaseDispatch(
              row.id,
              row.lock_token,
              new Date(Date.now() + VIDEO_DISPATCH.RETRY_MS),
            ))
          )
            throw new Error('Dispatch claim could not be released');
        } catch (releaseError: unknown) {
          throw new AggregateError(
            [error, releaseError],
            'Video dispatch failed and claim recovery is required',
          );
        }
        throw error;
      }
    }
  }

  private async waitForProducer(): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // Do not start Queue.add until ready: a timed-out readiness wait must not
      // leave a deferred add that can run after the database claim was released.
      const client = await Promise.race([
        this.queue.waitUntilReady(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Video queue readiness timed out')),
            VIDEO_DISPATCH.READY_TIMEOUT_MS,
          );
        }),
      ]);
      if (client.status !== 'ready')
        throw new Error('Video queue is unavailable');
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
