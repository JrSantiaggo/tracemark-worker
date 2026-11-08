const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const ORIGINAL_KEY = new RegExp(`^photos/(${UUID})/original\\.(jpg|png|webp)$`);

export interface OriginalKey {
  photoId: string;
  extension: 'jpg' | 'png' | 'webp';
}

export const PhotoKeys = {
  parseOriginal(key: string): OriginalKey | null {
    const match = ORIGINAL_KEY.exec(key);
    if (!match) return null;
    return { photoId: match[1]!, extension: match[2] as OriginalKey['extension'] };
  },

  watermarked(photoId: string): string {
    return `photos/${photoId}/watermarked.jpg`;
  },
};
