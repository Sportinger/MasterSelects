import { KALEIDOSCOPE_MAX_SEGMENTS, KALEIDOSCOPE_MIN_SEGMENTS, KALEIDOSCOPE_MIN_ZOOM, RGB_SPLIT_LENS_SCALE } from '../operators/mirrorRecipes';
import { CELL_REFERENCE_HEIGHT } from '../operators/cellGridRecipes';
import { applyWorkerSoftwarePointwiseFrame, type WorkerSoftwarePointwiseStep } from './workerSoftwarePointwiseEffects';

/**
 * Worker CPU fallback (software preview, worker-first export readback) for the built-in
 * Kaleidoscope, Mirror, RGB Split and Pixelate recipes (services/operators/mirrorRecipes.ts and
 * cellGridRecipes.ts): the same mappings, frame edges and premultiplied bilinear reads, applied to
 * the whole frame in stack order, together with the pointwise effects in front of them (a grade or
 * a key before Pixelate). Pixelate averages each cell exactly (the GPU spreads its taps for cells
 * wider than 128 rendered pixels). Edited graphs run through the graph interpreter instead.
 */
export type WorkerSoftwareMirrorPixelAdjustment =
  | { readonly type: 'kaleidoscope'; readonly segments: number; readonly rotation: number; readonly sourceAngle: number; readonly zoom: number;
    readonly centerX: number; readonly centerY: number; readonly stretch: boolean; readonly edges: EdgeMode }
  | { readonly type: 'mirror'; readonly horizontal: boolean; readonly vertical: boolean; readonly keepEnd: boolean; readonly angle: number;
    readonly centerX: number; readonly centerY: number; readonly edges: EdgeMode }
  | { readonly type: 'rgb-split'; readonly amount: number; readonly angle: number; readonly lens: boolean; readonly edges: EdgeMode }
  | { readonly type: 'pixelate'; readonly size: number }
  /** A pointwise effect that comes before a later mirror/pixel effect in the stack. */
  | { readonly type: 'pointwise'; readonly step: WorkerSoftwarePointwiseStep };
type EdgeMode = 'mirror' | 'clamp' | 'transparent';

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
      const amount = finite(params.amount, .005);
      return amount === 0 ? null : { type, amount, angle: finite(params.angle, 0), lens: params.mode === 'lens', edges: edgeMode(params.edges) };
    }
    // 1-pixel cells (judged at the rendered size) leave the picture unchanged: they are skipped.
    case 'pixelate': return { type, size: finite(params.size, 12) };
    default: return undefined;
  }
}

const cellPixels = (size: number, width: number, height: number) => Math.max(1, Math.floor(size * Math.min(width, height) / CELL_REFERENCE_HEIGHT + .5));

/**
 * Frame-sized float scratch, kept between frames (the worker renders one frame at a time) and
 * released after an idle second or two. Buffers only grow, so layers of different sizes in one
 * frame share them; a single resampling effect needs one buffer, a chain of them two.
 */
const BUFFER_RELEASE_MS = 2000;
let scratch: Float32Array[] = [];
let releaseTimer: ReturnType<typeof setTimeout> | undefined;
function scratchBuffer(slot: 0 | 1, length: number): Float32Array {
  let buffer = scratch[slot];
  if (!buffer || buffer.length < length) scratch[slot] = buffer = new Float32Array(length);
  return buffer.length === length ? buffer : buffer.subarray(0, length);
}
function scheduleScratchRelease(): void {
  if (typeof setTimeout !== 'function') return;
  if (releaseTimer !== undefined) clearTimeout(releaseTimer);
  releaseTimer = setTimeout(() => { scratch = []; releaseTimer = undefined; }, BUFFER_RELEASE_MS);
  (releaseTimer as { unref?: () => void }).unref?.();
}
/** Bytes held by the float scratch (diagnostics and tests). */
export function workerSoftwareMirrorPixelScratchBytes(): number {
  return scratch.reduce((total, buffer) => total + (buffer?.byteLength ?? 0), 0);
}

/** Straight RGBA bytes → premultiplied floats (0…1). */
function premultiplyInto(out: Float32Array, data: Uint8ClampedArray): void {
  for (let index = 0; index < data.length; index += 4) {
    const alpha = data[index + 3] / 255;
    out[index] = data[index] / 255 * alpha; out[index + 1] = data[index + 1] / 255 * alpha; out[index + 2] = data[index + 2] / 255 * alpha; out[index + 3] = alpha;
  }
}

/** Premultiplied floats → straight RGBA bytes. */
function writeStraight(data: Uint8ClampedArray, source: Float32Array): void {
  for (let index = 0; index < data.length; index += 4) {
    const a = source[index + 3], alpha = Math.max(a, 1e-6);
    data[index] = Math.round(source[index] / alpha * 255); data[index + 1] = Math.round(source[index + 1] / alpha * 255);
    data[index + 2] = Math.round(source[index + 2] / alpha * 255); data[index + 3] = Math.round(a * 255);
  }
}

