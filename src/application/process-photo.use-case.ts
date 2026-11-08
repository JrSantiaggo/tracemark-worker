import { PhotoKeys } from '../domain/photo-key.js';
import {
  FailureReason,
  PermanentProcessingError,
  PhotoNotProcessableError,
} from '../domain/processing-errors.js';
import { processingMessageSchema, type ProcessingMessage } from '../domain/processing-message.js';
import type { ImageWatermarker } from './ports/image-watermarker.js';
import type { Logger } from './ports/logger.js';
import type { ObjectStorage } from './ports/object-storage.js';
import type { PhotoStatusClient } from './ports/photo-status-client.js';

export const Disposition = {
  /** Processing finished (successfully or not): remove the message from the queue. */
  DELETE: 'DELETE',
  /** Transient failure: keep the message so SQS redelivers it. */
  RETRY: 'RETRY',
} as const;

export type Disposition = (typeof Disposition)[keyof typeof Disposition];

export interface Delivery {
  body: string;
  receiveCount: number;
}

export interface ProcessPhotoConfig {
  bucket: string;
  maxReceiveCount: number;
}

export class ProcessPhotoUseCase {
  constructor(
    private readonly storage: ObjectStorage,
    private readonly watermarker: ImageWatermarker,
    private readonly api: PhotoStatusClient,
    private readonly logger: Logger,
    private readonly config: ProcessPhotoConfig,
  ) {}

  async execute(delivery: Delivery): Promise<Disposition> {
    const message = this.parse(delivery.body);
    if (!message) return Disposition.DELETE;

    const context = { photoId: message.photoId, attempt: delivery.receiveCount };
    const isLastAttempt = delivery.receiveCount >= this.config.maxReceiveCount;

    try {
      const watermarkedKey = await this.process(message);
      this.logger.info({ ...context, watermarkedKey }, 'photo published');
      return Disposition.DELETE;
    } catch (error) {
      if (error instanceof PhotoNotProcessableError) {
        this.logger.warn({ ...context, apiStatus: error.status }, 'photo no longer processable, skipping');
        return Disposition.DELETE;
      }

      if (error instanceof PermanentProcessingError || isLastAttempt) {
        const reason = error instanceof PermanentProcessingError ? error.reason : FailureReason.RETRIES_EXHAUSTED;
        this.logger.error({ ...context, reason, err: error }, 'photo processing failed');
        return this.reportFailure(message.photoId, reason);
      }

      this.logger.warn({ ...context, err: error }, 'transient failure, message will be retried');
      return Disposition.RETRY;
    }
  }

  private async process(message: ProcessingMessage): Promise<string> {
    await this.api.markProcessing(message.photoId);

    const original = await this.storage.get(message.originalKey);
    if (!original) {
      throw new PermanentProcessingError(FailureReason.ORIGINAL_NOT_FOUND, 'original image not found in storage');
    }

    const watermarked = await this.watermarker.apply(original);
    const watermarkedKey = PhotoKeys.watermarked(message.photoId);
    await this.storage.put(watermarkedKey, watermarked.body, watermarked.contentType);
    await this.api.markPublishable(message.photoId, watermarkedKey);
    return watermarkedKey;
  }

  private async reportFailure(photoId: string, reason: string): Promise<Disposition> {
    try {
      await this.api.markFailed(photoId, reason);
      return Disposition.DELETE;
    } catch (error) {
      if (error instanceof PhotoNotProcessableError) return Disposition.DELETE;
      this.logger.error({ photoId, err: error }, 'could not report failure to the API');
      return Disposition.RETRY;
    }
  }

  private parse(body: string): ProcessingMessage | null {
    let message: ProcessingMessage;
    try {
      message = processingMessageSchema.parse(JSON.parse(body));
    } catch (error) {
      this.logger.error({ err: error }, 'discarding malformed message');
      return null;
    }

    const key = PhotoKeys.parseOriginal(message.originalKey);
    if (message.bucket !== this.config.bucket || key?.photoId !== message.photoId) {
      this.logger.error(
        { photoId: message.photoId, bucket: message.bucket, originalKey: message.originalKey },
        'discarding message for an unexpected bucket or key',
      );
      return null;
    }
    return message;
  }
}
