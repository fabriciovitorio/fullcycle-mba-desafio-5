import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import videosConfig from '../../config/videos.config';
import { VideoMediaService } from './video-media.service';
import { VideoMediaFiles } from './video-media-files';
import { VideoMediaProcess } from './video-media-process';

@Module({
  imports: [ConfigModule.forFeature(videosConfig)],
  providers: [VideoMediaService, VideoMediaFiles, VideoMediaProcess],
  exports: [VideoMediaService],
})
export class VideoMediaModule {}
