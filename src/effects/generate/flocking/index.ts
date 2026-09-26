// Flocking: a boids swarm simulated next to the clip. The graph lives on `clip.flock`;
// this entry places and toggles it. The 2D stack skips it (see layerEffectStack).

import shader from './shader.wgsl?raw';
import type { EffectDefinition } from '../../types';

export const flocking: EffectDefinition = {
  id: 'flocking',
  name: 'Flocking',
  category: 'generate',
  shader,
  entryPoint: 'flockingFragment',
  uniformSize: 0,
  params: {},
  extraControls: () => import('../../../components/panels/properties/flock/FlockEffectControls'),
  packUniforms: () => null,
};
