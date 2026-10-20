export const STORAGE_SIGNING = Symbol('STORAGE_SIGNING');

export interface SignedStorageUrl {
  url: string;
  expiresAt: Date;
}

export interface SignedUploadPart extends SignedStorageUrl {
  headers: { 'Content-Length': string };
}

export interface UploadPartSigningRequest {
  key: string;
  uploadId: string;
  partNumber: number;
  sizeBytes: number;
  sessionExpiresAt: Date;
}

export interface GetObjectSigningRequest {
  key: string;
  contentType: 'video/mp4' | 'image/jpeg';
  disposition: 'inline' | 'attachment';
  fileName?: string;
}

export interface StorageSigningPort {
  signUploadPart(request: UploadPartSigningRequest): Promise<SignedUploadPart>;
  signGetObject(request: GetObjectSigningRequest): Promise<SignedStorageUrl>;
}
