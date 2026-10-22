// Dithering: its presets. The recipe is the editable graph in src/services/operators/ditheringEffectGraph.ts
// (createDefaultDitheringGraph) and its shader twin ditherFragment; Pixel Size (scale) counts pixels of a 1080p frame.
import type { EffectPreset } from '../types';

export const DITHER_PRESETS: readonly EffectPreset[] = [
  // Two steps per channel: black, white and the six pure colours in a fine pattern, like an early colour printer.
  { id: 'eight-colours', name: 'Eight Colours', params: { scale: 2, levels: 2, amount: 1 } },
  // One-pixel grain with six steps per channel (216 colours): an image saved for the early web.
  { id: 'web-gif', name: 'Web GIF', params: { scale: 1, levels: 6, amount: 1 } },
  // Chunky pixels in 64 colours: a game console screen.
  { id: 'game-screen', name: 'Game Screen', params: { scale: 6, levels: 4, amount: 1 } },
  // Very large pixels in 125 colours: the figure as a mosaic that reads from the back row.
  { id: 'big-pixels', name: 'Big Pixels', params: { scale: 12, levels: 5, amount: 1 } },
  // A fine pattern of eight steps laid over the picture: texture without losing it.
  { id: 'soft-grain', name: 'Soft Grain', params: { scale: 2, levels: 8, amount: 0.6 } },
];
