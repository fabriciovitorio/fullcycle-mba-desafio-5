import { Injectable, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { DataSource, type Repository } from 'typeorm';
import { createTestDataSource } from '../test/create-test-data-source';
import { TEST_ENTITIES } from '../test/test-entities';
import { Video } from './entities/video.entity';
import { VideoProcessingOutbox } from './entities/video-processing-outbox.entity';
import { VideosPersistenceModule } from './videos-persistence.module';

@Injectable()
class PersistenceConsumer {
  constructor(
    @InjectRepository(Video) readonly videos: Repository<Video>,
    @InjectRepository(VideoProcessingOutbox)
    readonly outbox: Repository<VideoProcessingOutbox>,
  ) {}
}

@Module({
  imports: [VideosPersistenceModule],
  providers: [PersistenceConsumer],
})
class ConsumerModule {}

describe('VideosPersistenceModule (integration)', () => {
  it('should export both real repositories to an importing module with migrated storage', async () => {
    const module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot(createTestDataSource(TEST_ENTITIES).options),
        ConsumerModule,
      ],
    }).compile();
    try {
      const consumer = module.get(PersistenceConsumer);
      const source = module.get(DataSource);
      expect(consumer.videos.target).toBe(Video);
      expect(consumer.outbox.target).toBe(VideoProcessingOutbox);
      expect(consumer.videos.manager.connection).toBe(source);
      expect(consumer.outbox.manager.connection).toBe(source);
      expect(
        source
          .getMetadata(Video)
          .relations.find((relation) => relation.propertyName === 'channel')
          ?.isCascadeInsert,
      ).toBe(false);
      expect(source.options.synchronize).toBe(false);
      expect(await source.showMigrations()).toBe(false);
      const [connection] = await source.query<{ database: string }[]>(
        'SELECT current_database() AS database',
      );
      expect(connection.database).toBe(process.env.TEST_DB_NAME);
      expect(connection.database).not.toBe(process.env.TEST_PROTECTED_DB_NAME);
      await expect(consumer.videos.count()).resolves.toBeGreaterThanOrEqual(0);
      await expect(consumer.outbox.count()).resolves.toBeGreaterThanOrEqual(0);
    } finally {
      await module.close();
    }
  });
});
