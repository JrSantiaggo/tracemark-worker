import 'dotenv/config';
import { ProcessPhotoUseCase } from './application/process-photo.use-case.js';
import { loadWorkerEnv } from './config/env.js';
import { startHealthServer } from './infrastructure/health-server.js';
import { createLogger } from './infrastructure/logger.js';
import { S3ObjectStorage } from './infrastructure/s3-object-storage.js';
import { SharpWatermarker } from './infrastructure/sharp-watermarker.js';
import { createSqsClient } from './infrastructure/sqs-client.js';
import { SqsConsumer } from './infrastructure/sqs-consumer.js';
import { TracemarkApiClient } from './infrastructure/tracemark-api-client.js';

const env = loadWorkerEnv();
const logger = createLogger(env.LOG_LEVEL, env.NODE_ENV === 'development');

const processPhoto = new ProcessPhotoUseCase(
  new S3ObjectStorage({
    region: env.AWS_REGION,
    bucket: env.S3_BUCKET,
    endpoint: env.S3_ENDPOINT,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    maxObjectSizeBytes: env.MAX_SOURCE_SIZE_BYTES,
  }),
  new SharpWatermarker({
    text: env.WATERMARK_TEXT,
    maxDimension: env.PREVIEW_MAX_DIMENSION,
    jpegQuality: env.PREVIEW_JPEG_QUALITY,
  }),
  new TracemarkApiClient({
    baseUrl: env.API_BASE_URL,
    internalToken: env.INTERNAL_API_TOKEN,
    timeoutMs: env.API_TIMEOUT_MS,
  }),
  logger,
  { bucket: env.S3_BUCKET, maxReceiveCount: env.MAX_RECEIVE_COUNT },
);

const consumer = new SqsConsumer(
  createSqsClient(env.AWS_REGION, env.SQS_ENDPOINT),
  (delivery) => processPhoto.execute(delivery),
  logger,
  { queueUrl: env.SQS_QUEUE_URL, concurrency: env.WORKER_CONCURRENCY, waitTimeSeconds: env.SQS_WAIT_TIME_SECONDS },
);

const healthServer = startHealthServer(env.HEALTH_PORT, () => consumer.isHealthy());
consumer.start();
logger.info({ queueUrl: env.SQS_QUEUE_URL, concurrency: env.WORKER_CONCURRENCY }, 'worker started');

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    logger.info({ signal }, 'shutting down, waiting for in-flight messages');
    await consumer.stop();
    healthServer.close();
    process.exit(0);
  });
}
