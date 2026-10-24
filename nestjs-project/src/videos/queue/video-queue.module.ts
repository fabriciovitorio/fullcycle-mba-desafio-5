import { Logger, Module } from '@nestjs/common';
import { BullModule, InjectQueue } from '@nestjs/bullmq';
import { ConfigModule, type ConfigType } from '@nestjs/config';
import type { Queue } from 'bullmq';
import queueConfig from '../../config/queue.config';
import { VIDEO_QUEUE } from '../videos.constants';
import {
  VIDEO_DISPATCH,
  type VideoProcessingJob,
} from './video-queue.constants';

@Module({
  imports: [
    BullModule.registerQueueAsync({
      name: VIDEO_QUEUE.NAME,
      imports: [ConfigModule.forFeature(queueConfig)],
      inject: [queueConfig.KEY],
      useFactory: (config: ConfigType<typeof queueConfig>) => ({
        ...config,
        connection: {
          ...config.connection,
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
          connectTimeout: VIDEO_DISPATCH.READY_TIMEOUT_MS,
          commandTimeout: VIDEO_DISPATCH.COMMAND_TIMEOUT_MS,
        },
        defaultJobOptions: {
          ...config.defaultJobOptions,
          removeOnComplete: false,
          removeOnFail: false,
        },
      }),
    }),
  ],
  exports: [BullModule],
})
export class VideoQueueModule {
  private readonly logger = new Logger(VideoQueueModule.name);

  constructor(@InjectQueue(VIDEO_QUEUE.NAME) queue: Queue<VideoProcessingJob>) {
    // Queue errors can contain credentials; expose only a fixed operational log.
    queue.on('error', () => this.logger.error('Video queue connection failed'));
  }
}
