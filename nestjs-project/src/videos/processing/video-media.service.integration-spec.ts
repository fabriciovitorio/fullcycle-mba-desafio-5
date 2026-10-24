import { expect, jest } from '@jest/globals';
import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigModule, type ConfigType } from '@nestjs/config';
import fs from 'node:fs/promises';
import childProcess from 'node:child_process';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import videosConfig from '../../config/videos.config';
import { VideoMediaModule } from './video-media.module';
import { VideoMediaService } from './video-media.service';
import { VideoMediaProcess } from './video-media-process';
import { VideoMediaCancelledError } from './video-media.error';
import type { VideoMediaWorkspace } from './video-media.constants';

function boxes(buffer: Buffer): string[] {
  const result: string[] = [];
  let offset = 0;
  while (offset + 8 <= buffer.length) {
    let size = buffer.readUInt32BE(offset);
    if (size === 0) size = buffer.length - offset;
    if (size < 8 || offset + size > buffer.length)
      throw new Error('Invalid fixture MP4 box');
    result.push(buffer.toString('ascii', offset + 4, offset + 8));
    offset += size;
  }
  return result;
}

describe('VideoMediaService (integration)', () => {
  let root: string;
  let inputs: string;
  let workRoot: string;
  let service: VideoMediaService;
  let runner: VideoMediaProcess;
  const modules: TestingModule[] = [];
  const owned: {
    service: VideoMediaService;
    workspace: VideoMediaWorkspace;
  }[] = [];
  const original = join(__dirname, '../../../test/fixtures/upload-small.mp4');
  let aac: string;
  let unsupported: string;
  let mp3: string;
  let mov: string;
  async function mediaModule(
    overrides: Partial<ConfigType<typeof videosConfig>> = {},
  ) {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [videosConfig],
        }),
        VideoMediaModule,
      ],
    })
      .overrideProvider(videosConfig.KEY)
      .useValue({
        ...videosConfig(),
        tempDirectory: workRoot,
        ffmpegThreads: 1,
        probeTimeoutMs: 1000,
        processingTimeoutMs: 10000,
        ...overrides,
      })
      .compile();
    modules.push(module);
    return module;
  }
  async function generate(args: string[]) {
    await runner.run('ffmpeg', ['-v', 'error', '-nostdin', ...args], {
      timeoutMs: 10000,
      maxStdoutBytes: 1024,
    });
  }
  async function workspace(input = original, target = service) {
    const size = (await fs.stat(input)).size;
    const result = await target.createWorkspace(size);
    owned.push({ service: target, workspace: result });
    await fs.copyFile(input, result.originalPath, constants.COPYFILE_EXCL);
    return result;
  }
  async function hashStream(path: string) {
    return (
      await runner.run(
        'ffmpeg',
        [
          '-v',
          'error',
          '-nostdin',
          '-i',
          path,
          '-map',
          '0:v:0',
          '-c',
          'copy',
          '-f',
          'hash',
          '-hash',
          'sha256',
          'pipe:1',
        ],
        { timeoutMs: 3000, maxStdoutBytes: 1024 },
      )
    )
      .toString()
      .trim();
  }
  beforeAll(async () => {
    root = await fs.mkdtemp(join(tmpdir(), 'streamtube media-test-'));
    inputs = join(root, 'inputs');
    workRoot = join(root, 'workspaces');
    await fs.mkdir(inputs);
    await fs.mkdir(workRoot);
    const module = await mediaModule();
    service = module.get(VideoMediaService);
    runner = module.get(VideoMediaProcess);
    aac = join(inputs, 'aac.mp4');
    unsupported = join(inputs, 'mpeg4.mp4');
    mp3 = join(inputs, 'mp3.mp4');
    mov = join(inputs, 'quicktime.mov');
    await generate([
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=64x48:rate=12',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:sample_rate=44100',
      '-t',
      '0.5',
      '-c:v',
      'libx264',
      '-threads',
      '1',
      '-c:a',
      'aac',
      '-shortest',
      '-n',
      aac,
    ]);
    await generate([
      '-f',
      'lavfi',
      '-i',
      'color=black:size=32x32:rate=10',
      '-t',
      '0.2',
      '-c:v',
      'mpeg4',
      '-threads',
      '1',
      '-n',
      unsupported,
    ]);
    await generate([
      '-i',
      aac,
      '-c:v',
      'copy',
      '-c:a',
      'libmp3lame',
      '-threads',
      '1',
      '-n',
      mp3,
    ]);
    await generate(['-i', original, '-c', 'copy', '-f', 'mov', '-n', mov]);
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    for (const item of owned.splice(0))
      await item.service.cleanup(item.workspace);
    expect(await fs.readdir(workRoot)).toEqual([]);
  });
  afterAll(async () => {
    for (const module of modules) await module.close();
    if (root) await fs.rm(root, { recursive: true, force: true });
  });

  it('should prepare actual H264 MP4, decode a JPEG and preserve source bytes and video packets', async () => {
    const area = await workspace();
    const source = await fs.readFile(area.originalPath);
    const result = await service.prepare(area);
    expect(result).toMatchObject({
      durationSeconds: 0.2,
      metadata: {
        container: 'mp4',
        videoCodec: 'h264',
        audioCodec: null,
        width: 32,
        height: 32,
        frameRate: 10,
      },
    });
    expect(await fs.readFile(area.originalPath)).toEqual(source);
    const playback = await fs.readFile(result.playbackPath);
    const layout = boxes(playback);
    expect(layout.indexOf('moov')).toBeGreaterThanOrEqual(0);
    expect(layout.indexOf('moov')).toBeLessThan(layout.indexOf('mdat'));
    const jpeg = await fs.readFile(result.thumbnailPath);
    expect(jpeg.subarray(0, 2)).toEqual(Buffer.from([255, 216]));
    expect(jpeg.subarray(-2)).toEqual(Buffer.from([255, 217]));
    await generate(['-i', result.thumbnailPath, '-f', 'null', '-']);
    expect(await hashStream(area.originalPath)).toBe(
      await hashStream(result.playbackPath),
    );
    await service.cleanup(area);
    await service.cleanup(area);
    expect(await fs.readdir(workRoot)).toEqual([]);
  });
  it('should preserve optional AAC and move a real trailing moov before mdat without video recoding', async () => {
    const before = boxes(await fs.readFile(aac));
    expect(before.indexOf('moov')).toBeGreaterThan(before.indexOf('mdat'));
    const area = await workspace(aac);
    const result = await service.prepare(area);
    expect(result.durationSeconds).toBeCloseTo(0.5, 1);
    expect(result.metadata).toEqual({
      container: 'mp4',
      videoCodec: 'h264',
      audioCodec: 'aac',
      width: 64,
      height: 48,
      frameRate: 12,
    });
    const after = boxes(await fs.readFile(result.playbackPath));
    expect(after.indexOf('moov')).toBeLessThan(after.indexOf('mdat'));
    expect(await hashStream(aac)).toBe(await hashStream(result.playbackPath));
    const probe = await runner.run(
      'ffprobe',
      [
        '-v',
        'error',
        '-show_entries',
        'stream=codec_name',
        '-of',
        'json',
        result.playbackPath,
      ],
      { timeoutMs: 3000, maxStdoutBytes: 2048 },
    );
    expect(probe.toString()).toContain('aac');
  });
  it('should reject invalid bytes and remove the complete owned workspace', async () => {
    const bad = join(inputs, 'invalid.bin');
    await fs.writeFile(bad, 'private invalid content');
    const area = await workspace(bad);
    await expect(service.prepare(area)).rejects.toMatchObject({
      code: 'INVALID_VIDEO_CONTENT',
      message: 'Video content is invalid',
    });
    expect(await fs.readdir(workRoot)).toEqual([]);
  });
  it.each(['video', 'audio', 'container'] as const)(
    'should reject a real unsupported %s contract',
    async (kind) => {
      const area = await workspace(
        kind === 'video' ? unsupported : kind === 'audio' ? mp3 : mov,
      );
      await expect(service.prepare(area)).rejects.toMatchObject({
        code: 'UNSUPPORTED_VIDEO_FORMAT',
      });
      expect(await fs.readdir(workRoot)).toEqual([]);
    },
  );
  it('should refuse forged workspace paths without touching another file', async () => {
    const area = await workspace();
    const before = await fs.readFile(original);
    await expect(
      service.prepare({ ...area, originalPath: original }),
    ).rejects.toMatchObject({ code: 'PROCESSING_FAILED' });
    expect(await fs.readFile(original)).toEqual(before);
    expect(await fs.stat(area.originalPath)).toBeDefined();
  });
  it('should reject a symlink source and leave its target untouched', async () => {
    const area = await service.createWorkspace((await fs.stat(original)).size);
    owned.push({ service, workspace: area });
    await fs.symlink(original, area.originalPath);
    const before = await fs.readFile(original);
    await expect(service.prepare(area)).rejects.toMatchObject({
      code: 'INVALID_VIDEO_CONTENT',
    });
    expect(await fs.readFile(original)).toEqual(before);
    expect(await fs.readdir(workRoot)).toEqual([]);
  });
  it('should reject a concat script before it can become an input path list', async () => {
    const path = join(inputs, 'list.txt');
    await fs.writeFile(path, `ffconcat version 1.0\nfile '${original}'\n`);
    const area = await workspace(path);
    await expect(service.prepare(area)).rejects.toMatchObject({
      code: 'INVALID_VIDEO_CONTENT',
    });
    expect(await fs.readdir(workRoot)).toEqual([]);
  });
  it('should abort an actual probe, await process close and then remove its workspace', async () => {
    const area = await workspace();
    const controller = new AbortController();
    const spawn = jest.spyOn(childProcess, 'spawn');
    try {
      await Promise.all([
        expect(service.prepare(area, controller.signal)).rejects.toBeInstanceOf(
          VideoMediaCancelledError,
        ),
        (async () => {
          for (let i = 0; i < 1000 && spawn.mock.calls.length === 0; i++)
            await new Promise((resolve) => setTimeout(resolve, 1));
          controller.abort();
        })(),
      ]);
    } finally {
      controller.abort();
    }
    expect(await fs.readdir(workRoot)).toEqual([]);
    expect(spawn).toHaveBeenCalled();
    for (const result of spawn.mock.results)
      if (result.type === 'return')
        expect(
          result.value.exitCode !== null || result.value.signalCode !== null,
        ).toBe(true);
  });
  it('should enforce the overall operation timeout and remove its workspace', async () => {
    const module = await mediaModule({ processingTimeoutMs: 1 });
    const timed = module.get(VideoMediaService);
    const area = await workspace(original, timed);
    const spawn = jest.spyOn(childProcess, 'spawn');
    await expect(timed.prepare(area)).rejects.toMatchObject({
      code: 'PROCESSING_TIMEOUT',
    });
    expect(await fs.readdir(workRoot)).toEqual([]);
    for (const result of spawn.mock.results)
      if (result.type === 'return')
        expect(
          result.value.exitCode !== null || result.value.signalCode !== null,
        ).toBe(true);
  });
  it('should bound real probe stdout without exposing its output or leaving an active child', async () => {
    const spawn = jest.spyOn(childProcess, 'spawn');
    await expect(
      runner.run(
        'ffprobe',
        ['-v', 'error', '-show_format', '-of', 'json', original],
        { timeoutMs: 1000, maxStdoutBytes: 1 },
      ),
    ).rejects.toMatchObject({
      code: 'INVALID_VIDEO_CONTENT',
      message: 'Video content is invalid',
    });
    expect(spawn).toHaveBeenCalledTimes(1);
    for (const result of spawn.mock.results)
      if (result.type === 'return')
        expect(
          result.value.exitCode !== null || result.value.signalCode !== null,
        ).toBe(true);
  });
  it('should time out and await an actual long-running FFmpeg subprocess', async () => {
    const spawn = jest.spyOn(childProcess, 'spawn');
    await expect(
      runner.run(
        'ffmpeg',
        [
          '-v',
          'error',
          '-nostdin',
          '-re',
          '-f',
          'lavfi',
          '-i',
          'color=black:size=16x16:rate=1',
          '-f',
          'null',
          '-',
        ],
        { timeoutMs: 25, maxStdoutBytes: 1 },
      ),
    ).rejects.toMatchObject({ code: 'PROCESSING_TIMEOUT' });
    expect(spawn).toHaveBeenCalledTimes(1);
    for (const result of spawn.mock.results)
      if (result.type === 'return')
        expect(
          result.value.exitCode !== null || result.value.signalCode !== null,
        ).toBe(true);
  });
  it('should escalate cancellation to SIGKILL and await an actually stopped FFmpeg child', async () => {
    const controller = new AbortController();
    const spawn = jest.spyOn(childProcess, 'spawn');
    const pending = runner.run(
      'ffmpeg',
      [
        '-v',
        'error',
        '-nostdin',
        '-re',
        '-f',
        'lavfi',
        '-i',
        'color=black:size=16x16:rate=1',
        '-f',
        'null',
        '-',
      ],
      { signal: controller.signal, timeoutMs: 5000, maxStdoutBytes: 1 },
    );
    const checked = expect(pending).rejects.toBeInstanceOf(
      VideoMediaCancelledError,
    );
    const result = spawn.mock.results[0];
    if (result.type !== 'return' || !result.value.pid)
      throw new Error('Expected actual child PID');
    const child = result.value;
    const pid = child.pid!;
    try {
      process.kill(pid, 'SIGSTOP');
      for (let i = 0; i < 100; i++) {
        if (
          /^State:\s+T/m.test(await fs.readFile(`/proc/${pid}/status`, 'utf8'))
        )
          break;
        await new Promise((resolve) => setTimeout(resolve, 2));
      }
      controller.abort();
      await checked;
      expect(child.signalCode).toBe('SIGKILL');
      expect(() => process.kill(pid, 0)).toThrow(
        expect.objectContaining({ code: 'ESRCH' }),
      );
    } finally {
      controller.abort();
      await checked;
    }
  });
});
