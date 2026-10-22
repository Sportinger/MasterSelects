import { CELL_FILTER_MAX_TAPS, CELL_FILTER_SHARE } from '../../src/services/operators/patternCellFilter';

type Rgba = [number, number, number, number];
type Picture = (uv: [number, number]) => Rgba;
const clampUv = (value: number) => Math.min(Math.max(value, .001), .999);
const toLinear = (c: number) => (Math.abs(c) <= .04045 ? c / 12.92 : Math.sign(c) * ((Math.abs(c) + .055) / 1.055) ** 2.4);
const toSrgb = (c: number) => (Math.abs(c) <= .0031308 ? c * 12.92 : Math.sign(c) * (1.055 * Math.abs(c) ** (1 / 2.4) - .055));

/**
 * The Cell Filter (patternCellFilter.ts) in plain arithmetic, with its caches evaluated where they are read (as
 * evaluateImagePasses does without filterResources): a box of round(cell × 0.5) pixels, averaged per row and then per
 * column in linear light weighted by alpha, back in straight sRGB with the average alpha.
 */
export function cellFilteredPicture(picture: Picture, cellPixels: number, resolution: readonly [number, number]): Picture {
  const width = Math.max(Math.floor(cellPixels * CELL_FILTER_SHARE + .5), 1), count = Math.min(width, CELL_FILTER_MAX_TAPS);
  const offset = (index: number) => (index + .5) * (width / count) - width * .5;
  const row = ([u, v]: [number, number]): Rgba => {
    const sum: Rgba = [0, 0, 0, 0];
    for (let i = 0; i < count; i += 1) {
      const c = picture([clampUv(u + offset(i) / resolution[0]), clampUv(v)]);
      for (let k = 0; k < 3; k += 1) sum[k] += toLinear(c[k]) * c[3];
      sum[3] += c[3];
    }
    return sum.map(value => value / count) as Rgba;
  };
  return ([u, v]) => {
    const sum: Rgba = [0, 0, 0, 0];
    for (let j = 0; j < count; j += 1) row([clampUv(u), clampUv(v + offset(j) / resolution[1])]).forEach((value, k) => { sum[k] += value; });
    const average = sum.map(value => value / count), alpha = Math.max(average[3], 1e-6);
    return [toSrgb(average[0] / alpha), toSrgb(average[1] / alpha), toSrgb(average[2] / alpha), average[3]];
  };
}
