import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { VideoProcessingOutbox } from '../entities/video-processing-outbox.entity';
import { VideosRepository } from '../videos.repository';
import { VIDEO_QUEUE } from '../videos.constants';
import type { VideoProcessingJob } from './video-queue.constants';

export type ProcessingRecoveryDecision =
  | { action: 'publish'; attempts: number }
  | { action: 'defer' }
  | { action: 'terminal' };

@Injectable()
export class VideoProcessingReconciler {
  constructor(
    private readonly videos: VideosRepository,
    @InjectQueue(VIDEO_QUEUE.NAME)
    private readonly queue: Queue<VideoProcessingJob>,
  ) {}

  // Driven by the dispatcher's exclusive outbox claim and lifecycle, no second timer.
  async reconcileClaim(
    claim: VideoProcessingOutbox,
  ): Promise<ProcessingRecoveryDecision> {
    if (!claim.lock_token) throw new Error('Recovery claim has no token');
    const state = await this.videos.findProcessingRecovery(
      claim.video_id,
      claim.id,
      claim.lock_token,
    );
    if (!state) throw new Error('Recovery claim ownership was lost');
    if (state.leaseActive) return { action: 'defer' };
    const remaining =
      VIDEO_QUEUE.MAX_ATTEMPTS - state.video.processing_attempts;
    if (remaining <= 0) return this.fail(claim, 'budget');
    const job = await this.queue.getJob(`video-${claim.video_id}`);
    if (!job) return { action: 'publish', attempts: remaining };
    const status = await job.getState();
    if (status === 'failed') return this.fail(claim, 'failed');
    if (status === 'active' || status === 'unknown') return { action: 'defer' };
    if (status === 'completed') {
      if (job.attemptsMade >= (job.opts.attempts ?? VIDEO_QUEUE.MAX_ATTEMPTS))
        return this.fail(claim, 'failed');
      // Atomic expected-state transition; never remove by ID or reset counters.
      // Redis returnvalue is not evidence that media and DB finalization succeeded.
      await job.retry('completed', {
        resetAttemptsMade: false,
        resetAttemptsStarted: false,
      });
    }
    return { action: 'publish', attempts: remaining };
  }

  private async fail(
    claim: VideoProcessingOutbox,
    reason: 'budget' | 'failed',
  ): Promise<ProcessingRecoveryDecision> {
    if (
      !(await this.videos.failProcessingRecovery(
        claim.video_id,
        claim.id,
        claim.lock_token!,
        reason,
      ))
    )
      throw new Error('Processing recovery could not confirm terminal state');
    return { action: 'terminal' };
  }
}
