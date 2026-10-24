import { expect, jest } from '@jest/globals';
import { Test, type TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import type { JobState, RetryOptions } from 'bullmq';
import { Video } from '../entities/video.entity';
import { VideoProcessingOutbox } from '../entities/video-processing-outbox.entity';
import { VideosRepository } from '../videos.repository';
import { VIDEO_QUEUE } from '../videos.constants';
import { VideoProcessingReconciler } from './video-processing-reconciler.service';

describe('VideoProcessingReconciler', () => {
  let module: TestingModule;
  let service: VideoProcessingReconciler;
  const videos = {
    findProcessingRecovery:
      jest.fn<VideosRepository['findProcessingRecovery']>(),
    failProcessingRecovery:
      jest.fn<VideosRepository['failProcessingRecovery']>(),
  };
  const job = {
    attemptsMade: 0,
    opts: { attempts: 3 },
    getState: jest.fn<() => Promise<JobState | 'unknown'>>(),
    retry:
      jest.fn<(state: 'completed', options: RetryOptions) => Promise<void>>(),
  };
  const queue = {
    getJob: jest.fn<(id: string) => Promise<typeof job | undefined>>(),
  };
  let claim: VideoProcessingOutbox;
  let video: Video;
  beforeEach(async () => {
    jest.clearAllMocks();
    claim = Object.assign(new VideoProcessingOutbox(), {
      id: 'intent-id',
      video_id: 'video-id',
      lock_token: 'claim-token',
    });
    video = Object.assign(new Video(), {
      id: claim.video_id,
      processing_attempts: 1,
      status: 'processing',
    });
    videos.findProcessingRecovery.mockResolvedValue({
      video,
      leaseActive: false,
    });
    videos.failProcessingRecovery.mockResolvedValue(true);
    queue.getJob.mockResolvedValue(undefined);
    job.attemptsMade = 0;
    job.getState.mockResolvedValue('waiting');
    job.retry.mockResolvedValue(undefined);
    module = await Test.createTestingModule({
      providers: [
        VideoProcessingReconciler,
        { provide: VideosRepository, useValue: videos },
        { provide: getQueueToken(VIDEO_QUEUE.NAME), useValue: queue },
      ],
    }).compile();
    service = module.get(VideoProcessingReconciler);
  });
  afterEach(async () => {
    await module.close();
  });

  it('should reconstruct a missing job using only the persisted remaining budget', async () => {
    expect(await service.reconcileClaim(claim)).toEqual({
      action: 'publish',
      attempts: 2,
    });
    expect(queue.getJob).toHaveBeenCalledWith('video-video-id');
    expect(video.processing_attempts).toBe(1);
    expect(videos.failProcessingRecovery).not.toHaveBeenCalled();
  });
  it('should defer any recovery while the DB processing lease remains valid', async () => {
    video.processing_attempts = 3;
    videos.findProcessingRecovery.mockResolvedValue({
      video,
      leaseActive: true,
    });
    expect(await service.reconcileClaim(claim)).toEqual({ action: 'defer' });
    expect(queue.getJob).not.toHaveBeenCalled();
    expect(videos.failProcessingRecovery).not.toHaveBeenCalled();
  });
  it('should close an exhausted DB budget without creating a fourth processing attempt', async () => {
    video.processing_attempts = 3;
    expect(await service.reconcileClaim(claim)).toEqual({ action: 'terminal' });
    expect(videos.failProcessingRecovery).toHaveBeenCalledWith(
      claim.video_id,
      claim.id,
      claim.lock_token!,
      'budget',
    );
    expect(queue.getJob).not.toHaveBeenCalled();
  });
  it('should persist final failure for a failed job without trusting raw Redis failure diagnostics', async () => {
    queue.getJob.mockResolvedValue(job);
    job.getState.mockResolvedValue('failed');
    expect(await service.reconcileClaim(claim)).toEqual({ action: 'terminal' });
    expect(videos.failProcessingRecovery).toHaveBeenCalledWith(
      claim.video_id,
      claim.id,
      claim.lock_token!,
      'failed',
    );
    expect(job.retry).not.toHaveBeenCalled();
  });
  it('should stop a completed job that has exhausted its queue budget even if no DB claim was recorded', async () => {
    queue.getJob.mockResolvedValue(job);
    job.getState.mockResolvedValue('completed');
    job.attemptsMade = 3;
    expect(await service.reconcileClaim(claim)).toEqual({ action: 'terminal' });
    expect(job.retry).not.toHaveBeenCalled();
    expect(videos.failProcessingRecovery).toHaveBeenCalledWith(
      claim.video_id,
      claim.id,
      claim.lock_token!,
      'failed',
    );
  });
  it('should atomically retry completed without resetting Redis counters or inventing ready', async () => {
    queue.getJob.mockResolvedValue(job);
    job.getState.mockResolvedValue('completed');
    expect(await service.reconcileClaim(claim)).toEqual({
      action: 'publish',
      attempts: 2,
    });
    expect(job.retry).toHaveBeenCalledWith('completed', {
      resetAttemptsMade: false,
      resetAttemptsStarted: false,
    });
    expect(videos.failProcessingRecovery).not.toHaveBeenCalled();
  });
  it.each(['waiting', 'delayed', 'prioritized', 'waiting-children'] as const)(
    'should preserve existing %s jobs through idempotent publication',
    async (state) => {
      queue.getJob.mockResolvedValue(job);
      job.getState.mockResolvedValue(state);
      expect(await service.reconcileClaim(claim)).toEqual({
        action: 'publish',
        attempts: 2,
      });
      expect(job.retry).not.toHaveBeenCalled();
    },
  );
  it.each(['active', 'unknown'] as const)(
    'should defer a %s job without destructive removal or retry',
    async (state) => {
      queue.getJob.mockResolvedValue(job);
      job.getState.mockResolvedValue(state);
      expect(await service.reconcileClaim(claim)).toEqual({ action: 'defer' });
      expect(job.retry).not.toHaveBeenCalled();
    },
  );
  it('should propagate a missing or stale outbox claim before touching Redis', async () => {
    videos.findProcessingRecovery.mockResolvedValue(null);
    await expect(service.reconcileClaim(claim)).rejects.toThrow(
      'ownership was lost',
    );
    expect(queue.getJob).not.toHaveBeenCalled();
  });
  it('should propagate DB lookup failure instead of abandoning the intention', async () => {
    videos.findProcessingRecovery.mockRejectedValueOnce(
      new Error('db unavailable'),
    );
    await expect(service.reconcileClaim(claim)).rejects.toThrow(
      'db unavailable',
    );
  });
  it('should reject a failed terminal fence rather than falsely reporting completion', async () => {
    video.processing_attempts = 3;
    videos.failProcessingRecovery.mockResolvedValue(false);
    await expect(service.reconcileClaim(claim)).rejects.toThrow(
      'could not confirm',
    );
  });
  it('should propagate terminal DB commit failure for retry by the dispatcher', async () => {
    video.processing_attempts = 3;
    videos.failProcessingRecovery.mockRejectedValueOnce(
      new Error('commit failed'),
    );
    await expect(service.reconcileClaim(claim)).rejects.toThrow(
      'commit failed',
    );
  });
  it('should propagate a Redis inspection failure without mutating the processing budget', async () => {
    queue.getJob.mockRejectedValueOnce(new Error('Redis unavailable'));
    await expect(service.reconcileClaim(claim)).rejects.toThrow(
      'Redis unavailable',
    );
    expect(video.processing_attempts).toBe(1);
  });
  it('should propagate retry failure when the job left the expected completed state', async () => {
    queue.getJob.mockResolvedValue(job);
    job.getState.mockResolvedValue('completed');
    job.retry.mockRejectedValueOnce(new Error('wrong state'));
    await expect(service.reconcileClaim(claim)).rejects.toThrow('wrong state');
    expect(videos.failProcessingRecovery).not.toHaveBeenCalled();
  });
});
