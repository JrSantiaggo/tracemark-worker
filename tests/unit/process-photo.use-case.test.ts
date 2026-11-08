import { beforeEach, describe, expect, it } from 'vitest';
import { Disposition, ProcessPhotoUseCase } from '../../src/application/process-photo.use-case.js';
import {
  FailureReason,
  PermanentProcessingError,
  PhotoNotProcessableError,
} from '../../src/domain/processing-errors.js';
import {
  BUCKET,
  InMemoryStorage,
  messageBody,
  ORIGINAL_KEY,
  PHOTO_ID,
  RecordingStatusClient,
  silentLogger,
  StubWatermarker,
} from '../helpers/fakes.js';

const WATERMARKED_KEY = `photos/${PHOTO_ID}/watermarked.jpg`;

describe('ProcessPhotoUseCase', () => {
  let storage: InMemoryStorage;
  let watermarker: StubWatermarker;
  let api: RecordingStatusClient;
  let useCase: ProcessPhotoUseCase;

  beforeEach(() => {
    storage = new InMemoryStorage();
    watermarker = new StubWatermarker();
    api = new RecordingStatusClient();
    useCase = new ProcessPhotoUseCase(storage, watermarker, api, silentLogger, { bucket: BUCKET, maxReceiveCount: 3 });
    storage.objects.set(ORIGINAL_KEY, { body: Buffer.from('original'), contentType: 'image/jpeg' });
  });

  const run = (body = messageBody(), receiveCount = 1) => useCase.execute({ body, receiveCount });

  it('marks PROCESSING, stores the watermarked image and publishes it', async () => {
    expect(await run()).toBe(Disposition.DELETE);

    expect(storage.objects.get(WATERMARKED_KEY)).toEqual({
      body: Buffer.from('original-wm'),
      contentType: 'image/jpeg',
    });
    expect(api.calls).toEqual([
      { method: 'markProcessing', args: [PHOTO_ID] },
      { method: 'markPublishable', args: [PHOTO_ID, WATERMARKED_KEY] },
    ]);
  });

  it.each([
    ['invalid JSON', '{not json'],
    ['wrong schema', JSON.stringify({ photoId: 'x' })],
    ['unexpected bucket', messageBody({ bucket: 'someone-else' })],
    ['key of another photo', messageBody({ originalKey: 'photos/7c9e6679-7425-40de-944b-e07fc1f90ae7/original.jpg' })],
    ['non-original key', messageBody({ originalKey: WATERMARKED_KEY })],
  ])('discards messages with %s without calling the API', async (_label, body) => {
    expect(await run(body)).toBe(Disposition.DELETE);
    expect(api.calls).toEqual([]);
  });

  it('marks the photo as ERROR when the original is missing', async () => {
    storage.objects.clear();
    expect(await run()).toBe(Disposition.DELETE);
    expect(api.calls.at(-1)).toEqual({ method: 'markFailed', args: [PHOTO_ID, FailureReason.ORIGINAL_NOT_FOUND] });
  });

  it('marks the photo as ERROR when the image is invalid', async () => {
    watermarker.error = new PermanentProcessingError(FailureReason.INVALID_IMAGE, 'corrupt');
    expect(await run()).toBe(Disposition.DELETE);
    expect(api.calls.at(-1)).toEqual({ method: 'markFailed', args: [PHOTO_ID, FailureReason.INVALID_IMAGE] });
    expect(storage.objects.has(WATERMARKED_KEY)).toBe(false);
  });

  it('retries transient failures before the last attempt', async () => {
    storage.failNextGet = new Error('ECONNRESET');
    expect(await run(messageBody(), 1)).toBe(Disposition.RETRY);
    expect(api.calls.map((c) => c.method)).toEqual(['markProcessing']);
  });

  it('gives up and marks ERROR on the last attempt', async () => {
    storage.failNextGet = new Error('ECONNRESET');
    expect(await run(messageBody(), 3)).toBe(Disposition.DELETE);
    expect(api.calls.at(-1)).toEqual({ method: 'markFailed', args: [PHOTO_ID, FailureReason.RETRIES_EXHAUSTED] });
  });

  it('skips photos the API no longer accepts (deleted or already final)', async () => {
    api.failures.set('markProcessing', new PhotoNotProcessableError(PHOTO_ID, 409));
    expect(await run()).toBe(Disposition.DELETE);
    expect(storage.objects.has(WATERMARKED_KEY)).toBe(false);
  });

  it('keeps the message when the failure cannot be reported to the API', async () => {
    watermarker.error = new PermanentProcessingError(FailureReason.INVALID_IMAGE, 'corrupt');
    api.failures.set('markFailed', new Error('API down'));
    expect(await run()).toBe(Disposition.RETRY);
  });

  it('is safe to run twice for the same message', async () => {
    await run();
    expect(await run()).toBe(Disposition.DELETE);
    expect(storage.objects.size).toBe(2);
  });
});
