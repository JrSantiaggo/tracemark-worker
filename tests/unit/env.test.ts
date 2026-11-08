import { describe, expect, it } from 'vitest';
import { loadLambdaEnv, loadWorkerEnv } from '../../src/config/env.js';

const base = {
  SQS_QUEUE_URL: 'http://localhost:9324/000000000000/q',
  S3_BUCKET: 'bucket',
  API_BASE_URL: 'http://localhost:3333',
  INTERNAL_API_TOKEN: 'x'.repeat(32),
};

describe('env', () => {
  it('applies worker defaults', () => {
    expect(loadWorkerEnv({ ...base, S3_ENDPOINT: '' })).toMatchObject({
      WORKER_CONCURRENCY: 2,
      MAX_RECEIVE_COUNT: 3,
      PREVIEW_MAX_DIMENSION: 1600,
      S3_ENDPOINT: undefined,
    });
  });

  it('rejects weak tokens and invalid concurrency without echoing values', () => {
    expect(() => loadWorkerEnv({ ...base, INTERNAL_API_TOKEN: 'short-token' })).toThrow(/INTERNAL_API_TOKEN/);
    expect(() => loadWorkerEnv({ ...base, WORKER_CONCURRENCY: '11' })).toThrow(/WORKER_CONCURRENCY/);
    try {
      loadWorkerEnv({ ...base, INTERNAL_API_TOKEN: 'short-token' });
    } catch (error) {
      expect((error as Error).message).not.toContain('short-token');
    }
  });

  it('only requires the queue for the Lambda', () => {
    expect(loadLambdaEnv({ SQS_QUEUE_URL: base.SQS_QUEUE_URL }).SQS_QUEUE_URL).toBe(base.SQS_QUEUE_URL);
  });
});