/** One result pixel: premultiplied floats, or straight bytes when this is the last step. */
type Target = Float32Array | Uint8ClampedArray;
function store(target: Target, toBytes: boolean, index: number, r: number, g: number, b: number, a: number): void {
  if (!toBytes) { target[index] = r; target[index + 1] = g; target[index + 2] = b; target[index + 3] = a; return; }
  const alpha = Math.max(a, 1e-6);
  target[index] = Math.round(r / alpha * 255); target[index + 1] = Math.round(g / alpha * 255);
  target[index + 2] = Math.round(b / alpha * 255); target[index + 3] = Math.round(a * 255);
}

/** Per-read scratch pixels (no allocation per pixel). */
const readA = new Float32Array(4), readB = new Float32Array(4), readC = new Float32Array(4);

/** Bilinear, clamp-to-edge read of the premultiplied frame into `out` (like the GPU's linear sampler on the cache). */
function bilinear(out: Float32Array, source: Float32Array, width: number, height: number, u: number, v: number): void {
  const x = u * width - .5, y = v * height - .5, x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const left = clamp(x0, 0, width - 1) * 4, right = clamp(x0 + 1, 0, width - 1) * 4;
  const top = clamp(y0, 0, height - 1) * width * 4, bottom = clamp(y0 + 1, 0, height - 1) * width * 4;
  const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
  for (let channel = 0; channel < 4; channel += 1) {
    out[channel] = source[top + left + channel] * w00 + source[top + right + channel] * w10
      + source[bottom + left + channel] * w01 + source[bottom + right + channel] * w11;
  }
}

const mirrorRepeat = (value: number) => 1 - Math.abs((value * .5 - Math.floor(value * .5)) * 2 - 1);

/** One premultiplied read with the frame-edge mode into `out` (Transparent: one-pixel soft coverage). */
function edgeRead(out: Float32Array, source: Float32Array, width: number, height: number, u: number, v: number, edges: EdgeMode): void {
  if (edges === 'mirror') { bilinear(out, source, width, height, mirrorRepeat(u), mirrorRepeat(v)); return; }
  bilinear(out, source, width, height, clamp(u, 0, 1), clamp(v, 0, 1));
  if (edges !== 'transparent') return;
  const coverage = clamp(Math.min(u * width, v * height, (1 - u) * width, (1 - v) * height) + .5, 0, 1);
  if (coverage < 1) for (let channel = 0; channel < 4; channel += 1) out[channel] *= coverage;
}

function kaleidoscopeRead(out: Float32Array, source: Float32Array, width: number, height: number,
  adjustment: Extract<WorkerSoftwareMirrorPixelAdjustment, { type: 'kaleidoscope' }>, count: number, angle: number, radius: number, scaleX: number, scaleY: number): void {
  const wedge = Math.PI * 2 / count, progress = angle / wedge, wrapped = (progress - Math.floor(progress)) * wedge;
  const folded = (wrapped > wedge * .5 ? wedge - wrapped : wrapped) + adjustment.sourceAngle;
  edgeRead(out, source, width, height, adjustment.centerX + Math.cos(folded) * radius / scaleX,
    adjustment.centerY + Math.sin(folded) * radius / scaleY, adjustment.edges);
}

