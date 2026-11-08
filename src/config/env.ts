import { z } from 'zod';

const booleanString = z.enum(['true', 'false']).transform((value) => value === 'true');

const optionalUrl = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.url().optional(),
);

const awsSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  AWS_REGION: z.string().min(1).default('us-east-1'),
  SQS_QUEUE_URL: z.url(),
  SQS_ENDPOINT: optionalUrl,
});

const workerSchema = awsSchema.extend({
  S3_BUCKET: z.string().min(3),
  S3_ENDPOINT: optionalUrl,
  S3_FORCE_PATH_STYLE: booleanString.default(false),

  API_BASE_URL: z.url(),
  INTERNAL_API_TOKEN: z.string().min(32),
  API_TIMEOUT_MS: z.coerce.number().int().min(500).max(60_000).default(10_000),

  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(2),
  MAX_RECEIVE_COUNT: z.coerce.number().int().min(1).max(20).default(3),
  SQS_WAIT_TIME_SECONDS: z.coerce.number().int().min(0).max(20).default(20),
  HEALTH_PORT: z.coerce.number().int().min(1).max(65535).default(8080),

  MAX_SOURCE_SIZE_BYTES: z.coerce.number().int().positive().default(50 * 1024 * 1024),
  PREVIEW_MAX_DIMENSION: z.coerce.number().int().min(200).max(8000).default(1600),
  PREVIEW_JPEG_QUALITY: z.coerce.number().int().min(30).max(100).default(80),
  WATERMARK_TEXT: z.string().trim().min(1).max(60).default('TraceMark'),
});

export type LambdaEnv = z.infer<typeof awsSchema>;
export type WorkerEnv = z.infer<typeof workerSchema>;

function parse<T extends z.ZodType>(schema: T, source: NodeJS.ProcessEnv): z.infer<T> {
  const result = schema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid environment configuration:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

export const loadWorkerEnv = (source: NodeJS.ProcessEnv = process.env): WorkerEnv => parse(workerSchema, source);
export const loadLambdaEnv = (source: NodeJS.ProcessEnv = process.env): LambdaEnv => parse(awsSchema, source);
