import type { StorageObject } from './storage.port';

export const STORAGE_FILES = Symbol('STORAGE_FILES');

export interface StorageFileTransferPort {
  downloadFile(
    key: string,
    destination: string,
    signal?: AbortSignal,
  ): Promise<StorageObject>;
  uploadFile(
    key: string,
    source: string,
    contentType: string,
    signal?: AbortSignal,
  ): Promise<StorageObject>;
}
