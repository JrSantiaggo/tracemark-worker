import { GetObjectCommand, NoSuchKey, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { ObjectStorage } from '../application/ports/object-storage.js';
import { FailureReason, PermanentProcessingError } from '../domain/processing-errors.js';

export interface S3ObjectStorageConfig {
  region: string;
  bucket: string;
  endpoint?: string | undefined;
  forcePathStyle: boolean;
  maxObjectSizeBytes: number;
}

/** Credentials come from the default AWS provider chain (ECS task role in production). */
export class S3ObjectStorage implements ObjectStorage {
  private readonly client: S3Client;

  constructor(private readonly config: S3ObjectStorageConfig) {
    this.client = new S3Client({
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      ...(config.endpoint ? { endpoint: config.endpoint } : {}),
    });
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      const object = await this.client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: key }));
      if ((object.ContentLength ?? 0) > this.config.maxObjectSizeBytes) {
        object.Body?.transformToWebStream().cancel();
        throw new PermanentProcessingError(FailureReason.IMAGE_TOO_LARGE, 'original image exceeds the size limit');
      }
      return Buffer.from((await object.Body?.transformToByteArray()) ?? []);
    } catch (error) {
      if (error instanceof NoSuchKey) return null;
      throw error;
    }
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.config.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }
}
