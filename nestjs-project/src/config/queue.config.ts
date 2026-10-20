import { registerAs } from '@nestjs/config';
import type { QueueOptions } from 'bullmq';
import { VIDEO_QUEUE } from '../videos/videos.constants';

export default registerAs(
  'queue',
  () =>
    ({
      name: VIDEO_QUEUE.NAME,
      jobName: VIDEO_QUEUE.JOB_NAME,
      connection: {
        host: process.env.REDIS_HOST ?? 'redis',
        port: Number(process.env.REDIS_PORT ?? 6379),
        password: process.env.REDIS_PASSWORD || undefined,
      },
      prefix: process.env.VIDEO_QUEUE_PREFIX ?? VIDEO_QUEUE.DEFAULT_PREFIX,
      defaultJobOptions: {
        attempts: VIDEO_QUEUE.MAX_ATTEMPTS,
        backoff: { type: 'exponential', delay: VIDEO_QUEUE.BACKOFF_DELAY_MS },
      },
    }) satisfies QueueOptions & { name: string; jobName: string },
);
