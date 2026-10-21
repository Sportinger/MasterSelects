// CPU form of the Chroma Key screen matte for the worker software path (no Edge kernel;
// that path declines Chroma Key with Edge Softness or Shrink/Grow). Contract: keyerContract.ts.
// The per-pixel work is scalar only (no arrays or closures per pixel): a 1080p frame keys in tens
// of milliseconds, since the worker export readback path uses it for every frame.
import {
  CHROMA_KEY_BLUE_PRIOR, CHROMA_KEY_DARK_FLOOR, CHROMA_KEY_FULL_SCREEN_PURITY, CHROMA_KEY_GREEN_PRIOR, CHROMA_KEY_LOCAL_PRIOR_WEIGHT, CHROMA_KEY_LOCAL_PURITY_TRUST,
  CHROMA_KEY_MIN_CLIP_SPAN, CHROMA_KEY_MIN_SCREEN_PURITY, CHROMA_KEY_PRIOR_WEIGHT, CHROMA_KEY_SCREEN_COVERAGE, CHROMA_KEY_SCREEN_GRID_EDGE,
  CHROMA_KEY_SCREEN_WEIGHT_LEVEL, CHROMA_KEY_SCREEN_WEIGHT_PURITY, CHROMA_KEY_UNMIX_TRUST,
  chromaKeyPrimaryChannel, type ChromaKeyScreen, type ChromaKeySpillMethod,
} from './keyerContract';

export interface ChromaKeyCpuSettings {
  readonly screen: ChromaKeyScreen;
  /** Picked colour (straight sRGB-encoded 0..1), used for 'custom'. */
  readonly screenColor: readonly [number, number, number];
  readonly clipBlack: number;
  readonly clipWhite: number;
  readonly spillSuppression: number;
  /** Optional for older callers; Neutral (average) by default. */
  readonly spillMethod?: ChromaKeySpillMethod;
  readonly view: 'result' | 'matte';
}

/** Screen Grid: per-cell means of (weight * rgb) and of the weight, row-major. */
export interface ChromaKeyCpuGrid {
  readonly columns: number;
  readonly rows: number;
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly sums: Float32Array;
  readonly weights: Float32Array;
}

export interface ChromaKeyCpuScreen {
  readonly color: readonly [number, number, number];
  readonly channel: 0 | 1 | 2;
  /** 0..1: how sure the key is that a screen exists (0 keys nothing). */
  readonly found: number;
  /** Local screen colours for screen subtraction (absent for a picked colour or without frame size). */
  readonly grid?: ChromaKeyCpuGrid;
}

const smoothstep = (low: number, high: number, value: number) => {
  const t = Math.min(1, Math.max(0, (value - low) / (high - low)));
  return t * t * (3 - 2 * t);
};
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
/** The two non-primary channel indices of a primary channel. */
const OTHERS: Readonly<Record<0 | 1 | 2, readonly [0 | 1 | 2, 0 | 1 | 2]>> = { 0: [1, 2], 1: [0, 2], 2: [0, 1] };
/** Screen difference purity (c_p - max(c_o)) / c_p of a straight colour (negative channels count as 0). */
function purityOf(r: number, g: number, b: number, channel: 0 | 1 | 2): number {
  const c0 = Math.max(0, r), c1 = Math.max(0, g), c2 = Math.max(0, b);
  const primary = channel === 0 ? c0 : channel === 1 ? c1 : c2;
  const other = channel === 0 ? Math.max(c1, c2) : channel === 1 ? Math.max(c0, c2) : Math.max(c0, c1);
  return (primary - other) / Math.max(primary, 1e-4);
}

/**
 * Screen colour for one frame of 8-bit straight RGBA pixels: the automatic estimate or the pick.
 * With the frame size it also keeps the Screen Grid (longer side CHROMA_KEY_SCREEN_GRID_EDGE cells).
 */
