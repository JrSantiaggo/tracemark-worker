import { SQSClient } from '@aws-sdk/client-sqs';

export function createSqsClient(region: string, endpoint?: string): SQSClient {
  return new SQSClient({ region, ...(endpoint ? { endpoint } : {}) });
}
