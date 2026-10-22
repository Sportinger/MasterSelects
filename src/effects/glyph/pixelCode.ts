// Pixel Code: the glyph engine as a picture written in code. Every cell draws a random character of the ramp
// (Scramble sets how far from the character of its own brightness it may stray), coloured from Shadow to
// Highlight by the picture's brightness, so the figure appears in the colour and the density of the code.
// Shared by the effect definition (index.ts) and the runtime graph (src/services/operators/asciiEffectGraph.ts,
// its 'pixel-code' branches, the reference). shader.wgsl is not compiled for the glyph looks and is out of date.
import { GLYPH_FONT_OPTIONS } from '../_shared/glyphFonts';
import type { EffectParam, EffectPreset } from '../types';

/** Scramble of instances saved before it existed: every cell drew any character of the ramp. */
export const PIXEL_CODE_LEGACY_SCRAMBLE = 1;
/** Scramble of new instances: each cell draws from the half of the ramp around its own character. */
export const PIXEL_CODE_SCRAMBLE = 0.5;
/** Colours of instances saved before Shadow and Highlight existed: the earlier fixed deep blue and mint. */
export const PIXEL_CODE_LEGACY_SHADOW = '#144d7a';
export const PIXEL_CODE_LEGACY_HIGHLIGHT = '#47f2b8';
/** Colours of new instances: a darker blue, so the code on a dark stage recedes and the lit figure reads. */
export const PIXEL_CODE_SHADOW = '#0c2f52';
export const PIXEL_CODE_HIGHLIGHT = '#5cffc4';

/** Its own controls (lookOwn): how random the characters are, and the colours of the code. */
export const PIXEL_CODE_PARAMS: Record<string, EffectParam> = {
  scramble: {
    type: 'number', label: 'Scramble', default: PIXEL_CODE_SCRAMBLE, legacyDefault: PIXEL_CODE_LEGACY_SCRAMBLE, min: 0, max: 1, step: 0.01,
    animatable: true, group: 'Glyphs', renderMin: 0, renderMax: 1, graphOnly: true, lookOwn: true,
  },
  shadow: { type: 'color', label: 'Shadow', default: PIXEL_CODE_SHADOW, legacyDefault: PIXEL_CODE_LEGACY_SHADOW, group: 'Color', graphOnly: true, lookOwn: true },
  highlight: { type: 'color', label: 'Highlight', default: PIXEL_CODE_HIGHLIGHT, legacyDefault: PIXEL_CODE_LEGACY_HIGHLIGHT, group: 'Color', graphOnly: true, lookOwn: true },
};

const finite = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

/** At Scramble 1 (and Black Level 0, which holds no cell) every cell draws any character, so Invert Ramp only reshuffles them. */
export function pixelCodeWarnings(values: Record<string, number | boolean | string>): string[] {
  return values.invert === true && finite(values.scramble, PIXEL_CODE_LEGACY_SCRAMBLE) >= 1 && finite(values.blackLevel, 0) <= 0
    ? ['At Scramble 1 every cell draws any character of the ramp, so Invert Ramp only reshuffles them; lower Scramble to let it act.'] : [];
}

const MONO = GLYPH_FONT_OPTIONS[0].value;

// Every preset names Custom Ramp (a text control keeps its value otherwise), Black Level, Scramble, Shadow and Highlight.
export const PIXEL_CODE_PRESETS: readonly EffectPreset[] = [
  // Zeros and ones in ice blue on a black stage: a person written in binary.
  { id: 'binary-portrait', name: 'Binary Portrait', params: {
    cellSize: 12, rampPreset: 'binary', customRamp: '', scramble: 0.5, background: 0.08, blackLevel: 0.22, fontFamily: MONO, fontWeight: 700,
    shadow: '#3f8fc8', highlight: '#e6faff',
  } },
  // Larger pale hexadecimal figures over the whole frame, like the raw bytes of a file.
  { id: 'hex-dump', name: 'Hex Dump', params: {
    cellSize: 16, rampPreset: 'binary', customRamp: ' 0123456789ABCDEF', scramble: 0.35, background: 0.12, blackLevel: 0.1, fontFamily: MONO, fontWeight: 500,
    shadow: '#1b2230', highlight: '#f2f4f8',
  } },
  // Figures from violet to yellow, the brighter the higher: a thermal camera in digits.
  { id: 'heat-map', name: 'Heat Map', params: {
    cellSize: 14, rampPreset: 'numeric', customRamp: '', scramble: 0.25, background: 0.3, blackLevel: 0.08, fontFamily: MONO, fontWeight: 700,
    shadow: '#2b0a5a', highlight: '#ffd23f',
  } },
  // Brackets, operators and signs of program code in pink, denser where the picture is lit.
  { id: 'source-code', name: 'Source Code', params: {
    cellSize: 16, rampPreset: 'binary', customRamp: ' .:;=+-*/<>(){}[]#', scramble: 0.35, background: 0.2, blackLevel: 0.12, fontFamily: MONO, fontWeight: 800,
    shadow: '#2a0838', highlight: '#ffb3f0',
  } },
];