export function chromaKeyCpuScreen(pixels: ArrayLike<number>, settings: ChromaKeyCpuSettings, width?: number, height?: number): ChromaKeyCpuScreen {
  if (settings.screen === 'custom') {
    const color = settings.screenColor, channel = chromaKeyPrimaryChannel(color);
    const primary = Math.max(0, color[channel]);
    return { color, channel, found: primary > 0 ? smoothstep(CHROMA_KEY_MIN_SCREEN_PURITY, CHROMA_KEY_FULL_SCREEN_PURITY, purityOf(color[0], color[1], color[2], channel)) : 0 };
  }
  const channel = settings.screen === 'blue' ? 2 : 1;
  const prior = settings.screen === 'blue' ? CHROMA_KEY_BLUE_PRIOR : CHROMA_KEY_GREEN_PRIOR;
  const count = Math.floor(pixels.length / 4);
  const sized = width !== undefined && height !== undefined && width > 0 && height > 0 && width * height === count;
  const scale = sized ? Math.min(1, CHROMA_KEY_SCREEN_GRID_EDGE / Math.max(width, height)) : 1;
  const columns = sized ? Math.max(1, Math.round(width * scale)) : 1, rows = sized ? Math.max(1, Math.round(height * scale)) : 1;
  const sums = new Float32Array(columns * rows * 3), weights = new Float32Array(columns * rows), cellCounts = new Float32Array(columns * rows);
  const columnOf = sized ? Int32Array.from({ length: width }, (_value, x) => Math.min(columns - 1, Math.floor(x * columns / width))) : undefined;
  const [purityLow, purityHigh] = CHROMA_KEY_SCREEN_WEIGHT_PURITY, [levelLow, levelHigh] = CHROMA_KEY_SCREEN_WEIGHT_LEVEL;
  const [otherA, otherB] = OTHERS[channel];
  let weight = 0, r = 0, g = 0, b = 0;
  for (let index = 0, x = 0, y = 0, rowCell = 0; index < count; index += 1) {
    const offset = index * 4, pr = pixels[offset] / 255, pg = pixels[offset + 1] / 255, pb = pixels[offset + 2] / 255;
    // 8-bit input is never negative: primary and other are plain channel reads.
    const primary = channel === 1 ? pg : pb;
    const other = Math.max(otherA === 0 ? pr : pg, otherB === 2 ? pb : pg);
    const w = smoothstep(purityLow, purityHigh, (primary - other) / Math.max(primary, 1e-4))
      * smoothstep(levelLow, levelHigh, primary) * (pixels[offset + 3] / 255);
    weight += w; r += w * pr; g += w * pg; b += w * pb;
    if (columnOf) {
      const cell = rowCell + columnOf[x];
      sums[cell * 3] += w * pr; sums[cell * 3 + 1] += w * pg; sums[cell * 3 + 2] += w * pb; weights[cell] += w; cellCounts[cell] += 1;
      if (++x === width) { x = 0; y += 1; rowCell = Math.min(rows - 1, Math.floor(y * rows / height!)) * columns; }
    }
  }
  const coverage = count ? weight / count : 0, mean = count ? 1 / count : 0;
  const denominator = coverage + CHROMA_KEY_PRIOR_WEIGHT;
  const color: [number, number, number] = [(r * mean + prior[0] * CHROMA_KEY_PRIOR_WEIGHT) / denominator,
    (g * mean + prior[1] * CHROMA_KEY_PRIOR_WEIGHT) / denominator, (b * mean + prior[2] * CHROMA_KEY_PRIOR_WEIGHT) / denominator];
  const purity = Math.max(0, color[channel]) > 0 ? purityOf(color[0], color[1], color[2], channel) : 0;
  let grid: ChromaKeyCpuGrid | undefined;
  if (sized) {
    for (let cell = 0; cell < weights.length; cell += 1) {
      const share = cellCounts[cell] ? 1 / cellCounts[cell] : 0;
      weights[cell] *= share; sums[cell * 3] *= share; sums[cell * 3 + 1] *= share; sums[cell * 3 + 2] *= share;
    }
    grid = { columns, rows, frameWidth: width, frameHeight: height, sums, weights };
  }
  return { color, channel, grid, found: smoothstep(CHROMA_KEY_SCREEN_COVERAGE[0], CHROMA_KEY_SCREEN_COVERAGE[1], coverage)
    * smoothstep(CHROMA_KEY_MIN_SCREEN_PURITY, CHROMA_KEY_FULL_SCREEN_PURITY, purity) };
}

