import { expect, jest } from '@jest/globals';
import { Test, type TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import type { JobsOptions } from 'bullmq';
import { VideoProcessingOutbox } from '../entities/video-processing-outbox.entity';
import { VideoProcessingOutboxRepository } from '../video-processing-outbox.repository';
import { VIDEO_QUEUE } from '../videos.constants';
import {
  VIDEO_DISPATCH,
  type VideoProcessingJob,
} from './video-queue.constants';
import { VideoOutboxDispatcher } from './video-outbox-dispatcher.service';

describe('VideoOutboxDispatcher', () => {
  let module: TestingModule;
  let service: VideoOutboxDispatcher;
  const outbox = {
    claimDispatch: jest.fn<VideoProcessingOutboxRepository['claimDispatch']>(),
    markDispatched:
      jest.fn<VideoProcessingOutboxRepository['markDispatched']>(),
    releaseDispatch:
      jest.fn<VideoProcessingOutboxRepository['releaseDispatch']>(),
  };
  const queue = {
    waitUntilReady: jest.fn<() => Promise<{ status: string }>>(),
    add: jest.fn<
      (
        name: string,
        data: VideoProcessingJob,
        options: JobsOptions,
      ) => Promise<unknown>
    >(),
  };
  const logError = jest.fn();
  let row: VideoProcessingOutbox;
  beforeEach(async () => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'error').mockImplementation(logError);
    row = Object.assign(new VideoProcessingOutbox(), {
      id: 'outbox-id',
      video_id: 'video-id',
      lock_token: 'claim-token',
    });
    outbox.claimDispatch.mockResolvedValue([row]);
    outbox.markDispatched.mockResolvedValue(true);
    outbox.releaseDispatch.mockResolvedValue(true);
    queue.waitUntilReady.mockResolvedValue({ status: 'ready' });
    queue.add.mockResolvedValue(undefined);
    module = await Test.createTestingModule({
      providers: [
        VideoOutboxDispatcher,
        { provide: VideoProcessingOutboxRepository, useValue: outbox },
        { provide: getQueueToken(VIDEO_QUEUE.NAME), useValue: queue },
      ],
    }).compile();
    service = module.get(VideoOutboxDispatcher);
  });
  afterEach(async () => {
    await module.close();
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('should claim briefly and mark only after publishing with the exact job contract', async () => {
    let resolveAdd!: () => void;
    queue.add.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveAdd = resolve;
        }),
    );
    const pending = service.dispatch();
    await jest.advanceTimersByTimeAsync(0);
    expect(outbox.claimDispatch).toHaveBeenCalledWith(
      1,
      VIDEO_DISPATCH.LEASE_MS,
    );
    expect(outbox.markDispatched).not.toHaveBeenCalled();
    expect(queue.add).toHaveBeenCalledWith(
      'process-video',
      { schemaVersion: 1, videoId: row.video_id },
      {
        jobId: `video-${row.video_id}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: false,
        removeOnFail: false,
      },
    );
    resolveAdd();
    await pending;
    expect(outbox.markDispatched).toHaveBeenCalledWith(
      row.id,
      row.lock_token!,
      new Date(Date.now() + VIDEO_DISPATCH.RECHECK_MS),
    );
    expect(outbox.releaseDispatch).not.toHaveBeenCalled();
  });
  it('should leave an empty outbox alone', async () => {
    outbox.claimDispatch.mockResolvedValue([]);
    await service.dispatch();
    expect(queue.add).not.toHaveBeenCalled();
  });
  it('should release and reschedule failed publication without marking delivered', async () => {
    queue.add.mockRejectedValueOnce(new Error('queue failed'));
    await expect(service.dispatch()).rejects.toThrow('queue failed');
    expect(outbox.markDispatched).not.toHaveBeenCalled();
    expect(outbox.releaseDispatch).toHaveBeenCalledWith(
      row.id,
      row.lock_token!,
      new Date(Date.now() + VIDEO_DISPATCH.RETRY_MS),
    );
  });
  it('should propagate claim read failures before touching Redis', async () => {
    outbox.claimDispatch.mockRejectedValueOnce(new Error('db read failed'));
    await expect(service.dispatch()).rejects.toThrow('db read failed');
    expect(queue.add).not.toHaveBeenCalled();
  });
  it('should release a claim when the post-add persistence fails', async () => {
    outbox.markDispatched.mockRejectedValueOnce(new Error('db commit failed'));
    await expect(service.dispatch()).rejects.toThrow('db commit failed');
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(outbox.releaseDispatch).toHaveBeenCalledTimes(1);
  });
  it('should report lost claim ownership instead of reporting success', async () => {
    outbox.markDispatched.mockResolvedValueOnce(false);
    await expect(service.dispatch()).rejects.toThrow('ownership was lost');
  });
  it('should preserve both errors when release fails so recovery is observable', async () => {
    queue.add.mockRejectedValueOnce(new Error('queue failed'));
    outbox.releaseDispatch.mockRejectedValueOnce(new Error('db unavailable'));
    await expect(service.dispatch()).rejects.toMatchObject({
      name: 'AggregateError',
      errors: [
        expect.objectContaining({ message: 'queue failed' }),
        expect.objectContaining({ message: 'db unavailable' }),
      ],
    });
  });
  it('should reject an expired release token without hiding the dispatch failure', async () => {
    queue.add.mockRejectedValueOnce(new Error('queue failed'));
    outbox.releaseDispatch.mockResolvedValueOnce(false);
    await expect(service.dispatch()).rejects.toBeInstanceOf(AggregateError);
  });
  it('should bound initial readiness and never enqueue a deferred add after releasing a claim', async () => {
    let ready!: (value: { status: string }) => void;
    queue.waitUntilReady.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          ready = resolve;
        }),
    );
    const pending = expect(service.dispatch()).rejects.toThrow(
      'readiness timed out',
    );
    await jest.advanceTimersByTimeAsync(VIDEO_DISPATCH.READY_TIMEOUT_MS);
    await pending;
    ready({ status: 'ready' });
    await jest.advanceTimersByTimeAsync(0);
    expect(queue.add).not.toHaveBeenCalled();
    expect(outbox.releaseDispatch).toHaveBeenCalledTimes(1);
  });
  it('should reject a disconnected producer without marking delivery', async () => {
    queue.waitUntilReady.mockResolvedValueOnce({ status: 'reconnecting' });
    await expect(service.dispatch()).rejects.toThrow('unavailable');
    expect(queue.add).not.toHaveBeenCalled();
  });
  it('should not overlap direct calls and should await in-flight dispatch on shutdown', async () => {
    let finish!: () => void;
    queue.add.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const first = service.dispatch();
    await jest.advanceTimersByTimeAsync(0);
    const second = service.dispatch();
    let stopped = false;
    const shutdown = service.onModuleDestroy().then(() => {
      stopped = true;
    });
    await jest.advanceTimersByTimeAsync(0);
    expect(stopped).toBe(false);
    expect(outbox.claimDispatch).toHaveBeenCalledTimes(1);
    finish();
    await Promise.all([first, second, shutdown]);
    await service.dispatch();
    expect(outbox.claimDispatch).toHaveBeenCalledTimes(1);
  });
  it('should retry through one lifecycle timer and stop scheduling after shutdown', async () => {
    outbox.claimDispatch.mockRejectedValueOnce(
      new Error('secret database url'),
    );
    service.onApplicationBootstrap();
    service.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(0);
    expect(logError).toHaveBeenCalledWith(
      'Video outbox dispatch failed; retry scheduled',
    );
    await jest.advanceTimersByTimeAsync(VIDEO_DISPATCH.TICK_MS);
    expect(outbox.claimDispatch).toHaveBeenCalledTimes(2);
    await service.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(VIDEO_DISPATCH.TICK_MS * 3);
    expect(outbox.claimDispatch).toHaveBeenCalledTimes(2);
  });
});
