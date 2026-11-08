import { beforeAll, describe, expect, it } from 'vitest';
import { PermanentProcessingError } from '../../src/domain/processing-errors.js';
import { S3ObjectStorage } from '../../src/infrastructure/s3-object-storage.js';
import { ensureTestBucket, REGION, S3_ENDPOINT, TEST_BUCKET } from '../helpers/local-aws.js';

describe('S3ObjectStorage (SeaweedFS)', () => {
  const storage = new S3ObjectStorage({
    region: REGION,
    bucket: TEST_BUCKET,
    endpoint: S3_ENDPOINT,
    forcePathStyle: true,
    maxObjectSizeBytes: 1024,
  });

  beforeAll(ensureTestBucket);

  it('stores and reads objects with their content type', async () => {
    const key = `photos/${Date.now()}/watermarked.jpg`;
    await storage.put(key, Buffer.from('jpeg-bytes'), 'image/jpeg');
    expect((await storage.get(key))?.toString()).toBe('jpeg-bytes');
  });

  it('returns null for missing objects', async () => {
    expect(await storage.get('photos/missing/original.jpg')).toBeNull();
  });

  it('refuses to download objects above the size limit', async () => {
    const key = `photos/${Date.now()}/original.jpg`;
    await storage.put(key, Buffer.alloc(2048), 'image/jpeg');
    await expect(storage.get(key)).rejects.toMatchObject({ reason: 'IMAGE_TOO_LARGE' });
    await expect(storage.get(key)).rejects.toBeInstanceOf(PermanentProcessingError);
  });
});
