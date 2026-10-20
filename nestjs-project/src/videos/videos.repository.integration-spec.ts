import { randomBytes, randomUUID } from 'node:crypto';
import type { TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { cleanAllTables } from '../test/create-test-data-source';
import {
  createVideoFixture,
  createVideoPersistenceTestModule,
  VIDEO_TEST_METADATA,
} from '../test/video-persistence.fixture';
import { Video } from './entities/video.entity';
import { VideoProcessingOutbox } from './entities/video-processing-outbox.entity';
import { VIDEO_PERSISTENCE } from './videos.constants';
import {
  VideosRepository,
  type CreateVideoDraft,
  type ReadyVideo,
} from './videos.repository';
import { VideoIdGenerationFailedException } from './videos.exceptions';

describe('VideosRepository (integration)', () => {
  let module: TestingModule;
  let source: DataSource;
  let videos: VideosRepository;
  let slugs: string[];
  let generated: number;

  beforeAll(async () => {
    module = await createVideoPersistenceTestModule(() => {
      generated++;
      return slugs.shift() ?? randomBytes(12).toString('hex');
    });
    source = module.get(DataSource);
    videos = module.get(VideosRepository);
  });
  beforeEach(async () => {
    await cleanAllTables(source);
    slugs = [];
    generated = 0;
  });
  afterAll(async () => {
    if (source?.isInitialized) await cleanAllTables(source);
    if (module) await module.close();
  });

  function draftInput(channelId: string): CreateVideoDraft {
    return {
      channelId,
      title: 'New draft',
      originalFileName: 'original.mp4',
      declaredContentType: 'video/mp4',
      declaredSizeBytes: '1000',
      uploadExpiresAt: new Date(Date.now() + 86400000),
    };
  }
  async function processingVideo(): Promise<Video> {
    const video = await createVideoFixture(source);
    const claim = await videos.claimUpload(
      video.id,
      video.channel_id,
      'completing',
      60000,
    );
    if (!claim) throw new Error('Expected upload claim');
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
  function ready(id: string, token: string): ReadyVideo {
    return {
      durationSeconds: 2,
      metadata: VIDEO_TEST_METADATA,
      playbackKey: `videos/${id}/attempts/${token}/playback.mp4`,
      thumbnailKey: `videos/${id}/attempts/${token}/thumbnail.jpg`,
    };
  }
  async function expireProcessing(id: string): Promise<void> {
    await source.query(
      "UPDATE videos SET processing_lease_until = clock_timestamp() - interval '1 second' WHERE id = $1",
      [id],
    );
  }

  it('should create a server-owned draft identity and isolate private lookups by channel', async () => {
    const fixture = await createVideoFixture(source);
    const video = await videos.createDraft(draftInput(fixture.channel_id));
    expect(video.slug).toMatch(/^[0-9a-f]{24}$/);
    expect(video.source_key).toBe(`videos/${video.id}/source`);
    expect(video.status).toBe('draft');
    expect((await videos.findOwnedById(video.id, fixture.channel_id))?.id).toBe(
      video.id,
    );
    expect(await videos.findOwnedById(video.id, randomUUID())).toBeNull();
    expect(await videos.findUploadForOwner(video.id, randomUUID())).toBeNull();
    expect(await videos.findReadyBySlug(video.slug)).toBeNull();
  });

  it('should recover from a real slug collision inside the same PostgreSQL transaction', async () => {
    const existing = await createVideoFixture(source);
    const replacement = 'b'.repeat(24);
    slugs = [existing.slug, replacement];
    await source.transaction(async (manager) => {
      const video = await videos.createDraft(
        draftInput(existing.channel_id),
        manager,
      );
      expect(video.slug).toBe(replacement);
      expect(
        await manager.query<{ value: number }[]>('SELECT 1::int AS value'),
      ).toEqual([{ value: 1 }]);
    });
    expect(generated).toBe(2);
    expect(await source.getRepository(Video).count()).toBe(2);
  });

  it('should translate collision exhaustion and keep the surrounding transaction usable', async () => {
    const existing = await createVideoFixture(source);
    slugs = Array.from(
      { length: VIDEO_PERSISTENCE.MAX_SLUG_ATTEMPTS },
      () => existing.slug,
    );
    await source.transaction(async (manager) => {
      await expect(
        videos.createDraft(draftInput(existing.channel_id), manager),
      ).rejects.toMatchObject({
        errorCode: 'VIDEO_ID_GENERATION_FAILED',
        httpStatus: 503,
      });
      await expect(manager.query('SELECT 1')).resolves.toBeDefined();
    });
    expect(generated).toBe(VIDEO_PERSISTENCE.MAX_SLUG_ATTEMPTS);
    expect(await source.getRepository(Video).count()).toBe(1);
    expect(new VideoIdGenerationFailedException().message).not.toContain(
      existing.slug,
    );
  });

  it('should propagate an unrelated constraint violation without slug retries', async () => {
    await expect(
      videos.createDraft(draftInput(randomUUID())),
    ).rejects.toMatchObject({
      driverError: { code: '23503', constraint: 'FK_videos_channel' },
    });
    expect(generated).toBe(1);
  });

  it('should grant only one concurrent upload claim and hide session data from normal reads', async () => {
    const video = await createVideoFixture(source, {
      upload_id: 'private-session',
    });
    const results = await Promise.all([
      videos.claimUpload(video.id, video.channel_id, 'completing', 60000),
      videos.claimUpload(video.id, video.channel_id, 'aborting', 60000),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(
      (await videos.findOwnedById(video.id, video.channel_id))?.upload_id,
    ).toBeUndefined();
    expect(
      (await videos.findUploadForOwner(video.id, video.channel_id))?.upload_id,
    ).toBe('private-session');
    expect(
      await videos.claimUpload(video.id, randomUUID(), 'initializing', 60000),
    ).toBeNull();
  });

  it('should fence an expired upload claim and explicitly require reconciliation on recovery', async () => {
    const video = await createVideoFixture(source);
    const original = await videos.claimUpload(
      video.id,
      video.channel_id,
      'completing',
      60000,
    );
    if (!original) throw new Error('Expected claim');
    await source.query(
      "UPDATE videos SET operation_expires_at = clock_timestamp() - interval '1 second' WHERE id = $1",
      [video.id],
    );
    expect(
      await videos.completeUpload(
        video.id,
        video.channel_id,
        original.token,
        '1000',
      ),
    ).toBe(false);
    expect(
      await videos.releaseUpload(video.id, video.channel_id, original.token),
    ).toBe(false);
    const recovered = await videos.claimUpload(
      video.id,
      video.channel_id,
      'aborting',
      60000,
    );
    if (!recovered) throw new Error('Expected recovered claim');
    expect(recovered.requiresReconciliation).toBe(true);
    expect(recovered.previousOperation).toBe('completing');
    expect(recovered.token).not.toBe(original.token);
    expect(
      await videos.failUpload(
        video.id,
        video.channel_id,
        original.token,
        'UPLOAD_ABORTED',
        'Aborted',
      ),
    ).toBe(false);
  });

  it('should attach an upload session only for its live initialization claim', async () => {
    const video = await createVideoFixture(source);
    const claim = await videos.claimUpload(
      video.id,
      video.channel_id,
      'initializing',
      60000,
    );
    if (!claim) throw new Error('Expected claim');
    const deadline = new Date(Date.now() + 86400000);
    expect(
      await videos.attachUploadSession(
        video.id,
        randomUUID(),
        claim.token,
        'session',
        deadline,
      ),
    ).toBe(false);
    expect(
      await videos.attachUploadSession(
        video.id,
        video.channel_id,
        randomUUID(),
        'session',
        deadline,
      ),
    ).toBe(false);
    expect(
      await videos.attachUploadSession(
        video.id,
        video.channel_id,
        claim.token,
        'session',
        deadline,
      ),
    ).toBe(true);
    const found = await videos.findUploadForOwner(video.id, video.channel_id);
    expect(found?.upload_id).toBe('session');
    expect(found?.upload_expires_at).toEqual(deadline);
    expect(found?.operation_token).toBeNull();
  });

  it('should persist upload failure only for the owner with a live token', async () => {
    const video = await createVideoFixture(source);
    const claim = await videos.claimUpload(
      video.id,
      video.channel_id,
      'aborting',
      60000,
    );
    if (!claim) throw new Error('Expected claim');
    expect(
      await videos.failUpload(
        video.id,
        randomUUID(),
        claim.token,
        'UPLOAD_ABORTED',
        'Aborted',
      ),
    ).toBe(false);
    expect(
      await videos.failUpload(
        video.id,
        video.channel_id,
        claim.token,
        'UPLOAD_ABORTED',
        'Aborted',
      ),
    ).toBe(true);
    expect(
      (await videos.findOwnedById(video.id, video.channel_id))?.status,
    ).toBe('error');
    expect(await source.getRepository(VideoProcessingOutbox).count()).toBe(0);
    expect(
      await videos.claimUpload(
        video.id,
        video.channel_id,
        'initializing',
        60000,
      ),
    ).toBeNull();
  });

  it('should count only acquired processing attempts and cap retries persistently at three', async () => {
    const video = await processingVideo();
    for (let attempt = 1; attempt <= 3; attempt++) {
      const claim = await videos.claimProcessing(video.id, 60000);
      if (!claim?.processing_token)
        throw new Error('Expected processing claim');
      expect(claim.processing_attempts).toBe(attempt);
      expect(await videos.claimProcessing(video.id, 60000)).toBeNull();
      expect(
        await videos.releaseProcessing(video.id, claim.processing_token),
      ).toBe(true);
    }
    expect(await videos.claimProcessing(video.id, 60000)).toBeNull();
    expect(
      (await source.getRepository(Video).findOneByOrFail({ id: video.id }))
        .processing_attempts,
    ).toBe(3);
    expect(
      (
        await source
          .getRepository(VideoProcessingOutbox)
          .findOneByOrFail({ video_id: video.id })
      ).completed_at,
    ).toBeNull();
  });

  it('should grant one concurrent processing claim without consuming the duplicate budget', async () => {
    const video = await processingVideo();
    const claims = await Promise.all([
      videos.claimProcessing(video.id, 60000),
      videos.claimProcessing(video.id, 60000),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(
      (await source.getRepository(Video).findOneByOrFail({ id: video.id }))
        .processing_attempts,
    ).toBe(1);
  });

  it('should refuse all writes from an expired worker even before a new claim exists', async () => {
    const video = await processingVideo();
    const claim = await videos.claimProcessing(video.id, 60000);
    if (!claim?.processing_token) throw new Error('Expected processing claim');
    await expireProcessing(video.id);
    expect(
      await videos.heartbeatProcessing(video.id, claim.processing_token, 60000),
    ).toBe(false);
    expect(
      await videos.releaseProcessing(video.id, claim.processing_token),
    ).toBe(false);
    expect(
      await videos.finishReady(
        video.id,
        claim.processing_token,
        ready(video.id, claim.processing_token),
      ),
    ).toBe(false);
    expect(
      await videos.finishError(
        video.id,
        claim.processing_token,
        'PROCESSING_FAILED',
        'Failed',
      ),
    ).toBe(false);
  });

  it('should publish only the current attempt and close its outbox atomically', async () => {
    const video = await processingVideo();
    const old = await videos.claimProcessing(video.id, 60000);
    if (!old?.processing_token) throw new Error('Expected claim');
    await expireProcessing(video.id);
    const current = await videos.claimProcessing(video.id, 60000);
    if (!current?.processing_token) throw new Error('Expected claim');
    expect(
      await videos.finishReady(
        video.id,
        old.processing_token,
        ready(video.id, old.processing_token),
      ),
    ).toBe(false);
    expect(
      await videos.heartbeatProcessing(
        video.id,
        current.processing_token,
        120000,
      ),
    ).toBe(true);
    const output = ready(video.id, current.processing_token);
    await expect(
      videos.finishReady(video.id, current.processing_token, {
        ...output,
        playbackKey: 'wrong-attempt.mp4',
      }),
    ).rejects.toThrow('current processing attempt');
    expect(
      await videos.finishReady(video.id, current.processing_token, output),
    ).toBe(true);
    expect(
      await videos.finishError(
        video.id,
        old.processing_token,
        'PROCESSING_FAILED',
        'Failed',
      ),
    ).toBe(false);
    expect(
      await videos.finishReady(video.id, current.processing_token, output),
    ).toBe(false);
    expect((await videos.findReadyBySlug(video.slug))?.playback_key).toBe(
      output.playbackKey,
    );
    expect(
      (
        await source
          .getRepository(VideoProcessingOutbox)
          .findOneByOrFail({ video_id: video.id })
      ).completed_at,
    ).toBeInstanceOf(Date);
  });
});
