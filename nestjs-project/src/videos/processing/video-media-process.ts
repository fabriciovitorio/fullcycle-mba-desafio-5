import { Injectable } from '@nestjs/common';
import { spawn } from 'node:child_process';
import {
  VideoMediaCancelledError,
  VideoMediaError,
  assertMediaActive,
} from './video-media.error';
import { VIDEO_MEDIA } from './video-media.constants';

export interface VideoMediaProcessOptions {
  signal?: AbortSignal;
  timeoutMs: number;
  maxStdoutBytes: number;
}
@Injectable()
export class VideoMediaProcess {
  async run(
    binary: 'ffmpeg' | 'ffprobe',
    args: string[],
    options: VideoMediaProcessOptions,
  ): Promise<Buffer> {
    assertMediaActive(options.signal);
    if (
      !Number.isSafeInteger(options.timeoutMs) ||
      options.timeoutMs <= 0 ||
      !Number.isSafeInteger(options.maxStdoutBytes) ||
      options.maxStdoutBytes < 1
    )
      throw new VideoMediaError('PROCESSING_FAILED');
    return new Promise<Buffer>((resolve, reject) => {
      let failure: Error | undefined;
      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(binary, args, {
          shell: false,
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        });
      } catch {
        reject(new VideoMediaError('PROCESSING_FAILED'));
        return;
      }
      const chunks: Buffer[] = [];
      let length = 0;
      let escalation: ReturnType<typeof setTimeout> | undefined;
      const terminate = (error: Error) => {
        if (failure) return;
        failure = error;
        child.kill('SIGTERM');
        escalation = setTimeout(
          () => child.kill('SIGKILL'),
          VIDEO_MEDIA.KILL_GRACE_MS,
        );
      };
      const abort = () => terminate(new VideoMediaCancelledError());
      const timer = setTimeout(
        () => terminate(new VideoMediaError('PROCESSING_TIMEOUT')),
        options.timeoutMs,
      );
      options.signal?.addEventListener('abort', abort, { once: true });
      child.stdout!.on('data', (chunk: Buffer) => {
        length += chunk.length;
        if (length > options.maxStdoutBytes)
          terminate(new VideoMediaError('INVALID_VIDEO_CONTENT'));
        else if (!failure) chunks.push(chunk);
      });
      // Drain stderr without retaining or exposing bytes: bounded memory, no secrets.
      child.stderr!.resume();
      child.once('error', () => {
        failure ??= new VideoMediaError('PROCESSING_FAILED');
      });
      child.once('close', (code) => {
        clearTimeout(timer);
        if (escalation) clearTimeout(escalation);
        options.signal?.removeEventListener('abort', abort);
        if (failure) reject(failure);
        else if (code !== 0)
          reject(new VideoMediaError('INVALID_VIDEO_CONTENT'));
        else resolve(Buffer.concat(chunks, length));
      });
      if (options.signal?.aborted) abort();
    });
  }
}
