import type { S3Event } from 'aws-lambda';
import {
  EnqueueUploadedPhotosUseCase,
  type EnqueueResult,
  type UploadedObject,
} from '../application/enqueue-uploaded-photos.use-case.js';
import { loadLambdaEnv } from '../config/env.js';
import { createLogger } from '../infrastructure/logger.js';
import { createSqsClient } from '../infrastructure/sqs-client.js';
import { SqsMessagePublisher } from '../infrastructure/sqs-message-publisher.js';

export function toUploadedObjects(event: S3Event): UploadedObject[] {
  return event.Records.map((record) => ({
    bucket: record.s3.bucket.name,
    key: decodeURIComponent(record.s3.object.key.replace(/\+/g, ' ')),
    sizeBytes: record.s3.object.size,
    uploadedAt: new Date(record.eventTime).toISOString(),
  }));
}

export function createHandler(useCase: EnqueueUploadedPhotosUseCase) {
  return (event: S3Event): Promise<EnqueueResult> => useCase.execute(toUploadedObjects(event));
}

let defaultHandler: ReturnType<typeof createHandler> | undefined;

export function handler(event: S3Event): Promise<EnqueueResult> {
  defaultHandler ??= (() => {
    const env = loadLambdaEnv();
    const publisher = new SqsMessagePublisher(createSqsClient(env.AWS_REGION, env.SQS_ENDPOINT), env.SQS_QUEUE_URL);
    return createHandler(new EnqueueUploadedPhotosUseCase(publisher, createLogger(env.LOG_LEVEL, false)));
  })();
  return defaultHandler(event);
}
