import { randomBytes, randomUUID } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { DataSource, DeepPartial } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { Channel } from '../channels/entities/channel.entity';
import { Video, type VideoMetadata } from '../videos/entities/video.entity';
import { VideosPersistenceModule } from '../videos/videos-persistence.module';
import { createTestDataSource } from './create-test-data-source';
import { TEST_ENTITIES } from './test-entities';
import {
  VIDEO_SLUG_FACTORY,
  type VideoSlugFactory,
} from '../videos/videos.constants';

export const VIDEO_TEST_METADATA: VideoMetadata = {
  container: 'mp4',
  videoCodec: 'h264',
  audioCodec: 'aac',
  width: 1920,
  height: 1080,
  frameRate: 30,
};

export async function createVideoPersistenceTestModule(
  slugFactory?: VideoSlugFactory,
): Promise<TestingModule> {
  const builder = Test.createTestingModule({
    imports: [
      TypeOrmModule.forRoot(createTestDataSource(TEST_ENTITIES).options),
      VideosPersistenceModule,
    ],
  });
  if (slugFactory)
    builder.overrideProvider(VIDEO_SLUG_FACTORY).useValue(slugFactory);
  return builder.compile();
}

export async function createVideoFixture(
  dataSource: DataSource,
  overrides: DeepPartial<Video> = {},
): Promise<Video> {
  const id = randomUUID();
  const user = await dataSource.getRepository(User).save({
    email: `video-${id}@example.com`,
    password: 'video-test-only',
  });
  const channel = await dataSource.getRepository(Channel).save({
    name: 'Video test channel',
    nickname: `video-${id}`,
    user_id: user.id,
  });
  return dataSource.getRepository(Video).save({
    id,
    channel_id: channel.id,
    slug: randomBytes(12).toString('hex'),
    title: 'Video test',
    original_file_name: 'video.mp4',
    declared_content_type: 'video/mp4',
    declared_size_bytes: '1000',
    source_key: `videos/${id}/source`,
    upload_expires_at: new Date(Date.now() + 86400000),
    ...overrides,
  });
}
