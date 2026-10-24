import { expect, jest } from '@jest/globals';
import { Test, type TestingModule } from '@nestjs/testing';
import videosConfig from '../../config/videos.config';
import { VideoMediaService } from './video-media.service';
import { VideoMediaFiles, assertMediaSpace } from './video-media-files';
import { VideoMediaProcess } from './video-media-process';
import { normalizeVideoProbe } from './video-media-probe';
import { VideoMediaError, VideoMediaCancelledError } from './video-media.error';
import { VIDEO_MEDIA, type VideoMediaWorkspace } from './video-media.constants';

function probe() {
  return {
    format: {
      format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
      duration: '0.5',
      tags: { major_brand: 'isom', private: 'hidden' },
    },
    streams: [
      {
        codec_type: 'video',
        codec_name: 'h264',
        width: 64,
        height: 48,
        avg_frame_rate: '12/1',
        private: 'hidden',
      },
    ],
  };
}

describe('VideoMediaService normalization and limits', () => {
  it('should allowlist finite metadata and represent absent audio explicitly', () => {
    expect(normalizeVideoProbe(probe())).toEqual({
      durationSeconds: 0.5,
      metadata: {
        container: 'mp4',
        videoCodec: 'h264',
        audioCodec: null,
        width: 64,
        height: 48,
        frameRate: 12,
      },
    });
  });
  it.each([
    null,
    [],
    {},
    true,
    'json',
    { format: [], streams: [] },
    { format: { format_name: 7 }, streams: [] },
    { format: probe().format, streams: [null] },
  ])('should reject unknown probe shape %j', (value) => {
    expect(() => normalizeVideoProbe(value)).toThrow(
      expect.objectContaining({ code: 'INVALID_VIDEO_CONTENT' }),
    );
  });
  it.each(['NaN', 'Infinity', '0', '-1', '', false, null])(
    'should reject invalid duration %j',
    (duration) => {
      const value = { ...probe(), format: { ...probe().format, duration } };
      expect(() => normalizeVideoProbe(value)).toThrow(
        expect.objectContaining({ code: 'INVALID_VIDEO_CONTENT' }),
      );
    },
  );
  it.each([0, -1, 1.5, '64', null, Infinity])(
    'should reject invalid dimensions %j',
    (width) => {
      const value = { ...probe(), streams: [{ ...probe().streams[0], width }] };
      expect(() => normalizeVideoProbe(value)).toThrow(
        expect.objectContaining({ code: 'INVALID_VIDEO_CONTENT' }),
      );
    },
  );
  it('should reject codecs/containers outside MP4 H264 optional AAC', () => {
    const base = probe();
    for (const value of [
      { ...base, format: { ...base.format, format_name: 'matroska,webm' } },
      { ...base, format: { ...base.format, tags: { major_brand: 'qt  ' } } },
      { ...base, streams: [{ ...base.streams[0], codec_name: 'hevc' }] },
      {
        ...base,
        streams: [...base.streams, { codec_type: 'audio', codec_name: 'mp3' }],
      },
    ])
      expect(() => normalizeVideoProbe(value)).toThrow(
        expect.objectContaining({ code: 'UNSUPPORTED_VIDEO_FORMAT' }),
      );
  });
  it('should accept optional AAC and represent unknown frame rate as null', () => {
    const base = probe();
    const value = {
      ...base,
      streams: [
        { ...base.streams[0], avg_frame_rate: '0/0' },
        { codec_type: 'audio', codec_name: 'aac' },
      ],
    };
    expect(normalizeVideoProbe(value).metadata).toMatchObject({
      audioCodec: 'aac',
      frameRate: null,
    });
  });
  it('should reject a container without a video stream', () => {
    expect(() => normalizeVideoProbe({ ...probe(), streams: [] })).toThrow(
      expect.objectContaining({ code: 'INVALID_VIDEO_CONTENT' }),
    );
  });
  it('should reserve original plus remux and headroom using exact bigint arithmetic', () => {
    const size = 10000000000;
    const needed = BigInt(size) * 2n + BigInt(VIDEO_MEDIA.DISK_RESERVE_BYTES);
    expect(() => assertMediaSpace(needed - 1n, size, 2)).toThrow(
      expect.objectContaining({ code: 'PROCESSING_FAILED' }),
    );
    expect(() => assertMediaSpace(needed, size, 2)).not.toThrow();
    expect(() =>
      assertMediaSpace(
        BigInt(size) + BigInt(VIDEO_MEDIA.DISK_RESERVE_BYTES),
        size,
        1,
      ),
    ).not.toThrow();
  });
  it.each([0, -1, 1.1, 10000000001, NaN])(
    'should reject invalid expected bytes %j before file creation',
    (size) => {
      expect(() => assertMediaSpace(999999999999999n, size, 2)).toThrow(
        expect.objectContaining({ code: 'INVALID_VIDEO_CONTENT' }),
      );
    },
  );
});

