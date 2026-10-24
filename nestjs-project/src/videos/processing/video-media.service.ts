import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import videosConfig from '../../config/videos.config';
import { VideoMediaFiles } from './video-media-files';
import { VideoMediaProcess } from './video-media-process';
import { normalizeVideoProbe } from './video-media-probe';
import {
  VideoMediaCancelledError,
  VideoMediaError,
  assertMediaActive,
} from './video-media.error';
import {
  VIDEO_MEDIA,
  type VideoMediaResult,
  type VideoMediaWorkspace,
} from './video-media.constants';

@Injectable()
export class VideoMediaService {
  private readonly active = new Set<VideoMediaWorkspace>();
  constructor(
    @Inject(videosConfig.KEY)
    private readonly config: ConfigType<typeof videosConfig>,
    private readonly files: VideoMediaFiles,
    private readonly process: VideoMediaProcess,
  ) {}
  async createWorkspace(
    expectedBytes: number,
    signal?: AbortSignal,
  ): Promise<VideoMediaWorkspace> {
    return this.files.create(expectedBytes, signal);
  }
  async cleanup(workspace: VideoMediaWorkspace): Promise<void> {
    if (this.active.has(workspace))
      throw new VideoMediaError('PROCESSING_FAILED');
    await this.files.cleanup(workspace);
  }
  async prepare(
    workspace: VideoMediaWorkspace,
    callerSignal?: AbortSignal,
  ): Promise<VideoMediaResult> {
    this.files.assertOwned(workspace);
    if (this.active.has(workspace))
      throw new VideoMediaError('PROCESSING_FAILED');
    this.active.add(workspace);
    const controller = new AbortController();
    const abort = () => controller.abort();
    let timedOut = false;
    callerSignal?.addEventListener('abort', abort, { once: true });
    if (callerSignal?.aborted) abort();
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.config.processingTimeoutMs);
    try {
      assertMediaActive(controller.signal);
      await this.files.checkSource(workspace);
      const probe = await this.process.run(
        'ffprobe',
        [
          '-v',
          'error',
          '-protocol_whitelist',
          VIDEO_MEDIA.PROTOCOLS,
          '-f',
          'mov',
          '-enable_drefs',
          '0',
          '-use_absolute_path',
          '0',
          '-threads',
          String(this.config.ffmpegThreads),
          '-show_entries',
          'format=format_name,duration:format_tags=major_brand:stream=codec_type,codec_name,width,height,avg_frame_rate',
          '-of',
          'json',
          workspace.originalPath,
        ],
        {
          signal: controller.signal,
          timeoutMs: this.config.probeTimeoutMs,
          maxStdoutBytes: this.config.maxProbeOutputBytes,
        },
      );
      let value: unknown;
      try {
        value = JSON.parse(probe.toString('utf8'));
      } catch {
        throw new VideoMediaError('INVALID_VIDEO_CONTENT');
      }
      const normalized = normalizeVideoProbe(value);
      const common = [
        '-v',
        'error',
        '-nostdin',
        '-protocol_whitelist',
        VIDEO_MEDIA.PROTOCOLS,
        '-f',
        'mov',
        '-enable_drefs',
        '0',
        '-use_absolute_path',
        '0',
        '-threads',
        String(this.config.ffmpegThreads),
        '-i',
        workspace.originalPath,
      ];
      await this.process.run(
        'ffmpeg',
        [
          ...common,
          '-map',
          '0:v:0',
          '-map',
          '0:a?',
          '-c',
          'copy',
          '-movflags',
          '+faststart',
          '-n',
          workspace.playbackPath,
        ],
        {
          signal: controller.signal,
          timeoutMs: this.config.processingTimeoutMs,
          maxStdoutBytes: 1,
        },
      );
      await this.process.run(
        'ffmpeg',
        [
          ...common,
          '-map',
          '0:v:0',
          '-frames:v',
          '1',
          '-an',
          '-threads',
          String(this.config.ffmpegThreads),
          '-filter_threads',
          '1',
          '-c:v',
          'mjpeg',
          '-f',
          'image2',
          '-update',
          '1',
          '-n',
          workspace.thumbnailPath,
        ],
        {
          signal: controller.signal,
          timeoutMs: this.config.processingTimeoutMs,
          maxStdoutBytes: 1,
        },
      );
      await this.files.checkOutputs(workspace);
      assertMediaActive(controller.signal);
      return {
        ...normalized,
        originalPath: workspace.originalPath,
        playbackPath: workspace.playbackPath,
        thumbnailPath: workspace.thumbnailPath,
      };
    } catch (error: unknown) {
      await this.files.cleanup(workspace);
      if (timedOut && !callerSignal?.aborted)
        throw new VideoMediaError('PROCESSING_TIMEOUT');
      if (
        error instanceof VideoMediaError ||
        error instanceof VideoMediaCancelledError
      )
        throw error;
      throw new VideoMediaError('PROCESSING_FAILED');
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', abort);
      this.active.delete(workspace);
    }
  }
}
