import { jest } from '@jest/globals';
import type { TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { cleanAllTables } from '../test/create-test-data-source';
import {
  createVideoFixture,
  createVideoPersistenceTestModule,
} from '../test/video-persistence.fixture';
import { Video } from './entities/video.entity';
import { VideoProcessingOutbox } from './entities/video-processing-outbox.entity';
import { VideoProcessingOutboxRepository } from './video-processing-outbox.repository';
import { VideosRepository } from './videos.repository';

describe('VideoProcessingOutboxRepository (integration)', () => {
  let module: TestingModule;
  let source: DataSource;
  let videos: VideosRepository;
  let outbox: VideoProcessingOutboxRepository;
  beforeAll(async () => {
    module = await createVideoPersistenceTestModule();
    source = module.get(DataSource);
    videos = module.get(VideosRepository);
    outbox = module.get(VideoProcessingOutboxRepository);
  });
  beforeEach(async () => cleanAllTables(source));
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    if (source?.isInitialized) await cleanAllTables(source);
    if (module) await module.close();
  });

  async function draftWithClaim() {
    const video = await createVideoFixture(source);
    const claim = await videos.claimUpload(
      video.id,
      video.channel_id,
      'completing',
      60000,
    );
    if (!claim) throw new Error('Expected claim');
    return { video, claim };
  }
  async function processingVideo(): Promise<Video> {
    const { video, claim } = await draftWithClaim();
    expect(
      await videos.completeUpload(
        video.id,
        video.channel_id,
        claim.token,
        '1000',
      ),
    ).toBe(true);
    return video;
  }

  it('should roll back both processing transition and outbox after a real SQL failure', async () => {
    const { video, claim } = await draftWithClaim();
    const createSpy = jest.spyOn(outbox, 'createForVideo');
    createSpy.mockImplementationOnce(async (manager, id) => {
      createSpy.mockRestore();
      await outbox.createForVideo(manager, id);
      await manager.query('SELECT 1 / 0');
    });
    await expect(
      videos.completeUpload(video.id, video.channel_id, claim.token, '1000'),
    ).rejects.toMatchObject({ driverError: { code: '22012' } });
    const found = await videos.findOwnedById(video.id, video.channel_id);
    expect(found?.status).toBe('draft');
    expect(found?.actual_size_bytes).toBeNull();
    expect(found?.operation_token).toBe(claim.token);
    expect(await source.getRepository(VideoProcessingOutbox).count()).toBe(0);
    expect(
      await videos.completeUpload(
        video.id,
        video.channel_id,
        claim.token,
        '1000',
      ),
    ).toBe(true);
  });

  it('should reject size mismatch without transitioning or inserting an outbox', async () => {
    const { video, claim } = await draftWithClaim();
    expect(
      await videos.completeUpload(
        video.id,
        video.channel_id,
        claim.token,
        '999',
      ),
    ).toBe(false);
    expect(
      await videos.completeUpload(video.id, randomUUID(), claim.token, '1000'),
    ).toBe(false);
    expect(
      (await videos.findOwnedById(video.id, video.channel_id))?.status,
    ).toBe('draft');
    expect(await source.getRepository(VideoProcessingOutbox).count()).toBe(0);
  });

  it('should create one outbox under concurrent or repeated completion', async () => {
    const { video, claim } = await draftWithClaim();
    const outcomes = await Promise.all([
      videos.completeUpload(video.id, video.channel_id, claim.token, '1000'),
      videos.completeUpload(video.id, video.channel_id, claim.token, '1000'),
    ]);
    expect(outcomes.sort()).toEqual([false, true]);
    expect(
      await videos.completeUpload(
        video.id,
        video.channel_id,
        claim.token,
        '1000',
      ),
    ).toBe(false);
    expect(
      await source
        .getRepository(VideoProcessingOutbox)
        .countBy({ video_id: video.id }),
    ).toBe(1);
    expect(
      (await videos.findOwnedById(video.id, video.channel_id))?.status,
    ).toBe('processing');
  });

  it('should require a transaction and a completed upload for outbox creation', async () => {
    const video = await createVideoFixture(source);
    await expect(
      outbox.createForVideo(source.manager, video.id),
    ).rejects.toThrow('active transaction');
    await expect(
      source.transaction((manager) => outbox.createForVideo(manager, video.id)),
    ).rejects.toThrow('completed upload');
    await expect(
      source.transaction((manager) =>
        outbox.completeForVideo(manager, video.id),
      ),
    ).rejects.toThrow('terminal video');
    expect(await source.getRepository(VideoProcessingOutbox).count()).toBe(0);
  });

  it('should roll back terminal video and outbox changes together and permit a safe retry', async () => {
    const video = await processingVideo();
    const claim = await videos.claimProcessing(video.id, 60000);
    if (!claim?.processing_token) throw new Error('Expected processing claim');
    const completeSpy = jest.spyOn(outbox, 'completeForVideo');
    completeSpy.mockImplementationOnce(async (manager, id) => {
      completeSpy.mockRestore();
      await outbox.completeForVideo(manager, id);
      await manager.query('SELECT 1 / 0');
    });
    await expect(
      videos.finishError(
        video.id,
        claim.processing_token,
        'PROCESSING_FAILED',
        'Failed',
      ),
    ).rejects.toMatchObject({ driverError: { code: '22012' } });
    expect(
      (await videos.findOwnedById(video.id, video.channel_id))?.status,
    ).toBe('processing');
    expect(
      (
        await source
          .getRepository(VideoProcessingOutbox)
          .findOneByOrFail({ video_id: video.id })
      ).completed_at,
    ).toBeNull();
    expect(
      await videos.finishError(
        video.id,
        claim.processing_token,
        'PROCESSING_FAILED',
        'Failed',
      ),
    ).toBe(true);
    expect(
      (
        await source
          .getRepository(VideoProcessingOutbox)
          .findOneByOrFail({ video_id: video.id })
      ).completed_at,
    ).toBeInstanceOf(Date);
    expect(await videos.claimProcessing(video.id, 60000)).toBeNull();
  });

  it('should preserve processing when the required outbox is missing at finalization', async () => {
    const video = await processingVideo();
    const claim = await videos.claimProcessing(video.id, 60000);
    if (!claim?.processing_token) throw new Error('Expected claim');
    await source
      .getRepository(VideoProcessingOutbox)
      .delete({ video_id: video.id });
    await expect(
      videos.finishError(
        video.id,
        claim.processing_token,
        'PROCESSING_FAILED',
        'Failed',
      ),
    ).rejects.toThrow('intent is missing');
    expect(
      (await videos.findOwnedById(video.id, video.channel_id))?.status,
    ).toBe('processing');
  });

  it('should grant one concurrent dispatch claim and never complete an intent on dispatch', async () => {
    const video = await processingVideo();
    const claims = await Promise.all([
      outbox.claimDispatch(1, 60000),
      outbox.claimDispatch(1, 60000),
    ]);
    expect(claims.flat()).toHaveLength(1);
    const row = claims.flat()[0];
    if (!row.lock_token) throw new Error('Expected lock token');
    expect(row.video_id).toBe(video.id);
    expect(row.dispatch_attempts).toBe(1);
    expect(
      await outbox.markDispatched(
        row.id,
        row.lock_token,
        new Date(Date.now() + 60000),
      ),
    ).toBe(true);
    const saved = await source
      .getRepository(VideoProcessingOutbox)
      .findOneByOrFail({ id: row.id });
    expect(saved.dispatched_at).toBeInstanceOf(Date);
    expect(saved.completed_at).toBeNull();
    expect(await outbox.claimDispatch(1, 60000)).toEqual([]);
  });

  it('should recover an expired dispatcher and reject its old token before and after recovery', async () => {
    await processingVideo();
    const [old] = await outbox.claimDispatch(1, 60000);
    if (!old.lock_token) throw new Error('Expected token');
    await source.query(
      "UPDATE video_processing_outbox SET locked_until = clock_timestamp() - interval '1 second' WHERE id = $1",
      [old.id],
    );
    expect(
      await outbox.markDispatched(old.id, old.lock_token, new Date()),
    ).toBe(false);
    expect(
      await outbox.releaseDispatch(old.id, old.lock_token, new Date()),
    ).toBe(false);
    const [current] = await outbox.claimDispatch(1, 60000);
    if (!current.lock_token) throw new Error('Expected recovered token');
    expect(current.lock_token).not.toBe(old.lock_token);
    expect(current.dispatch_attempts).toBe(2);
    expect(
      await outbox.markDispatched(old.id, old.lock_token, new Date()),
    ).toBe(false);
    expect(
      await outbox.releaseDispatch(current.id, current.lock_token, new Date()),
    ).toBe(true);
    const saved = await source
      .getRepository(VideoProcessingOutbox)
      .findOneByOrFail({ id: current.id });
    expect(saved.last_error).toBe('Dispatch failed');
    expect(saved.completed_at).toBeNull();
  });

  it('should keep dispatched processing intents eligible for reconciliation after the due time', async () => {
    await processingVideo();
    const [row] = await outbox.claimDispatch(1, 60000);
    if (!row.lock_token) throw new Error('Expected token');
    expect(
      await outbox.markDispatched(row.id, row.lock_token, new Date(0)),
    ).toBe(true);
    const [reconciled] = await outbox.claimDispatch(1, 60000);
    expect(reconciled.id).toBe(row.id);
    expect(reconciled.completed_at).toBeNull();
  });

  it('should skip a row locked by another transaction instead of blocking the batch', async () => {
    const first = await processingVideo();
    const second = await processingVideo();
    const runner = source.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    let pending: Promise<VideoProcessingOutbox[]> | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await runner.manager
        .getRepository(VideoProcessingOutbox)
        .createQueryBuilder('outbox')
        .where({ video_id: first.id })
        .setLock('pessimistic_write')
        .getOneOrFail();
      pending = outbox.claimDispatch(2, 60000);
      const deadline = new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error('Dispatch blocked on a locked row')),
          2000,
        );
      });
      const claimed = await Promise.race([pending, deadline]);
      expect(claimed.map((row) => row.video_id)).toEqual([second.id]);
    } finally {
      if (timeout) clearTimeout(timeout);
      await runner.rollbackTransaction();
      await runner.release();
      if (pending) await pending;
    }
  });

  it('should exclude terminal videos even if an unfinished legacy intent exists', async () => {
    const video = await processingVideo();
    await source
      .getRepository(Video)
      .update(video.id, { status: 'error', error_code: 'PROCESSING_FAILED' });
    expect(await outbox.claimDispatch(1, 60000)).toEqual([]);
  });
});
