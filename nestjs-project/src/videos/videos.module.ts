import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ChannelsModule } from '../channels/channels.module';
import videosConfig from '../config/videos.config';
import { StorageModule } from '../storage/storage.module';
import { VideosPersistenceModule } from './videos-persistence.module';
import { VideoUploadsService } from './video-uploads.service';

@Module({
  imports: [
    ConfigModule.forFeature(videosConfig),
    ChannelsModule,
    VideosPersistenceModule,
    StorageModule,
  ],
  providers: [VideoUploadsService],
  exports: [VideoUploadsService],
})
export class VideosModule {}
