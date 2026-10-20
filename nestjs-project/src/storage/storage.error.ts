export type StorageErrorKind =
  | 'upload_not_found'
  | 'object_not_found'
  | 'invalid_multipart'
  | 'unavailable'
  | 'operation_failed'
  | 'invalid_response'
  | 'invalid_request'
  | 'cancelled'
  | 'cleanup_failed';

const MESSAGES: Record<StorageErrorKind, string> = {
  upload_not_found: 'Multipart session was not found',
  object_not_found: 'Storage object was not found',
  invalid_multipart: 'Multipart parts are invalid',
  unavailable: 'Storage is unavailable',
  operation_failed: 'Storage operation failed',
  invalid_response: 'Storage returned an invalid response',
  invalid_request: 'Storage request is invalid or expired',
  cancelled: 'Storage transfer was cancelled',
  cleanup_failed: 'Storage transfer cleanup requires recovery',
};

export class StorageError extends Error {
  constructor(public readonly kind: StorageErrorKind) {
    super(MESSAGES[kind]);
    this.name = 'StorageError';
  }
}

// Recovery details stay inside the application; callers must not serialize them to HTTP.
export class StorageCleanupError extends StorageError {
  constructor(
    public readonly recovery: {
      key: string;
      uploadId?: string;
      localPath?: string;
    },
    public readonly originalKind: StorageErrorKind,
  ) {
    super('cleanup_failed');
  }
}