/** Bilinear Screen Grid taps of one axis: lower cell, upper cell and the upper cell's share, per pixel. */
interface AxisTaps { readonly low: Int32Array; readonly high: Int32Array; readonly share: Float32Array }
function axisTaps(pixels: number, cells: number): AxisTaps {
  const low = new Int32Array(pixels), high = new Int32Array(pixels), share = new Float32Array(pixels);
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const position = clamp((pixel + 0.5) * cells / pixels - 0.5, 0, cells - 1), lower = Math.floor(position);
    low[pixel] = lower; high[pixel] = Math.min(cells - 1, lower + 1); share[pixel] = position - lower;
  }
  return { low, high, share };
}

/** One frame's keyer: the screen, the settings and every per-frame constant, ready for chromaKeyCpuKey. */
export interface ChromaKeyCpuKeyer {
  readonly screen: ChromaKeyCpuScreen;
  readonly settings: ChromaKeyCpuSettings;
  readonly channel: 0 | 1 | 2;
  readonly otherA: 0 | 1 | 2;
  readonly otherB: 0 | 1 | 2;
  readonly screenPrimary: number;
  readonly screenReference: number;
  readonly screenPurity: number;
  readonly clipBlack: number;
  readonly clipRange: number;
  readonly spill: number;
  readonly gentle: boolean;
  readonly matteView: boolean;
  readonly columns?: AxisTaps;
  readonly rows?: AxisTaps;
}

export function prepareChromaKeyCpu(screen: ChromaKeyCpuScreen, settings: ChromaKeyCpuSettings): ChromaKeyCpuKeyer {
  const channel = screen.channel, [otherA, otherB] = OTHERS[channel], color = screen.color;
  const screenPrimary = Math.max(0, color[channel]);
  const screenOther = Math.max(Math.max(0, color[otherA]), Math.max(0, color[otherB]));
  const clipBlack = clamp(settings.clipBlack, 0, 1), clipWhite = clamp(settings.clipWhite, 0, 1);
  const grid = screen.grid;
  return { screen, settings, channel, otherA, otherB, screenPrimary, screenReference: Math.max(screenPrimary - screenOther, 1e-4),
    screenPurity: purityOf(color[0], color[1], color[2], channel), clipBlack, clipRange: Math.max(clipWhite - clipBlack, CHROMA_KEY_MIN_CLIP_SPAN),
    spill: clamp(settings.spillSuppression, 0, 1) * screen.found, gentle: settings.spillMethod === 'max', matteView: settings.view === 'matte',
    ...(grid ? { columns: axisTaps(grid.frameWidth, grid.columns), rows: axisTaps(grid.frameHeight, grid.rows) } : {}) };
}

/**
 * Keys one straight RGBA pixel (0..1) into `out` (r, g, b, a); `x`/`y` (pixel coordinates inside the
 * frame the grid was measured on) select the local screen colour.
 */
