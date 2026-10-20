import { registerAs } from '@nestjs/config';
import type { S3ClientConfig } from '@aws-sdk/client-s3';
import { requiredEnvironmentVariable } from './environment.util';

export default registerAs(
  'storage',
  () =>
    ({
      endpoint: requiredEnvironmentVariable('STORAGE_ENDPOINT'),
      publicEndpoint: requiredEnvironmentVariable('STORAGE_PUBLIC_ENDPOINT'),
      region: process.env.STORAGE_REGION ?? 'us-east-1',
      bucket: requiredEnvironmentVariable('STORAGE_BUCKET'),
      credentials: {
        accessKeyId: requiredEnvironmentVariable('STORAGE_ACCESS_KEY'),
        secretAccessKey: requiredEnvironmentVariable('STORAGE_SECRET_KEY'),
      },
      forcePathStyle:
        (process.env.STORAGE_FORCE_PATH_STYLE ?? 'true') === 'true',
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    }) satisfies S3ClientConfig & { publicEndpoint: string; bucket: string },
);
