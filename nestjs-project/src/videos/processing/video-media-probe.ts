import type { VideoMetadata } from '../entities/video.entity';
import { VideoMediaError } from './video-media.error';

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function rate(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d+\/\d+$/.test(value)) return null;
  const [n, d] = value.split('/').map(Number);
  const result = n / d;
  return Number.isFinite(result) && result > 0 ? result : null;
}
export function normalizeVideoProbe(value: unknown): {
  durationSeconds: number;
  metadata: VideoMetadata;
} {
  if (
    !record(value) ||
    !record(value.format) ||
    !Array.isArray(value.streams) ||
    !value.streams.every(record)
  )
    throw new VideoMediaError('INVALID_VIDEO_CONTENT');
  const format = value.format;
  if (typeof format.format_name !== 'string')
    throw new VideoMediaError('INVALID_VIDEO_CONTENT');
  // ffprobe uses the same demuxer name for QuickTime/3GP/MP4; inspect ftyp too.
  const brand = record(format.tags) ? format.tags.major_brand : undefined;
  if (
    !format.format_name.split(',').includes('mp4') ||
    typeof brand !== 'string' ||
    !/^(?:isom|iso[2-9]|mp4[12]|avc1|dash|M4V |M4VH|M4VP|MSNV)$/.test(brand)
  )
    throw new VideoMediaError('UNSUPPORTED_VIDEO_FORMAT');
  const streams: Record<string, unknown>[] = value.streams;
  const videos = streams.filter((stream) => stream.codec_type === 'video');
  const audio = streams.filter((stream) => stream.codec_type === 'audio');
  if (videos.length === 0) throw new VideoMediaError('INVALID_VIDEO_CONTENT');
  if (
    videos.length !== 1 ||
    videos[0].codec_name !== 'h264' ||
    audio.some((stream) => stream.codec_name !== 'aac') ||
    videos.length + audio.length !== streams.length
  )
    throw new VideoMediaError('UNSUPPORTED_VIDEO_FORMAT');
  const video = videos[0];
  if (
    (typeof format.duration !== 'string' &&
      typeof format.duration !== 'number') ||
    String(format.duration).trim() === ''
  )
    throw new VideoMediaError('INVALID_VIDEO_CONTENT');
  const durationSeconds = Number(format.duration);
  if (
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0 ||
    typeof video.width !== 'number' ||
    !Number.isSafeInteger(video.width) ||
    video.width <= 0 ||
    typeof video.height !== 'number' ||
    !Number.isSafeInteger(video.height) ||
    video.height <= 0
  )
    throw new VideoMediaError('INVALID_VIDEO_CONTENT');
  return {
    durationSeconds,
    metadata: {
      container: 'mp4',
      videoCodec: 'h264',
      audioCodec: audio.length ? 'aac' : null,
      width: video.width,
      height: video.height,
      frameRate: rate(video.avg_frame_rate),
    },
  };
}
