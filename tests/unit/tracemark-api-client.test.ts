import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PhotoNotProcessableError } from '../../src/domain/processing-errors.js';
import { TracemarkApiClient, TracemarkApiError } from '../../src/infrastructure/tracemark-api-client.js';
import { PHOTO_ID } from '../helpers/fakes.js';

const TOKEN = 'internal-token-with-at-least-32-characters';

describe('TracemarkApiClient', () => {
  let server: Server;
  let client: TracemarkApiClient;
  let nextStatus = 200;
  let delayMs = 0;
  const requests: Array<{ method?: string; url?: string; token?: string; body: unknown }> = [];

  beforeAll(async () => {
    server = createServer(async (request: IncomingMessage, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(chunk as Buffer);
      requests.push({
        method: request.method,
        url: request.url,
        token: request.headers['x-internal-token'] as string,
        body: JSON.parse(Buffer.concat(chunks).toString() || 'null'),
      });
      setTimeout(() => response.writeHead(nextStatus, { 'content-type': 'application/json' }).end('{}'), delayMs);
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    client = new TracemarkApiClient({ baseUrl: `http://127.0.0.1:${port}`, internalToken: TOKEN, timeoutMs: 300 });
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  beforeEach(() => {
    requests.length = 0;
    nextStatus = 200;
    delayMs = 0;
  });

  it('sends the documented internal contract', async () => {
    await client.markProcessing(PHOTO_ID);
    await client.markPublishable(PHOTO_ID, `photos/${PHOTO_ID}/watermarked.jpg`);
    await client.markFailed(PHOTO_ID, 'x'.repeat(600));

    expect(requests.map((r) => [r.method, r.url, r.token])).toEqual(
      Array(3).fill(['PATCH', `/internal/photos/${PHOTO_ID}/processing-result`, TOKEN]),
    );
    expect(requests.map((r) => r.body)).toEqual([
      { status: 'PROCESSING' },
      { status: 'PUBLISHABLE', watermarkedKey: `photos/${PHOTO_ID}/watermarked.jpg` },
      { status: 'ERROR', reason: 'x'.repeat(500) },
    ]);
  });

  it.each([404, 409])('maps %i to PhotoNotProcessableError', async (status) => {
    nextStatus = status;
    await expect(client.markProcessing(PHOTO_ID)).rejects.toBeInstanceOf(PhotoNotProcessableError);
  });

  it.each([400, 401, 500, 503])('maps %i to a generic API error', async (status) => {
    nextStatus = status;
    await expect(client.markProcessing(PHOTO_ID)).rejects.toBeInstanceOf(TracemarkApiError);
  });

  it('times out slow responses', async () => {
    delayMs = 1000;
    await expect(client.markProcessing(PHOTO_ID)).rejects.toThrow(/abort|timeout/i);
  });
});
