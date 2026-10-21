// CPU form of the Chroma Key screen matte for the worker software path (no Edge kernel;
// that path declines Chroma Key with Edge Softness or Shrink/Grow). Contract: keyerContract.ts.
import {
  CHROMA_KEY_BLUE_PRIOR, CHROMA_KEY_DARK_FLOOR, CHROMA_KEY_FULL_SCREEN_PURITY, CHROMA_KEY_GREEN_PRIOR, CHROMA_KEY_LOCAL_PRIOR_WEIGHT, CHROMA_KEY_LOCAL_PURITY_TRUST,
  CHROMA_KEY_MIN_SCREEN_PURITY, CHROMA_KEY_PRIOR_WEIGHT, CHROMA_KEY_SCREEN_COVERAGE, CHROMA_KEY_SCREEN_GRID_EDGE,
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

function parts(r: number, g: number, b: number, channel: 0 | 1 | 2): [number, number] {
  const c = [Math.max(0, r), Math.max(0, g), Math.max(0, b)];
  return [c[channel], Math.max(...c.filter((_value, index) => index !== channel))];
}

/**
 * Screen colour for one frame of 8-bit straight RGBA pixels: the automatic estimate or the pick.
 * With the frame size it also keeps the Screen Grid (longer side CHROMA_KEY_SCREEN_GRID_EDGE cells).
 */
export function chromaKeyCpuScreen(pixels: ArrayLike<number>, settings: ChromaKeyCpuSettings, width?: number, height?: number): ChromaKeyCpuScreen {
  if (settings.screen === 'custom') {
    const color = settings.screenColor, channel = chromaKeyPrimaryChannel(color), [primary, other] = parts(color[0], color[1], color[2], channel);
    return { color, channel, found: smoothstep(CHROMA_KEY_MIN_SCREEN_PURITY, CHROMA_KEY_FULL_SCREEN_PURITY, primary > 0 ? (primary - other) / primary : 0) };
  }
  const channel = settings.screen === 'blue' ? 2 : 1;
  const prior = settings.screen === 'blue' ? CHROMA_KEY_BLUE_PRIOR : CHROMA_KEY_GREEN_PRIOR;
  const count = Math.floor(pixels.length / 4);
  const sized = width !== undefined && height !== undefined && width > 0 && height > 0 && width * height === count;
  const scale = sized ? Math.min(1, CHROMA_KEY_SCREEN_GRID_EDGE / Math.max(width, height)) : 1;
  const columns = sized ? Math.max(1, Math.round(width * scale)) : 1, rows = sized ? Math.max(1, Math.round(height * scale)) : 1;
  const sums = new Float32Array(columns * rows * 3), weights = new Float32Array(columns * rows), cellCounts = new Float32Array(columns * rows);
  let weight = 0, r = 0, g = 0, b = 0;
  for (let index = 0; index < count; index += 1) {
    const offset = index * 4, pr = pixels[offset] / 255, pg = pixels[offset + 1] / 255, pb = pixels[offset + 2] / 255;
    const [primary, other] = parts(pr, pg, pb, channel);
    const w = smoothstep(CHROMA_KEY_SCREEN_WEIGHT_PURITY[0], CHROMA_KEY_SCREEN_WEIGHT_PURITY[1], (primary - other) / Math.max(primary, 1e-4))
      * smoothstep(CHROMA_KEY_SCREEN_WEIGHT_LEVEL[0], CHROMA_KEY_SCREEN_WEIGHT_LEVEL[1], primary) * (pixels[offset + 3] / 255);
    weight += w; r += w * pr; g += w * pg; b += w * pb;
    if (sized) {
      const cell = Math.min(rows - 1, Math.floor(Math.floor(index / width) * rows / height)) * columns
        + Math.min(columns - 1, Math.floor((index % width) * columns / width));
      sums[cell * 3] += w * pr; sums[cell * 3 + 1] += w * pg; sums[cell * 3 + 2] += w * pb; weights[cell] += w; cellCounts[cell] += 1;
    }
  }
  const coverage = count ? weight / count : 0, mean = count ? 1 / count : 0;
  const denominator = coverage + CHROMA_KEY_PRIOR_WEIGHT;
  const color: [number, number, number] = [(r * mean + prior[0] * CHROMA_KEY_PRIOR_WEIGHT) / denominator,
    (g * mean + prior[1] * CHROMA_KEY_PRIOR_WEIGHT) / denominator, (b * mean + prior[2] * CHROMA_KEY_PRIOR_WEIGHT) / denominator];
  const [primary, other] = parts(color[0], color[1], color[2], channel);
  const purity = primary > 0 ? (primary - other) / primary : 0;
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

/** Local screen colour at a pixel: bilinear Screen Grid mean with the frame estimate as a faint prior. */
function localScreen(screen: ChromaKeyCpuScreen, x: number, y: number): readonly [number, number, number] {
  const grid = screen.grid;
  if (!grid) return screen.color;
  const gx = Math.min(grid.columns - 1, Math.max(0, (x + 0.5) * grid.columns / grid.frameWidth - 0.5));
  const gy = Math.min(grid.rows - 1, Math.max(0, (y + 0.5) * grid.rows / grid.frameHeight - 0.5));
  const x0 = Math.floor(gx), y0 = Math.floor(gy), x1 = Math.min(grid.columns - 1, x0 + 1), y1 = Math.min(grid.rows - 1, y0 + 1);
  const fx = gx - x0, fy = gy - y0;
  const taps: Array<[number, number]> = [[y0 * grid.columns + x0, (1 - fx) * (1 - fy)], [y0 * grid.columns + x1, fx * (1 - fy)],
    [y1 * grid.columns + x0, (1 - fx) * fy], [y1 * grid.columns + x1, fx * fy]];
  let weight = CHROMA_KEY_LOCAL_PRIOR_WEIGHT;
  const sum = screen.color.map(value => value * CHROMA_KEY_LOCAL_PRIOR_WEIGHT);
  for (const [cell, share] of taps) {
    weight += grid.weights[cell] * share;
    for (let channel = 0; channel < 3; channel += 1) sum[channel] += grid.sums[cell * 3 + channel] * share;
  }
  const local: [number, number, number] = [sum[0] / weight, sum[1] / weight, sum[2] / weight];
  // A local colour much less pure than the frame estimate is chiffon or smoke filling the cell, not screen.
  const purity = (color: readonly number[]) => {
    const [primary, other] = parts(color[0], color[1], color[2], screen.channel);
    return (primary - other) / Math.max(primary, 1e-4);
  };
  const trust = smoothstep(CHROMA_KEY_LOCAL_PURITY_TRUST[0], CHROMA_KEY_LOCAL_PURITY_TRUST[1], purity(local) / Math.max(purity(screen.color), 1e-4));
  return [0, 1, 2].map(index => screen.color[index] + (local[index] - screen.color[index]) * trust) as [number, number, number];
}

/** Keys one straight RGBA pixel (0..1); `x`/`y` (pixel coordinates) select the local screen colour. */
export function chromaKeyCpuPixel(input: readonly [number, number, number, number], screen: ChromaKeyCpuScreen,
  settings: ChromaKeyCpuSettings, x = 0, y = 0): [number, number, number, number] {
  const [screenPrimary, screenOther] = parts(screen.color[0], screen.color[1], screen.color[2], screen.channel);
  const [primary, other] = parts(input[0], input[1], input[2], screen.channel);
  const brightness = Math.max(Math.min(screenPrimary, Math.max(primary, CHROMA_KEY_DARK_FLOOR * screenPrimary)), 1e-4);
  const transparency = (primary - other) * screenPrimary / (Math.max(screenPrimary - screenOther, 1e-4) * brightness) * screen.found;
  const raw = 1 - Math.min(1, Math.max(0, transparency));
  const clipBlack = Math.min(1, Math.max(0, settings.clipBlack)), clipWhite = Math.min(1, Math.max(0, settings.clipWhite));
  const matte = Math.min(1, Math.max(0, (raw - clipBlack) / Math.max(clipWhite - clipBlack, 1e-3)));
  const alpha = input[3] * matte;
  if (settings.view === 'matte') return [alpha, alpha, alpha, 1];
  // Screen subtraction with the (dimmed) local screen colour behind the pixel.
  const positive = [Math.max(0, input[0]), Math.max(0, input[1]), Math.max(0, input[2])];
  const behind = localScreen(screen, x, y), behindPrimary = Math.max(0, behind[screen.channel]);
  const dim = Math.min(behindPrimary, Math.max(primary, CHROMA_KEY_DARK_FLOOR * behindPrimary)) / Math.max(behindPrimary, 1e-4);
  const ceiling = Math.max(1, ...positive);
  const trust = smoothstep(CHROMA_KEY_UNMIX_TRUST[0], CHROMA_KEY_UNMIX_TRUST[1], matte);
  const colour = positive.map((value, channel) => {
    const unmixed = Math.min(ceiling, Math.max(0, value - (1 - matte) * behind[channel] * dim)) / Math.max(matte, 1e-4);
    return Math.min(ceiling, Math.max(0, value + (unmixed - value) * trust));
  });
  const others = colour.filter((_value, index) => index !== screen.channel);
  const limit = settings.spillMethod === 'max' ? Math.max(others[0], others[1]) : (others[0] + others[1]) / 2;
  const excess = Math.max(colour[screen.channel] - limit, 0) * Math.min(1, Math.max(0, settings.spillSuppression)) * screen.found;
  colour[screen.channel] -= excess;
  return [colour[0], colour[1], colour[2], alpha];
}
