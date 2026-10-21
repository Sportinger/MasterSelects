import { KALEIDOSCOPE_MAX_SEGMENTS, KALEIDOSCOPE_MIN_SEGMENTS, KALEIDOSCOPE_MIN_ZOOM, RGB_SPLIT_LENS_SCALE } from '../operators/mirrorRecipes';
import { CELL_REFERENCE_HEIGHT } from '../operators/cellGridRecipes';

/**
 * Worker CPU fallback (software preview, worker-first export readback) for the built-in
 * Kaleidoscope, Mirror, RGB Split and Pixelate recipes (services/operators/mirrorRecipes.ts and
 * cellGridRecipes.ts): the same mappings, frame edges and premultiplied bilinear reads, applied to
 * the whole frame in stack order. Pixelate averages each cell exactly (the GPU spreads its taps for
 * cells wider than 128 rendered pixels). Edited graphs run through the graph interpreter instead.
 */
export type WorkerSoftwareMirrorPixelAdjustment =
  | { readonly type: 'kaleidoscope'; readonly segments: number; readonly rotation: number; readonly sourceAngle: number; readonly zoom: number;
    readonly centerX: number; readonly centerY: number; readonly stretch: boolean; readonly edges: EdgeMode }
  | { readonly type: 'mirror'; readonly horizontal: boolean; readonly vertical: boolean; readonly keepEnd: boolean; readonly angle: number;
    readonly centerX: number; readonly centerY: number; readonly edges: EdgeMode }
  | { readonly type: 'rgb-split'; readonly amount: number; readonly angle: number; readonly lens: boolean; readonly edges: EdgeMode }
  | { readonly type: 'pixelate'; readonly size: number };
type EdgeMode = 'mirror' | 'clamp' | 'transparent';
type Pixel = [number, number, number, number];

const finite = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const edgeMode = (value: unknown): EdgeMode => value === 'clamp' || value === 'transparent' ? value : 'mirror';
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** The adjustment of a built-in recipe (params with defaults resolved), null when its settings leave the picture unchanged, undefined for other effects. */
export function workerSoftwareMirrorPixelAdjustment(type: string, params: Record<string, unknown>): WorkerSoftwareMirrorPixelAdjustment | null | undefined {
  switch (type) {
    case 'kaleidoscope': return { type, segments: finite(params.segments, 6), rotation: finite(params.rotation, 0), sourceAngle: finite(params.sourceAngle, 0),
      zoom: finite(params.zoom, 1), centerX: finite(params.centerX, .5), centerY: finite(params.centerY, .5), stretch: params.shape === 'frame', edges: edgeMode(params.edges) };
    case 'mirror': {
      const horizontal = params.horizontal !== false, vertical = params.vertical === true;
      return horizontal || vertical ? { type, horizontal, vertical, keepEnd: params.keep === 'end', angle: finite(params.angle, 0),
        centerX: finite(params.centerX, .5), centerY: finite(params.centerY, .5), edges: edgeMode(params.edges) } : null;
    }
    case 'rgb-split': {
      const amount = finite(params.amount, .01);
      return amount === 0 ? null : { type, amount, angle: finite(params.angle, 0), lens: params.mode === 'lens', edges: edgeMode(params.edges) };
    }
    // 1-pixel cells (judged at the rendered size) leave the picture unchanged: applyPixelate skips them.
    case 'pixelate': return { type, size: finite(params.size, 12) };
    default: return undefined;
  }
}

const cellPixels = (size: number, width: number, height: number) => Math.max(1, Math.floor(size * Math.min(width, height) / CELL_REFERENCE_HEIGHT + .5));

/** Straight RGBA bytes → premultiplied floats (0…1). */
function premultiplied(data: Uint8ClampedArray): Float32Array {
  const out = new Float32Array(data.length);
  for (let index = 0; index < data.length; index += 4) {
    const alpha = data[index + 3] / 255;
    out[index] = data[index] / 255 * alpha; out[index + 1] = data[index + 1] / 255 * alpha; out[index + 2] = data[index + 2] / 255 * alpha; out[index + 3] = alpha;
  }
  return out;
}

/** Bilinear, clamp-to-edge read of the premultiplied frame (like the GPU's linear sampler on the cache). */
function bilinear(source: Float32Array, width: number, height: number, u: number, v: number): Pixel {
  const x = u * width - .5, y = v * height - .5, x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const result: Pixel = [0, 0, 0, 0];
  const corners: [number, number, number][] = [[x0, y0, (1 - fx) * (1 - fy)], [x0 + 1, y0, fx * (1 - fy)], [x0, y0 + 1, (1 - fx) * fy], [x0 + 1, y0 + 1, fx * fy]];
  for (const [cx, cy, weight] of corners) {
    if (!weight) continue;
    const index = (clamp(cy, 0, height - 1) * width + clamp(cx, 0, width - 1)) * 4;
    for (let channel = 0; channel < 4; channel += 1) result[channel] += source[index + channel] * weight;
  }
  return result;
}

const mirrorRepeat = (value: number) => 1 - Math.abs((value * .5 - Math.floor(value * .5)) * 2 - 1);

/** One premultiplied read with the frame-edge mode (Transparent: one-pixel soft coverage). */
function edgeRead(source: Float32Array, width: number, height: number, u: number, v: number, edges: EdgeMode): Pixel {
  const read = edges === 'mirror' ? bilinear(source, width, height, mirrorRepeat(u), mirrorRepeat(v))
    : bilinear(source, width, height, clamp(u, 0, 1), clamp(v, 0, 1));
  if (edges !== 'transparent') return read;
  const coverage = clamp(Math.min(u * width, v * height, (1 - u) * width, (1 - v) * height) + .5, 0, 1);
  return read.map(value => value * coverage) as Pixel;
}

