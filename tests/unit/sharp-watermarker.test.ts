import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { PermanentProcessingError } from '../../src/domain/processing-errors.js';
import { buildOverlaySvg, SharpWatermarker } from '../../src/infrastructure/sharp-watermarker.js';

const watermarker = new SharpWatermarker({ text: 'TraceMark', maxDimension: 800, jpegQuality: 80 });

function solidImage(width: number, height: number, format: 'jpeg' | 'png' | 'webp' = 'jpeg'): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 20, g: 100, b: 180 } } })
    .toFormat(format)
    .toBuffer();
}

describe('SharpWatermarker', () => {
  it.each(['jpeg', 'png', 'webp'] as const)('outputs a resized JPEG from %s', async (format) => {
    const result = await watermarker.apply(await solidImage(2000, 1000, format));
    const meta = await sharp(result.body).metadata();

    expect(result.contentType).toBe('image/jpeg');
    expect(meta.format).toBe('jpeg');
    expect([meta.width, meta.height]).toEqual([800, 400]);
  });

  it('does not upscale small images', async () => {
    const result = await watermarker.apply(await solidImage(300, 200));
    expect([result.width, result.height]).toEqual([300, 200]);
  });

  it('actually draws the watermark over the image', async () => {
    const plain = await sharp(await solidImage(800, 400)).raw().toBuffer({ resolveWithObject: true });
    const marked = await sharp((await watermarker.apply(await solidImage(800, 400))).body)
      .raw()
      .toBuffer({ resolveWithObject: true });

    let changedPixels = 0;
    for (let i = 0; i < plain.data.length; i += 3) {
      if (Math.abs(plain.data[i]! - marked.data[i]!) > 30) changedPixels += 1;
    }
    expect(changedPixels / (plain.info.width * plain.info.height)).toBeGreaterThan(0.03);
  });

  it('strips metadata such as EXIF/GPS', async () => {
    const withExif = await sharp(await solidImage(400, 300))
      .withExif({ IFD0: { Copyright: 'secret-location' } })
      .jpeg()
      .toBuffer();
    const result = await watermarker.apply(withExif);
    expect((await sharp(result.body).metadata()).exif).toBeUndefined();
  });

  it.each([
    ['random bytes', Buffer.from('definitely not an image')],
    ['truncated JPEG', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00])],
  ])('rejects %s as a permanent error', async (_label, input) => {
    await expect(watermarker.apply(input)).rejects.toBeInstanceOf(PermanentProcessingError);
  });

  it('rejects unsupported formats such as GIF', async () => {
    const gif = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#fff' } }).gif().toBuffer();
    await expect(watermarker.apply(gif)).rejects.toMatchObject({ reason: 'INVALID_IMAGE' });
  });

  it('escapes the watermark text inside the SVG', () => {
    expect(buildOverlaySvg(100, 100, '<script>&')).toContain('&#60;script&#62;&#38;');
  });
});
