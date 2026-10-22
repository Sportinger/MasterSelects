/**
 * Edge Detect contract, shared by the operator graph (`services/operators/edgeDetectEffectGraph.ts`),
 * the parameter notes and the tests.
 *
 * - Edges are the brightness gradient of a Gaussian of sigma = Width pixels of a 1080p frame
 *   (a derivative-of-Gaussian, the first stage of Canny), measured on premultiplied brightness, so
 *   the outline of a title on a transparent layer is an edge too. The window reaches two sigma,
 *   at most EDGE_MAX_REACH_PX pixels; sigma is never below EDGE_MIN_SIGMA_PX pixels. The outermost
 *   taps count with the share of them two sigma covers, so an animated Width changes smoothly
 *   (the 3.2.7 recipe used whole taps out to ceil(2 sigma) and jumped at each step; saved ones keep it).
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
/** Window half size in pixels is ceil(2 sigma), at most this. */
export const EDGE_MAX_REACH_PX = 8;
export const EDGE_VIVID_FLOOR = 0.05;

const finite = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/** Gaussian sigma in pixels for a Width on a frame whose shorter side is `shortSide` pixels. */
export function edgeSigmaPx(width: number, shortSide: number): number {
  return Math.max(EDGE_MIN_SIGMA_PX, Math.max(width, EDGE_MIN_WIDTH) * shortSide / EDGE_REFERENCE_HEIGHT);
}

/** Window half size in pixels for a Width on a frame whose shorter side is `shortSide`. */
export function edgeReachPx(width: number, shortSide: number): number {
  return Math.min(EDGE_MAX_REACH_PX, Math.ceil(2 * edgeSigmaPx(width, shortSide)));
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
  } else if (Math.ceil(2 * edgeSigmaPx(lineWidth, shortSide)) > EDGE_MAX_REACH_PX) {
    notes.push(`Width ${lineWidth} needs a wider window than ${EDGE_MAX_REACH_PX} px at ${width}x${height}; the edges come out slightly thinner than set.`);
  }
  return notes;
}
