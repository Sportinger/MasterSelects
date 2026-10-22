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
