import { ConfigModule, type ConfigType } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import queueConfig from './queue.config';
import videosConfig from './videos.config';

async function loadConfiguration(): Promise<{
  queue: ConfigType<typeof queueConfig>;
  videos: ConfigType<typeof videosConfig>;
}> {
  const module = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        ignoreEnvFile: true,
        load: [queueConfig, videosConfig],
      }),
    ],
  }).compile();
  try {
    return {
      queue: module.get<ConfigType<typeof queueConfig>>(queueConfig.KEY),
      videos: module.get<ConfigType<typeof videosConfig>>(videosConfig.KEY),
    };
  } finally {
    await module.close();
  }
}

describe('queueConfig and videosConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('VIDEO_') || key.startsWith('REDIS_'))
        delete process.env[key];
    }
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('uses the Compose Redis service and the planned queue/retry contract', async () => {
    const { queue } = await loadConfiguration();
    expect(queue.connection).toEqual({
      host: 'redis',
      port: 6379,
      password: undefined,
    });
    expect(queue.prefix).toBe('streamtube');
    expect(queue.name).toBe('video-processing');
    expect(queue.jobName).toBe('process-video');
    expect(queue.defaultJobOptions).toEqual({
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
    });
  });

  it('isolates queue keys and accepts an optional Redis password', async () => {
    process.env.REDIS_HOST = 'redis-test';
    process.env.REDIS_PORT = '6380';
    process.env.REDIS_PASSWORD = 'local-test-password';
    process.env.VIDEO_QUEUE_PREFIX = 'streamtube:test';
    const { queue } = await loadConfiguration();
    expect(queue.connection).toEqual({
      host: 'redis-test',
      port: 6380,
      password: 'local-test-password',
    });
    expect(queue.prefix).toBe('streamtube:test');
  });

  it('loads the fixed upload contract and bounded default processing settings', async () => {
    const { videos } = await loadConfiguration();
    expect(videos.maxSizeBytes).toBe(10_000_000_000);
    expect(videos.partSizeBytes).toBe(67_108_864);
    expect(videos.maxPartsPerRequest).toBe(50);
    expect(videos.maxProbeOutputBytes).toBe(1_048_576);
    expect(videos.uploadTtlSeconds).toBe(86400);
    expect(videos.signedUrlTtlSeconds).toBe(900);
    expect(videos.workerConcurrency).toBe(1);
    expect(videos.ffmpegThreads).toBe(1);
    expect(videos.probeTimeoutMs).toBe(60000);
    expect(videos.processingTimeoutMs).toBe(3600000);
    expect(videos.processingLeaseMs).toBe(60000);
    expect(videos.processingHeartbeatIntervalMs).toBe(10000);
    expect(videos.cleanupGraceSeconds).toBe(86400);
    expect(videos.tempDirectory).toBe('/tmp/streamtube-videos');
  });

  it('changes operational values without allowing the public 10GB or part-size contract to grow', async () => {
    process.env.VIDEO_UPLOAD_TTL_SECONDS = '3600';
    process.env.VIDEO_SIGNED_URL_TTL_SECONDS = '60';
    process.env.VIDEO_PROCESSING_TIMEOUT_MS = '7200000';
    process.env.VIDEO_PROBE_TIMEOUT_MS = '6e4';
    process.env.VIDEO_WORKER_CONCURRENCY = '2';
    process.env.VIDEO_FFMPEG_THREADS = '2';
    process.env.VIDEO_PROCESSING_LEASE_MS = '90000';
    process.env.VIDEO_PROCESSING_HEARTBEAT_INTERVAL_MS = '15000';
    process.env.VIDEO_CLEANUP_GRACE_SECONDS = '3600';
    process.env.VIDEO_TEMP_DIRECTORY = '/tmp/streamtube-custom';
    process.env.VIDEO_MAX_SIZE_BYTES = '20000000000';
    process.env.VIDEO_PART_SIZE_BYTES = '10000000000';
    const { videos } = await loadConfiguration();
    expect(videos.maxSizeBytes).toBe(10_000_000_000);
    expect(videos.partSizeBytes).toBe(67_108_864);
    expect(videos.uploadTtlSeconds).toBe(3600);
    expect(videos.signedUrlTtlSeconds).toBe(60);
    expect(videos.processingTimeoutMs).toBe(7200000);
    expect(videos.probeTimeoutMs).toBe(60000);
    expect(videos.workerConcurrency).toBe(2);
    expect(videos.ffmpegThreads).toBe(2);
    expect(videos.processingLeaseMs).toBe(90000);
    expect(videos.processingHeartbeatIntervalMs).toBe(15000);
    expect(videos.cleanupGraceSeconds).toBe(3600);
    expect(videos.tempDirectory).toBe('/tmp/streamtube-custom');
  });
});
