import { Module } from '@nestjs/common';
import { VideosPersistenceModule } from '../videos-persistence.module';
import { VideoQueueModule } from './video-queue.module';
import { VideoOutboxDispatcher } from './video-outbox-dispatcher.service';

// Imported by the standalone worker, never by the HTTP API.
@Module({
  imports: [VideosPersistenceModule, VideoQueueModule],
  providers: [VideoOutboxDispatcher],
  exports: [VideoOutboxDispatcher],
})
export class VideoOutboxDispatcherModule {}
