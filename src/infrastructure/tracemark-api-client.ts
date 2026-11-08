import type { PhotoStatusClient } from '../application/ports/photo-status-client.js';
import { PhotoNotProcessableError } from '../domain/processing-errors.js';

export interface TracemarkApiConfig {
  baseUrl: string;
  internalToken: string;
  timeoutMs: number;
}

export class TracemarkApiError extends Error {
  constructor(
    readonly status: number,
    body: string,
  ) {
    super(`TraceMark API responded ${status}: ${body.slice(0, 300)}`);
    this.name = 'TracemarkApiError';
  }
}

export class TracemarkApiClient implements PhotoStatusClient {
  constructor(private readonly config: TracemarkApiConfig) {}

  markProcessing(photoId: string): Promise<void> {
    return this.send(photoId, { status: 'PROCESSING' });
  }

  markPublishable(photoId: string, watermarkedKey: string): Promise<void> {
    return this.send(photoId, { status: 'PUBLISHABLE', watermarkedKey });
  }

  markFailed(photoId: string, reason: string): Promise<void> {
    return this.send(photoId, { status: 'ERROR', reason: reason.slice(0, 500) });
  }

  private async send(photoId: string, body: object): Promise<void> {
    const url = new URL(`/internal/photos/${encodeURIComponent(photoId)}/processing-result`, this.config.baseUrl);
    const response = await fetch(url, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'x-internal-token': this.config.internalToken },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });

    if (response.ok) return;
    if (response.status === 404 || response.status === 409) {
      throw new PhotoNotProcessableError(photoId, response.status);
    }
    throw new TracemarkApiError(response.status, await response.text());
  }
}
