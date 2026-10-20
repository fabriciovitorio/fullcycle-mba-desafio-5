import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Video } from './entities/video.entity';
import { VideoProcessingOutbox } from './entities/video-processing-outbox.entity';
import { randomBytes } from 'node:crypto';
import { VIDEO_PERSISTENCE, VIDEO_SLUG_FACTORY } from './videos.constants';
import { VideosRepository } from './videos.repository';
import { VideoProcessingOutboxRepository } from './video-processing-outbox.repository';

@Module({
  imports: [TypeOrmModule.forFeature([Video, VideoProcessingOutbox])],
  providers: [
    {
      provide: VIDEO_SLUG_FACTORY,
      useValue: () => randomBytes(VIDEO_PERSISTENCE.SLUG_BYTES).toString('hex'),
    },
    VideoProcessingOutboxRepository,
    VideosRepository,
  ],
  exports: [TypeOrmModule, VideosRepository, VideoProcessingOutboxRepository],
})
export class VideosPersistenceModule {}
