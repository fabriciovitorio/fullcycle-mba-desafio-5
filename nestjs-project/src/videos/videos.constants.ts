export const VIDEO_LIMITS = {
  MAX_SIZE_BYTES: 10_000_000_000,
  PART_SIZE_BYTES: 64 * 1024 * 1024,
  MAX_PARTS_PER_REQUEST: 50,
  MAX_SIGNED_URL_TTL_SECONDS: 900,
  MAX_PROBE_OUTPUT_BYTES: 1024 * 1024,
} as const;

export const VIDEO_QUEUE = {
  NAME: 'video-processing',
  JOB_NAME: 'process-video',
  SCHEMA_VERSION: 1,
  MAX_ATTEMPTS: 3,
  BACKOFF_DELAY_MS: 2000,
  DEFAULT_PREFIX: 'streamtube',
} as const;

export const VIDEO_HTTP_RATE_LIMITS = {
  WINDOW_MS: 60_000,
  CREATE: 10,
  CONTROL: 120,
} as const;

export const VIDEO_SLUG_FACTORY = Symbol('VIDEO_SLUG_FACTORY');
export const VIDEO_UPLOAD = {
  OPERATION_LEASE_MS: 120_000,
  FINALIZATION_LEASE_MS: 180_000,
  COMPENSATION_WINDOW_MS: 60_000,
  INITIALIZATION_FAILURE_CODE: 'UPLOAD_INITIALIZATION_FAILED',
  INITIALIZATION_FAILURE_MESSAGE: 'Video upload could not be initialized',
} as const;
export const VIDEO_UPLOAD_FAILURES = {
  ABORTED: { code: 'UPLOAD_ABORTED', message: 'Video upload was aborted' },
  EXPIRED: { code: 'UPLOAD_EXPIRED', message: 'Video upload session expired' },
  SIZE_MISMATCH: {
    code: 'UPLOAD_SIZE_MISMATCH',
    message: 'Uploaded bytes do not match the declared size',
  },
} as const;
export const VIDEO_SAFE_ERROR_CODES = new Set<string>([
  'UPLOAD_ABORTED',
  'UPLOAD_EXPIRED',
  'UPLOAD_INITIALIZATION_FAILED',
  'UPLOAD_SIZE_MISMATCH',
  'INVALID_VIDEO_CONTENT',
  'UNSUPPORTED_VIDEO_FORMAT',
  'PROCESSING_TIMEOUT',
  'PROCESSING_FAILED',
]);
export type VideoSlugFactory = () => string;
export const VIDEO_PERSISTENCE = {
  SLUG_BYTES: 12,
  MAX_SLUG_ATTEMPTS: 5,
} as const;

export const VIDEO_DEFAULTS = {
  UPLOAD_TTL_SECONDS: 24 * 60 * 60,
  SIGNED_URL_TTL_SECONDS: 900,
  WORKER_CONCURRENCY: 1,
  FFMPEG_THREADS: 1,
  PROBE_TIMEOUT_MS: 60_000,
  PROCESSING_TIMEOUT_MS: 60 * 60 * 1000,
  PROCESSING_LEASE_MS: 60_000,
  PROCESSING_HEARTBEAT_INTERVAL_MS: 10_000,
  CLEANUP_GRACE_SECONDS: 24 * 60 * 60,
  TEMP_DIRECTORY: '/tmp/streamtube-videos',
} as const;
