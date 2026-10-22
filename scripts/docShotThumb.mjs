// Gallery thumbnails of the effect catalog, cut from an effect's still or clip poster (scripts/effect-docs.mjs
// --thumbs and the runner scripts/docs-media.mjs): 400 × 250 WebP (smaller if needed) within the thumbnail budget.
import fs from 'node:fs';
import path from 'node:path';
import { THUMB_TARGET_BYTES } from './effectDocsCatalog.mjs';

/**
 * The part of the still a thumbnail shows: `region` (fractions [left, top, width, height] of the still, from
 * effectDocsExtras.mjs) or the effect half of an "original | effect" still (the lower half when it is stacked).
 */
export function thumbRegion({ width, height }, region) {
  if (region) {
    return { left: Math.round(region[0] * width), top: Math.round(region[1] * height), width: Math.round(region[2] * width), height: Math.round(region[3] * height) };
  }
  return height > width * 0.9
    ? { left: 0, top: Math.ceil(height / 2), width, height: Math.floor(height / 2) }
    : { left: Math.ceil(width / 2), top: 0, width: Math.floor(width / 2), height };
}

/** Writes the thumbnail of `source` to `out`; returns its byte size. */
export async function makeThumb({ source, out, region }) {
  const { default: sharp } = await import('sharp');
  const { width, height } = await sharp(source).metadata();
  const extract = thumbRegion({ width, height }, region);
  // Lower the quality first, then the size, until the thumbnail fits (fine line patterns compress badly).
  let buffer;
  search: for (const [w, h] of [[400, 250], [352, 220], [320, 200]]) {
    for (let quality = 72; quality >= 40; quality -= 8) {
      buffer = await sharp(source).extract(extract).resize(w, h, { fit: 'cover', position: 'attention' }).webp({ quality }).toBuffer();
      if (buffer.length <= THUMB_TARGET_BYTES) break search;
    }
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, buffer);
  return buffer.length;
}
