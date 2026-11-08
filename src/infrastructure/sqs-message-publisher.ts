import { SendMessageCommand, type SQSClient } from '@aws-sdk/client-sqs';
import type { MessagePublisher } from '../application/ports/message-publisher.js';
import type { ProcessingMessage } from '../domain/processing-message.js';

export class SqsMessagePublisher implements MessagePublisher {
  constructor(
    private readonly client: SQSClient,
    private readonly queueUrl: string,
  ) {}

  async publish(message: ProcessingMessage): Promise<void> {
    await this.client.send(
      new SendMessageCommand({
        QueueUrl: this.queueUrl,
        MessageBody: JSON.stringify(message),
        MessageAttributes: { photoId: { DataType: 'String', StringValue: message.photoId } },
      }),
    );
  }
}
