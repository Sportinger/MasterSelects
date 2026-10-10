/**
 * Shared Glow sampling contract. The editable operator graph, the WGSL reference
 * shader and the worker software path all follow these rules:
 *
 * 1. Bright pass: each source pixel emits `rgb * alpha * smoothstep(threshold ± 0.1, luma)`.
 * 2. Prefilter: a separable Gaussian (horizontal, then vertical) of that light, sized
 *    to the ring sample spacing. Taps sit on texel boundaries two pixels apart, so the
 *    linear sampler averages every source texel exactly once (no gaps for thin strokes).
 * 3. Rings: ring k sits at `k * radius * 10` pixels, converted per axis, so the glow is
 *    round on non-square layers. Each ring keeps its legacy total weight
 *    `samplesPerRing * gaussian(k / rings)` but spreads it over enough samples that the
 *    outer arc spacing never exceeds the ring spacing (bounded by 64 per ring).
 * 4. Resolve: premultiplied source + glow light; alpha grows to cover the halo, so a
 *    straight-alpha compositor shows the glow outside transparent glyphs.
 */
export const GLOW_MAX_RINGS = 32;
export const GLOW_MIN_SAMPLES_PER_RING = 4;
export const GLOW_MAX_SAMPLES_PER_RING = 64;
/** Legacy radius unit: one radius step moves each ring by ten source pixels. */
export const GLOW_PIXELS_PER_RADIUS = 10;
/** One rect-reduce row holds at most 64 taps, two pixels apart: a ±63 px prefilter. */
export const GLOW_MAX_PREFILTER_TAPS_PER_SIDE = 32;
export const GLOW_MIN_PREFILTER_SIGMA_PX = 0.5;
export const GLOW_THRESHOLD_SOFTNESS = 0.1;
export const GLOW_SOFTNESS_OFFSET = 0.3;
export const GLOW_CENTER_WEIGHT = 2;
export const GLOW_AMOUNT_GAIN = 2;
export const GLOW_RING_STAGGER = 0.5;

export interface GlowSamplingParams {
  rings?: unknown;
  samplesPerRing?: unknown;
  radius?: unknown;
}

export interface GlowSamplingPlan {
  /** Requested values after the legacy clamp and truncation. */
  readonly rings: number;
  readonly samplesPerRing: number;
  /** Samples per ring needed to keep the outer arc spacing within one ring step. */
  readonly requiredSamplesPerRing: number;
  readonly effectiveSamplesPerRing: number;
  readonly ringStepPx: number;
  /** Largest gap between neighbouring samples, radially or along the outer ring. */
  readonly sampleSpacingPx: number;
  readonly prefilterSigmaPx: number;
  readonly requiredPrefilterTapsPerSide: number;
  readonly prefilterTapsPerSide: number;
  /** True when a requested or derived count was clamped. */
  readonly ringsClamped: boolean;
  readonly samplesClamped: boolean;
  readonly sampleCapReached: boolean;
  readonly prefilterCapReached: boolean;
}

const finite = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Catalog defaults are applied by the caller; missing values fall back to them here as well. */
export function resolveGlowSampling(params: GlowSamplingParams): GlowSamplingPlan {
  const requestedRings = finite(params.rings, 6.85), requestedSamples = finite(params.samplesPerRing, 17.95);
  const rings = Math.floor(clamp(requestedRings, 1, GLOW_MAX_RINGS));
  const samplesPerRing = Math.floor(clamp(requestedSamples, GLOW_MIN_SAMPLES_PER_RING, GLOW_MAX_SAMPLES_PER_RING));
  const ringCircumference = Math.PI * 2 * rings;
  // TAU * rings is never an integer, so floor + 1 is its ceiling.
  const requiredSamplesPerRing = Math.floor(ringCircumference) + 1;
  const effectiveSamplesPerRing = Math.min(Math.max(samplesPerRing, requiredSamplesPerRing), GLOW_MAX_SAMPLES_PER_RING);
  const ringStepPx = finite(params.radius, 1) * GLOW_PIXELS_PER_RADIUS;
  const sampleSpacingPx = Math.abs(ringStepPx) * Math.max(1, ringCircumference / effectiveSamplesPerRing);
  const prefilterSigmaPx = Math.max(sampleSpacingPx * 0.5, GLOW_MIN_PREFILTER_SIGMA_PX);
  const requiredPrefilterTapsPerSide = Math.floor(prefilterSigmaPx * 1.5) + 1;
  const prefilterTapsPerSide = Math.min(requiredPrefilterTapsPerSide, GLOW_MAX_PREFILTER_TAPS_PER_SIDE);
  return {
    rings, samplesPerRing, requiredSamplesPerRing, effectiveSamplesPerRing, ringStepPx, sampleSpacingPx,
    prefilterSigmaPx, requiredPrefilterTapsPerSide, prefilterTapsPerSide,
    ringsClamped: requestedRings < 1 || requestedRings > GLOW_MAX_RINGS,
    samplesClamped: requestedSamples < GLOW_MIN_SAMPLES_PER_RING || requestedSamples > GLOW_MAX_SAMPLES_PER_RING,
    sampleCapReached: requiredSamplesPerRing > GLOW_MAX_SAMPLES_PER_RING && samplesPerRing < requiredSamplesPerRing,
    prefilterCapReached: requiredPrefilterTapsPerSide > GLOW_MAX_PREFILTER_TAPS_PER_SIDE,
  };
}

/** Horizontal/vertical prefilter offset in pixels for tap `index` of `2 * tapsPerSide`. */
export const glowPrefilterOffsetPx = (index: number, tapsPerSide: number) => 2 * index - 2 * tapsPerSide + 0.5;

/** Ring sample offset in normalized UV; pixels are converted per axis. */
export function glowRingOffsetUv(ring: number, sample: number, plan: GlowSamplingPlan, width: number, height: number): [number, number] {
  const angle = (sample * Math.PI * 2) / plan.effectiveSamplesPerRing + ring * GLOW_RING_STAGGER;
  const distance = ring * plan.ringStepPx;
  return [(Math.cos(angle) * distance) / width, (Math.sin(angle) * distance) / height];
}

/** Human-readable quality limits for the inspector; undefined when Glow renders as requested. */
export function glowQualityNote(plan: GlowSamplingPlan): string | undefined {
  const notes: string[] = [];
  if (plan.ringsClamped) notes.push(`Rings is limited to 1–${GLOW_MAX_RINGS}; using ${plan.rings}.`);
  if (plan.samplesClamped) {
    notes.push(`Samples/Ring is limited to ${GLOW_MIN_SAMPLES_PER_RING}–${GLOW_MAX_SAMPLES_PER_RING}; using ${plan.samplesPerRing}.`);
  }
  if (plan.sampleCapReached) {
    notes.push(`${plan.rings} rings need ${plan.requiredSamplesPerRing} samples per ring for an even glow; `
      + `capped at ${GLOW_MAX_SAMPLES_PER_RING}, so the prefilter widens instead.`);
  }
  if (plan.prefilterCapReached) {
    notes.push(`This radius needs a ±${Math.round(plan.prefilterSigmaPx * 3)} px prefilter; it is capped at `
      + `±${GLOW_MAX_PREFILTER_TAPS_PER_SIDE * 2 - 1} px, so faint ring structure can remain. Lower Radius or Rings for a fully smooth glow.`);
  }
  return notes.length ? notes.join(' ') : undefined;
}
