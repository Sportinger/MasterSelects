// Gallery thumbnails of the effect catalog, cut from an effect's still or clip poster (scripts/effect-docs.mjs
// --thumbs and the runner scripts/docs-media.mjs): 400 × 250 WebP (smaller if needed) within the thumbnail budget.
import fs from 'node:fs';
import path from 'node:path';
import { THUMB_TARGET_BYTES } from './effectDocsCatalog.mjs';

/** With fit 'whole', a region narrower than this (width : height) is not cropped to the 16:10 card: it is fitted whole. */
const NARROW = 1.3;
/** Inset at an inner edge (a cut through the still, not its border), as a share of the still: past the gap of a split. */
const INSET = 0.005;
/** How far past the inset a light divider line is still looked for, as a share of the still. */
const DIVIDER_SCAN = 0.02;

/**
 * The part of the still a thumbnail shows: `region` (fractions [left, top, width, height] of the still, from
 * effectDocsExtras.mjs or the recipe) or the effect half of an "original | effect" still (the lower half when it
 * is stacked). Pixels, before the divider is trimmed.
 */
export function thumbRegion({ width, height }, region) {
  if (region) {
    return { left: Math.round(region[0] * width), top: Math.round(region[1] * height), width: Math.round(region[2] * width), height: Math.round(region[3] * height) };
  }
  return height > width * 0.9
    ? { left: 0, top: Math.ceil(height / 2), width, height: Math.floor(height / 2) }
    : { left: Math.ceil(width / 2), top: 0, width: Math.floor(width / 2), height };
}

/**
 * Moves every inner edge of `rect` (one that cuts through the still, such as the middle of a split) inward past
 * the divider between the halves: a fixed inset of 0.5 % of the still, then on past any light, even line (the
 * white gap of a split still). `pixels(rect)` gives the greyscale bytes of a rectangle of the still.
 */
export async function trimDividers(rect, { width, height }, pixels) {
  const result = { ...rect };
  const sides = [
    { inner: rect.left > 0, axis: 'x', from: 'start' },
    { inner: rect.left + rect.width < width, axis: 'x', from: 'end' },
    { inner: rect.top > 0, axis: 'y', from: 'start' },
    { inner: rect.top + rect.height < height, axis: 'y', from: 'end' },
  ];
  for (const side of sides.filter((entry) => entry.inner)) {
    const size = side.axis === 'x' ? width : height;
    const inset = Math.ceil(size * INSET);
    const scan = Math.ceil(size * DIVIDER_SCAN);
    const across = side.axis === 'x' ? rect.height : rect.width;
    const along = side.axis === 'x' ? rect.width : rect.height;
    const depth = Math.min(inset + scan, Math.floor(along / 4));
    // The strip at this edge, `depth` lines deep, read line by line from the edge inward.
    const strip = side.axis === 'x'
      ? { left: side.from === 'start' ? rect.left : rect.left + rect.width - depth, top: rect.top, width: depth, height: rect.height }
      : { left: rect.left, top: side.from === 'start' ? rect.top : rect.top + rect.height - depth, width: rect.width, height: depth };
    const bytes = await pixels(strip);
    const line = (index) => {
      const at = side.from === 'start' ? index : depth - 1 - index;
      const values = Array.from({ length: across }, (_, k) => (side.axis === 'x' ? bytes[k * depth + at] : bytes[at * rect.width + k]));
      const mean = values.reduce((sum, value) => sum + value, 0) / across;
      const spread = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / across);
      return { mean, spread };
    };
    let cut = Math.min(inset, depth);
    while (cut < depth) {
      const { mean, spread } = line(cut);
      if (mean < 200 || spread > 24) break;
      cut += 1;
    }
    if (side.axis === 'x') {
      if (side.from === 'start') result.left += cut;
      result.width -= cut;
    } else {
      if (side.from === 'start') result.top += cut;
      result.height -= cut;
    }
  }
  return result;
}

/**
 * Writes the thumbnail of `source` to `out`; returns its byte size. `fit: 'whole'` (the effect half of a loop's
 * poster): a region narrower than 1.3 : 1 is fitted whole instead of cropped to the card.
 */
export async function makeThumb({ source, out, region, fit }) {
  const { default: sharp } = await import('sharp');
  const { width, height } = await sharp(source).metadata();
  const pixels = async (strip) => sharp(source).extract(strip).greyscale().raw().toBuffer();
  const extract = await trimDividers(thumbRegion({ width, height }, region), { width, height }, pixels);
  const narrow = fit === 'whole' && extract.width / extract.height < NARROW;
  // A narrow picture (the effect half of a portrait pair) is fitted whole over a blurred, darkened copy of
  // itself, so the card keeps the dancer's head and feet; a wider one is cropped to the card.
  const render = async (w, h, quality) => {
    const cut = sharp(source).extract(extract);
    if (!narrow) return cut.resize(w, h, { fit: 'cover', position: 'attention' }).webp({ quality }).toBuffer();
    const picture = await cut.clone().resize(w, h, { fit: 'inside' }).toBuffer();
    const ground = await cut.clone().resize(w, h, { fit: 'cover' }).blur(18).modulate({ brightness: 0.55 }).toBuffer();
    return sharp(ground).composite([{ input: picture, gravity: 'centre' }]).webp({ quality }).toBuffer();
  };
  // Lower the quality first, then the size, until the thumbnail fits (fine line patterns compress badly).
  let buffer;
  search: for (const [w, h] of [[400, 250], [352, 220], [320, 200]]) {
    for (let quality = 72; quality >= 40; quality -= 8) {
      buffer = await render(w, h, quality);
      if (buffer.length <= THUMB_TARGET_BYTES) break search;
    }
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, buffer);
  return buffer.length;
}
