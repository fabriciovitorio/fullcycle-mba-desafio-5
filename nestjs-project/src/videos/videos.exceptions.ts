import { DomainException } from '../common/exceptions/domain.exception';

export class ChannelNotFoundException extends DomainException {
  constructor() {
    super('CHANNEL_NOT_FOUND', 404, 'Channel was not found');
  }
}

export class VideoNotFoundException extends DomainException {
  constructor() {
    super('VIDEO_NOT_FOUND', 404, 'Video was not found');
  }
}

export class InvalidVideoStateException extends DomainException {
  constructor() {
    super(
      'INVALID_VIDEO_STATE',
      409,
      'Video state does not allow this operation',
    );
  }
}

export class UploadOperationInProgressException extends DomainException {
  constructor() {
    super(
      'UPLOAD_OPERATION_IN_PROGRESS',
      409,
      'Upload operation requires completion or reconciliation',
    );
  }
}

export class UploadExpiredException extends DomainException {
  constructor() {
    super('UPLOAD_EXPIRED', 410, 'Upload session has expired');
  }
}

export class StorageUnavailableException extends DomainException {
  constructor() {
    super(
      'STORAGE_UNAVAILABLE',
      503,
      'Storage operation could not be confirmed',
    );
  }
}

export class VideoUploadValidationException extends DomainException {
  constructor() {
    super('VALIDATION_ERROR', 400, 'Video upload request is invalid');
  }
}

export class VideoIdGenerationFailedException extends DomainException {
  constructor() {
    super(
      'VIDEO_ID_GENERATION_FAILED',
      503,
      'Unable to generate video identity',
    );
  }
}

export class UploadIncompleteException extends DomainException {
  constructor() {
    super(
      'UPLOAD_INCOMPLETE',
      409,
      'Upload parts are incomplete or out of sequence',
    );
  }
}

export class UploadSizeMismatchException extends DomainException {
  constructor() {
    super(
      'UPLOAD_SIZE_MISMATCH',
      409,
      'Uploaded bytes do not match the declared size',
    );
  }
}
