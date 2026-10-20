import type { VideoStatus } from './entities/video.entity';

export interface CreateVideoUpload {
  title: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
}

export interface VideoUploadStatus {
  id: string;
  slug: string;
  status: VideoStatus;
  errorCode: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface VideoUploadSession {
  partSizeBytes: number;
  partCount: number;
  expiresAt: Date;
}

export interface VideoUploadInitialization {
  video: VideoUploadStatus;
  upload: VideoUploadSession;
}

export interface VideoUploadResume {
  video: VideoUploadStatus;
  upload: VideoUploadSession & {
    parts: { partNumber: number; sizeBytes: number; etag: string }[];
  };
}

export interface VideoUploadPermissions {
  parts: {
    partNumber: number;
    url: string;
    expiresAt: Date;
    headers: { 'Content-Length': string };
  }[];
}
