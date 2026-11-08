import sharp from 'sharp';
import type { ImageWatermarker, WatermarkedImage } from '../application/ports/image-watermarker.js';
import { FailureReason, PermanentProcessingError } from '../domain/processing-errors.js';

const SUPPORTED_FORMATS = new Set(['jpeg', 'png', 'webp']);
const MAX_INPUT_PIXELS = 120_000_000;

export interface WatermarkConfig {
  text: string;
  maxDimension: number;
  jpegQuality: number;
}

export class SharpWatermarker implements ImageWatermarker {
  constructor(private readonly config: WatermarkConfig) {}

  async apply(original: Buffer): Promise<WatermarkedImage> {
    const resized = await this.resize(original);
    const overlay = Buffer.from(buildOverlaySvg(resized.width, resized.height, this.config.text));

    const { data, info } = await sharp(resized.data)
      .composite([{ input: overlay, blend: 'over' }])
      .jpeg({ quality: this.config.jpegQuality, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });

    return { body: data, contentType: 'image/jpeg', width: info.width, height: info.height };
  }

  private async resize(original: Buffer): Promise<{ data: Buffer; width: number; height: number }> {
    try {
      const image = sharp(original, { failOn: 'error', limitInputPixels: MAX_INPUT_PIXELS });
      const { format } = await image.metadata();
      if (!format || !SUPPORTED_FORMATS.has(format)) {
        throw new PermanentProcessingError(FailureReason.INVALID_IMAGE, `unsupported image format: ${format}`);
      }

      const { data, info } = await image
        .rotate()
        .resize({
          width: this.config.maxDimension,
          height: this.config.maxDimension,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .toBuffer({ resolveWithObject: true });
      return { data, width: info.width, height: info.height };
    } catch (error) {
      if (error instanceof PermanentProcessingError) throw error;
      throw new PermanentProcessingError(FailureReason.INVALID_IMAGE, `could not decode image: ${(error as Error).message}`);
    }
  }
}

export function buildOverlaySvg(width: number, height: number, text: string): string {
  const fontSize = Math.max(16, Math.round(Math.min(width, height) / 12));
  const tileWidth = Math.round(fontSize * (text.length * 0.7 + 3));
  const tileHeight = fontSize * 4;
  const strokeWidth = Math.max(1, Math.round(fontSize / 24));

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <defs>
    <pattern id="wm" width="${tileWidth}" height="${tileHeight}" patternUnits="userSpaceOnUse" patternTransform="rotate(-30)">
      <text x="0" y="${fontSize * 1.5}" font-family="DejaVu Sans, Arial, sans-serif" font-size="${fontSize}" font-weight="bold"
        fill="#ffffff" fill-opacity="0.45" stroke="#000000" stroke-opacity="0.25" stroke-width="${strokeWidth}">${escapeXml(text)}</text>
    </pattern>
  </defs>
  <rect width="100%" height="100%" fill="url(#wm)"/>
</svg>`;
}

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (char) => `&#${char.charCodeAt(0)};`);
}
