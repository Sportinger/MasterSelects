// Chroma Key screen-matte contract, shared by the image graph
// (services/operators/chromaKeyEffectGraph.ts), the worker software path and the tests.
//
// For a straight RGB colour c and screen colour S with primary channel p (G for green,
// B for blue, the strongest channel of a picked colour) and the other two channels o:
//   E(c)   = c_p - max(c_o)                         screen difference
//   t(c)   = E(c) * S_p / (E(S) * clamp(c_p, 0.25 * S_p, S_p))
//   matte  = 1 - clamp(t, 0, 1), then levels: clamp((matte - clipBlack) / (clipWhite - clipBlack), 0, 1)
// Pixels at least as bright as the screen need the screen's full difference E(S) to vanish;
// darker pixels compare their purity E/c_p with the screen's, so shadowed and falloff areas of
// the screen key as cleanly as its lit centre.
// Screen subtraction: colour = max(c - (1 - matte) * B, 0) / matte, with B the screen behind the pixel:
// the local screen colour L (Screen Grid mean around the pixel, the frame estimate where no cell saw
// screen, the pick for a picked colour) dimmed like the matte dims it, B = L * clamp(c_p, 0.25 L_p, L_p) / L_p.
// L only counts where it is nearly as pure as the frame estimate (purity ratio 0.5..0.8): a cell filled by
// chiffon or smoke is not screen and falls back to the frame estimate.
// The matte is the Clip Black/White matte before Shrink/Grow and Edge Softness; below a matte of 0.05
// the pixel's own colour fades back in (the division would only amplify noise there).
// Spill: c_p -= max(c_p - L, 0) * spill, with the limit L = mean(c_o) (Neutral, the default: hair and
// fabric lose the screen tint without turning olive) or L = max(c_o) (Gentle: keeps yellows on a green
// screen and cyans on a blue one, but leaves an olive/teal cast on hair).

/** Edge Softness and Shrink/Grow are pixels on a 1080p frame (shorter side). */
export const CHROMA_KEY_REFERENCE_HEIGHT = 1080;
/** Below this share of the screen's primary channel a pixel is compared by purity, not difference. */
export const CHROMA_KEY_DARK_FLOOR = 0.25;
/** Screen colours whose purity E(S)/S_p is below this cannot be keyed (grey picks key nothing). */
export const CHROMA_KEY_MIN_SCREEN_PURITY = 0.06;
export const CHROMA_KEY_FULL_SCREEN_PURITY = 0.12;
/** Auto screen colour: purity and brightness ramps that decide which pixels count as screen. */
export const CHROMA_KEY_SCREEN_WEIGHT_PURITY = [0.1, 0.3] as const;
export const CHROMA_KEY_SCREEN_WEIGHT_LEVEL = [0.03, 0.12] as const;
/** Share of the frame (by weight) that must look like screen before the auto key engages. */
export const CHROMA_KEY_SCREEN_COVERAGE = [0.002, 0.01] as const;
/** Auto screen estimate: a 64 px grid (5x5 reads per cell), then one 33x33 average. */
export const CHROMA_KEY_SCREEN_GRID_EDGE = 64;
export const CHROMA_KEY_SCREEN_CELL_EXTENT = 2;
export const CHROMA_KEY_SCREEN_AVERAGE_EXTENT = 16;
/** Prior used only while no screen is found (its tiny weight never shifts a real estimate). */
export const CHROMA_KEY_PRIOR_WEIGHT = 1e-5;
/** Local screen colour: weight of the frame estimate added to each Screen Grid read (cells without screen fall back to it). */
export const CHROMA_KEY_LOCAL_PRIOR_WEIGHT = 1e-3;
/** Local screen colour is trusted from this share of the frame estimate's purity (below: frame estimate). */
export const CHROMA_KEY_LOCAL_PURITY_TRUST = [0.5, 0.8] as const;
/** Screen subtraction fades in between these matte values. */
export const CHROMA_KEY_UNMIX_TRUST = [0, 0.05] as const;
export const CHROMA_KEY_GREEN_PRIOR = [0.25, 0.6, 0.3] as const;
export const CHROMA_KEY_BLUE_PRIOR = [0.2, 0.3, 0.65] as const;
/** Shrink/Grow: a soft minimum (maximum) of the matte, -ln(mean(exp(-k m))) / k, over a Gaussian of
 * sigma = |shrink| / 2.4 px read out to 4.5 sigma (so the window edge adds no step); a hard edge moves
 * by about |shrink| with a ramp of about 1.5 |shrink|, while flat semi-transparent areas (chiffon,
 * smoke) keep their value. */
