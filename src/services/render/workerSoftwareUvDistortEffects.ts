import type { Effect } from '../../types/effects';
import { effectOperatorParams } from '../operators/effectGraphOwner';
import { isNeutralUvDistortEffect, rendersBuiltInUvDistortRecipe } from '../operators/uvDistortIdentity';
import { DISTORT_EDGE_OPTIONS, PINCH_BETA_LIMIT, RADIUS_EPSILON } from '../operators/uvDistortRecipes';

type Rgba = readonly [number, number, number, number];
/** 0 Mirror, 1 Clamp, 2 Transparent (the order of the Frame Edges options). */
type EdgeIndex = 0 | 1 | 2;

/** One built-in Wave, Twirl or Bulge & Pinch in the worker CPU fallback (see uvDistortRecipes.ts). */
export type WorkerSoftwareUvDistortAdjustment = {
  readonly kind: 'bulge' | 'twirl'; readonly amount: number; readonly radius: number;
  readonly centerX: number; readonly centerY: number; readonly stretchToFrame: boolean; readonly edges: EdgeIndex;
} | {
  readonly kind: 'wave'; readonly amplitudeX: number; readonly amplitudeY: number; readonly frequencyX: number;
  readonly frequencyY: number; readonly speed: number; readonly phaseDegrees: number; readonly edges: EdgeIndex;
};

const TAU = Math.PI * 2;
const finite = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/**
 * The hand-written CPU form of an untouched built-in recipe, so the worker software fallback and
 * worker-first export readback do not interpret the whole graph per pixel. Undefined for an
 * edited graph (the graph interpreter runs it); null when the settings change nothing.
 */
export function workerSoftwareUvDistortAdjustment(effect: Effect): WorkerSoftwareUvDistortAdjustment | null | undefined {
  if (effect.type !== 'wave' && effect.type !== 'twirl' && effect.type !== 'bulge') return undefined;
  if (!rendersBuiltInUvDistortRecipe(effect)) return undefined;
  if (isNeutralUvDistortEffect(effect)) return null;
  const params = effectOperatorParams(effect);
  // Unknown choices fall back to the defaults, exactly as the graph's choice binding does.
  const edgeChoice = DISTORT_EDGE_OPTIONS.findIndex(option => option.value === params.edges);
  const edges = (edgeChoice < 0 ? 0 : edgeChoice) as EdgeIndex;
  if (effect.type === 'wave') return {
    kind: 'wave', edges, amplitudeX: finite(params.amplitudeX, 0.015), amplitudeY: finite(params.amplitudeY, 0.015),
    frequencyX: finite(params.frequencyX, 4), frequencyY: finite(params.frequencyY, 4),
    speed: finite(params.speed, 0.5), phaseDegrees: finite(params.phase, 0),
  };
  return {
    kind: effect.type, edges, amount: finite(params.amount, 2), radius: finite(params.radius, 0.5),
    centerX: finite(params.centerX, 0.5), centerY: finite(params.centerY, 0.5), stretchToFrame: params.shape === 'frame',
  };
}

/** Where the output pixel at `uv` reads the source: the recipe's mapping before the frame-edge rule. */
function sampleUv(adjustment: WorkerSoftwareUvDistortAdjustment, uvX: number, uvY: number, width: number, height: number,
  timelineTime: number): [number, number] {
  if (adjustment.kind === 'wave') {
    const phase = adjustment.phaseDegrees * Math.PI / 180 + adjustment.speed * timelineTime * TAU;
    const y = uvY + Math.sin(uvX * adjustment.frequencyX * TAU + phase) * adjustment.amplitudeX;
    return [uvX + Math.sin(y * adjustment.frequencyY * TAU + phase) * adjustment.amplitudeY, y];
  }
  // Shape space: Circle measures in units of the shorter side, Stretch to Frame per axis.
  const shortSide = Math.min(width, height);
  const scaleX = adjustment.stretchToFrame ? 1 : width / shortSide, scaleY = adjustment.stretchToFrame ? 1 : height / shortSide;
  const px = (uvX - adjustment.centerX) * scaleX, py = (uvY - adjustment.centerY) * scaleY;
  const r = Math.hypot(px, py) / Math.max(adjustment.radius, RADIUS_EPSILON);
  let movedX: number, movedY: number;
  if (adjustment.kind === 'bulge') {
    const inside = Math.max(1 - r * r, 0), amount = adjustment.amount;
    const beta = Math.log(Math.max(amount, 1)) - PINCH_BETA_LIMIT * Math.min(Math.max(1 - amount, 0), 1);
    const scale = Math.exp(-beta * inside * inside);
    movedX = px * scale; movedY = py * scale;
  } else {
    const falloff = 1 - Math.min(r, 1), angle = adjustment.amount * falloff * falloff;
    const sine = Math.sin(angle), cosine = Math.cos(angle);
    movedX = px * cosine - py * sine; movedY = px * sine + py * cosine;
  }
  return [adjustment.centerX + movedX / scaleX, adjustment.centerY + movedY / scaleY];
}

const mirror = (value: number) => { const wrapped = value - Math.floor(value * .5) * 2; return wrapped > 1 ? 2 - wrapped : wrapped; };
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

/**
 * One output pixel: the recipe's mapping, the frame-edge rule, then one bilinear, clamp-to-edge
 * read of premultiplied texels (the GPU reads its premultiplied rgba16float cache the same way),
 * unpremultiplied at the end, so cut-outs and transparent frame edges keep their colour.
 */
export function applyWorkerSoftwareUvDistort(source: Uint8ClampedArray, width: number, height: number, uvX: number, uvY: number,
  adjustment: WorkerSoftwareUvDistortAdjustment, timelineTime: number): Rgba {
  const [u, v] = sampleUv(adjustment, uvX, uvY, width, height, timelineTime);
  const readU = adjustment.edges === 0 ? mirror(u) : clamp01(u), readV = adjustment.edges === 0 ? mirror(v) : clamp01(v);
  const x = readU * width - .5, y = readV * height - .5, x0 = Math.floor(x), y0 = Math.floor(y), tx = x - x0, ty = y - y0;
  let red = 0, green = 0, blue = 0, alpha = 0;
  for (let corner = 0; corner < 4; corner++) {
    const dx = corner & 1, dy = corner >> 1, weight = (dx ? tx : 1 - tx) * (dy ? ty : 1 - ty);
    if (weight === 0) continue;
    const column = Math.max(0, Math.min(width - 1, x0 + dx)), row = Math.max(0, Math.min(height - 1, y0 + dy));
    const offset = (row * width + column) * 4, texelAlpha = source[offset + 3] / 255, premultiplied = weight * texelAlpha / 255;
    red += source[offset] * premultiplied; green += source[offset + 1] * premultiplied; blue += source[offset + 2] * premultiplied;
    alpha += weight * texelAlpha;
  }
  if (adjustment.edges === 2) {
    // Transparent: a one-pixel soft edge that lowers coverage only (colour is restored below).
    const inside = Math.min(u * width, v * height, (1 - u) * width, (1 - v) * height);
    const coverage = clamp01(inside + .5);
    red *= coverage; green *= coverage; blue *= coverage; alpha *= coverage;
  }
  const safe = Math.max(alpha, 1e-6);
  return [red / safe, green / safe, blue / safe, alpha];
}
