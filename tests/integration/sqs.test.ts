import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EnqueueUploadedPhotosUseCase } from '../../src/application/enqueue-uploaded-photos.use-case.js';
import { Disposition, type Delivery } from '../../src/application/process-photo.use-case.js';
import { SqsConsumer } from '../../src/infrastructure/sqs-consumer.js';
import { SqsMessagePublisher } from '../../src/infrastructure/sqs-message-publisher.js';
import { BUCKET, PHOTO_ID, silentLogger } from '../helpers/fakes.js';
import { createTestQueues, receiveAll, sqs, waitFor } from '../helpers/local-aws.js';

describe('SQS integration (ElasticMQ)', () => {
  const client = sqs();
  let queues: Awaited<ReturnType<typeof createTestQueues>>;
  let consumer: SqsConsumer | undefined;

  beforeEach(async () => {
    queues = await createTestQueues(client, 2);
  });

  afterEach(async () => {
    await consumer?.stop();
    consumer = undefined;
    await queues.cleanup();
  });

  const enqueue = (count = 1) =>
    new EnqueueUploadedPhotosUseCase(new SqsMessagePublisher(client, queues.queueUrl), silentLogger).execute(
      Array.from({ length: count }, () => ({
        bucket: BUCKET,
        key: `photos/${PHOTO_ID}/original.jpg`,
        sizeBytes: 100,
        uploadedAt: new Date().toISOString(),
      })),
    );

  const startConsumer = (handler: (delivery: Delivery) => Promise<Disposition>) => {
    consumer = new SqsConsumer(client, handler, silentLogger, {
      queueUrl: queues.queueUrl,
      concurrency: 2,
      waitTimeSeconds: 1,
    });
    consumer.start();
    return consumer;
  };

  it('delivers the Lambda message to the worker and deletes it after success', async () => {
    await enqueue();
    const deliveries: Delivery[] = [];
    startConsumer(async (delivery) => {
      deliveries.push(delivery);
      return Disposition.DELETE;
    });

    await waitFor(() => deliveries.length === 1);
    expect(JSON.parse(deliveries[0]!.body)).toMatchObject({ version: 1, photoId: PHOTO_ID, bucket: BUCKET });
    expect(deliveries[0]!.receiveCount).toBe(1);

    await consumer!.stop();
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(await receiveAll(client, queues.queueUrl)).toEqual([]);
  });

  it('redelivers on RETRY with an increasing receive count and then moves to the DLQ', async () => {
    await enqueue();
    const receiveCounts: number[] = [];
    startConsumer(async (delivery) => {
      receiveCounts.push(delivery.receiveCount);
      return Disposition.RETRY;
    });

    await waitFor(() => receiveCounts.length >= 2);
    await consumer!.stop();
    expect(receiveCounts.slice(0, 2)).toEqual([1, 2]);

    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(await receiveAll(client, queues.queueUrl)).toEqual([]);
    expect(await receiveAll(client, queues.dlqUrl)).toHaveLength(1);
  });

  it('treats handler crashes as RETRY', async () => {
    await enqueue();
    let attempts = 0;
    startConsumer(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('boom');
      return Disposition.DELETE;
    });
    await waitFor(() => attempts === 2);
  });

  it('processes messages concurrently and stops gracefully', async () => {
    await enqueue(4);
    let inFlight = 0;
    let maxInFlight = 0;
    let done = 0;
    startConsumer(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 200));
      inFlight -= 1;
      done += 1;
      return Disposition.DELETE;
    });

    await waitFor(() => done === 4);
    expect(maxInFlight).toBe(2);
    expect(consumer!.isHealthy()).toBe(true);
    await consumer!.stop();
    expect(consumer!.isHealthy()).toBe(false);
  });
});