export const CHROMA_KEY_SHRINK_SHARPNESS = 10;
export const CHROMA_KEY_SHRINK_SIGMA_DIVISOR = 2.4;
export const CHROMA_KEY_SHRINK_REACH_SIGMAS = 4.5;
/** Edge Softness: Gaussian blur of the matte whose 10-90 % ramp is the softness (sigma = softness / 2.56). */
export const CHROMA_KEY_SOFTNESS_SIGMA_DIVISOR = 2.56;
/** Separable Gaussian passes: taps every pixel (Edge Softness out to 3 sigma), at most 32 per side (wider kernels stride). */
export const CHROMA_KEY_GAUSSIAN_REACH_SIGMAS = 3;
export const CHROMA_KEY_GAUSSIAN_MAX_TAPS_PER_SIDE = 32;
/** Edge Softness and |Shrink/Grow| beyond this (1080p px) are clamped; the inspector says so. */
export const CHROMA_KEY_MAX_EDGE_PX = 20;
export const CHROMA_KEY_DEFAULT_SCREEN_COLOR = '#4c9a55';

export type ChromaKeyScreen = 'green' | 'blue' | 'custom';
export type ChromaKeySpillMethod = 'average' | 'max';

export function chromaKeySpillMethod(value: unknown): ChromaKeySpillMethod {
  return value === 'max' ? 'max' : 'average';
}

export function chromaKeyScreen(value: unknown): ChromaKeyScreen {
  return value === 'blue' ? 'blue' : value === 'custom' ? 'custom' : 'green';
}

/** '#rrggbb' → straight sRGB-encoded [r, g, b] in 0..1 (falls back to the default colour). */
export function chromaKeyHexColor(value: unknown): [number, number, number] {
  const hex = typeof value === 'string' && /^#?[0-9a-f]{6}$/i.test(value.trim()) ? value.trim().replace('#', '') : CHROMA_KEY_DEFAULT_SCREEN_COLOR.slice(1);
  return [0, 2, 4].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255) as [number, number, number];
}

/** Primary channel index of a screen colour (ties prefer green, then blue). */
export function chromaKeyPrimaryChannel(color: readonly number[]): 0 | 1 | 2 {
  if (color[1] >= Math.max(color[0], color[2])) return 1;
  return color[2] >= color[0] ? 2 : 0;
}

/** Purity E(S)/S_p of a screen colour; below CHROMA_KEY_MIN_SCREEN_PURITY nothing is keyed. */
export function chromaKeyScreenPurity(color: readonly number[]): number {
  const primary = chromaKeyPrimaryChannel(color);
  const others = [0, 1, 2].filter(index => index !== primary).map(index => color[index]);
  return color[primary] > 0 ? (color[primary] - Math.max(...others)) / color[primary] : 0;
}

export interface ChromaKeyNumbers {
  clipBlack: number;
  clipWhite: number;
  spill: number;
  softness: number;
  shrink: number;
  /** Parameters that arrived outside their usable range and were clamped (for the inspector). */
  clamped: string[];
}

/** The numbers the graph actually uses (the graph applies the same clamps). A value outside its usable
 * range is used at the limit, an unusable one (NaN, text) as the default; both are listed in `clamped`. */
export function chromaKeyNumbers(params: Record<string, unknown>): ChromaKeyNumbers {
  const clamped: string[] = [];
  const read = (key: string, fallback: number, min: number, max: number) => {
    const raw = params[key];
    if (raw === undefined) return fallback;
    if (typeof raw !== 'number' || !Number.isFinite(raw)) { clamped.push(key); return fallback; }
    const result = Math.min(max, Math.max(min, raw));
    if (result !== raw) clamped.push(key);
    return result;
  };
  return {
    clipBlack: read('clipBlack', 0.3, 0, 1),
    clipWhite: read('clipWhite', 0.85, 0, 1),
    spill: read('spillSuppression', 1, 0, 1),
    softness: read('edgeSoftness', 0, 0, CHROMA_KEY_MAX_EDGE_PX),
    shrink: read('edgeShrink', 0, -CHROMA_KEY_MAX_EDGE_PX, CHROMA_KEY_MAX_EDGE_PX),
    clamped,
  };
}
