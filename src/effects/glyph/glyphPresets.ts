// Named starting points of the glyph looks, picked in the Preset row of their cards (EffectPreset).
// Every preset names Custom Ramp, so a ramp typed earlier never hides the preset's own characters.
import type { EffectPreset } from '../types';

export const ASCII_PRESETS: readonly EffectPreset[] = [
  // Green letters and signs on black, like the screen of an old computer.
  { id: 'green-terminal', name: 'Green Terminal', params: {
    cellSize: 12, rampPreset: 'detailed', customRamp: '', background: 0.2, colorMode: 'duotone', colorA: '#001a08', colorB: '#4dff7a', fontWeight: 700,
  } },
  // Shaded blocks that join into a coarse mosaic, like early computer art.
  { id: 'shade-blocks', name: 'Shade Blocks', params: { cellSize: 10, rampPreset: 'blocks', customRamp: '', background: 0.2 } },
  // Every cell a bar that rises with its brightness, like a wall of level meters.
  { id: 'level-bars', name: 'Level Bars', params: { cellSize: 18, rampPreset: 'bars', customRamp: '', background: 0.12 } },
  // One round dot per cell in the picture's colour, like the LEDs of a video wall.
  { id: 'led-wall', name: 'LED Wall', params: { cellSize: 12, rampPreset: 'standard', customRamp: '●', background: 0.06 } },
];

export const GLYPH_MATRIX_PRESETS: readonly EffectPreset[] = [
  // Bars that roll through the whole ramp: diagonal staircases sweep across the picture.
  { id: 'data-wave', name: 'Data Wave', params: { cellSize: 12, rampPreset: 'bars', customRamp: '', roll: 1, background: 0.25 } },
  // Shading blocks that shimmer among their neighbours; the figure stays easy to read.
  { id: 'shade-shimmer', name: 'Shade Shimmer', params: { cellSize: 10, rampPreset: 'blocks', customRamp: '', roll: 0.4, background: 0.15 } },
  // White code on a deep blue field, rolling through half the ramp.
  { id: 'ice-code', name: 'Ice Code', params: {
    cellSize: 14, rampPreset: 'detailed', customRamp: '', roll: 0.5, background: 0.2, colorMode: 'duotone', colorA: '#123a5c', colorB: '#f0fbff', fontWeight: 700,
  } },
  // Large letters that run through the alphabet, like a split-flap departure board.
  { id: 'split-flap', name: 'Split-Flap', params: { cellSize: 30, rampPreset: 'standard', customRamp: ' ABCDEFGHIJKLMNOPQRSTUVWXYZ', roll: 1, background: 0.55, fontWeight: 700 } },
];
