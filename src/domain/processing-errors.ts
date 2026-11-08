export const FailureReason = {
  INVALID_MESSAGE: 'INVALID_MESSAGE',
  ORIGINAL_NOT_FOUND: 'ORIGINAL_NOT_FOUND',
  IMAGE_TOO_LARGE: 'IMAGE_TOO_LARGE',
  INVALID_IMAGE: 'INVALID_IMAGE',
  RETRIES_EXHAUSTED: 'PROCESSING_RETRIES_EXHAUSTED',
} as const;

export type FailureReason = (typeof FailureReason)[keyof typeof FailureReason];

/** Retrying will not help: the photo must be marked as ERROR. */
export class PermanentProcessingError extends Error {
  constructor(
    readonly reason: FailureReason,
    message: string,
  ) {
    super(message);
    this.name = 'PermanentProcessingError';
  }
}

/** The API no longer accepts updates for this photo (deleted or already final). */
export class PhotoNotProcessableError extends Error {
  constructor(
    readonly photoId: string,
    readonly status: number,
  ) {
    super(`photo ${photoId} is not processable (API responded ${status})`);
    this.name = 'PhotoNotProcessableError';
  }
}
