import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { EnqueueUploadedPhotosUseCase } from '../src/application/enqueue-uploaded-photos.use-case.js';
import { loadWorkerEnv } from '../src/config/env.js';
import { createLogger } from '../src/infrastructure/logger.js';
import { createSqsClient } from '../src/infrastructure/sqs-client.js';
import { SqsMessagePublisher } from '../src/infrastructure/sqs-message-publisher.js';

const env = loadWorkerEnv();
const API = env.API_BASE_URL;
const TIMEOUT_MS = 30_000;

async function call<T = any>(method: string, path: string, body?: unknown, token?: string): Promise<T> {
  const response = await fetch(new URL(path, API), {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : null,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path} -> ${response.status}: ${text}`);
  return JSON.parse(text) as T;
}

const step = (message: string) => console.log(`✔ ${message}`);
const suffix = Date.now();

const photographer = await call('POST', '/auth/register', {
  name: 'Fotógrafa Worker', email: `foto-${suffix}@worker.test`, password: 'senha-segura-123', role: 'PHOTOGRAPHER',
});
const runner = await call('POST', '/auth/register', {
  name: 'Corredor Worker', email: `runner-${suffix}@worker.test`, password: 'senha-segura-123',
});

const original = await sharp({
  create: { width: 2400, height: 1600, channels: 3, background: { r: 30, g: 120, b: 200 } },
}).jpeg({ quality: 90 }).toBuffer();

const created = await call('POST', '/photos', {
  photos: [{ title: 'Smoke Worker', price: '29.90', fileName: 'smoke.jpg', mimeType: 'image/jpeg', fileSize: original.length }],
}, photographer.accessToken);
const { photo, upload } = created.data[0];

const form = new FormData();
for (const [key, value] of Object.entries(upload.fields as Record<string, string>)) form.append(key, value);
form.append('file', new Blob([original], { type: 'image/jpeg' }), 'smoke.jpg');
const uploaded = await fetch(upload.url, { method: 'POST', body: form });
if (!uploaded.ok) throw new Error(`upload S3 falhou: ${uploaded.status}`);
step(`foto ${photo.id} enviada ao S3 (${original.length} bytes, 2400x1600)`);

const lambda = new EnqueueUploadedPhotosUseCase(
  new SqsMessagePublisher(createSqsClient(env.AWS_REGION, env.SQS_ENDPOINT), env.SQS_QUEUE_URL),
  createLogger('silent', false),
);
await lambda.execute([{ bucket: env.S3_BUCKET, key: upload.fields.key, sizeBytes: original.length, uploadedAt: new Date().toISOString() }]);
step('Lambda simulada publicou a mensagem no SQS');

const deadline = Date.now() + TIMEOUT_MS;
let details: any;
do {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  details = await call('GET', `/photos/${photo.id}`, undefined, photographer.accessToken);
} while (details.status !== 'PUBLISHABLE' && details.status !== 'ERROR' && Date.now() < deadline);

if (details.status !== 'PUBLISHABLE') throw new Error(`foto terminou em ${details.status} (${details.processingError ?? 'timeout'})`);
step('Worker processou a foto -> PUBLISHABLE');

const asRunner = await call('GET', `/photos/${photo.id}`, undefined, runner.accessToken);
const watermarked = Buffer.from(await (await fetch(asRunner.image.url)).arrayBuffer());
const meta = await sharp(watermarked).metadata();
if (asRunner.image.variant !== 'WATERMARKED' || meta.format !== 'jpeg' || Math.max(meta.width!, meta.height!) > env.PREVIEW_MAX_DIMENSION) {
  throw new Error(`prévia inesperada: ${asRunner.image.variant} ${meta.format} ${meta.width}x${meta.height}`);
}
mkdirSync('tmp', { recursive: true });
writeFileSync('tmp/smoke-watermarked.jpg', watermarked);
step(`usuário comum recebe a prévia com marca-d'água (${meta.width}x${meta.height}) -> tmp/smoke-watermarked.jpg`);

const notifications = await call('GET', '/notifications', undefined, photographer.accessToken);
if (!notifications.data.some((n: { type: string }) => n.type === 'PHOTO_PUBLISHED')) throw new Error('notificação ausente');
step('fotógrafo notificado da publicação');

console.log('\nFluxo assíncrono validado.');
