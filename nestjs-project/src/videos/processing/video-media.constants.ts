import type { VideoMetadata } from '../entities/video.entity';
export interface VideoMediaWorkspace {
  readonly directory: string;
  readonly originalPath: string;
  readonly playbackPath: string;
  readonly thumbnailPath: string;
}
export interface VideoMediaResult {
  durationSeconds: number;
  metadata: VideoMetadata;
  originalPath: string;
  playbackPath: string;
  thumbnailPath: string;
}
export const VIDEO_MEDIA = {
  DISK_RESERVE_BYTES: 16 * 1024 * 1024,
  KILL_GRACE_MS: 250,
  PROTOCOLS: 'file,pipe',
} as const;
