export const S3_CLIENT = Symbol('S3_CLIENT');
export const S3_SIGNING_CLIENT = Symbol('S3_SIGNING_CLIENT');
export const S3_TRANSFER_OPTIONS = Symbol('S3_TRANSFER_OPTIONS');
export const S3_STORAGE_OPTIONS = Symbol('S3_STORAGE_OPTIONS');
export const STORAGE_LIMITS = {
  OPERATION_TIMEOUT_MS: 30_000,
  LIST_PARTS_PAGE_SIZE: 1000,
  MAX_MULTIPART_PARTS: 10_000,
  MIN_PART_SIZE_BYTES: 5 * 1024 * 1024,
  MAX_PART_SIZE_BYTES: 5 * 1024 * 1024 * 1024,
  STREAM_HIGH_WATER_MARK: 64 * 1024,
} as const;
export interface S3StorageOptions {
  operationTimeoutMs: number;
  listPartsPageSize: number;
}

export interface S3TransferOptions {
  partSizeBytes: number;
  transferTimeoutMs: number;
}