function writeStraight(data: Uint8ClampedArray, index: number, [r, g, b, a]: Pixel): void {
  const alpha = Math.max(a, 1e-6);
  data[index] = Math.round(r / alpha * 255); data[index + 1] = Math.round(g / alpha * 255); data[index + 2] = Math.round(b / alpha * 255);
  data[index + 3] = Math.round(a * 255);
}

function kaleidoscopeRead(source: Float32Array, width: number, height: number, adjustment: Extract<WorkerSoftwareMirrorPixelAdjustment, { type: 'kaleidoscope' }>,
  count: number, angle: number, radius: number, scale: [number, number]): Pixel {
  const wedge = Math.PI * 2 / count, progress = angle / wedge, wrapped = (progress - Math.floor(progress)) * wedge;
  const folded = (wrapped > wedge * .5 ? wedge - wrapped : wrapped) + adjustment.sourceAngle;
  return edgeRead(source, width, height, adjustment.centerX + Math.cos(folded) * radius / scale[0],
    adjustment.centerY + Math.sin(folded) * radius / scale[1], adjustment.edges);
}

function applyResampling(data: Uint8ClampedArray, width: number, height: number, adjustment: Exclude<WorkerSoftwareMirrorPixelAdjustment, { type: 'pixelate' }>): void {
  const source = premultiplied(data), short = Math.max(1, Math.min(width, height));
  const circle: [number, number] = [width / short, height / short];
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const u = (x + .5) / width, v = (y + .5) / height;
    let result: Pixel;
    if (adjustment.type === 'kaleidoscope') {
      const scale: [number, number] = adjustment.stretch ? [1, 1] : circle;
      const px = (u - adjustment.centerX) * scale[0], py = (v - adjustment.centerY) * scale[1];
      const angle = Math.atan2(py, px) + adjustment.rotation, radius = Math.hypot(px, py) / Math.max(adjustment.zoom, KALEIDOSCOPE_MIN_ZOOM);
      const count = clamp(adjustment.segments, KALEIDOSCOPE_MIN_SEGMENTS, KALEIDOSCOPE_MAX_SEGMENTS), low = Math.floor(count), t = count - low;
      const a = kaleidoscopeRead(source, width, height, adjustment, low, angle, radius, scale);
      const b = t > 0 ? kaleidoscopeRead(source, width, height, adjustment, low + 1, angle, radius, scale) : a;
      result = a.map((value, channel) => value + (b[channel] - value) * t) as Pixel;
    } else if (adjustment.type === 'mirror') {
      const angle = adjustment.angle, c = Math.cos(angle), s = Math.sin(angle), sign = adjustment.keepEnd ? 1 : -1;
      const px = (u - adjustment.centerX) * circle[0], py = (v - adjustment.centerY) * circle[1];
      let lx = px * c + py * s, ly = -px * s + py * c;
      if (adjustment.horizontal) lx = Math.abs(lx) * sign;
      if (adjustment.vertical) ly = Math.abs(ly) * sign;
      result = edgeRead(source, width, height, adjustment.centerX + (lx * c - ly * s) / circle[0], adjustment.centerY + (lx * s + ly * c) / circle[1], adjustment.edges);
    } else {
      const dx = Math.cos(adjustment.angle), dy = Math.sin(adjustment.angle), reach = Math.hypot(dx * width, dy * height) * adjustment.amount;
      const [ox, oy] = adjustment.lens ? [(u - .5) * -RGB_SPLIT_LENS_SCALE * adjustment.amount, (v - .5) * -RGB_SPLIT_LENS_SCALE * adjustment.amount]
        : [dx * reach / width, dy * reach / height];
      const red = edgeRead(source, width, height, u + ox, v + oy, adjustment.edges), green = bilinear(source, width, height, u, v);
      const blue = edgeRead(source, width, height, u - ox, v - oy, adjustment.edges);
      result = [red[0], green[1], blue[2], Math.max(red[3], green[3], blue[3])];
    }
    writeStraight(data, (y * width + x) * 4, result);
  }
}

/** Exact cell averages of the premultiplied frame on the centred grid. */
function applyPixelate(data: Uint8ClampedArray, width: number, height: number, size: number): void {
  const cell = cellPixels(size, width, height);
  if (cell <= 1) return;
  const source = premultiplied(data);
  const originX = Math.floor(width * .5), originY = Math.floor(height * .5);
  const firstX = originX - Math.ceil(originX / cell) * cell, firstY = originY - Math.ceil(originY / cell) * cell;
  for (let startY = firstY; startY < height; startY += cell) for (let startX = firstX; startX < width; startX += cell) {
    const x0 = Math.max(0, startX), x1 = Math.min(width, startX + cell), y0 = Math.max(0, startY), y1 = Math.min(height, startY + cell);
    if (x1 <= x0 || y1 <= y0) continue;
    const sum: Pixel = [0, 0, 0, 0];
    for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) {
      const index = (y * width + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) sum[channel] += source[index + channel];
    }
    const average = sum.map(value => value / ((x1 - x0) * (y1 - y0))) as Pixel;
    for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) writeStraight(data, (y * width + x) * 4, average);
  }
}

/** Applies the adjustments in stack order to straight RGBA bytes, in place. */
export function applyWorkerSoftwareMirrorPixelEffects(data: Uint8ClampedArray, width: number, height: number,
  adjustments: readonly WorkerSoftwareMirrorPixelAdjustment[]): void {
  for (const adjustment of adjustments) {
    if (adjustment.type === 'pixelate') applyPixelate(data, width, height, adjustment.size);
    else applyResampling(data, width, height, adjustment);
  }
}
