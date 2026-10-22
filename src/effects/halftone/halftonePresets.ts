// Halftone: its presets. The recipe is the editable graph in src/services/operators/halftoneEffectGraphs.ts
// (createDefaultHalftoneGraph) and its shader twin halftoneFragment; Dot Size (scale) counts pixels of a 1080p frame.
import type { EffectPreset } from '../types';

export const HALFTONE_PRESETS: readonly EffectPreset[] = [
  // A fine black screen at 45° on greyish newsprint: a press photo.
  { id: 'newsprint', name: 'Newsprint', params: { scale: 7, angle: 45, amount: 1, colorA: '#1c1c1c', colorB: '#ebe5d3' } },
  // Large navy dots on yellow: a comic panel or a pop poster.
  { id: 'pop-art', name: 'Pop Art', params: { scale: 22, angle: 45, amount: 1, colorA: '#1b2a6b', colorB: '#ffd23f' } },
  // Prussian blue on pale paper, a slightly turned screen.
  { id: 'cyanotype', name: 'Cyanotype', params: { scale: 10, angle: 15, amount: 1, colorA: '#163a70', colorB: '#eef2f6' } },
  // Very large upright dots, black on white: a graphic dot picture that reads from far away.
  { id: 'big-dots', name: 'Big Dots', params: { scale: 40, amount: 1, colorA: '#0d0d0d', colorB: '#f2efe8' } },
  // A fine screen over the picture's own colours, like a printed magazine page.
  { id: 'magazine', name: 'Magazine', params: { scale: 8, angle: 30, amount: 0.55 } },
];
