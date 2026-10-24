import { expect, jest } from '@jest/globals';
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
import { VideoProcessingOutboxRepository } from '../video-processing-outbox.repository';
import { VideoOutboxDispatcher } from './video-outbox-dispatcher.service';

describe('VideoOutboxDispatcher (integration)', () => {
  let fixture: Awaited<ReturnType<typeof createVideoQueueFixture>>;
  let gate: Awaited<ReturnType<typeof createRedisGate>>;
  let source: DataSource;
  let dispatcher: VideoOutboxDispatcher;
  beforeEach(async () => {
    gate = await createRedisGate();
    fixture = await createVideoQueueFixture({ dispatcher: true, gate });
    source = fixture.module.get(DataSource);
    dispatcher = fixture.module.get(VideoOutboxDispatcher);
    await waitForQueue(fixture.queue);
    await cleanAllTables(source);
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    // Always restore before queue cleanup, including after a failed outage test.
    gate.restore();
    try {
      await waitForQueue(fixture.queue);
      await cleanAllTables(source);
      await fixture.close();
    } finally {
      await gate.close();
    }
  });
  async function intent(videoId: string) {
    return source
      .getRepository(VideoProcessingOutbox)
      .findOneByOrFail({ video_id: videoId });
  }
  async function due(videoId: string) {
    await source
      .getRepository(VideoProcessingOutbox)
      .update(
        { video_id: videoId },
        { next_attempt_at: new Date(Date.now() - 1000) },
      );
  }

  it('should publish the exact small payload/options after claiming and keep the processing intent open', async () => {
    const row = await createDispatchVideo(fixture.module);
    await dispatcher.dispatch();
    const job = await fixture.queue.getJob(`video-${row.id}`);
    expect(job).toBeDefined();
    expect(job!.name).toBe('process-video');
    expect(job!.data).toEqual({ schemaVersion: 1, videoId: row.id });
    expect(job!.opts).toMatchObject({
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: false,
      removeOnFail: false,
    });
    const outbox = await intent(row.id);
    expect(outbox.dispatched_at).toBeInstanceOf(Date);
    expect(outbox.completed_at).toBeNull();
    expect(outbox.lock_token).toBeNull();
    expect(outbox.dispatch_attempts).toBe(1);
    expect(outbox.last_error).toBeNull();
    expect(
      (await source.getRepository(Video).findOneByOrFail({ id: row.id }))
        .processing_attempts,
    ).toBe(0);
    expect(await fixture.queue.getWorkers()).toEqual([]);
  });
  it('should deduplicate repeated dispatch by logical jobId while the intent stays eligible', async () => {
    const row = await createDispatchVideo(fixture.module);
    await dispatcher.dispatch();
    await due(row.id);
    await dispatcher.dispatch();
    expect(
      await fixture.queue.getJobCounts('wait', 'active', 'completed', 'failed'),
    ).toMatchObject({ wait: 1, active: 0, completed: 0, failed: 0 });
    expect((await intent(row.id)).dispatch_attempts).toBe(2);
    expect((await intent(row.id)).completed_at).toBeNull();
  });
  it('should release the claim when Redis is unreachable and later dispatch without another upload', async () => {
    const row = await createDispatchVideo(fixture.module);
    gate.block();
    // Let the real socket close propagate, without replacing Queue.add or Redis.
    const client = await fixture.queue.client;
    if (client.status === 'ready')
      await new Promise<void>((resolve) =>
        client.once('close', () => resolve()),
      );
    await expect(dispatcher.dispatch()).rejects.toThrow();
    const failed = await intent(row.id);
    expect(failed.dispatched_at).toBeNull();
    expect(failed.completed_at).toBeNull();
    expect(failed.lock_token).toBeNull();
    expect(failed.last_error).toBe('Dispatch failed');
    gate.restore();
    await waitForQueue(fixture.queue);
    await due(row.id);
    await dispatcher.dispatch();
    expect(await fixture.queue.getJob(`video-${row.id}`)).toBeDefined();
    expect(await source.getRepository(Video).count()).toBe(1);
    expect((await intent(row.id)).last_error).toBeNull();
    expect((await intent(row.id)).completed_at).toBeNull();
  });
  it('should recover the add-before-commit crash window with an expired claim and one logical job', async () => {
    const row = await createDispatchVideo(fixture.module);
    const repo = fixture.module.get(VideoProcessingOutboxRepository);
    // Real SQL failures after the successful Redis add preserve the crash window.
    jest.spyOn(repo, 'markDispatched').mockImplementationOnce(async () => {
      await source.query('SELECT 1 / 0');
      return false;
    });
    jest.spyOn(repo, 'releaseDispatch').mockImplementationOnce(async () => {
      await source.query('SELECT 1 / 0');
      return false;
    });
    await expect(dispatcher.dispatch()).rejects.toBeInstanceOf(AggregateError);
    const failed = await intent(row.id);
    expect(failed.dispatched_at).toBeNull();
    expect(failed.lock_token).not.toBeNull();
    expect(await fixture.queue.getJob(`video-${row.id}`)).toBeDefined();
    await source
      .getRepository(VideoProcessingOutbox)
      .update(failed.id, { locked_until: new Date(Date.now() - 1000) });
    await dispatcher.dispatch();
    const recovered = await intent(row.id);
    expect(recovered.dispatched_at).toBeInstanceOf(Date);
    expect(recovered.lock_token).toBeNull();
    expect(recovered.completed_at).toBeNull();
    expect(recovered.dispatch_attempts).toBe(2);
    expect(await fixture.queue.getJobCounts('wait', 'active')).toMatchObject({
      wait: 1,
      active: 0,
    });
  });
  it('should leave future, completed and terminal-video intentions undispatched', async () => {
    const future = await createDispatchVideo(fixture.module);
    await source
      .getRepository(VideoProcessingOutbox)
      .update(
        { video_id: future.id },
        { next_attempt_at: new Date(Date.now() + 60000) },
      );
    const terminal = await createDispatchVideo(fixture.module);
    await source.getRepository(Video).update(terminal.id, {
      status: 'error',
      error_code: 'PROCESSING_FAILED',
      error_message: 'Video processing failed',
    });
    const completed = await createDispatchVideo(fixture.module);
    await source
      .getRepository(VideoProcessingOutbox)
      .update({ video_id: completed.id }, { completed_at: new Date() });
    await dispatcher.dispatch();
    expect(await fixture.queue.getJobCounts('wait', 'active')).toMatchObject({
      wait: 0,
      active: 0,
    });
    for (const row of [future, terminal, completed])
      expect((await intent(row.id)).dispatch_attempts).toBe(0);
  });
  it('should recover when constructed while Redis is already unreachable', async () => {
    await fixture.close();
    await gate.close();
    gate = await createRedisGate(false);
    fixture = await createVideoQueueFixture({ dispatcher: true, gate });
    source = fixture.module.get(DataSource);
    dispatcher = fixture.module.get(VideoOutboxDispatcher);
    const row = await createDispatchVideo(fixture.module);
    const start = Date.now();
    await expect(dispatcher.dispatch()).rejects.toThrow('readiness timed out');
    expect(Date.now() - start).toBeLessThan(5000);
    expect((await intent(row.id)).dispatched_at).toBeNull();
    gate.restore();
    await waitForQueue(fixture.queue);
    await due(row.id);
    await dispatcher.dispatch();
    expect(await fixture.queue.getJob(`video-${row.id}`)).toBeDefined();
  }, 20000);
});