describe('VideoMediaService', () => {
  let module: TestingModule;
  let service: VideoMediaService;
  const workspace: VideoMediaWorkspace = Object.freeze({
    directory: '/owned/attempt',
    originalPath: '/owned/attempt/original.mp4',
    playbackPath: '/owned/attempt/playback.mp4',
    thumbnailPath: '/owned/attempt/thumbnail.jpg',
  });
  const files = {
    assertOwned: jest.fn<VideoMediaFiles['assertOwned']>(),
    create: jest.fn<VideoMediaFiles['create']>(),
    checkSource: jest.fn<VideoMediaFiles['checkSource']>(),
    checkOutputs: jest.fn<VideoMediaFiles['checkOutputs']>(),
    cleanup: jest.fn<VideoMediaFiles['cleanup']>(),
  };
  const runner = { run: jest.fn<VideoMediaProcess['run']>() };
  beforeEach(async () => {
    jest.useFakeTimers();
    jest.resetAllMocks();
    files.assertOwned.mockReturnValue(1000);
    files.checkSource.mockResolvedValue(undefined);
    files.checkOutputs.mockResolvedValue(undefined);
    files.cleanup.mockResolvedValue(undefined);
    runner.run.mockResolvedValue(Buffer.alloc(0));
    runner.run.mockResolvedValueOnce(Buffer.from(JSON.stringify(probe())));
    module = await Test.createTestingModule({
      providers: [
        VideoMediaService,
        {
          provide: videosConfig.KEY,
          useValue: {
            ...videosConfig(),
            ffmpegThreads: 1,
            probeTimeoutMs: 1000,
            processingTimeoutMs: 5000,
            maxProbeOutputBytes: 2048,
          },
        },
        { provide: VideoMediaFiles, useValue: files },
        { provide: VideoMediaProcess, useValue: runner },
      ],
    }).compile();
    service = module.get(VideoMediaService);
  });
  afterEach(async () => {
    await module.close();
    jest.useRealTimers();
  });
  it('should use fixed paths, restricted protocols and stream-copy faststart, then one JPEG frame', async () => {
    const result = await service.prepare(workspace);
    expect(result.metadata.videoCodec).toBe('h264');
    expect(runner.run).toHaveBeenCalledTimes(3);
    const [probeCall, remux, thumbnail] = runner.run.mock.calls;
    expect(probeCall[0]).toBe('ffprobe');
    expect(probeCall[1]).not.toContain('-nostdin');
    expect(probeCall[1]).toEqual(
      expect.arrayContaining([
        '-f',
        'mov',
        '-enable_drefs',
        '0',
        '-use_absolute_path',
        '-protocol_whitelist',
        'file,pipe',
        workspace.originalPath,
      ]),
    );
    expect(probeCall[2]).toMatchObject({
      timeoutMs: 1000,
      maxStdoutBytes: 2048,
    });
    expect(remux[1]).toEqual(
      expect.arrayContaining([
        '-nostdin',
        '-c',
        'copy',
        '-movflags',
        '+faststart',
        '-n',
        workspace.playbackPath,
      ]),
    );
    expect(thumbnail[1]).toEqual(
      expect.arrayContaining([
        '-frames:v',
        '1',
        '-c:v',
        'mjpeg',
        workspace.thumbnailPath,
      ]),
    );
    expect(files.checkOutputs).toHaveBeenCalledWith(workspace);
    expect(files.cleanup).not.toHaveBeenCalled();
  });
  it('should clean owned files after malformed JSON without leaking probe output', async () => {
    runner.run.mockReset();
    runner.run.mockResolvedValueOnce(
      Buffer.from('private stderr path malformed JSON'),
    );
    await expect(service.prepare(workspace)).rejects.toMatchObject({
      code: 'INVALID_VIDEO_CONTENT',
      message: 'Video content is invalid',
    });
    expect(files.cleanup).toHaveBeenCalledWith(workspace);
  });
  it('should stop before remux when the codec is unsupported', async () => {
    runner.run.mockReset();
    runner.run.mockResolvedValueOnce(
      Buffer.from(
        JSON.stringify({
          ...probe(),
          streams: [{ ...probe().streams[0], codec_name: 'hevc' }],
        }),
      ),
    );
    await expect(service.prepare(workspace)).rejects.toMatchObject({
      code: 'UNSUPPORTED_VIDEO_FORMAT',
    });
    expect(runner.run).toHaveBeenCalledTimes(1);
    expect(files.cleanup).toHaveBeenCalledTimes(1);
  });
  it('should preserve typed timeouts while cleaning partial files', async () => {
    runner.run.mockReset();
    runner.run.mockRejectedValueOnce(new VideoMediaError('PROCESSING_TIMEOUT'));
    await expect(service.prepare(workspace)).rejects.toMatchObject({
      code: 'PROCESSING_TIMEOUT',
    });
    expect(files.cleanup).toHaveBeenCalledTimes(1);
  });
  it('should classify unknown failures safely without exposing internal paths', async () => {
    files.checkSource.mockRejectedValueOnce(
      new Error('/secret/path credential'),
    );
    await expect(service.prepare(workspace)).rejects.toMatchObject({
      code: 'PROCESSING_FAILED',
      message: 'Video processing failed',
    });
    expect(files.cleanup).toHaveBeenCalledTimes(1);
  });
  it('should clean and distinguish a caller cancellation before spawning', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      service.prepare(workspace, controller.signal),
    ).rejects.toBeInstanceOf(VideoMediaCancelledError);
    expect(runner.run).not.toHaveBeenCalled();
    expect(files.cleanup).toHaveBeenCalledTimes(1);
  });
  it('should bound the whole operation and map internal deadline cancellation to timeout', async () => {
    runner.run.mockReset();
    runner.run.mockImplementationOnce(
      (_binary, _args, options) =>
        new Promise((_resolve, reject) => {
          options.signal!.addEventListener(
            'abort',
            () => reject(new VideoMediaCancelledError()),
            { once: true },
          );
        }),
    );
    const checked = expect(service.prepare(workspace)).rejects.toMatchObject({
      code: 'PROCESSING_TIMEOUT',
    });
    await jest.advanceTimersByTimeAsync(5000);
    await checked;
    expect(files.cleanup).toHaveBeenCalledTimes(1);
  });
  it('should not clean or prepare a workspace concurrently with an active operation', async () => {
    let finish!: (value: Buffer) => void;
    runner.run.mockReset();
    runner.run.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    runner.run.mockResolvedValue(Buffer.alloc(0));
    const pending = service.prepare(workspace);
    await jest.advanceTimersByTimeAsync(0);
    await expect(service.prepare(workspace)).rejects.toMatchObject({
      code: 'PROCESSING_FAILED',
    });
    await expect(service.cleanup(workspace)).rejects.toMatchObject({
      code: 'PROCESSING_FAILED',
    });
    expect(files.cleanup).not.toHaveBeenCalled();
    finish(Buffer.from(JSON.stringify(probe())));
    await pending;
  });
});
