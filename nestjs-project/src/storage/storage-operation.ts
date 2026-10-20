import { S3ServiceException } from '@aws-sdk/client-s3';
import { StorageError } from './storage.error';

export function mapStorageError(
  error: unknown,
  timedOut = false,
): StorageError {
  if (error instanceof StorageError) return error;
  if (error instanceof S3ServiceException) {
    if (
      error.name === 'NoSuchKey' ||
      (error.name === 'NotFound' && error.$metadata.httpStatusCode === 404)
    )
      return new StorageError('object_not_found');
    if (error.name === 'NoSuchUpload')
      return new StorageError('upload_not_found');
    if (
      ['InvalidPart', 'InvalidPartOrder', 'EntityTooSmall'].includes(error.name)
    )
      return new StorageError('invalid_multipart');
    if (
      (error.$metadata.httpStatusCode ?? 0) >= 500 ||
      error.$metadata.httpStatusCode === 429
    )
      return new StorageError('unavailable');
    return new StorageError('operation_failed');
  }
  if (
    timedOut ||
    (typeof error === 'object' &&
      error !== null &&
      (('name' in error &&
        typeof error.name === 'string' &&
        ['AbortError', 'TimeoutError'].includes(error.name)) ||
        ('code' in error &&
          typeof error.code === 'string' &&
          [
            'ECONNREFUSED',
            'ECONNRESET',
            'ENOTFOUND',
            'EAI_AGAIN',
            'EHOSTUNREACH',
            'ETIMEDOUT',
          ].includes(error.code)) ||
        // Smithy's retry middleware can stringify foreign-realm native errors,
        // dropping their code. Match only its wrapper and known transport codes.
        ('message' in error &&
          typeof error.message === 'string' &&
          error.message.startsWith('AWS SDK error wrapper for Error: ') &&
          /\b(?:ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ETIMEDOUT)\b/.test(
            error.message,
          ))))
  )
    return new StorageError('unavailable');
  return new StorageError('operation_failed');
}

export async function withStorageOperation<T>(
  work: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  callerSignal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timeout = setTimeout(abort, timeoutMs);
  callerSignal?.addEventListener('abort', abort, { once: true });
  try {
    if (callerSignal?.aborted) throw new StorageError('cancelled');
    return await work(controller.signal);
  } catch (error: unknown) {
    if (error instanceof StorageError && error.kind === 'cleanup_failed')
      throw error;
    if (callerSignal?.aborted) throw new StorageError('cancelled');
    throw mapStorageError(error, controller.signal.aborted);
  } finally {
    clearTimeout(timeout);
    callerSignal?.removeEventListener('abort', abort);
  }
}
