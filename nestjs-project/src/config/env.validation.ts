import * as Joi from 'joi';
import {
  VIDEO_DEFAULTS,
  VIDEO_LIMITS,
  VIDEO_QUEUE,
} from '../videos/videos.constants';

const positiveInteger = () =>
  Joi.number().integer().min(1).max(Number.MAX_SAFE_INTEGER);

const storageEndpoint = (internal: boolean) =>
  Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .custom((value: string, helpers) => {
      let endpoint: URL;
      try {
        endpoint = new URL(value);
      } catch {
        return helpers.error('string.uri');
      }
      if (
        endpoint.username ||
        endpoint.password ||
        endpoint.search ||
        endpoint.hash ||
        (internal &&
          ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname))
      ) {
        return helpers.error('any.invalid');
      }
      return value;
    });

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().port().default(3000),
  DB_HOST: Joi.string()
    .hostname()
    .invalid('localhost', '127.0.0.1', '::1')
    .default('db'),
  DB_PORT: Joi.number().default(5432),
  DB_USERNAME: Joi.string().required(),
  DB_PASSWORD: Joi.string().required(),
  DB_NAME: Joi.string().required(),
  JWT_SECRET: Joi.string().required(),
  JWT_REFRESH_SECRET: Joi.string().required(),
  JWT_ACCESS_EXPIRATION: Joi.string().default('15m'),
  JWT_REFRESH_EXPIRATION: Joi.string().default('7d'),
  CONFIRMATION_TOKEN_EXPIRATION_HOURS: Joi.number().default(1),
  PASSWORD_RESET_TOKEN_EXPIRATION_HOURS: Joi.number().default(1),
  APP_URL: Joi.string().uri().default('http://localhost:3000'),
  MAIL_HOST: Joi.string().default('mailpit'),
  MAIL_PORT: Joi.number().default(1025),
  MAIL_FROM: Joi.string().default('"StreamTube" <noreply@streamtube.com>'),
  SWAGGER_ENABLED: Joi.string().valid('true', 'false').default('false'),
  STORAGE_ENDPOINT: storageEndpoint(true).required(),
  STORAGE_PUBLIC_ENDPOINT: storageEndpoint(false).required(),
  STORAGE_REGION: Joi.string().default('us-east-1'),
  STORAGE_BUCKET: Joi.string()
    .min(3)
    .max(63)
    .pattern(/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/)
    .pattern(/\.\.|\.-|-\./, { invert: true })
    .pattern(/^\d+\.\d+\.\d+\.\d+$/, { invert: true })
    .required(),
  STORAGE_ACCESS_KEY: Joi.string().required(),
  STORAGE_SECRET_KEY: Joi.string().required(),
  STORAGE_FORCE_PATH_STYLE: Joi.string().valid('true', 'false').default('true'),
  REDIS_HOST: Joi.string()
    .hostname()
    .invalid('localhost', '127.0.0.1', '::1')
    .default('redis'),
  REDIS_PORT: Joi.number().port().min(1).default(6379),
  REDIS_PASSWORD: Joi.string().allow('').optional(),
  VIDEO_QUEUE_PREFIX: Joi.string()
    .pattern(/^[a-zA-Z0-9:_-]+$/)
    .default(VIDEO_QUEUE.DEFAULT_PREFIX),
  VIDEO_UPLOAD_TTL_SECONDS: positiveInteger().default(
    VIDEO_DEFAULTS.UPLOAD_TTL_SECONDS,
  ),
  VIDEO_SIGNED_URL_TTL_SECONDS: positiveInteger()
    .max(VIDEO_LIMITS.MAX_SIGNED_URL_TTL_SECONDS)
    .default(VIDEO_DEFAULTS.SIGNED_URL_TTL_SECONDS),
  VIDEO_WORKER_CONCURRENCY: positiveInteger().default(
    VIDEO_DEFAULTS.WORKER_CONCURRENCY,
  ),
  VIDEO_FFMPEG_THREADS: positiveInteger().default(
    VIDEO_DEFAULTS.FFMPEG_THREADS,
  ),
  VIDEO_PROBE_TIMEOUT_MS: positiveInteger().default(
    VIDEO_DEFAULTS.PROBE_TIMEOUT_MS,
  ),
  VIDEO_PROCESSING_TIMEOUT_MS: positiveInteger().default(
    VIDEO_DEFAULTS.PROCESSING_TIMEOUT_MS,
  ),
  VIDEO_PROCESSING_LEASE_MS: positiveInteger().default(
    VIDEO_DEFAULTS.PROCESSING_LEASE_MS,
  ),
  VIDEO_PROCESSING_HEARTBEAT_INTERVAL_MS: positiveInteger()
    .less(Joi.ref('VIDEO_PROCESSING_LEASE_MS'))
    .default(VIDEO_DEFAULTS.PROCESSING_HEARTBEAT_INTERVAL_MS),
  VIDEO_CLEANUP_GRACE_SECONDS: positiveInteger().default(
    VIDEO_DEFAULTS.CLEANUP_GRACE_SECONDS,
  ),
  VIDEO_TEMP_DIRECTORY: Joi.string()
    .pattern(/^\//)
    .default(VIDEO_DEFAULTS.TEMP_DIRECTORY),
})
  .custom((value: Record<string, unknown>, helpers) => {
    // Joi does not revalidate a default against sibling refs when the default is applied.
    const heartbeat = value.VIDEO_PROCESSING_HEARTBEAT_INTERVAL_MS;
    const lease = value.VIDEO_PROCESSING_LEASE_MS;
    if (
      typeof heartbeat === 'number' &&
      typeof lease === 'number' &&
      heartbeat >= lease
    ) {
      return helpers.error('videos.heartbeat');
    }
    return value;
  })
  .messages({
    'string.pattern.base': '{{#label}} has an invalid format',
    'string.pattern.invert.base': '{{#label}} has an invalid format',
    'videos.heartbeat':
      'VIDEO_PROCESSING_HEARTBEAT_INTERVAL_MS must be less than VIDEO_PROCESSING_LEASE_MS',
  });
