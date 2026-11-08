export interface WatermarkedImage {
  body: Buffer;
  contentType: 'image/jpeg';
  width: number;
  height: number;
}

export interface ImageWatermarker {
  apply(original: Buffer): Promise<WatermarkedImage>;
}
