/**
 * Edge Detect contract, shared by the operator graph (`services/operators/edgeDetectEffectGraph.ts`),
 * the parameter notes and the tests.
 *
 * - Edges are the brightness gradient of a Gaussian of sigma = Width pixels of a 1080p frame
 *   (a derivative-of-Gaussian, the first stage of Canny), measured on premultiplied brightness, so
 *   the outline of a title on a transparent layer is an edge too. The window reaches two sigma at
 *   any frame size; sigma is never below EDGE_MIN_SIGMA_PX pixels. The window is separable and
 *   runs as a horizontal pass (cached) and a vertical pass, with taps one pixel apart out to two
 *   sigma, so it averages every pixel it covers: a Width draws the same line, and lets the same
 *   amount of fine texture through, in a half-size preview, at 1080p and at 4K. Past
 *   EDGE_PASS_TAPS taps per side the taps spread out (reported by edgeDetectParamNotes). The
 *   outermost taps count with the share of them two sigma covers, so an animated Width changes
 *   smoothly (the 3.2.7 recipe used whole taps out to ceil(2 sigma), at most 8 px, in one 2D
 *   window, and jumped at each step; saved ones keep it).
 * - The gradient is divided by the window's own second moment, so it is exact for a brightness
 *   ramp at any Width and resolution; a hard step of contrast c then gives a response of about
 *   x = c * EDGE_GAIN * Strength (EDGE_GAIN matches the brightness of the earlier Sobel edges).
 *   The line strength is 1 - exp(-x): linear for faint edges, rolling off softly instead of
 *   clipping, so dense detail keeps its structure.
 * - Lines are white on black (Invert: black on white); Color tints them with the picture's own
 *   colour at full brightness: the alpha-weighted mean of this pixel and two taps one and two
 *   sigma towards the brighter side of the edge, so an outline outside a layer takes its colour.
 * - Lines are composited over the background premultiplied: alpha = edge + source alpha *
 *   (1 - edge), colour = (line * edge + background * source alpha * (1 - edge)) / alpha. An
 *   outline outside a transparent layer keeps its full line colour.
 */
export const EDGE_REFERENCE_HEIGHT = 1080;
export const EDGE_GAIN = 4;
export const EDGE_MIN_WIDTH = 0.25;
/** A pixel grid cannot resolve a narrower Gaussian; below it edges would fade instead of thinning. */
export const EDGE_MIN_SIGMA_PX = 0.7;
/** Window taps per side of the 3.2.7 recipe (one 2D window, ending at 8 px). */
export const EDGE_WINDOW_TAPS = 8;
/** Taps per side of each pass of the current recipe; a wider window spaces them further apart (see edgeTapSpacingPx). */
export const EDGE_PASS_TAPS = 64;
export const EDGE_VIVID_FLOOR = 0.05;

const finite = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/** Gaussian sigma in pixels for a Width on a frame whose shorter side is `shortSide` pixels. */
export function edgeSigmaPx(width: number, shortSide: number): number {
  return Math.max(EDGE_MIN_SIGMA_PX, Math.max(width, EDGE_MIN_WIDTH) * shortSide / EDGE_REFERENCE_HEIGHT);
}

/** Distance in pixels between neighbouring window taps: 1, or 2 sigma / EDGE_PASS_TAPS for a wider window. */
export function edgeTapSpacingPx(width: number, shortSide: number): number {
  return Math.max(1, 2 * edgeSigmaPx(width, shortSide) / EDGE_PASS_TAPS);
}

/** Notes for values Edge Detect limits at this frame size; empty when it renders them as set. */
export function edgeDetectParamNotes(params: Record<string, unknown>, width = 1920, height = 1080): string[] {
  const notes: string[] = [];
  const strength = finite(params.strength, 1), lineWidth = finite(params.width, 1), colorize = finite(params.colorize, 0);
  const shortSide = Math.max(1, Math.min(width, height));
  if (strength < 0) notes.push(`Strength ${strength} is below 0; it is used as 0 (no edges).`);
  if (colorize < 0 || colorize > 1) notes.push(`Color ${colorize} is outside 0–1; it is used as ${colorize < 0 ? 0 : 1}.`);
  if (lineWidth * shortSide / EDGE_REFERENCE_HEIGHT < EDGE_MIN_SIGMA_PX) {
    notes.push(`Width ${lineWidth} is finer than a pixel can show at ${width}x${height}; the lines stay ${EDGE_MIN_SIGMA_PX} px wide.`);
  }
  const spacing = edgeTapSpacingPx(lineWidth, shortSide);
  if (spacing > 1) {
    notes.push(`Width ${lineWidth} needs a window wider than ${EDGE_PASS_TAPS} px per side at ${width}x${height}; its taps sit ${spacing.toFixed(1)} px apart, so fine texture can leave a little more speckle than in a smaller frame.`);
  }
  return notes;
}
