import { ConfigModule, type ConfigType } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import storageConfig from './storage.config';
import { TEST_STORAGE_ENV } from '../test/video-environment.fixture';

async function loadStorage(): Promise<ConfigType<typeof storageConfig>> {
  const module = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ ignoreEnvFile: true, load: [storageConfig] }),
    ],
  }).compile();
  try {
    return module.get<ConfigType<typeof storageConfig>>(storageConfig.KEY);
  } finally {
    await module.close();
  }
}

describe('storageConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, ...TEST_STORAGE_ENV };
    delete process.env.STORAGE_REGION;
    delete process.env.STORAGE_FORCE_PATH_STYLE;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('loads the namespace with private bucket settings and MinIO-compatible defaults', async () => {
    const config = await loadStorage();
    expect(config.region).toBe('us-east-1');
    expect(config.forcePathStyle).toBe(true);
    expect(config.bucket).toBe('streamtube-test-videos');
    expect(config.credentials).toEqual({
      accessKeyId: TEST_STORAGE_ENV.STORAGE_ACCESS_KEY,
      secretAccessKey: TEST_STORAGE_ENV.STORAGE_SECRET_KEY,
    });
    expect(config.requestChecksumCalculation).toBe('WHEN_REQUIRED');
    expect(config.responseChecksumValidation).toBe('WHEN_REQUIRED');
  });

  it('keeps the internal I/O endpoint separate from the externally signed endpoint', async () => {
    process.env.STORAGE_PUBLIC_ENDPOINT = 'https://media.example.test';
    const config = await loadStorage();
    expect(config.endpoint).toBe('http://minio:9000');
    expect(config.publicEndpoint).toBe('https://media.example.test');
  });

  it('honors region and an explicit false path-style setting', async () => {
    process.env.STORAGE_REGION = 'sa-east-1';
    process.env.STORAGE_FORCE_PATH_STYLE = 'false';
    const config = await loadStorage();
    expect(config.region).toBe('sa-east-1');
    expect(config.forcePathStyle).toBe(false);
  });

  it('fails when an isolated factory has no required secret', async () => {
    delete process.env.STORAGE_SECRET_KEY;
    await expect(loadStorage()).rejects.toThrow('STORAGE_SECRET_KEY');
  });
});
