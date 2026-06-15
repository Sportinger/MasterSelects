// Zig-Zag Blocks Transition
// Reveals the incoming clip behind a jagged block edge.

import type { TransitionDefinition } from '../types';

export const zigZagBlocks: TransitionDefinition = {
  id: 'zig-zag-blocks',
  name: 'Zig-Zag Blocks',
  category: 'pattern',
  defaultDuration: 1.1,
  minDuration: 0.1,
  maxDuration: 5,
  description: 'Reveal the incoming clip behind a deterministic zig-zag block edge',
  recipe: [
    {
      kind: 'mask',
      target: 'incoming',
      mask: 'pattern',
      pattern: 'zig-zag',
    },
  ],
};
