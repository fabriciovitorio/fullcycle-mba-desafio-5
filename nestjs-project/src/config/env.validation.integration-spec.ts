import { envValidationSchema } from './env.validation';
import type { ValidationError } from 'joi';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import storageConfig from './storage.config';
import { TEST_STORAGE_ENV } from '../test/video-environment.fixture';

const requiredEnv = {
  ...TEST_STORAGE_ENV,
  DB_USERNAME: 'user',
  DB_PASSWORD: 'pass',
  DB_NAME: 'db',
  JWT_SECRET: 'secret',
  JWT_REFRESH_SECRET: 'refresh-secret',
};

function validate(env: Record<string, string | undefined>): {
  value: unknown;
  error?: ValidationError;
} {
  const result = envValidationSchema.validate(
    { ...requiredEnv, ...env },
    { allowUnknown: true, abortEarly: false },
  );
  // Joi's failure branch exposes any even with a generic ValidationResult.
  const value: unknown = result.value;
  return { value, error: result.error };
}

describe('envValidationSchema — SWAGGER_ENABLED', () => {
  it('should reject SWAGGER_ENABLED with an invalid value', () => {
    const { error } = validate({ SWAGGER_ENABLED: 'invalid' });
    expect(error).toBeDefined();
    expect(error!.message).toContain('SWAGGER_ENABLED');
  });

  it('should accept SWAGGER_ENABLED=true', () => {
    const { error } = validate({ SWAGGER_ENABLED: 'true' });
    expect(error).toBeUndefined();
  });

  it('should accept SWAGGER_ENABLED=false', () => {
    const { error } = validate({ SWAGGER_ENABLED: 'false' });
    expect(error).toBeUndefined();
  });

  it('should apply default false when SWAGGER_ENABLED is not set', () => {
    const { value, error } = validate({});
    expect(error).toBeUndefined();
    expect(value).toHaveProperty('SWAGGER_ENABLED', 'false');
  });
});

describe('envValidationSchema — video infrastructure', () => {
  const originalEnv = process.env;
  afterEach(() => {
    process.env = originalEnv;
  });

  it.each(Object.keys(TEST_STORAGE_ENV))(
    'rejects a missing required %s',
    (key) => {
      const { error } = validate({ [key]: undefined });
      expect(error?.message).toContain(key);
    },
  );

  it.each([
    ['STORAGE_ENDPOINT', 'not-a-url'],
    ['STORAGE_ENDPOINT', 'http://localhost:9000'],
    ['STORAGE_ENDPOINT', 'http://127.0.0.1:9000'],
    ['STORAGE_PUBLIC_ENDPOINT', 'ftp://media.example.test'],
    [
      'STORAGE_PUBLIC_ENDPOINT',
      'https://username:do-not-print@media.example.test',
    ],
    ['STORAGE_BUCKET', 'Invalid_Bucket'],
    ['STORAGE_BUCKET', 'bucket..invalid'],
    ['STORAGE_BUCKET', '127.0.0.1'],
    ['STORAGE_FORCE_PATH_STYLE', 'yes'],
    ['DB_HOST', 'localhost'],
    ['REDIS_HOST', '127.0.0.1'],
    ['REDIS_PORT', '70000'],
    ['VIDEO_QUEUE_PREFIX', 'prefix with space'],
    ['VIDEO_UPLOAD_TTL_SECONDS', '0'],
    ['VIDEO_SIGNED_URL_TTL_SECONDS', '901'],
    ['VIDEO_WORKER_CONCURRENCY', '1.5'],
    ['VIDEO_FFMPEG_THREADS', '0'],
    ['VIDEO_PROBE_TIMEOUT_MS', '-1'],
    ['VIDEO_PROCESSING_TIMEOUT_MS', 'not-a-number'],
    ['VIDEO_PROCESSING_LEASE_MS', '0'],
    ['VIDEO_PROCESSING_HEARTBEAT_INTERVAL_MS', '60000'],
    ['VIDEO_CLEANUP_GRACE_SECONDS', '0'],
    ['VIDEO_TEMP_DIRECTORY', 'relative-directory'],
  ])('rejects invalid %s without printing credentials', (key, value) => {
    const { error } = validate({ [key]: value });
    expect(error?.message).toContain(key);
    expect(error?.message).not.toContain(TEST_STORAGE_ENV.STORAGE_SECRET_KEY);
    expect(error?.message).not.toContain('do-not-print');
  });

  it('accepts required values with optional Redis password and operational settings', () => {
    expect(validate({}).error).toBeUndefined();
    expect(
      validate({
        STORAGE_FORCE_PATH_STYLE: 'false',
        REDIS_PASSWORD: '',
        VIDEO_QUEUE_PREFIX: 'streamtube:test',
        VIDEO_SIGNED_URL_TTL_SECONDS: '900',
      }).error,
    ).toBeUndefined();
  });

  it('rejects a lease shorter than the default heartbeat', () => {
    const { error } = validate({ VIDEO_PROCESSING_LEASE_MS: '5000' });
    expect(error?.message).toContain('VIDEO_PROCESSING_HEARTBEAT_INTERVAL_MS');
  });

  it('fails actual configuration bootstrap for a missing bucket without loading fallback secrets', async () => {
    process.env = { ...originalEnv, ...requiredEnv };
    delete process.env.STORAGE_BUCKET;
    const createModule = async (): Promise<void> => {
      const module = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({
            ignoreEnvFile: true,
            validationSchema: envValidationSchema,
            validationOptions: { allowUnknown: true, abortEarly: false },
            load: [storageConfig],
          }),
        ],
      }).compile();
      await module.close();
    };
    await expect(createModule()).rejects.toThrow('STORAGE_BUCKET');
  });
});
