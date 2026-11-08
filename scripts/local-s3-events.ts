import 'dotenv/config';
import { ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { EnqueueUploadedPhotosUseCase } from '../src/application/enqueue-uploaded-photos.use-case.js';
import { loadWorkerEnv } from '../src/config/env.js';
import { PhotoKeys } from '../src/domain/photo-key.js';
import { createLogger } from '../src/infrastructure/logger.js';
import { createSqsClient } from '../src/infrastructure/sqs-client.js';
import { SqsMessagePublisher } from '../src/infrastructure/sqs-message-publisher.js';

const POLL_INTERVAL_MS = 2000;

const env = loadWorkerEnv();
if (!env.S3_ENDPOINT) throw new Error('Este script emula eventos do S3 apenas no ambiente local (defina S3_ENDPOINT).');

const logger = createLogger(env.LOG_LEVEL, true);
const s3 = new S3Client({ region: env.AWS_REGION, endpoint: env.S3_ENDPOINT, forcePathStyle: env.S3_FORCE_PATH_STYLE });
const lambda = new EnqueueUploadedPhotosUseCase(
  new SqsMessagePublisher(createSqsClient(env.AWS_REGION, env.SQS_ENDPOINT), env.SQS_QUEUE_URL),
  logger,
);

const startedAt = new Date();
const seen = new Set<string>();

async function poll(): Promise<void> {
  let token: string | undefined;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({ Bucket: env.S3_BUCKET, Prefix: 'photos/', ContinuationToken: token }),
    );
    for (const object of page.Contents ?? []) {
      const key = object.Key ?? '';
      if (seen.has(key) || !PhotoKeys.parseOriginal(key) || (object.LastModified ?? startedAt) < startedAt) continue;
      seen.add(key);
      await lambda.execute([
        { bucket: env.S3_BUCKET, key, sizeBytes: object.Size ?? 0, uploadedAt: (object.LastModified ?? new Date()).toISOString() },
      ]);
    }
    token = page.NextContinuationToken;
  } while (token);
}

logger.info({ bucket: env.S3_BUCKET }, 'emulating S3 ObjectCreated events for new originals');
setInterval(() => poll().catch((error: unknown) => logger.error({ err: error }, 'poll failed')), POLL_INTERVAL_MS);
