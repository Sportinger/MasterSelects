import type { EffectPreset, FullscreenEffectDefinition } from '../../types';
import { FEEDBACK_PARAMETERS } from '../../_shared/feedbackParameters';
import shader from './kineticTrace.wgsl?raw';

/** The share of the visible trail each new frame keeps. */
export const KINETIC_TRACE_DEFAULT_TRAIL = 0.9;
/**
 * Before Length existed every frame kept 0.9 of the previous output, which already carried Amount, so
 * the visible trail kept 0.9 × Amount per frame (0.72 at the old default Amount 0.8). A saved Motion
 * Trails without Length still renders exactly that way (kineticTraceKeep); the card shows 0.72.
 */
export const KINETIC_TRACE_LEGACY_KEEP = 0.9;
export const KINETIC_TRACE_LEGACY_TRAIL = 0.72;
/** Saved Motion Trails from before Tint existed render without it, as they always looked. */
export const KINETIC_TRACE_LEGACY_TINT = 0;
const DEFAULT_COLOR = '#36f59a';

/** Named starting points (the card's Preset row): the trail and its colour. */
export const KINETIC_TRACE_PRESETS: readonly EffectPreset[] = [
  { id: 'light-trails', name: 'Light Trails', params: { trail: 0.9, tint: 0 } },
  { id: 'long-streaks', name: 'Long Streaks', params: { trail: 0.96, tint: 0 } },
  { id: 'neon-trace', name: 'Neon Trace', params: { trail: 0.93, tint: 0.5, color: '#22d3ff' } },
  { id: 'embers', name: 'Embers', params: { trail: 0.95, tint: 0.35, color: '#ff7a2f' } },
  { id: 'afterimage', name: 'Afterimage', params: { trail: 0.985, tint: 0.2, color: '#ffd27a' } },
];

function numeric(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function rgba(value: unknown): [number, number, number, number] {
  const hex = typeof value === 'string' && /^#[\da-f]{6}$/i.test(value) ? value : DEFAULT_COLOR;
  return [1, 3, 5].map(start => Number.parseInt(hex.slice(start, start + 2), 16) / 255).concat(1) as [number, number, number, number];
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/**
 * The share of the previous output the shader keeps per frame. The output is already mixed with the
 * current picture by Amount, so the visible trail keeps Amount × keep per frame: keep = Length / Amount
 * makes it keep Length. keep never exceeds 1 (a larger factor would brighten static areas frame after
 * frame), so a Length above Amount fades like Length = Amount; the card says so.
 */
export function kineticTraceKeep(params: Record<string, unknown>): number {
  if (params.trail === undefined) return KINETIC_TRACE_LEGACY_KEEP;
  const amount = clamp01(numeric(params.amount, 1));
  const trail = clamp01(numeric(params.trail, KINETIC_TRACE_DEFAULT_TRAIL));
  return Math.min(1, trail / Math.max(amount, 1e-4));
}

/** Card and tool notes for values Motion Trails renders clamped or that change nothing. */
export function kineticTraceParamNotes(params: Record<string, number | boolean | string>): string[] {
  const notes: string[] = [];
  const range = (key: string, label: string, fallback: number) => {
    const value = params[key];
    if (value === undefined) return;
    if (typeof value !== 'number' || !Number.isFinite(value)) notes.push(`${label} is not a number; it renders as ${fallback}.`);
    else if (value < 0 || value > 1) notes.push(`${label} ${value} is outside 0 to 1; it renders as ${clamp01(value)}.`);
  };
  range('amount', 'Amount', 1);
  range('trail', 'Length', KINETIC_TRACE_DEFAULT_TRAIL);
  range('tint', 'Tint', KINETIC_TRACE_LEGACY_TINT);
  const amount = clamp01(numeric(params.amount, 1));
  if (typeof params.trail === 'number' && clamp01(params.trail) > amount + 1e-6) {
    notes.push(`Length ${clamp01(params.trail)} is above Amount ${amount}: the trail fades as at Length ${amount}, because each frame builds on the mixed picture. Raise Amount for a longer trail.`);
  }
  const color = params.color;
  if (numeric(params.tint, KINETIC_TRACE_LEGACY_TINT) <= 0 && typeof color === 'string' && color.toLowerCase() !== DEFAULT_COLOR) {
    notes.push('At Tint 0 the Overlay colour does not colour the trails; it only tints the glow around a tracked subject.');
  }
  if (typeof params.color === 'string' && !/^#[\da-f]{6}$/i.test(params.color)) {
    notes.push(`Overlay ${params.color} is not a #rrggbb colour; it renders as ${DEFAULT_COLOR}.`);
  }
  return notes;
}

export const kineticTrace: FullscreenEffectDefinition = {
  id: 'kinetic-trace',
  name: 'Motion Trails',
  category: 'tracking',
  shader,
  entryPoint: 'kineticTraceFragment',
  uniformSize: 80,
  landmarkPoints: true,
  usesFeedback: true,
  requiresContinuousRender: true,
  presets: KINETIC_TRACE_PRESETS,
  params: {
    trail: { type: 'number', label: 'Length', default: KINETIC_TRACE_DEFAULT_TRAIL, legacyDefault: KINETIC_TRACE_LEGACY_TRAIL, min: 0, max: 1, step: 0.01, animatable: true, group: 'Trail' },
    tint: { type: 'number', label: 'Tint', default: 0, legacyDefault: KINETIC_TRACE_LEGACY_TINT, min: 0, max: 1, step: 0.01, animatable: true, group: 'Color' },
    color: { type: 'color', label: 'Overlay', default: DEFAULT_COLOR, group: 'Color' },
    amount: { type: 'number', label: 'Amount', default: 1, min: 0, max: 1, step: 0.01, animatable: true, group: 'Mix' },
    speed: { type: 'number', label: 'Speed', default: 1, min: 0, max: 5, step: 0.05, animatable: true, group: 'Motion',
      deprecated: 'Motion Trails follow the tracked movement and have no speed; the value is ignored.' },
    ...FEEDBACK_PARAMETERS,
  },
  paramWarnings: params => kineticTraceParamNotes(params),
  packUniforms: (params, width, height, timelineTimeSeconds = 0) => new Float32Array([
    width,
    height,
    clamp01(numeric(params.amount, 1)),
    Number.isFinite(timelineTimeSeconds) ? timelineTimeSeconds : 0,
    0,
    numeric(params.trackingCenterX, 0.5),
    numeric(params.trackingCenterY, 0.5),
    Math.max(0.03, numeric(params.trackingSpread, 0.15)),
    numeric(params.trackingMotionX, 0),
    numeric(params.trackingMotionY, 0),
    numeric(params.trackingCount, 0),
    4,
    ...rgba(params.color),
    kineticTraceKeep(params),
    clamp01(numeric(params.tint, KINETIC_TRACE_LEGACY_TINT)),
    0,
    0,
  ]),
};
