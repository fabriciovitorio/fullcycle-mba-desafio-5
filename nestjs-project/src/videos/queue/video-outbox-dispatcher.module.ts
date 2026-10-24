import { Module } from '@nestjs/common';
import { VideosPersistenceModule } from '../videos-persistence.module';
import { VideoQueueModule } from './video-queue.module';
import { VideoOutboxDispatcher } from './video-outbox-dispatcher.service';
import { VideoProcessingReconciler } from './video-processing-reconciler.service';

// Imported by the standalone worker, never by the HTTP API.
@Module({
  imports: [VideosPersistenceModule, VideoQueueModule],
  providers: [VideoOutboxDispatcher, VideoProcessingReconciler],
  exports: [VideoOutboxDispatcher, VideoProcessingReconciler],
})
export class VideoOutboxDispatcherModule {}
