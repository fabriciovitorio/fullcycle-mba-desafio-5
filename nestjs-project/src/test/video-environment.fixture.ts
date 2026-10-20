// Local test values only: Jest never supplies fallback credentials to application startup.
export const TEST_STORAGE_ENV = {
  STORAGE_ENDPOINT: 'http://minio:9000',
  STORAGE_PUBLIC_ENDPOINT: 'http://minio:9000',
  STORAGE_BUCKET: 'streamtube-test-videos',
  STORAGE_ACCESS_KEY: 'streamtube-test',
  STORAGE_SECRET_KEY: 'streamtube-test-secret',
} as const;
