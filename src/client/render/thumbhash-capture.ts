import { rgbaToThumbHash, THUMBHASH_MAX_SIDE, thumbHashToBase64 } from '../../shared/thumbhash-encode.ts';

/**
 * The ThumbHash (base64) of a poster JPEG given as base64. The browser decodes and downscales it to at most
 * THUMBHASH_MAX_SIDE a side, so the server needs no image decoder of its own.
 */
export async function jpegThumbHash(jpeg: string) {
  const bytes = Uint8Array.from(atob(jpeg), (character) => character.charCodeAt(0));
  const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
  const scale = Math.min(1, THUMBHASH_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const context = new OffscreenCanvas(w, h).getContext('2d');
  if (!context) throw new Error('no 2D canvas for the ThumbHash');
  context.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return thumbHashToBase64(rgbaToThumbHash(w, h, context.getImageData(0, 0, w, h).data));
}
