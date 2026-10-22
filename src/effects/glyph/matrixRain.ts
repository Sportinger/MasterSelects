// Matrix Rain: the glyph engine as falling code. Every column carries drops that fall at their own pace,
// each with a bright, almost white head and a trail that fades behind it; the picture sets how brightly the
// rain glows, so the figure appears in the code. The characters stay in their cells and swap now and then.
// Shared by the effect definition (index.ts) and the runtime graph (src/services/operators/asciiEffectGraph.ts,
// its 'matrix' branches, the reference). shader.wgsl is not compiled for the glyph looks and is out of date.
import type { EffectParam, EffectPreset } from '../types';

/** Rows a drop falls per second at Speed 1, on average over the columns. */
export const MATRIX_FALL_RATE = 12;
/** Each column falls at its own pace: MATRIX_PACE_MIN to MATRIX_PACE_MIN + MATRIX_PACE_SPAN times the fall rate. */
export const MATRIX_PACE_MIN = 0.6;
export const MATRIX_PACE_SPAN = 0.8;
/** Rows from one drop to the next in a column, on average; each column spaces its drops from GAP_MIN to GAP_MIN + GAP_SPAN times it. */
export const MATRIX_DROP_SPACING = 32;
export const MATRIX_GAP_MIN = 0.6;
export const MATRIX_GAP_SPAN = 0.8;
/** Character swaps per second of every cell at Speed 1 (each cell at its own moment). */
export const MATRIX_SWAP_RATE = 2;
/** Brightness of the trails: base + factor × the picture's tone squared, so the figure glows in the code and the dark stage stays dim. */
export const MATRIX_TONE_BASE = 0.05;
export const MATRIX_TONE_FACTOR = 1.5;
/** Light of a drop's head whatever the picture, so the leading character always flashes (Black Level can still clear it on the stage). */
export const MATRIX_HEAD_LIGHT = 0.85;
/** Share of the ground (Background) that glows without rain; a passing trail lights the rest. */
export const MATRIX_GROUND_FLOOR = 0.6;
/** The glow behind the code reads the picture at four points this share of a cell away diagonally (a small blur). */
export const MATRIX_GROUND_SPREAD = 0.3;
/** How far the head of a drop turns towards white. */
export const MATRIX_HEAD_WHITE = 0.8;
/** Colour of the rain in new instances and in instances saved before Rain Color existed. */
export const MATRIX_RAIN_COLOR = '#29ff6b';
/** Trail of new instances: half the way back to the drop above. */
export const MATRIX_DEFAULT_TRAIL = 0.5;

/** Its own controls: the colour of the rain and the length of its trails. */
export const MATRIX_RAIN_PARAMS: Record<string, EffectParam> = {
  rainColor: { type: 'color', label: 'Rain Color', default: MATRIX_RAIN_COLOR, group: 'Color', graphOnly: true, lookOwn: true },
  trail: {
    type: 'number', label: 'Trail', default: MATRIX_DEFAULT_TRAIL, min: 0, max: 1, step: 0.01,
    animatable: true, group: 'Motion', renderMin: 0, renderMax: 1, graphOnly: true, lookOwn: true,
  },
};

/** Half-width katakana and digits after a space, like the code of the films (drawn from the system's Japanese font). */
export const MATRIX_KATAKANA_RAMP = ' ｦｱｳｴｵｶｷｹｺｻｼｽｾｿﾀﾂﾃﾅﾆﾇﾈﾊﾋﾎﾏﾐﾑﾒﾓﾔﾕﾗﾘﾜ0123456789';

// Every preset names Custom Ramp (a text control keeps its value otherwise) and Black Level.
export const MATRIX_RAIN_PRESETS: readonly EffectPreset[] = [
  // Katakana and digits that roll through the whole set, as in the films; a faint glow keeps the figure.
  { id: 'digital-rain', name: 'Digital Rain', params: {
    cellSize: 16, rampPreset: 'numeric', customRamp: MATRIX_KATAKANA_RAMP, roll: 1, background: 0.18, blackLevel: 0, trail: 0.6,
  } },
  // Only the lit figure is drawn in code with long trails; below Black Level the dark stage stays empty.
  { id: 'code-portrait', name: 'Code Portrait', params: {
    cellSize: 12, rampPreset: 'numeric', customRamp: '', roll: 0.4, background: 0.3, blackLevel: 0.2, trail: 0.8, speed: 0.7,
  } },
  // Fine zeros and ones in cold cyan, dense over the whole frame and falling fast.
  { id: 'binary-storm', name: 'Binary Storm', params: {
    cellSize: 9, rampPreset: 'binary', customRamp: '', roll: 0.6, background: 0.25, blackLevel: 0, trail: 0.75, speed: 2.2, rainColor: '#4fd8ff', fontWeight: 700,
  } },
  // Large red digits with short trails: an alarm, a system in danger.
  { id: 'red-alert', name: 'Red Alert', params: {
    cellSize: 20, rampPreset: 'numeric', customRamp: '', roll: 0.5, background: 0.15, blackLevel: 0.12, trail: 0.45, speed: 1.6, rainColor: '#ff3b30', fontWeight: 800,
  } },
];
