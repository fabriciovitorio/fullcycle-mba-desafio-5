import { expect } from '@jest/globals';
import { VideoQueueModule } from './video-queue.module';
import { VIDEO_QUEUE } from '../videos.constants';
import {
  createVideoQueueFixture,
  waitForQueue,
} from '../../test/video-queue.fixture';

describe('VideoQueueModule (integration)', () => {
  let fixture: Awaited<ReturnType<typeof createVideoQueueFixture>>;
  beforeAll(async () => {
    fixture = await createVideoQueueFixture();
    await waitForQueue(fixture.queue);
  });
  afterAll(async () => {
    await fixture?.close();
  });
  it('should resolve the real BullMQ queue with isolated config and producer-only connections', async () => {
    expect(fixture.module.get(VideoQueueModule)).toBeDefined();
    expect(fixture.queue.name).toBe('video-processing');
    expect(fixture.queue.opts.prefix).toBe(fixture.config.prefix);
    expect(fixture.queue.opts.defaultJobOptions).toMatchObject({
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: false,
      removeOnFail: false,
    });
    expect(fixture.queue.opts.connection).toMatchObject({
      host: 'redis',
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      commandTimeout: 2000,
    });
    expect((await fixture.queue.client).status).toBe('ready');
    expect(await fixture.queue.getWorkers()).toEqual([]);
  });
  it('should provide Queue.add and deduplicate a stable ID using the configured defaults', async () => {
    const payload = {
      schemaVersion: 1 as const,
      videoId: '3df90d11-3c5d-4817-9c44-d3c3dbb9b091',
    };
    const id = `video-${payload.videoId}`;
    await fixture.queue.add(VIDEO_QUEUE.JOB_NAME, payload, { jobId: id });
    await fixture.queue.add(VIDEO_QUEUE.JOB_NAME, payload, { jobId: id });
    expect((await fixture.queue.getJob(id))?.data).toEqual(payload);
    expect(await fixture.queue.getJobCounts('wait', 'active')).toMatchObject({
      wait: 1,
      active: 0,
    });
  });
});
