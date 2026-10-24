export type VideoMediaErrorCode =
  | 'INVALID_VIDEO_CONTENT'
  | 'UNSUPPORTED_VIDEO_FORMAT'
  | 'PROCESSING_TIMEOUT'
  | 'PROCESSING_FAILED';
const MESSAGES: Record<VideoMediaErrorCode, string> = {
  INVALID_VIDEO_CONTENT: 'Video content is invalid',
  UNSUPPORTED_VIDEO_FORMAT: 'Video format is not supported',
  PROCESSING_TIMEOUT: 'Video processing timed out',
  PROCESSING_FAILED: 'Video processing failed',
};
export class VideoMediaError extends Error {
  constructor(public readonly code: VideoMediaErrorCode) {
    super(MESSAGES[code]);
    this.name = 'VideoMediaError';
  }
}
// Cancellation after lease loss is not a terminal media failure.
export class VideoMediaCancelledError extends Error {
  constructor() {
    super('Video processing was cancelled');
    this.name = 'VideoMediaCancelledError';
  }
}
export function assertMediaActive(signal?: AbortSignal): void {
  if (signal?.aborted) throw new VideoMediaCancelledError();
}
