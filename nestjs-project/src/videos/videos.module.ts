import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ChannelsModule } from '../channels/channels.module';
import videosConfig from '../config/videos.config';
import { StorageModule } from '../storage/storage.module';
import { VideosPersistenceModule } from './videos-persistence.module';
import { VideoUploadCompletionService } from './video-upload-completion.service';
import { VideoUploadsService } from './video-uploads.service';
import { VideosUploadsController } from './videos-uploads.controller';

@Module({
  imports: [
    ConfigModule.forFeature(videosConfig),
    ChannelsModule,
    VideosPersistenceModule,
    StorageModule,
  ],
  controllers: [VideosUploadsController],
  providers: [VideoUploadsService, VideoUploadCompletionService],
  exports: [VideoUploadsService, VideoUploadCompletionService],
})
export class VideosModule {}