function applyResampling(target: Target, source: Float32Array, width: number, height: number,
  adjustment: Extract<WorkerSoftwareMirrorPixelAdjustment, { type: 'kaleidoscope' | 'mirror' | 'rgb-split' }>): void {
  const toBytes = !(target instanceof Float32Array);
  const short = Math.max(1, Math.min(width, height)), circleX = width / short, circleY = height / short;
  const kaleidoscope = adjustment.type === 'kaleidoscope' ? adjustment : undefined;
  const count = kaleidoscope ? clamp(kaleidoscope.segments, KALEIDOSCOPE_MIN_SEGMENTS, KALEIDOSCOPE_MAX_SEGMENTS) : 0;
  const low = Math.floor(count), t = count - low;
  const scaleX = kaleidoscope?.stretch ? 1 : circleX, scaleY = kaleidoscope?.stretch ? 1 : circleY;
  const turn = adjustment.type === 'mirror' ? adjustment.angle : 0, cos = Math.cos(turn), sin = Math.sin(turn);
  const split = adjustment.type === 'rgb-split' ? adjustment : undefined;
  const reach = split ? Math.hypot(Math.cos(split.angle) * width, Math.sin(split.angle) * height) * split.amount : 0;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const u = (x + .5) / width, v = (y + .5) / height, index = (y * width + x) * 4;
    if (kaleidoscope) {
      const px = (u - kaleidoscope.centerX) * scaleX, py = (v - kaleidoscope.centerY) * scaleY;
      const angle = Math.atan2(py, px) + kaleidoscope.rotation, radius = Math.hypot(px, py) / Math.max(kaleidoscope.zoom, KALEIDOSCOPE_MIN_ZOOM);
      kaleidoscopeRead(readA, source, width, height, kaleidoscope, low, angle, radius, scaleX, scaleY);
      if (t > 0) kaleidoscopeRead(readB, source, width, height, kaleidoscope, low + 1, angle, radius, scaleX, scaleY);
      if (t > 0) for (let channel = 0; channel < 4; channel += 1) readA[channel] += (readB[channel] - readA[channel]) * t;
      store(target, toBytes, index, readA[0], readA[1], readA[2], readA[3]);
    } else if (adjustment.type === 'mirror') {
      const sign = adjustment.keepEnd ? 1 : -1;
      const px = (u - adjustment.centerX) * circleX, py = (v - adjustment.centerY) * circleY;
      let lx = px * cos + py * sin, ly = -px * sin + py * cos;
      if (adjustment.horizontal) lx = Math.abs(lx) * sign;
      if (adjustment.vertical) ly = Math.abs(ly) * sign;
      edgeRead(readA, source, width, height, adjustment.centerX + (lx * cos - ly * sin) / circleX, adjustment.centerY + (lx * sin + ly * cos) / circleY, adjustment.edges);
      store(target, toBytes, index, readA[0], readA[1], readA[2], readA[3]);
    } else if (split) {
      const ox = split.lens ? (u - .5) * -RGB_SPLIT_LENS_SCALE * split.amount : Math.cos(split.angle) * reach / width;
      const oy = split.lens ? (v - .5) * -RGB_SPLIT_LENS_SCALE * split.amount : Math.sin(split.angle) * reach / height;
      edgeRead(readA, source, width, height, u + ox, v + oy, split.edges);
      bilinear(readB, source, width, height, u, v);
      edgeRead(readC, source, width, height, u - ox, v - oy, split.edges);
      store(target, toBytes, index, readA[0], readB[1], readC[2], Math.max(readA[3], readB[3], readC[3]));
    }
  }
}

/** Exact cell averages of the premultiplied frame on the centred grid (cells of 2 pixels or more). */
function applyPixelate(target: Target, source: Float32Array, width: number, height: number, cell: number): void {
  const toBytes = !(target instanceof Float32Array);
  const originX = Math.floor(width * .5), originY = Math.floor(height * .5);
  const firstX = originX - Math.ceil(originX / cell) * cell, firstY = originY - Math.ceil(originY / cell) * cell;
  for (let startY = firstY; startY < height; startY += cell) for (let startX = firstX; startX < width; startX += cell) {
    const x0 = Math.max(0, startX), x1 = Math.min(width, startX + cell), y0 = Math.max(0, startY), y1 = Math.min(height, startY + cell);
    if (x1 <= x0 || y1 <= y0) continue;
    let r = 0, g = 0, b = 0, a = 0;
    for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) {
      const index = (y * width + x) * 4;
      r += source[index]; g += source[index + 1]; b += source[index + 2]; a += source[index + 3];
    }
    const count = (x1 - x0) * (y1 - y0);
    r /= count; g /= count; b /= count; a /= count;
    for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) {
      const index = (y * width + x) * 4;
      store(target, toBytes, index, r, g, b, a);
    }
  }
}

/**
 * Applies the steps in stack order to straight RGBA bytes, in place: one premultiplied float copy
 * of the frame (a second one only when a resampling result is read again), pointwise steps in
 * place, and a final resampling step written straight back into the bytes.
 */
export function applyWorkerSoftwareMirrorPixelEffects(data: Uint8ClampedArray, width: number, height: number,
  adjustments: readonly WorkerSoftwareMirrorPixelAdjustment[], timelineTime = 0): void {
  const active = adjustments.filter(adjustment => adjustment.type !== 'pixelate' || cellPixels(adjustment.size, width, height) > 1);
  if (!active.length || width < 1 || height < 1) return;
  const lastResampling = active.findLastIndex(adjustment => adjustment.type !== 'pointwise');
  const resamplingCount = active.filter(adjustment => adjustment.type !== 'pointwise').length;
  // A second buffer only when a resampling step's result is read again (another resampling or pointwise step follows).
  const needsBack = resamplingCount > 1 || (lastResampling >= 0 && lastResampling < active.length - 1);
  let front = scratchBuffer(0, data.length), back = needsBack ? scratchBuffer(1, data.length) : undefined;
  scheduleScratchRelease();
  premultiplyInto(front, data);
  for (const [index, adjustment] of active.entries()) {
    if (adjustment.type === 'pointwise') { applyWorkerSoftwarePointwiseFrame(front, width, height, adjustment.step, timelineTime); continue; }
    const target: Target = index === lastResampling && index === active.length - 1 ? data : back!;
    if (adjustment.type === 'pixelate') applyPixelate(target, front, width, height, cellPixels(adjustment.size, width, height));
    else applyResampling(target, front, width, height, adjustment);
    if (target === data) return;
    [front, back] = [back!, front];
  }
  writeStraight(data, front);
}
