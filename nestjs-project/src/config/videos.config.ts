import { registerAs } from '@nestjs/config';
import { VIDEO_DEFAULTS, VIDEO_LIMITS } from '../videos/videos.constants';

export default registerAs('videos', () => ({
  maxSizeBytes: VIDEO_LIMITS.MAX_SIZE_BYTES,
  partSizeBytes: VIDEO_LIMITS.PART_SIZE_BYTES,
  maxPartsPerRequest: VIDEO_LIMITS.MAX_PARTS_PER_REQUEST,
  maxProbeOutputBytes: VIDEO_LIMITS.MAX_PROBE_OUTPUT_BYTES,
  uploadTtlSeconds: Number(
    process.env.VIDEO_UPLOAD_TTL_SECONDS ?? VIDEO_DEFAULTS.UPLOAD_TTL_SECONDS,
  ),
  signedUrlTtlSeconds: Number(
    process.env.VIDEO_SIGNED_URL_TTL_SECONDS ??
      VIDEO_DEFAULTS.SIGNED_URL_TTL_SECONDS,
  ),
  workerConcurrency: Number(
    process.env.VIDEO_WORKER_CONCURRENCY ?? VIDEO_DEFAULTS.WORKER_CONCURRENCY,
  ),
  ffmpegThreads: Number(
    process.env.VIDEO_FFMPEG_THREADS ?? VIDEO_DEFAULTS.FFMPEG_THREADS,
  ),
  probeTimeoutMs: Number(
    process.env.VIDEO_PROBE_TIMEOUT_MS ?? VIDEO_DEFAULTS.PROBE_TIMEOUT_MS,
  ),
  processingTimeoutMs: Number(
    process.env.VIDEO_PROCESSING_TIMEOUT_MS ??
      VIDEO_DEFAULTS.PROCESSING_TIMEOUT_MS,
  ),
  processingLeaseMs: Number(
    process.env.VIDEO_PROCESSING_LEASE_MS ?? VIDEO_DEFAULTS.PROCESSING_LEASE_MS,
  ),
  processingHeartbeatIntervalMs: Number(
    process.env.VIDEO_PROCESSING_HEARTBEAT_INTERVAL_MS ??
      VIDEO_DEFAULTS.PROCESSING_HEARTBEAT_INTERVAL_MS,
  ),
  cleanupGraceSeconds: Number(
    process.env.VIDEO_CLEANUP_GRACE_SECONDS ??
      VIDEO_DEFAULTS.CLEANUP_GRACE_SECONDS,
  ),
  tempDirectory:
    process.env.VIDEO_TEMP_DIRECTORY ?? VIDEO_DEFAULTS.TEMP_DIRECTORY,
}));
