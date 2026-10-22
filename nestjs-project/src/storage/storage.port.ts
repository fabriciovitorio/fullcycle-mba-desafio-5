export const STORAGE = Symbol('STORAGE');

export interface StoragePart {
  partNumber: number;
  etag: string;
  size: number;
}

export interface CompletedStoragePart {
  partNumber: number;
  etag: string;
}

export interface StorageObject {
  contentLength: number;
  etag: string;
  contentType?: string;
}

export interface StoragePort {
  createMultipartUpload(
    key: string,
    contentType: string,
    signal?: AbortSignal,
  ): Promise<string>;
  listParts(key: string, uploadId: string): Promise<StoragePart[]>;
  completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: readonly CompletedStoragePart[],
    signal?: AbortSignal,
  ): Promise<StorageObject>;
  abortMultipartUpload(key: string, uploadId: string): Promise<void>;
  headObject(key: string): Promise<StorageObject>;
  deleteObject(key: string): Promise<void>;
}
