import 'dotenv/config';
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import {
  CreateQueueCommand,
  DeleteQueueCommand,
  GetQueueAttributesCommand,
  ReceiveMessageCommand,
  type SQSClient,
} from '@aws-sdk/client-sqs';
import { createSqsClient } from '../../src/infrastructure/sqs-client.js';

export const REGION = process.env.AWS_REGION ?? 'us-east-1';
export const SQS_ENDPOINT = process.env.SQS_ENDPOINT ?? 'http://localhost:9324';
export const S3_ENDPOINT = process.env.S3_ENDPOINT ?? 'http://localhost:8333';
export const TEST_BUCKET = 'tracemark-worker-test';

export const sqs = (): SQSClient => createSqsClient(REGION, SQS_ENDPOINT);

export async function createTestQueues(client: SQSClient, maxReceiveCount: number) {
  const name = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const dlq = await client.send(new CreateQueueCommand({ QueueName: `${name}-dlq` }));
  const dlqArn = (
    await client.send(new GetQueueAttributesCommand({ QueueUrl: dlq.QueueUrl, AttributeNames: ['QueueArn'] }))
  ).Attributes!.QueueArn!;
  const queue = await client.send(
    new CreateQueueCommand({
      QueueName: name,
      Attributes: {
        VisibilityTimeout: '1',
        RedrivePolicy: JSON.stringify({ deadLetterTargetArn: dlqArn, maxReceiveCount }),
      },
    }),
  );
  return {
    queueUrl: queue.QueueUrl!,
    dlqUrl: dlq.QueueUrl!,
    cleanup: async () => {
      await client.send(new DeleteQueueCommand({ QueueUrl: queue.QueueUrl }));
      await client.send(new DeleteQueueCommand({ QueueUrl: dlq.QueueUrl }));
    },
  };
}

export async function receiveAll(client: SQSClient, queueUrl: string): Promise<string[]> {
  const response = await client.send(
    new ReceiveMessageCommand({ QueueUrl: queueUrl, MaxNumberOfMessages: 10, WaitTimeSeconds: 1 }),
  );
  return (response.Messages ?? []).map((m) => m.Body ?? '');
}

export async function ensureTestBucket(): Promise<void> {
  const client = new S3Client({ region: REGION, endpoint: S3_ENDPOINT, forcePathStyle: true });
  await client.send(new CreateBucketCommand({ Bucket: TEST_BUCKET })).catch((error: Error) => {
    if (!['BucketAlreadyOwnedByYou', 'BucketAlreadyExists'].includes(error.name)) throw error;
  });
}

export async function waitFor(condition: () => boolean | Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
