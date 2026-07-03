import type { TransitionDefinition } from '../types';

// Deterministic warm edge leak overlay plus a soft dissolve.
export const lightLeak: TransitionDefinition = {
  id: 'light-leak',
  name: 'Light Leak',
  category: 'light',
  defaultDuration: 1.25,
  minDuration: 0.1,
  maxDuration: 5,
  description: 'A warm analog edge leak washes across the cut',
  params: {
    color: {
      type: 'color',
      label: 'Color',
      defaultValue: '#ffb36a',
    },
  },
  recipe: [
    {
      kind: 'mask',
      target: 'incoming',
      mask: 'wipe',
      direction: 'right',
      angle: 0.18,
      feather: 0.1,
    },
    {
      kind: 'overlay',
      overlay: 'light-leak',
      color: '#ffb36a',
      colorParam: 'color',
      blendMode: 'screen',
      opacity: { from: 0.5, to: 0.5 },
      centerX: { from: -0.25, to: 1.22 },
      width: 0.32,
      softness: 0.42,
      angle: 0.18,
      startProgress: 0,
      endProgress: 1,
      curve: 'ease-in-out',
    },
  ],
};
