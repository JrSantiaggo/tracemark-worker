export interface PhotoStatusClient {
  markProcessing(photoId: string): Promise<void>;
  markPublishable(photoId: string, watermarkedKey: string): Promise<void>;
  markFailed(photoId: string, reason: string): Promise<void>;
}
