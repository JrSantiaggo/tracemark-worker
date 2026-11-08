import type { ProcessingMessage } from '../../domain/processing-message.js';

export interface MessagePublisher {
  publish(message: ProcessingMessage): Promise<void>;
}
