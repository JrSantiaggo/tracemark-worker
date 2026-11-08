import { z } from 'zod';

export const processingMessageSchema = z.object({
  version: z.literal(1),
  photoId: z.uuid(),
  bucket: z.string().min(3),
  originalKey: z.string().min(1),
  sizeBytes: z.number().int().positive(),
  uploadedAt: z.iso.datetime(),
});

export type ProcessingMessage = z.infer<typeof processingMessageSchema>;
