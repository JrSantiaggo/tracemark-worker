import { DeleteMessageCommand, ReceiveMessageCommand, type Message, type SQSClient } from '@aws-sdk/client-sqs';
import type { Logger } from '../application/ports/logger.js';
import { Disposition, type Delivery } from '../application/process-photo.use-case.js';

export interface SqsConsumerConfig {
  queueUrl: string;
  concurrency: number;
  waitTimeSeconds: number;
}

export type DeliveryHandler = (delivery: Delivery) => Promise<Disposition>;

const RECEIVE_ERROR_BACKOFF_MS = 5_000;

export class SqsConsumer {
  private running = false;
  private loop: Promise<void> | undefined;
  private abortReceive = new AbortController();
  private lastPollAt = 0;

  constructor(
    private readonly client: SQSClient,
    private readonly handler: DeliveryHandler,
    private readonly logger: Logger,
    private readonly config: SqsConsumerConfig,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.loop = this.run();
  }

  /** Stops polling and waits for in-flight messages to finish. */
  async stop(): Promise<void> {
    this.running = false;
    this.abortReceive.abort();
    await this.loop;
  }

  isHealthy(now = Date.now()): boolean {
    const maxSilenceMs = (this.config.waitTimeSeconds + 30) * 1000;
    return this.running && now - this.lastPollAt < maxSilenceMs;
  }

  private async run(): Promise<void> {
    while (this.running) {
      this.lastPollAt = Date.now();
      let messages: Message[];
      try {
        messages = await this.receive();
      } catch (error) {
        if (!this.running) break;
        this.logger.error({ err: error }, 'failed to receive messages');
        await delay(RECEIVE_ERROR_BACKOFF_MS);
        continue;
      }
      await Promise.all(messages.map((message) => this.handle(message)));
    }
  }

  private async receive(): Promise<Message[]> {
    const response = await this.client.send(
      new ReceiveMessageCommand({
        QueueUrl: this.config.queueUrl,
        MaxNumberOfMessages: this.config.concurrency,
        WaitTimeSeconds: this.config.waitTimeSeconds,
        MessageSystemAttributeNames: ['ApproximateReceiveCount'],
      }),
      { abortSignal: this.abortReceive.signal },
    );
    return response.Messages ?? [];
  }

  private async handle(message: Message): Promise<void> {
    const delivery: Delivery = {
      body: message.Body ?? '',
      receiveCount: Number(message.Attributes?.ApproximateReceiveCount ?? '1'),
    };

    let disposition: Disposition;
    try {
      disposition = await this.handler(delivery);
    } catch (error) {
      this.logger.error({ err: error, messageId: message.MessageId }, 'unexpected error while handling message');
      disposition = Disposition.RETRY;
    }

    if (disposition === Disposition.DELETE && message.ReceiptHandle) {
      await this.client
        .send(new DeleteMessageCommand({ QueueUrl: this.config.queueUrl, ReceiptHandle: message.ReceiptHandle }))
        .catch((error: unknown) => this.logger.error({ err: error, messageId: message.MessageId }, 'failed to delete message'));
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
