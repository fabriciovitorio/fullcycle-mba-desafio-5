import { randomUUID } from 'node:crypto';
import type { TestingModule } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { Channel } from '../../channels/entities/channel.entity';
import { cleanAllTables } from '../../test/create-test-data-source';
import {
  createVideoFixture,
  createVideoPersistenceTestModule,
  VIDEO_TEST_METADATA,
} from '../../test/video-persistence.fixture';
import { Video } from './video.entity';

describe('Video entity (integration)', () => {
  let module: TestingModule;
  let source: DataSource;
  let videos: Repository<Video>;

  beforeAll(async () => {
    module = await createVideoPersistenceTestModule();
    source = module.get(DataSource);
    videos = source.getRepository(Video);
  });

  beforeEach(async () => cleanAllTables(source));
  afterAll(async () => {
    if (source?.isInitialized) await cleanAllTables(source);
    if (module) await module.close();
  });

  it('should persist a draft with bigint strings, timestamps and attempt defaults', async () => {
    const saved = await createVideoFixture(source, {
      declared_size_bytes: '10000000000',
    });
    const found = await videos.findOneByOrFail({ id: saved.id });
    expect(found.status).toBe('draft');
    expect(found.declared_size_bytes).toBe('10000000000');
    expect(found.actual_size_bytes).toBeNull();
    expect(found.processing_attempts).toBe(0);
    expect(found.created_at).toBeInstanceOf(Date);
    expect(found.updated_at).toBeInstanceOf(Date);
    expect(found.upload_expires_at.getTime()).toBe(
      saved.upload_expires_at.getTime(),
    );
  });

  it('should reject a video without an existing channel', async () => {
    await expect(
      createVideoFixture(source, { channel_id: randomUUID() }),
    ).rejects.toMatchObject({
      driverError: { code: '23503', constraint: 'FK_videos_channel' },
    });
  });

  it.each(['slug', 'source_key'] as const)(
    'should reject duplicate %s',
    async (field) => {
      const saved = await createVideoFixture(source);
      await expect(
        createVideoFixture(source, { [field]: saved[field] }),
      ).rejects.toMatchObject({
        driverError: { code: '23505', constraint: `UQ_videos_${field}` },
      });
    },
  );

  it('should protect a channel with videos from deletion and load inverse relations explicitly', async () => {
    const saved = await createVideoFixture(source);
    const channel = await source.getRepository(Channel).findOneOrFail({
      where: { id: saved.channel_id },
      relations: { videos: true },
    });
    expect(channel.videos.map((video) => video.id)).toEqual([saved.id]);
    const video = await videos.findOneOrFail({
      where: { id: saved.id },
      relations: { channel: true },
    });
    expect(video.channel.id).toBe(channel.id);
    await expect(
      source.getRepository(Channel).delete(channel.id),
    ).rejects.toMatchObject({
      driverError: { code: '23503', constraint: 'FK_videos_channel' },
    });
  });

  it('should hide the upload id by default and allow an explicit internal selection', async () => {
    const saved = await createVideoFixture(source, {
      upload_id: 'private-multipart-id',
    });
    expect(
      (await videos.findOneByOrFail({ id: saved.id })).upload_id,
    ).toBeUndefined();
    const internal = await videos
      .createQueryBuilder('video')
      .addSelect('video.upload_id')
      .where('video.id = :id', { id: saved.id })
      .getOneOrFail();
    expect(internal.upload_id).toBe('private-multipart-id');
  });

  it.each([
    ['declared_size_bytes', '0', 'CK_videos_declared_size'],
    ['declared_size_bytes', '10000000001', 'CK_videos_declared_size'],
    ['actual_size_bytes', '999', 'CK_videos_actual_size'],
    ['status', 'published', 'CK_videos_status'],
    ['slug', 'A'.repeat(24), 'CK_videos_slug'],
    ['title', ' ', 'CK_videos_title'],
    ['title', ' untrimmed ', 'CK_videos_title'],
    ['upload_operation', 'unknown', 'CK_videos_upload_operation'],
    ['processing_attempts', -1, 'CK_videos_processing_attempts'],
    ['duration_seconds', 0, 'CK_videos_duration'],
    ['duration_seconds', Number.POSITIVE_INFINITY, 'CK_videos_duration'],
    ['duration_seconds', Number.NaN, 'CK_videos_duration'],
  ])('should enforce %s invariant for %s', async (field, value, constraint) => {
    const saved = await createVideoFixture(source);
    await expect(
      videos
        .createQueryBuilder()
        .update()
        .set({ [field]: value })
        .where('id = :id', { id: saved.id })
        .execute(),
    ).rejects.toMatchObject({ driverError: { code: '23514', constraint } });
  });

  it('should persist processing and error states with their operational timestamps', async () => {
    const lease = new Date(Date.now() + 60000);
    const saved = await createVideoFixture(source, {
      status: 'processing',
      processing_token: randomUUID(),
      processing_lease_until: lease,
      upload_operation: 'completing',
      operation_token: randomUUID(),
      operation_expires_at: lease,
    });
    const found = await videos.findOneByOrFail({ id: saved.id });
    expect(found.processing_lease_until).toEqual(lease);
    expect(found.operation_expires_at).toEqual(lease);
    await videos.update(saved.id, {
      status: 'error',
      error_code: 'PROCESSING_FAILED',
      error_message: 'Processing failed',
    });
    expect((await videos.findOneByOrFail({ id: saved.id })).status).toBe(
      'error',
    );
  });

  it.each([null, '', '   '])(
    'should reject error state without a nonempty code (%s)',
    async (error_code) => {
      await expect(
        createVideoFixture(source, { status: 'error', error_code }),
      ).rejects.toMatchObject({
        driverError: { code: '23514', constraint: 'CK_videos_error' },
      });
    },
  );

  it('should persist ready metadata and original byte size without losing precision', async () => {
    const saved = await createVideoFixture(source, {
      status: 'ready',
      declared_size_bytes: '10000000000',
      actual_size_bytes: '10000000000',
      duration_seconds: 1.25,
      metadata: VIDEO_TEST_METADATA,
      playback_key: 'videos/attempt/playback.mp4',
      thumbnail_key: 'videos/attempt/thumbnail.jpg',
    });
    const found = await videos.findOneByOrFail({ id: saved.id });
    expect(found.actual_size_bytes).toBe('10000000000');
    expect(found.metadata).toEqual(VIDEO_TEST_METADATA);
    expect(found.duration_seconds).toBe(1.25);
  });

  it.each([
    'actual_size_bytes',
    'duration_seconds',
    'metadata',
    'playback_key',
    'thumbnail_key',
  ] as const)('should reject ready without %s', async (field) => {
    await expect(
      createVideoFixture(source, {
        status: 'ready',
        actual_size_bytes: '1000',
        duration_seconds: 1,
        metadata: VIDEO_TEST_METADATA,
        playback_key: 'playback.mp4',
        thumbnail_key: 'thumbnail.jpg',
        [field]: null,
      }),
    ).rejects.toMatchObject({
      driverError: { code: '23514', constraint: 'CK_videos_ready' },
    });
  });

  it.each([
    JSON.stringify({
      ...VIDEO_TEST_METADATA,
      rawProbe: 'must not be persisted',
    }),
    JSON.stringify({ ...VIDEO_TEST_METADATA, width: 0 }),
    JSON.stringify({ ...VIDEO_TEST_METADATA, height: 1.5 }),
    JSON.stringify({ ...VIDEO_TEST_METADATA, frameRate: -1 }),
    JSON.stringify({ container: 'mp4' }),
    'null',
    '[]',
  ])(
    'should reject metadata outside the limited shape (%s)',
    async (metadata) => {
      const saved = await createVideoFixture(source);
      await expect(
        source.query('UPDATE videos SET metadata = $1::jsonb WHERE id = $2', [
          metadata,
          saved.id,
        ]),
      ).rejects.toMatchObject({
        driverError: { code: '23514', constraint: 'CK_videos_metadata' },
      });
    },
  );

  it('should allow unavailable audio codec and frame rate in the limited metadata object', async () => {
    const metadata = {
      ...VIDEO_TEST_METADATA,
      audioCodec: null,
      frameRate: null,
    };
    const saved = await createVideoFixture(source, { metadata });
    expect((await videos.findOneByOrFail({ id: saved.id })).metadata).toEqual(
      metadata,
    );
  });
});
