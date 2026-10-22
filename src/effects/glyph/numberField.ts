// Number Field: the glyph engine as a field of figures in a few flat colours. Every cell takes one of Steps
// colours, evenly spaced from Dark to Light by its brightness, so the picture reads as stepped bands of digits.
// Shared by the effect definition (index.ts) and the runtime graph (src/services/operators/asciiEffectGraph.ts,
// its 'number-field' branch, the reference). shader.wgsl is not compiled for the glyph looks and is out of date.
import { GLYPH_FONT_OPTIONS } from '../_shared/glyphFonts';
import type { EffectParam, EffectPreset } from '../types';

/** Colour steps of new instances and of instances saved before Steps existed. */
export const NUMBER_FIELD_STEPS = 5;
/** Fewest and most colour steps that render (other values render clamped and the card says so). */
export const NUMBER_FIELD_MIN_STEPS = 2;
export const NUMBER_FIELD_MAX_STEPS = 16;

/** Its own control (lookOwn): how many flat colours the figures take between Dark and Light. */
export const NUMBER_FIELD_PARAMS: Record<string, EffectParam> = {
  steps: {
    type: 'number', label: 'Steps', default: NUMBER_FIELD_STEPS, legacyDefault: NUMBER_FIELD_STEPS,
    min: NUMBER_FIELD_MIN_STEPS, max: NUMBER_FIELD_MAX_STEPS, step: 1, animatable: true, group: 'Color',
    renderMin: NUMBER_FIELD_MIN_STEPS, renderMax: NUMBER_FIELD_MAX_STEPS, graphOnly: true, lookOwn: true,
  },
};

/** The colour step (0 … steps − 1) of a tone 0..1: equal bands, pure white in the last one. Reference for the tests. */
export function numberFieldStep(tone: number, steps: number): number {
  const count = Math.min(Math.max(Math.floor(steps + 0.5), NUMBER_FIELD_MIN_STEPS), NUMBER_FIELD_MAX_STEPS);
  return Math.min(Math.floor(Math.min(Math.max(tone, 0), 1) * count), count - 1) / (count - 1);
}

const SERIF = GLYPH_FONT_OPTIONS[1].value, SANS = GLYPH_FONT_OPTIONS[2].value;

// Every preset names Custom Ramp (a text control keeps its value otherwise), Black Level, Steps, Dark and Light.
export const NUMBER_FIELD_PRESETS: readonly EffectPreset[] = [
  // Large amber serif figures in three steps on brown-black, like a countdown or a departure board.
  { id: 'countdown', name: 'Countdown', params: {
    cellSize: 40, rampPreset: 'numeric', customRamp: '', steps: 3, background: 0.25, blackLevel: 0.1, fontFamily: SERIF, fontWeight: 600,
    colorA: '#1a0f00', colorB: '#ffb000',
  } },
  // Every cell carries the number of its colour, 1 to 5, from navy to gold: a picture to paint by numbers.
  { id: 'paint-by-numbers', name: 'Paint by Numbers', params: {
    cellSize: 18, rampPreset: 'numeric', customRamp: '12345', steps: 5, background: 0.6, blackLevel: 0.05, fontFamily: SANS, fontWeight: 600,
    colorA: '#1e2f5c', colorB: '#ffd166',
  } },
  // Two steps only: bold vermilion figures where the picture is lit, near-black everywhere else.
  { id: 'signal-red', name: 'Signal Red', params: {
    cellSize: 22, rampPreset: 'numeric', customRamp: '', steps: 2, background: 0.4, blackLevel: 0.15, fontFamily: SANS, fontWeight: 800,
    colorA: '#120806', colorB: '#ff4d2e',
  } },
  // Fine pale violet figures in ten shades; with the Numeric ramp every figure names its own shade, 1 to 9.
  { id: 'census', name: 'Census', params: {
    cellSize: 11, rampPreset: 'numeric', customRamp: '', steps: 10, background: 0.3, blackLevel: 0.08, fontFamily: GLYPH_FONT_OPTIONS[0].value, fontWeight: 600,
    colorA: '#1b1033', colorB: '#e9d8ff',
  } },
];
