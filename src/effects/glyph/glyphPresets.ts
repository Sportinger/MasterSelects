// Named starting points of the glyph looks, picked in the Preset row of their cards (EffectPreset).
// Every preset names Custom Ramp and Black Level (Symbol Matrix also Twinkle), so a value set earlier never changes the preset's look.
import type { EffectPreset } from '../types';

export const ASCII_PRESETS: readonly EffectPreset[] = [
  // Green letters and signs on black, like the screen of an old computer; the brightest glow pale.
  // Black Level drops the grey stage to black.
  { id: 'green-terminal', name: 'Green Terminal', params: {
    cellSize: 12, rampPreset: 'detailed', customRamp: '', background: 0.1, blackLevel: 0.2, colorMode: 'duotone', colorA: '#001a08', colorB: '#8cffaa', fontWeight: 800,
  } },
  // Shaded blocks that join into a coarse mosaic, like early computer art.
  { id: 'shade-blocks', name: 'Shade Blocks', params: { cellSize: 10, rampPreset: 'blocks', customRamp: '', background: 0.2, blackLevel: 0 } },
  // Large cells, each a bar that rises with its brightness over a dim picture, like a wall of level meters.
  { id: 'level-bars', name: 'Level Bars', params: { cellSize: 18, rampPreset: 'bars', customRamp: '', background: 0.2, blackLevel: 0.1 } },
  // One round dot per cell in the picture's colour, like the LEDs of a video wall.
  { id: 'led-wall', name: 'LED Wall', params: { cellSize: 12, rampPreset: 'standard', customRamp: '●', background: 0.06, blackLevel: 0 } },
];

export const GLYPH_MATRIX_PRESETS: readonly EffectPreset[] = [
  // Bars that roll through the whole ramp: diagonal staircases sweep across the picture.
  { id: 'data-wave', name: 'Data Wave', params: { cellSize: 12, rampPreset: 'bars', customRamp: '', roll: 1, background: 0.25, blackLevel: 0 } },
  // Shading blocks that shimmer among their neighbours; the figure stays easy to read.
  { id: 'shade-shimmer', name: 'Shade Shimmer', params: { cellSize: 10, rampPreset: 'blocks', customRamp: '', roll: 0.4, background: 0.15, blackLevel: 0 } },
  // White code on a deep blue field, rolling through half the ramp; below Black Level the dark stage holds still, an empty blue.
  { id: 'ice-code', name: 'Ice Code', params: {
    cellSize: 14, rampPreset: 'detailed', customRamp: '', roll: 0.5, background: 0.2, blackLevel: 0.2, colorMode: 'duotone', colorA: '#123a5c', colorB: '#f0fbff', fontWeight: 700,
  } },
  // Large letters that run through the alphabet, like a split-flap departure board.
  { id: 'split-flap', name: 'Split-Flap', params: { cellSize: 30, rampPreset: 'standard', customRamp: ' ABCDEFGHIJKLMNOPQRSTUVWXYZ', roll: 1, background: 0.55, blackLevel: 0, fontWeight: 700 } },
];

export const SYMBOL_MATRIX_PRESETS: readonly EffectPreset[] = [
  // Faint dots on a night-blue ground; the figure is a constellation of warm white stars that twinkle slowly.
  { id: 'night-sky', name: 'Night Sky', params: {
    cellSize: 16, rampPreset: 'symbols', customRamp: ' ·+*✦', roll: 0.25, twinkle: 0.6, background: 0, blackLevel: 0, speed: 0.5,
    colorMode: 'duotone', colorA: '#3a4f9a', colorB: '#fff4d8', fontWeight: 800,
  } },
  // Large circles, diamonds, triangles and squares in the picture's colours that keep turning into one another.
  { id: 'shape-shift', name: 'Shape Shift', params: { cellSize: 24, rampPreset: 'symbols', customRamp: ' ·○◇△□●◆■', roll: 0.35, twinkle: 0.25, background: 0.3, blackLevel: 0 } },
  // Random digits that change quickly on the figure, in its colours; Black Level thins out the dark stage.
  { id: 'number-storm', name: 'Number Storm', params: { cellSize: 14, rampPreset: 'numeric', customRamp: '', roll: 1, twinkle: 0.2, background: 0.35, blackLevel: 0.2, speed: 2 } },
  // Glowing orange signs on a dark red ground that flare up and fade slowly, like sparks over a fire.
  { id: 'embers', name: 'Embers', params: {
    cellSize: 18, rampPreset: 'symbols', customRamp: '', roll: 0.6, twinkle: 0.6, background: 0.3, blackLevel: 0.2, speed: 0.7,
    colorMode: 'duotone', colorA: '#1a0500', colorB: '#ffd27a', fontWeight: 900,
  } },
];

export const RETRO_MATRIX_PRESETS: readonly EffectPreset[] = [
  // Fine green text on a dark screen, the classic computer terminal.
  { id: 'green-screen', name: 'Green Screen', params: { cellSize: 12, rampPreset: 'standard', customRamp: '', roll: 0.3, background: 0.2, blackLevel: 0, phosphor: '#33ff66' } },
  // Crisp white text without scanlines, like a paper-white monitor.
  { id: 'paper-white', name: 'Paper White', params: { cellSize: 14, rampPreset: 'detailed', customRamp: '', roll: 0.3, background: 0.15, blackLevel: 0.15, scanlines: 0, phosphor: '#e8eef8' } },
  // Large amber digits that crawl up slowly; the dark stage drops out, so the bright digits carry the figure.
  { id: 'teletype', name: 'Teletype', params: { cellSize: 28, rampPreset: 'numeric', customRamp: '', roll: 0.2, background: 0.15, blackLevel: 0.14, scanlines: 0.8, speed: 0.4, fontWeight: 700 } },
  // A fast stream of zeros and ones in cold cyan.
  { id: 'binary-stream', name: 'Binary Stream', params: {
    cellSize: 10, rampPreset: 'binary', customRamp: '', roll: 0.5, background: 0.12, blackLevel: 0.15, speed: 3, phosphor: '#66e0ff', fontWeight: 700,
  } },
];
