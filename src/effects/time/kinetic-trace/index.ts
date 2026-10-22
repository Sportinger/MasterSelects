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
/** Saved Motion Trails from before Softness existed keep their sharp trail. */
export const KINETIC_TRACE_LEGACY_SOFTNESS = 0;
export const KINETIC_TRACE_DEFAULT_SOFTNESS = 1;
/** Softness is in pixels of a 1080-line frame, so the trail looks the same at every preview size. */
export const KINETIC_TRACE_MAX_SOFTNESS = 8;
/** The Overlay colour of saved Motion Trails without one (it only tinted the tracked glow then). */
const LEGACY_COLOR = '#36f59a';
const DEFAULT_COLOR = '#7fd8ff';

/** Named starting points (the card's Preset row): the trail and its colour. */
export const KINETIC_TRACE_PRESETS: readonly EffectPreset[] = [
  { id: 'light-trails', name: 'Light Trails', params: { trail: 0.9, tint: 0, softness: 1 } },
  { id: 'light-painting', name: 'Light Painting', params: { trail: 0.995, tint: 0, softness: 0.5 } },
  { id: 'neon-trace', name: 'Neon Trace', params: { trail: 0.93, tint: 0.5, color: '#22d3ff', softness: 1 } },
  { id: 'embers', name: 'Embers', params: { trail: 0.95, tint: 0.6, color: '#ff7a2f', softness: 2.5 } },
  { id: 'afterimage', name: 'Afterimage', params: { trail: 0.97, tint: 0.4, color: '#b9a4ff', softness: 4 } },
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
 * The share of the previous frame the shader keeps per frame. The engine feeds back the trace at
 * Amount 1 (feedbackStateParams), so Amount only sets how much of it shows and the trail keeps Length.
 * A Motion Trails saved before Length fed back its Amount-mixed output with 0.9 and keeps that.
 */
export function kineticTraceKeep(params: Record<string, unknown>): number {
  if (params.trail === undefined) return KINETIC_TRACE_LEGACY_KEEP;
  return clamp01(numeric(params.trail, KINETIC_TRACE_DEFAULT_TRAIL));
}

/** The trace the next frame builds on: unmixed (Amount 1), except for saves from before Length. */
export function kineticTraceFeedbackState(params: Record<string, number | boolean | string>): Record<string, number> | undefined {
  return params.trail === undefined ? undefined : { amount: 1 };
}

/** Softness in pixels of a 1080-line frame, clamped to 0…8. */
export function kineticTraceSoftness(params: Record<string, unknown>): number {
  return Math.min(KINETIC_TRACE_MAX_SOFTNESS, Math.max(0, numeric(params.softness, KINETIC_TRACE_LEGACY_SOFTNESS)));
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
  const softness = params.softness;
  if (softness !== undefined && (typeof softness !== 'number' || !Number.isFinite(softness))) notes.push(`Softness is not a number; it renders as ${KINETIC_TRACE_LEGACY_SOFTNESS}.`);
  else if (typeof softness === 'number' && (softness < 0 || softness > KINETIC_TRACE_MAX_SOFTNESS)) {
    notes.push(`Softness ${softness} is outside 0 to ${KINETIC_TRACE_MAX_SOFTNESS} px; it renders as ${kineticTraceSoftness(params)} px.`);
  }
  if (params.trail === undefined && typeof params.amount === 'number' && params.amount < 1) {
    notes.push('This Motion Trails was saved before Length: its trail still shortens with Amount. Set Length to make Amount a plain opacity.');
  }
  const color = params.color;
  if (numeric(params.tint, KINETIC_TRACE_LEGACY_TINT) <= 0 && typeof color === 'string' && ![DEFAULT_COLOR, LEGACY_COLOR].includes(color.toLowerCase())) {
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
  feedbackStateParams: kineticTraceFeedbackState,
  requiresContinuousRender: true,
  presets: KINETIC_TRACE_PRESETS,
  params: {
    trail: { type: 'number', label: 'Length', default: KINETIC_TRACE_DEFAULT_TRAIL, legacyDefault: KINETIC_TRACE_LEGACY_TRAIL, min: 0, max: 1, step: 0.01, animatable: true, group: 'Trail' },
    softness: { type: 'number', label: 'Softness', default: KINETIC_TRACE_DEFAULT_SOFTNESS, legacyDefault: KINETIC_TRACE_LEGACY_SOFTNESS,
      min: 0, max: KINETIC_TRACE_MAX_SOFTNESS, step: 0.1, unit: ' px', animatable: true, group: 'Trail' },
    tint: { type: 'number', label: 'Tint', default: 0, legacyDefault: KINETIC_TRACE_LEGACY_TINT, min: 0, max: 1, step: 0.01, animatable: true, group: 'Color' },
    color: { type: 'color', label: 'Overlay', default: DEFAULT_COLOR, legacyDefault: LEGACY_COLOR, group: 'Color' },
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
    kineticTraceSoftness(params),
    0,
  ]),
};
