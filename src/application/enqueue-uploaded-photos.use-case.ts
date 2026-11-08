import { PhotoKeys } from '../domain/photo-key.js';
import type { Logger } from './ports/logger.js';
import type { MessagePublisher } from './ports/message-publisher.js';

export interface UploadedObject {
  bucket: string;
  key: string;
  sizeBytes: number;
  uploadedAt: string;
}

export interface EnqueueResult {
  enqueued: number;
  skipped: number;
}

export class EnqueueUploadedPhotosUseCase {
  constructor(
    private readonly publisher: MessagePublisher,
    private readonly logger: Logger,
  ) {}

  async execute(objects: UploadedObject[]): Promise<EnqueueResult> {
    let enqueued = 0;

    for (const object of objects) {
      const parsed = PhotoKeys.parseOriginal(object.key);
      if (!parsed || object.sizeBytes <= 0) {
        this.logger.warn({ bucket: object.bucket, key: object.key, sizeBytes: object.sizeBytes }, 'ignoring object');
        continue;
      }

      await this.publisher.publish({
        version: 1,
        photoId: parsed.photoId,
        bucket: object.bucket,
        originalKey: object.key,
        sizeBytes: object.sizeBytes,
        uploadedAt: object.uploadedAt,
      });
      this.logger.info({ photoId: parsed.photoId, key: object.key }, 'photo enqueued for processing');
      enqueued += 1;
    }

    return { enqueued, skipped: objects.length - enqueued };
  }
}
