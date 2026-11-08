import type { ImageWatermarker, WatermarkedImage } from '../../src/application/ports/image-watermarker.js';
import type { Logger } from '../../src/application/ports/logger.js';
import type { ObjectStorage } from '../../src/application/ports/object-storage.js';
import type { PhotoStatusClient } from '../../src/application/ports/photo-status-client.js';

export const PHOTO_ID = '6151b55a-04e6-48cb-a868-281dbd735ce4';
export const BUCKET = 'tracemark-test';
export const ORIGINAL_KEY = `photos/${PHOTO_ID}/original.jpg`;

export function messageBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: 1,
    photoId: PHOTO_ID,
    bucket: BUCKET,
    originalKey: ORIGINAL_KEY,
    sizeBytes: 1024,
    uploadedAt: '2026-11-08T18:00:00.000Z',
    ...overrides,
  });
}

export class InMemoryStorage implements ObjectStorage {
  readonly objects = new Map<string, { body: Buffer; contentType: string }>();
  failNextGet: Error | undefined;

  async get(key: string): Promise<Buffer | null> {
    if (this.failNextGet) {
      const error = this.failNextGet;
      this.failNextGet = undefined;
      throw error;
    }
    return this.objects.get(key)?.body ?? null;
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    this.objects.set(key, { body, contentType });
  }
}

export class StubWatermarker implements ImageWatermarker {
  error: Error | undefined;

  async apply(original: Buffer): Promise<WatermarkedImage> {
    if (this.error) throw this.error;
    return { body: Buffer.concat([original, Buffer.from('-wm')]), contentType: 'image/jpeg', width: 10, height: 10 };
  }
}

type Call = { method: 'markProcessing' | 'markPublishable' | 'markFailed'; args: string[] };

export class RecordingStatusClient implements PhotoStatusClient {
  readonly calls: Call[] = [];
  readonly failures = new Map<Call['method'], Error>();

  async markProcessing(photoId: string): Promise<void> {
    this.record('markProcessing', [photoId]);
  }

  async markPublishable(photoId: string, key: string): Promise<void> {
    this.record('markPublishable', [photoId, key]);
  }

  async markFailed(photoId: string, reason: string): Promise<void> {
    this.record('markFailed', [photoId, reason]);
  }

  private record(method: Call['method'], args: string[]): void {
    this.calls.push({ method, args });
    const failure = this.failures.get(method);
    if (failure) throw failure;
  }
}

export const silentLogger: Logger = { info() {}, warn() {}, error() {} };
