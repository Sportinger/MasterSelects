import type { RotoMask } from './rotoTypes';

export interface RotoEdges { offset: number; softness: number }
export const DEFAULT_ROTO_EDGES: RotoEdges = { offset: 0, softness: 0 };

/** Squared Euclidean distance to the requested class, with a separable parabola envelope. */
function distances(mask: RotoMask, foreground: boolean) {
  const { width, height, data } = mask;
  const limit = width * width + height * height + 1;
  const result = new Float32Array(data.length);
  const n = Math.max(width, height), values = new Float64Array(n), out = new Float64Array(n);
  const sites = new Int32Array(n), borders = new Float64Array(n + 1);
  const transform = (length: number) => {
    let k = 0; sites[0] = 0; borders[0] = -Infinity; borders[1] = Infinity;
    for (let q = 1; q < length; q++) {
      let intersection: number;
      do {
        const p = sites[k];
        intersection = ((values[q] + q * q) - (values[p] + p * p)) / (2 * (q - p));
        if (intersection > borders[k]) break;
        k--;
      } while (k >= 0);
      k++; sites[k] = q; borders[k] = intersection!; borders[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < length; q++) {
      while (borders[k + 1] < q) k++;
      out[q] = (q - sites[k]) ** 2 + values[sites[k]];
    }
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) values[x] = (data[y * width + x] >= 128) === foreground ? 0 : limit;
    transform(width);
    for (let x = 0; x < width; x++) result[y * width + x] = out[x];
  }
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) values[y] = result[y * width + x];
    transform(height);
    for (let y = 0; y < height; y++) result[y * width + x] = out[y];
  }
  return result;
}

/** A geometric edge adjustment, not an estimate of hair or translucent material. */
export function refineRotoEdges(mask: RotoMask, edges: RotoEdges): Uint8Array {
  const offset = Math.max(-8, Math.min(8, Number.isFinite(edges.offset) ? edges.offset : 0));
  const softness = Math.max(0, Math.min(8, Number.isFinite(edges.softness) ? edges.softness : 0));
  if (offset === 0 && softness === 0) return mask.data;
  let selected = 0;
  for (const value of mask.data) if (value >= 128) selected++;
  // With no boundary in the source image, do not invent one at its outer border.
  if (selected === 0 || selected === mask.data.length) return mask.data;
  const inside = distances(mask, false), outside = distances(mask, true);
  const result = new Uint8Array(mask.data.length);
  for (let i = 0; i < result.length; i++) {
    const distance = mask.data[i] >= 128 ? Math.sqrt(inside[i]) - .5 : .5 - Math.sqrt(outside[i]);
    const coverage = softness > 0 ? .5 + (distance + offset) / (2 * softness) : distance + offset > 0 ? 1 : 0;
    result[i] = Math.round(255 * Math.max(0, Math.min(1, coverage)));
  }
  return result;
}