export function chromaKeyCpuKey(keyer: ChromaKeyCpuKeyer, r: number, g: number, b: number, a: number, x: number, y: number, out: Float32Array | Float64Array | number[]): void {
  const channel = keyer.channel, otherA = keyer.otherA, otherB = keyer.otherB, screen = keyer.screen, color = screen.color;
  const c0 = Math.max(0, r), c1 = Math.max(0, g), c2 = Math.max(0, b);
  const primary = channel === 0 ? c0 : channel === 1 ? c1 : c2;
  const other = Math.max(otherA === 0 ? c0 : c1, otherB === 2 ? c2 : c1);
  const brightness = Math.max(Math.min(keyer.screenPrimary, Math.max(primary, CHROMA_KEY_DARK_FLOOR * keyer.screenPrimary)), 1e-4);
  const transparency = (primary - other) * keyer.screenPrimary / (keyer.screenReference * brightness) * screen.found;
  const raw = 1 - clamp(transparency, 0, 1);
  const matte = clamp((raw - keyer.clipBlack) / keyer.clipRange, 0, 1);
  const alpha = a * matte;
  if (keyer.matteView) { out[0] = alpha; out[1] = alpha; out[2] = alpha; out[3] = 1; return; }
  // Fully keyed (0) and fully solid (1) pixels keep their colour: screen subtraction only acts in between.
  let o0 = c0, o1 = c1, o2 = c2;
  if (matte > 0 && matte < 1) {
    // The screen behind the pixel: the local Screen Grid colour (with the frame estimate as a faint prior),
    // trusted only while it is nearly as pure as the frame estimate, else the frame estimate.
    let behind0 = color[0], behind1 = color[1], behind2 = color[2];
    const grid = screen.grid, columns = keyer.columns, rows = keyer.rows;
    if (grid && columns && rows) {
      const px = clamp(Math.floor(x), 0, grid.frameWidth - 1), py = clamp(Math.floor(y), 0, grid.frameHeight - 1);
      const fx = columns.share[px], fy = rows.share[py];
      const top = rows.low[py] * grid.columns, bottom = rows.high[py] * grid.columns;
      const c00 = top + columns.low[px], c10 = top + columns.high[px], c01 = bottom + columns.low[px], c11 = bottom + columns.high[px];
      const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
      const sums = grid.sums, weights = grid.weights, prior = CHROMA_KEY_LOCAL_PRIOR_WEIGHT;
      const weight = prior + weights[c00] * w00 + weights[c10] * w10 + weights[c01] * w01 + weights[c11] * w11;
      const local0 = (color[0] * prior + sums[c00 * 3] * w00 + sums[c10 * 3] * w10 + sums[c01 * 3] * w01 + sums[c11 * 3] * w11) / weight;
      const local1 = (color[1] * prior + sums[c00 * 3 + 1] * w00 + sums[c10 * 3 + 1] * w10 + sums[c01 * 3 + 1] * w01 + sums[c11 * 3 + 1] * w11) / weight;
      const local2 = (color[2] * prior + sums[c00 * 3 + 2] * w00 + sums[c10 * 3 + 2] * w10 + sums[c01 * 3 + 2] * w01 + sums[c11 * 3 + 2] * w11) / weight;
      // A local colour much less pure than the frame estimate is chiffon or smoke filling the cell, not screen.
      const trust = smoothstep(CHROMA_KEY_LOCAL_PURITY_TRUST[0], CHROMA_KEY_LOCAL_PURITY_TRUST[1],
        purityOf(local0, local1, local2, channel) / Math.max(keyer.screenPurity, 1e-4));
      behind0 += (local0 - behind0) * trust; behind1 += (local1 - behind1) * trust; behind2 += (local2 - behind2) * trust;
    }
    // Screen subtraction with the local screen dimmed like the matte dims it.
    const behindPrimary = Math.max(0, channel === 0 ? behind0 : channel === 1 ? behind1 : behind2);
    const dim = Math.min(behindPrimary, Math.max(primary, CHROMA_KEY_DARK_FLOOR * behindPrimary)) / Math.max(behindPrimary, 1e-4);
    const ceiling = Math.max(1, c0, c1, c2), share = (1 - matte) * dim, divisor = Math.max(matte, 1e-4);
    const trust = smoothstep(CHROMA_KEY_UNMIX_TRUST[0], CHROMA_KEY_UNMIX_TRUST[1], matte);
    o0 = clamp(c0 + (Math.min(ceiling, Math.max(0, c0 - share * behind0)) / divisor - c0) * trust, 0, ceiling);
    o1 = clamp(c1 + (Math.min(ceiling, Math.max(0, c1 - share * behind1)) / divisor - c1) * trust, 0, ceiling);
    o2 = clamp(c2 + (Math.min(ceiling, Math.max(0, c2 - share * behind2)) / divisor - c2) * trust, 0, ceiling);
  }
  // Spill: the screen channel down to the mean (Neutral) or the stronger (Gentle) of the other two.
  const first = otherA === 0 ? o0 : o1, second = otherB === 2 ? o2 : o1;
  const limit = keyer.gentle ? Math.max(first, second) : (first + second) / 2;
  const excess = Math.max((channel === 0 ? o0 : channel === 1 ? o1 : o2) - limit, 0) * keyer.spill;
  if (channel === 0) o0 -= excess; else if (channel === 1) o1 -= excess; else o2 -= excess;
  out[0] = o0; out[1] = o1; out[2] = o2; out[3] = alpha;
}

/** Keys one straight RGBA pixel (0..1); `x`/`y` (pixel coordinates) select the local screen colour. */
export function chromaKeyCpuPixel(input: readonly [number, number, number, number], screen: ChromaKeyCpuScreen,
  settings: ChromaKeyCpuSettings, x = 0, y = 0): [number, number, number, number] {
  const out: [number, number, number, number] = [0, 0, 0, 0];
  chromaKeyCpuKey(prepareChromaKeyCpu(screen, settings), input[0], input[1], input[2], input[3], x, y, out);
  return out;
}
