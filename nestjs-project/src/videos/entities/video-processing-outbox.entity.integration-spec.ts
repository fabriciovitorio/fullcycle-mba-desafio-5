import { randomUUID } from 'node:crypto';
import type { TestingModule } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { cleanAllTables } from '../../test/create-test-data-source';
import {
  createVideoFixture,
  createVideoPersistenceTestModule,
} from '../../test/video-persistence.fixture';
import { Video } from './video.entity';
import { VideoProcessingOutbox } from './video-processing-outbox.entity';

describe('VideoProcessingOutbox entity (integration)', () => {
  let module: TestingModule;
  let source: DataSource;
  let outbox: Repository<VideoProcessingOutbox>;

  beforeAll(async () => {
    module = await createVideoPersistenceTestModule();
    source = module.get(DataSource);
    outbox = source.getRepository(VideoProcessingOutbox);
  });
  beforeEach(async () => cleanAllTables(source));
  afterAll(async () => {
    if (source?.isInitialized) await cleanAllTables(source);
    if (module) await module.close();
  });

  it('should persist one processing intent with scheduling and timestamp defaults', async () => {
    const video = await createVideoFixture(source);
    const saved = await outbox.save({
      video_id: video.id,
      event_type: 'video.upload.completed',
      schema_version: 1,
    });
    const found = await outbox.findOneByOrFail({ id: saved.id });
    expect(found.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(found.dispatch_attempts).toBe(0);
    expect(found.next_attempt_at).toBeInstanceOf(Date);
    expect(found.created_at).toBeInstanceOf(Date);
    expect(found.updated_at).toBeInstanceOf(Date);
    expect(found.dispatched_at).toBeNull();
    expect(found.locked_until).toBeNull();
    expect(found.lock_token).toBeNull();
    expect(found.last_error).toBeNull();
    expect(found.completed_at).toBeNull();
    await expect(
      outbox.save({
        video_id: video.id,
        event_type: 'video.upload.completed',
        schema_version: 1,
      }),
    ).rejects.toMatchObject({ driverError: { code: '23505' } });
  });

  it('should reject an intent without an existing video', async () => {
    await expect(
      outbox.save({
        video_id: randomUUID(),
        event_type: 'video.upload.completed',
        schema_version: 1,
      }),
    ).rejects.toMatchObject({
      driverError: {
        code: '23503',
        constraint: 'FK_video_processing_outbox_video',
      },
    });
  });

  it('should load both relation directions and cascade only the outbox when deleting a video', async () => {
    const video = await createVideoFixture(source);
    const saved = await outbox.save({
      video_id: video.id,
      event_type: 'video.upload.completed',
      schema_version: 1,
    });
    const loadedVideo = await source.getRepository(Video).findOneOrFail({
      where: { id: video.id },
      relations: { processingOutbox: true },
    });
    const loadedOutbox = await outbox.findOneOrFail({
      where: { id: saved.id },
      relations: { video: true },
    });
    expect(loadedVideo.processingOutbox?.id).toBe(saved.id);
    expect(loadedOutbox.video.id).toBe(video.id);
    await source.getRepository(Video).delete(video.id);
    expect(await outbox.existsBy({ id: saved.id })).toBe(false);
    const channels = await source.query<{ count: string }[]>(
      'SELECT count(*)::text AS count FROM channels',
    );
    expect(channels[0].count).toBe('1');
  });

  it.each([
    ['event_type', 'unknown.event', 'CK_video_processing_outbox_event_type'],
    ['schema_version', 2, 'CK_video_processing_outbox_schema_version'],
    ['dispatch_attempts', -1, 'CK_video_processing_outbox_dispatch_attempts'],
  ])('should reject invalid %s', async (field, value, constraint) => {
    const video = await createVideoFixture(source);
    const saved = await outbox.save({
      video_id: video.id,
      event_type: 'video.upload.completed',
      schema_version: 1,
    });
    await expect(
      outbox
        .createQueryBuilder()
        .update()
        .set({ [field]: value })
        .where('id = :id', { id: saved.id })
        .execute(),
    ).rejects.toMatchObject({ driverError: { code: '23514', constraint } });
  });

  it('should preserve claim, dispatch and completion timestamps with timezone precision', async () => {
    const video = await createVideoFixture(source);
    const now = new Date();
    const token = randomUUID();
    const saved = await outbox.save({
      video_id: video.id,
      event_type: 'video.upload.completed',
      schema_version: 1,
      lock_token: token,
      locked_until: now,
      next_attempt_at: now,
      dispatched_at: now,
      completed_at: now,
      dispatch_attempts: 2,
      last_error: 'Temporary dispatch failure',
    });
    const found = await outbox.findOneByOrFail({ id: saved.id });
    expect(found.lock_token).toBe(token);
    for (const field of [
      'locked_until',
      'next_attempt_at',
      'dispatched_at',
      'completed_at',
    ] as const)
      expect(found[field]).toEqual(now);
    expect(found.dispatch_attempts).toBe(2);
    expect(found.last_error).toBe('Temporary dispatch failure');
  });
});
