import 'dotenv/config';
import type { S3Event } from 'aws-lambda';
import { handler } from '../src/lambda/validate-upload.handler.js';

const [key, size = '1024'] = process.argv.slice(2);
if (!key) {
  console.error('uso: npm run lambda:simulate -- photos/<photoId>/original.jpg [tamanho-em-bytes]');
  process.exit(1);
}

function buildS3Event(bucket: string, objectKey: string, sizeBytes: number): S3Event {
  return {
    Records: [
      {
        eventVersion: '2.1',
        eventSource: 'aws:s3',
        awsRegion: process.env.AWS_REGION ?? 'us-east-1',
        eventTime: new Date().toISOString(),
        eventName: 'ObjectCreated:Post',
        s3: {
          bucket: { name: bucket },
          object: { key: encodeURIComponent(objectKey).replace(/%2F/g, '/'), size: sizeBytes },
        },
      },
    ],
  } as unknown as S3Event;
}

console.log(await handler(buildS3Event(process.env.S3_BUCKET ?? 'tracemark-photos-local', key, Number(size))));
