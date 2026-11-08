import { describe, expect, it } from 'vitest';
import { PhotoKeys } from '../../src/domain/photo-key.js';
import { processingMessageSchema } from '../../src/domain/processing-message.js';
import { messageBody, PHOTO_ID } from '../helpers/fakes.js';

describe('PhotoKeys', () => {
  it.each(['jpg', 'png', 'webp'] as const)('parses original.%s', (extension) => {
    expect(PhotoKeys.parseOriginal(`photos/${PHOTO_ID}/original.${extension}`)).toEqual({ photoId: PHOTO_ID, extension });
  });

  it.each([
    `photos/${PHOTO_ID}/watermarked.jpg`,
    `photos/${PHOTO_ID}/original.gif`,
    `photos/${PHOTO_ID}/original.JPG`,
    'photos/not-a-uuid/original.jpg',
    `other/${PHOTO_ID}/original.jpg`,
    `photos/${PHOTO_ID}/original.jpg/../x`,
  ])('rejects %s', (key) => {
    expect(PhotoKeys.parseOriginal(key)).toBeNull();
  });

  it('builds the watermarked key expected by the API', () => {
    expect(PhotoKeys.watermarked(PHOTO_ID)).toBe(`photos/${PHOTO_ID}/watermarked.jpg`);
  });
});

describe('processingMessageSchema', () => {
  it('accepts the contract published by the Lambda', () => {
    expect(processingMessageSchema.safeParse(JSON.parse(messageBody())).success).toBe(true);
  });

  it('rejects unknown versions', () => {
    expect(processingMessageSchema.safeParse(JSON.parse(messageBody({ version: 2 }))).success).toBe(false);
  });
});
