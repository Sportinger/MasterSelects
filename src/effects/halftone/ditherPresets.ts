// Dithering: its presets. The recipe is the editable graph in src/services/operators/ditheringEffectGraph.ts
// (createDefaultDitheringGraph) and its shader twin ditherFragment; Pixel Size (scale) counts pixels of a 1080p frame.
import type { EffectPreset } from '../types';

export const DITHER_PRESETS: readonly EffectPreset[] = [
  // Two steps per channel: black, white and the six pure colours in a fine pattern, like an early colour printer.
  { id: 'eight-colours', name: 'Eight Colours', params: { scale: 2, levels: 2, amount: 1 } },
  // Three steps per channel (27 colours) on coarse pixels: a flat, posterised print with hard colour steps.
  { id: 'poster', name: 'Poster', params: { scale: 4, levels: 3, amount: 1 } },
  // Chunky pixels in 64 colours: a game console screen.
  { id: 'game-screen', name: 'Game Screen', params: { scale: 6, levels: 4, amount: 1 } },
  // Very large pixels in 125 colours: the figure as a mosaic that reads from the back row.
  { id: 'big-pixels', name: 'Big Pixels', params: { scale: 12, levels: 5, amount: 1 } },
];
