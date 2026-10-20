import { Module } from '@nestjs/common';
import { ConfigModule, type ConfigType } from '@nestjs/config';
import { S3Client } from '@aws-sdk/client-s3';
import storageConfig from '../config/storage.config';
import videosConfig from '../config/videos.config';
import { S3StorageService } from './s3-storage.service';
import { StorageSigningService } from './storage-signing.service';
import { StorageFileTransferService } from './storage-file-transfer.service';
import { STORAGE_SIGNING } from './storage-signing.port';
import { STORAGE_FILES } from './storage-file-transfer.port';
import { STORAGE } from './storage.port';
import {
  S3_CLIENT,
  S3_STORAGE_OPTIONS,
  S3_SIGNING_CLIENT,
  S3_TRANSFER_OPTIONS,
  STORAGE_LIMITS,
} from './storage.constants';

@Module({
  imports: [
    ConfigModule.forFeature(storageConfig),
    ConfigModule.forFeature(videosConfig),
  ],
  providers: [
    {
      provide: S3_SIGNING_CLIENT,
      inject: [storageConfig.KEY],
      useFactory: (config: ConfigType<typeof storageConfig>) =>
        new S3Client({
          endpoint: config.publicEndpoint,
          region: config.region,
          credentials: config.credentials,
          forcePathStyle: config.forcePathStyle,
          requestChecksumCalculation: config.requestChecksumCalculation,
          responseChecksumValidation: config.responseChecksumValidation,
          maxAttempts: 1,
        }),
    },
    {
      provide: S3_TRANSFER_OPTIONS,
      inject: [videosConfig.KEY],
      useFactory: (config: ConfigType<typeof videosConfig>) => ({
        partSizeBytes: config.partSizeBytes,
        transferTimeoutMs: config.processingTimeoutMs,
      }),
    },
    {
      provide: S3_CLIENT,
      inject: [storageConfig.KEY],
      useFactory: (config: ConfigType<typeof storageConfig>) =>
        new S3Client({
          endpoint: config.endpoint,
          region: config.region,
          credentials: config.credentials,
          forcePathStyle: config.forcePathStyle,
          requestChecksumCalculation: config.requestChecksumCalculation,
          responseChecksumValidation: config.responseChecksumValidation,
          maxAttempts: 2,
        }),
    },
    {
      provide: S3_STORAGE_OPTIONS,
      useValue: {
        operationTimeoutMs: STORAGE_LIMITS.OPERATION_TIMEOUT_MS,
        listPartsPageSize: STORAGE_LIMITS.LIST_PARTS_PAGE_SIZE,
      },
    },
    S3StorageService,
    { provide: STORAGE, useExisting: S3StorageService },
    StorageSigningService,
    { provide: STORAGE_SIGNING, useExisting: StorageSigningService },
    StorageFileTransferService,
    { provide: STORAGE_FILES, useExisting: StorageFileTransferService },
  ],
  exports: [STORAGE, STORAGE_SIGNING, STORAGE_FILES],
})
export class StorageModule {}
