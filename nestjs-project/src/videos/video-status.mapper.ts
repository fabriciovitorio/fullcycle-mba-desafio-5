import type { Video } from './entities/video.entity';
import type { VideoUploadStatus } from './video-uploads.types';
import { VIDEO_SAFE_ERROR_CODES } from './videos.constants';

export function videoStatus(video: Video): VideoUploadStatus {
  return {
    id: video.id,
    slug: video.slug,
    status: video.status,
    errorCode:
      video.error_code && VIDEO_SAFE_ERROR_CODES.has(video.error_code)
        ? video.error_code
        : null,
    createdAt: video.created_at,
    updatedAt: video.updated_at,
  };
}
