import type { S3Event } from 'aws-lambda';
import { describe, expect, it } from 'vitest';
import { EnqueueUploadedPhotosUseCase } from '../../src/application/enqueue-uploaded-photos.use-case.js';
import type { ProcessingMessage } from '../../src/domain/processing-message.js';
import { createHandler, toUploadedObjects } from '../../src/lambda/validate-upload.handler.js';
import { BUCKET, PHOTO_ID, silentLogger } from '../helpers/fakes.js';

function s3Event(...keys: Array<{ key: string; size?: number }>): S3Event {
  return {
    Records: keys.map(({ key, size = 2048 }) => ({
      eventTime: '2026-11-08T18:00:00.000Z',
      s3: { bucket: { name: BUCKET }, object: { key, size } },
    })),
  } as unknown as S3Event;
}

function setup() {
  const published: ProcessingMessage[] = [];
  const useCase = new EnqueueUploadedPhotosUseCase({ publish: async (m) => void published.push(m) }, silentLogger);
  return { published, handler: createHandler(useCase) };
}

describe('validate-upload Lambda', () => {
  it('publishes one message per valid original upload', async () => {
    const { published, handler } = setup();
    const result = await handler(s3Event({ key: `photos/${PHOTO_ID}/original.jpg` }));

    expect(result).toEqual({ enqueued: 1, skipped: 0 });
    expect(published).toEqual([
      {
        version: 1,
        photoId: PHOTO_ID,
        bucket: BUCKET,
        originalKey: `photos/${PHOTO_ID}/original.jpg`,
        sizeBytes: 2048,
        uploadedAt: '2026-11-08T18:00:00.000Z',
      },
    ]);
  });

  it('ignores watermarked outputs, unexpected keys and empty files (prevents processing loops)', async () => {
    const { published, handler } = setup();
    const result = await handler(
      s3Event(
        { key: `photos/${PHOTO_ID}/watermarked.jpg` },
        { key: `photos/${PHOTO_ID}/original.gif` },
        { key: 'uploads/anything.jpg' },
        { key: `photos/${PHOTO_ID}/original.png`, size: 0 },
      ),
    );
    expect(result).toEqual({ enqueued: 0, skipped: 4 });
    expect(published).toEqual([]);
  });

  it('decodes URL-encoded keys from S3 events', () => {
    const [object] = toUploadedObjects(s3Event({ key: 'photos/a%20b+c/original.jpg' }));
    expect(object?.key).toBe('photos/a b c/original.jpg');
  });

  it('propagates publish failures so Lambda retries the event', async () => {
    const useCase = new EnqueueUploadedPhotosUseCase(
      { publish: async () => Promise.reject(new Error('SQS unavailable')) },
      silentLogger,
    );
    await expect(createHandler(useCase)(s3Event({ key: `photos/${PHOTO_ID}/original.jpg` }))).rejects.toThrow(
      'SQS unavailable',
    );
  });
});
