import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { lstat, mkdir, mkdtemp, realpath, rm, statfs } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import type { Stats } from 'node:fs';
import videosConfig from '../../config/videos.config';
import { VIDEO_LIMITS } from '../videos.constants';
import { VideoMediaError, assertMediaActive } from './video-media.error';
import { VIDEO_MEDIA, type VideoMediaWorkspace } from './video-media.constants';

function assertMediaSize(expectedBytes: number): void {
  if (
    !Number.isSafeInteger(expectedBytes) ||
    expectedBytes < 1 ||
    expectedBytes > VIDEO_LIMITS.MAX_SIZE_BYTES
  )
    throw new VideoMediaError('INVALID_VIDEO_CONTENT');
}
export function assertMediaSpace(
  availableBytes: bigint,
  expectedBytes: number,
  copies: 1 | 2,
): void {
  assertMediaSize(expectedBytes);
  if (
    availableBytes <
    BigInt(expectedBytes) * BigInt(copies) +
      BigInt(VIDEO_MEDIA.DISK_RESERVE_BYTES)
  )
    throw new VideoMediaError('PROCESSING_FAILED');
}
@Injectable()
export class VideoMediaFiles {
  private readonly owned = new Map<VideoMediaWorkspace, number>();
  private readonly closed = new WeakSet<VideoMediaWorkspace>();
  constructor(
    @Inject(videosConfig.KEY)
    private readonly config: ConfigType<typeof videosConfig>,
  ) {}

  async create(
    expectedBytes: number,
    signal?: AbortSignal,
  ): Promise<VideoMediaWorkspace> {
    assertMediaActive(signal);
    assertMediaSize(expectedBytes);
    if (!isAbsolute(this.config.tempDirectory))
      throw new VideoMediaError('PROCESSING_FAILED');
    await mkdir(this.config.tempDirectory, { recursive: true, mode: 0o700 });
    const root = await realpath(this.config.tempDirectory);
    const space = await statfs(root, { bigint: true });
    assertMediaSpace(space.bavail * space.bsize, expectedBytes, 2);
    assertMediaActive(signal);
    const directory = await mkdtemp(join(root, 'attempt-'));
    const workspace = Object.freeze({
      directory,
      originalPath: join(directory, 'original.mp4'),
      playbackPath: join(directory, 'playback.mp4'),
      thumbnailPath: join(directory, 'thumbnail.jpg'),
    });
    this.owned.set(workspace, expectedBytes);
    if (signal?.aborted) {
      await this.cleanup(workspace);
      assertMediaActive(signal);
    }
    return workspace;
  }
  assertOwned(workspace: VideoMediaWorkspace): number {
    const size = this.owned.get(workspace);
    if (size === undefined) throw new VideoMediaError('PROCESSING_FAILED');
    return size;
  }
  async checkSource(workspace: VideoMediaWorkspace): Promise<void> {
    const expected = this.assertOwned(workspace);
    const directory = await lstat(workspace.directory);
    if (!directory.isDirectory() || directory.isSymbolicLink())
      throw new VideoMediaError('INVALID_VIDEO_CONTENT');
    const source = await lstat(workspace.originalPath);
    if (!source.isFile() || source.isSymbolicLink() || source.size !== expected)
      throw new VideoMediaError('INVALID_VIDEO_CONTENT');
    const space = await statfs(workspace.directory, { bigint: true });
    assertMediaSpace(space.bavail * space.bsize, expected, 1);
  }
  async checkOutputs(workspace: VideoMediaWorkspace): Promise<void> {
    this.assertOwned(workspace);
    for (const path of [workspace.playbackPath, workspace.thumbnailPath]) {
      let file: Stats;
      try {
        file = await lstat(path);
      } catch {
        throw new VideoMediaError('INVALID_VIDEO_CONTENT');
      }
      if (!file.isFile() || file.isSymbolicLink() || file.size < 1)
        throw new VideoMediaError('INVALID_VIDEO_CONTENT');
    }
  }
  async cleanup(workspace: VideoMediaWorkspace): Promise<void> {
    if (this.closed.has(workspace)) return;
    this.assertOwned(workspace);
    await rm(workspace.directory, { recursive: true, force: true });
    this.owned.delete(workspace);
    this.closed.add(workspace);
  }
}
