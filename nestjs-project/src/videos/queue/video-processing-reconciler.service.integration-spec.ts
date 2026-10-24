import { expect, jest } from '@jest/globals';
import { Worker } from 'bullmq';
import { DataSource } from 'typeorm';
import { cleanAllTables } from '../../test/create-test-data-source';
import {
  createDispatchVideo,
  createRedisGate,
  createVideoQueueFixture,
  waitForQueue,
} from '../../test/video-queue.fixture';
import { Video } from '../entities/video.entity';
import { VideoProcessingOutbox } from '../entities/video-processing-outbox.entity';
import { VideosRepository } from '../videos.repository';
import { VideoProcessingOutboxRepository } from '../video-processing-outbox.repository';
import { VideoOutboxDispatcher } from './video-outbox-dispatcher.service';
import type { VideoProcessingJob } from './video-queue.constants';

describe('VideoProcessingReconciler (integration)', () => {
  let fixture: Awaited<ReturnType<typeof createVideoQueueFixture>>;
  let gate: Awaited<ReturnType<typeof createRedisGate>>;
  let source: DataSource;
  let videos: VideosRepository;
  let outbox: VideoProcessingOutboxRepository;
  let dispatcher: VideoOutboxDispatcher;
  beforeEach(async () => {
    gate = await createRedisGate();
    fixture = await createVideoQueueFixture({ dispatcher: true, gate });
    source = fixture.module.get(DataSource);
    videos = fixture.module.get(VideosRepository);
    outbox = fixture.module.get(VideoProcessingOutboxRepository);
    dispatcher = fixture.module.get(VideoOutboxDispatcher);
    await waitForQueue(fixture.queue);
    await cleanAllTables(source);
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    gate.restore();
    try {
      await waitForQueue(fixture.queue);
      await cleanAllTables(source);
      await fixture.close();
    } finally {
      await gate.close();
    }
  });
  async function intent(id: string) {
    return source
      .getRepository(VideoProcessingOutbox)
      .findOneByOrFail({ video_id: id });
  }
  async function current(id: string) {
    return source.getRepository(Video).findOneByOrFail({ id });
  }
  async function due(id: string) {
    await source
      .getRepository(VideoProcessingOutbox)
      .update(
        { video_id: id },
        { next_attempt_at: new Date(Date.now() - 1000) },
      );
  }
  async function attempts(id: string, count: number) {
    for (let i = 0; i < count; i++) {
      const claim = await videos.claimProcessing(id, 60000);
      expect(claim).not.toBeNull();
      expect(await videos.releaseProcessing(id, claim!.processing_token!)).toBe(
        true,
      );
    }
  }
  async function consumeTerminal(
    state: 'completed' | 'failed',
    processor: () => Promise<unknown>,
  ) {
    const worker = new Worker<VideoProcessingJob, unknown>(
      fixture.queue.name,
      processor,
      {
        prefix: fixture.config.prefix,
        connection: {
          ...fixture.config.connection,
          maxRetriesPerRequest: null,
        },
        autorun: false,
      },
    );
    const terminal = new Promise<void>((resolve, reject) => {
      worker.once('error', reject);
      if (state === 'completed') worker.once('completed', () => resolve());
      else
        worker.on('failed', (job) => {
          if (!job) {
            reject(new Error('Expected failed job'));
            return;
          }
          if (job.attemptsMade >= (job.opts.attempts ?? 1)) resolve();
        });
    });
    await worker.waitUntilReady();
    const running = worker.run();
    try {
      await terminal;
    } finally {
      await worker.close();
      await running;
    }
  }

  it('should recreate a deleted job with only the DB remaining attempt and unchanged video identity', async () => {
    const row = await createDispatchVideo(fixture.module);
    await dispatcher.dispatch();
    await attempts(row.id, 2);
    await (await fixture.queue.getJob(`video-${row.id}`))!.remove();
    await due(row.id);
    await dispatcher.dispatch();
    const job = await fixture.queue.getJob(`video-${row.id}`);
    expect(job!.data).toEqual({ schemaVersion: 1, videoId: row.id });
    expect(job!.opts.attempts).toBe(1);
    expect(await current(row.id)).toMatchObject({
      id: row.id,
      slug: row.slug,
      status: 'processing',
      processing_attempts: 2,
    });
    expect((await intent(row.id)).completed_at).toBeNull();
    expect(await fixture.queue.getJobCounts('wait')).toMatchObject({ wait: 1 });
  });
  it('should atomically fail an exhausted missing job instead of granting a fourth DB attempt', async () => {
    const row = await createDispatchVideo(fixture.module);
    await attempts(row.id, 3);
    await dispatcher.dispatch();
    expect(await current(row.id)).toMatchObject({
      status: 'error',
      processing_attempts: 3,
      error_code: 'PROCESSING_FAILED',
      processing_token: null,
      processing_lease_until: null,
    });
    expect((await intent(row.id)).completed_at).toBeInstanceOf(Date);
    expect((await intent(row.id)).lock_token).toBeNull();
    expect(await fixture.queue.getJob(`video-${row.id}`)).toBeUndefined();
    expect(await videos.claimProcessing(row.id, 60000)).toBeNull();
  });
  it('should preserve a valid processing lease when its Redis job has disappeared', async () => {
    const row = await createDispatchVideo(fixture.module);
    const active = await videos.claimProcessing(row.id, 60000);
    const before = await current(row.id);
    await dispatcher.dispatch();
    expect(await current(row.id)).toEqual(before);
    expect(await fixture.queue.getJob(`video-${row.id}`)).toBeUndefined();
    const deferred = await intent(row.id);
    expect(deferred.dispatched_at).toBeNull();
    expect(deferred.completed_at).toBeNull();
    expect(deferred.last_error).toBeNull();
    expect(deferred.lock_token).toBeNull();
    expect(
      await videos.heartbeatProcessing(
        row.id,
        active!.processing_token!,
        60000,
      ),
    ).toBe(true);
  });
  it('should recover an expired processing lease without resetting budget or authorizing the old token', async () => {
    const row = await createDispatchVideo(fixture.module);
    const old = await videos.claimProcessing(row.id, 60000);
    await source
      .getRepository(Video)
      .update(row.id, { processing_lease_until: new Date(Date.now() - 1000) });
    await dispatcher.dispatch();
    expect((await fixture.queue.getJob(`video-${row.id}`))!.opts.attempts).toBe(
      2,
    );
    expect((await current(row.id)).processing_attempts).toBe(1);
    const next = await videos.claimProcessing(row.id, 60000);
    expect(next!.processing_attempts).toBe(2);
    expect(next!.processing_token).not.toBe(old!.processing_token);
    expect(
      await videos.finishError(
        row.id,
        old!.processing_token!,
        'PROCESSING_FAILED',
        'Video processing failed',
      ),
    ).toBe(false);
    expect((await current(row.id)).status).toBe('processing');
  });
  it('should bound repeated real completions that never recorded a DB processing claim', async () => {
    const row = await createDispatchVideo(fixture.module);
    await dispatcher.dispatch();
    for (let index = 1; index <= 3; index++) {
      await consumeTerminal('completed', () => Promise.resolve(undefined));
      expect(
        (await fixture.queue.getJob(`video-${row.id}`))!.attemptsMade,
      ).toBe(index);
      await due(row.id);
      await dispatcher.dispatch();
    }
    expect(await current(row.id)).toMatchObject({
      status: 'error',
      processing_attempts: 0,
      error_code: 'PROCESSING_FAILED',
    });
    expect((await intent(row.id)).completed_at).toBeInstanceOf(Date);
    expect(
      await (await fixture.queue.getJob(`video-${row.id}`))!.getState(),
    ).toBe('completed');
  });
  it('should requeue a real completed job with DB still processing and preserve Redis counters', async () => {
    const row = await createDispatchVideo(fixture.module);
    await dispatcher.dispatch();
    await consumeTerminal('completed', async () => {
      const claim = await videos.claimProcessing(row.id, 60000);
      expect(claim).not.toBeNull();
      await videos.releaseProcessing(row.id, claim!.processing_token!);
      return { status: 'ready', playbackKey: 'untrusted-return-value' };
    });
    const before = (await fixture.queue.getJob(`video-${row.id}`))!;
    expect(await before.getState()).toBe('completed');
    const made = before.attemptsMade;
    const started = before.attemptsStarted;
    await due(row.id);
    await dispatcher.dispatch();
    const after = (await fixture.queue.getJob(`video-${row.id}`))!;
    expect(await after.getState()).toBe('waiting');
    expect(after.attemptsMade).toBe(made);
    expect(after.attemptsStarted).toBe(started);
    expect(await current(row.id)).toMatchObject({
      status: 'processing',
      processing_attempts: 1,
      playback_key: null,
      thumbnail_key: null,
    });
    expect((await intent(row.id)).completed_at).toBeNull();
  });
  it('should persist sanitized error after a real job exhausts retries even if failure happened before DB claim', async () => {
    const row = await createDispatchVideo(fixture.module);
    await dispatcher.dispatch();
    await consumeTerminal('failed', () =>
      Promise.reject(new Error('private stderr credential diagnostic')),
    );
    const job = (await fixture.queue.getJob(`video-${row.id}`))!;
    expect(await job.getState()).toBe('failed');
    expect(job.attemptsMade).toBe(3);
    await due(row.id);
    await dispatcher.dispatch();
    const saved = await current(row.id);
    expect(saved).toMatchObject({
      status: 'error',
      error_code: 'PROCESSING_FAILED',
      error_message: 'Video processing failed',
      processing_attempts: 0,
    });
    expect(saved.error_message).not.toContain('private');
    expect((await intent(row.id)).completed_at).toBeInstanceOf(Date);
    expect(await job.getState()).toBe('failed');
  }, 20000);
  it('should stop completed-without-commit recovery once the persistent budget is exhausted', async () => {
    const row = await createDispatchVideo(fixture.module);
    await dispatcher.dispatch();
    await consumeTerminal('completed', () => Promise.resolve(undefined));
    await attempts(row.id, 3);
    await due(row.id);
    await dispatcher.dispatch();
    expect(await current(row.id)).toMatchObject({
      status: 'error',
      processing_attempts: 3,
    });
    expect((await intent(row.id)).completed_at).toBeInstanceOf(Date);
    expect(
      await (await fixture.queue.getJob(`video-${row.id}`))!.getState(),
    ).toBe('completed');
  });
  it('should roll back video and outbox together after a real terminal SQL failure, then recover', async () => {
    const row = await createDispatchVideo(fixture.module);
    await attempts(row.id, 3);
    const complete = jest.spyOn(outbox, 'completeForVideo');
    complete.mockImplementationOnce(async (manager, id) => {
      complete.mockRestore();
      await outbox.completeForVideo(manager, id);
      await manager.query('SELECT 1 / 0');
    });
    await expect(dispatcher.dispatch()).rejects.toMatchObject({
      driverError: { code: '22012' },
    });
    expect(await current(row.id)).toMatchObject({
      status: 'processing',
      processing_attempts: 3,
      error_code: null,
    });
    expect((await intent(row.id)).completed_at).toBeNull();
    await due(row.id);
    await dispatcher.dispatch();
    expect((await current(row.id)).status).toBe('error');
    expect((await intent(row.id)).completed_at).toBeInstanceOf(Date);
  });
  it('should reject an expired outbox token and protect a live processing lease at terminal recovery', async () => {
    const row = await createDispatchVideo(fixture.module);
    await attempts(row.id, 2);
    const active = await videos.claimProcessing(row.id, 60000);
    const [claim] = await outbox.claimDispatch(1, 30000);
    expect(
      await videos.failProcessingRecovery(
        row.id,
        claim.id,
        claim.lock_token!,
        'budget',
      ),
    ).toBe(false);
    await source
      .getRepository(VideoProcessingOutbox)
      .update(claim.id, { locked_until: new Date(Date.now() - 1000) });
    expect(
      await videos.failProcessingRecovery(
        row.id,
        claim.id,
        claim.lock_token!,
        'failed',
      ),
    ).toBe(false);
    expect((await current(row.id)).processing_token).toBe(
      active!.processing_token,
    );
    expect((await intent(row.id)).completed_at).toBeNull();
  });
  it('should recheck the outbox deadline after waiting for a locked video row', async () => {
    const row = await createDispatchVideo(fixture.module);
    await attempts(row.id, 3);
    const [claim] = await outbox.claimDispatch(1, 30000);
    const runner = source.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      await runner.manager
        .getRepository(Video)
        .createQueryBuilder('video')
        .where({ id: row.id })
        .setLock('pessimistic_write')
        .getOne();
      await runner.manager
        .getRepository(VideoProcessingOutbox)
        .update(claim.id, { locked_until: new Date(Date.now() + 30) });
      const pending = videos.failProcessingRecovery(
        row.id,
        claim.id,
        claim.lock_token!,
        'budget',
      );
      await runner.query('SELECT pg_sleep(0.08)');
      await runner.commitTransaction();
      expect(await pending).toBe(false);
    } finally {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await runner.release();
    }
    expect((await current(row.id)).status).toBe('processing');
    expect((await intent(row.id)).completed_at).toBeNull();
  });
  it('should release and retry after a real DB inspection failure without losing the job intention', async () => {
    const row = await createDispatchVideo(fixture.module);
    jest
      .spyOn(videos, 'findProcessingRecovery')
      .mockImplementationOnce(async () => {
        await source.query('SELECT 1 / 0');
        return null;
      });
    await expect(dispatcher.dispatch()).rejects.toMatchObject({
      driverError: { code: '22012' },
    });
    expect((await intent(row.id)).last_error).toBe('Dispatch failed');
    expect((await intent(row.id)).completed_at).toBeNull();
    await due(row.id);
    await dispatcher.dispatch();
    expect(await fixture.queue.getJob(`video-${row.id}`)).toBeDefined();
    expect((await current(row.id)).processing_attempts).toBe(0);
  });
});
