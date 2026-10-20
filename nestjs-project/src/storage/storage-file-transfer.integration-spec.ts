import { jest } from '@jest/globals';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  access,
  mkdtemp,
  open,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import {
  createStorageFixture,
  type StorageFixture,
} from '../test/storage.fixture';
import { StorageCleanupError, StorageError } from './storage.error';
import { STORAGE_LIMITS } from './storage.constants';

describe('Storage file transfers (integration)', () => {
  let fixture: StorageFixture;
  let directory: string;
  beforeEach(async () => {
    fixture = await createStorageFixture();
    directory = await mkdtemp(join(tmpdir(), 'streamtube-si0342-'));
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    try {
      await fixture?.cleanup();
    } finally {
      if (directory) await rm(directory, { recursive: true, force: true });
    }
  });

  async function sparse(name: string, size: number): Promise<string> {
    const path = join(directory, name);
    const file = await open(path, 'wx');
    try {
      await file.truncate(size);
      await file.write(Buffer.from('begin'), 0, 5, 0);
      await file.write(Buffer.from('end'), 0, 3, size - 3);
    } finally {
      await file.close();
    }
    return path;
  }

  async function digest(path: string): Promise<string> {
    const hash = createHash('sha256');
    for await (const value of createReadStream(path)) {
      const chunk: unknown = value;
      if (!Buffer.isBuffer(chunk))
        throw new Error('Expected binary fixture stream');
      hash.update(chunk);
    }
    return hash.digest('hex');
  }

  function observeParts(afterPart?: () => void) {
    const bodies: Readable[] = [];
    const commands: string[] = [];
    fixture.client.middlewareStack.add(
      (next, context) => async (args) => {
        commands.push(context.commandName ?? '');
        const input: unknown = args.input;
        if (
          context.commandName === 'UploadPartCommand' &&
          typeof input === 'object' &&
          input !== null &&
          'Body' in input &&
          input.Body instanceof Readable
        )
          bodies.push(input.Body);
        const result = await next(args);
        if (context.commandName === 'UploadPartCommand') afterPart?.();
        return result;
      },
      { step: 'initialize', name: 'observeRealTransfer' },
    );
    return { bodies, commands };
  }

  it('should stream a real two-part file in both directions with identical hashes', async () => {
    const source = await sparse('source.mp4', 5 * 1024 * 1024 + 97);
    const key = fixture.key('playback.mp4');
    const seen = observeParts();
    const uploaded = await fixture.files.uploadFile(key, source, 'video/mp4');
    expect(uploaded.contentLength).toBe((await stat(source)).size);
    expect(seen.bodies).toHaveLength(2);
    expect(seen.commands).not.toContain('PutObjectCommand');
    for (const body of seen.bodies) {
      expect(body.readableHighWaterMark).toBe(
        STORAGE_LIMITS.STREAM_HIGH_WATER_MARK,
      );
      expect(body.closed).toBe(true);
    }
    const destination = join(directory, 'download.mp4');
    expect(await fixture.files.downloadFile(key, destination)).toEqual(
      uploaded,
    );
    expect(await digest(destination)).toBe(await digest(source));
    expect(await fixture.uploads(key)).toEqual([]);
  });

  it('should transfer a small JPEG without buffering an entire video', async () => {
    const source = join(directory, 'thumbnail.jpg');
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    await writeFile(source, bytes);
    const key = fixture.key('thumbnail.jpg');
    const result = await fixture.files.uploadFile(key, source, 'image/jpeg');
    expect(result.contentType).toBe('image/jpeg');
    const destination = join(directory, 'received.jpg');
    await fixture.files.downloadFile(key, destination);
    expect(await readFile(destination)).toEqual(bytes);
  });

  it('should choose multipart for a source larger than 5GiB and abort it on cancellation', async () => {
    // Sparse fixture tests path selection and cancellation, not a full >5GiB transfer.
    const source = await sparse('large-sparse.mp4', 5 * 1024 ** 3 + 1);
    const key = fixture.key('cancelled.mp4');
    const controller = new AbortController();
    const seen = observeParts(() => controller.abort());
    await expect(
      fixture.files.uploadFile(key, source, 'video/mp4', controller.signal),
    ).rejects.toMatchObject({ kind: 'cancelled' });
    expect(seen.bodies).toHaveLength(1);
    expect(seen.bodies[0].closed).toBe(true);
    expect(seen.commands).not.toContain('PutObjectCommand');
    expect(await fixture.uploads(key)).toEqual([]);
    await expect(fixture.storage.headObject(key)).rejects.toMatchObject({
      kind: 'object_not_found',
    });
  });

  it('should close a real download stream and remove its partial file on cancellation', async () => {
    const source = await sparse('source.mp4', 5 * 1024 * 1024 + 97);
    const key = fixture.key();
    await fixture.files.uploadFile(key, source, 'video/mp4');
    const controller = new AbortController();
    let body: Readable | undefined;
    fixture.client.middlewareStack.add(
      (next, context) => async (args) => {
        const result = await next(args);
        const output: unknown = result.output;
        if (
          context.commandName === 'GetObjectCommand' &&
          typeof output === 'object' &&
          output !== null &&
          'Body' in output &&
          output.Body instanceof Readable
        ) {
          body = output.Body;
          body.once('data', () => controller.abort());
        }
        return result;
      },
      { step: 'initialize', name: 'cancelRealDownload' },
    );
    const destination = join(directory, 'partial.mp4');
    await expect(
      fixture.files.downloadFile(key, destination, controller.signal),
    ).rejects.toMatchObject({ kind: 'cancelled' });
    expect(body?.closed).toBe(true);
    await expect(access(destination)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('should preserve an existing destination and clean a new destination after storage failure', async () => {
    const existing = join(directory, 'existing.mp4');
    await writeFile(existing, 'keep-existing');
    const key = fixture.key();
    await expect(
      fixture.files.downloadFile(key, existing),
    ).rejects.toMatchObject({ kind: 'operation_failed' });
    expect(await readFile(existing, 'utf8')).toBe('keep-existing');
    const missing = join(directory, 'missing.mp4');
    await expect(
      fixture.files.downloadFile(key, missing),
    ).rejects.toMatchObject({ kind: 'object_not_found' });
    await expect(access(missing)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('should abort a real multipart when a transfer fails after storing a part', async () => {
    const source = await sparse('source.mp4', 5 * 1024 * 1024 + 97);
    const key = fixture.key();
    const seen = observeParts(() => {
      throw new Error('Injected failure after actual UploadPart response');
    });
    await expect(
      fixture.files.uploadFile(key, source, 'video/mp4'),
    ).rejects.toMatchObject({ kind: 'operation_failed' });
    expect(seen.bodies[0].closed).toBe(true);
    expect(await fixture.uploads(key)).toEqual([]);
  });

  it('should expose recovery information when multipart cleanup fails and allow actual retry', async () => {
    const source = await sparse('source.mp4', 5 * 1024 * 1024 + 97);
    const key = fixture.key();
    const controller = new AbortController();
    const seen = observeParts(() => controller.abort());
    const abort = jest
      .spyOn(fixture.storage, 'abortMultipartUpload')
      .mockRejectedValueOnce(new StorageError('unavailable'));
    try {
      await fixture.files.uploadFile(
        key,
        source,
        'video/mp4',
        controller.signal,
      );
      throw new Error('Expected cleanup failure');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(StorageCleanupError);
      if (!(error instanceof StorageCleanupError) || !error.recovery.uploadId)
        throw error;
      expect(error.recovery.key).toBe(key);
      expect(error.originalKind).toBe('cancelled');
      expect(await fixture.uploads(key)).toHaveLength(1);
      abort.mockRestore();
      await fixture.storage.abortMultipartUpload(key, error.recovery.uploadId);
      expect(await fixture.uploads(key)).toEqual([]);
    }
    expect(seen.bodies[0].closed).toBe(true);
  });

  it('should perform no I/O for an already cancelled transfer', async () => {
    const controller = new AbortController();
    controller.abort();
    const key = fixture.key();
    const path = join(directory, 'untouched.mp4');
    await expect(
      fixture.files.uploadFile(key, path, 'video/mp4', controller.signal),
    ).rejects.toMatchObject({ kind: 'cancelled' });
    await expect(
      fixture.files.downloadFile(key, path, controller.signal),
    ).rejects.toMatchObject({ kind: 'cancelled' });
    await expect(access(path)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fixture.uploads(key)).toEqual([]);
  });
});
