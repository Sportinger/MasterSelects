// Rom1 - watery smoke: a frozen snapshot of the original Acuarela feedback look (Acuarela is a watercolour now).
// It renders through its node graph (rom1EffectGraph.ts); this shader is that graph's reference.

import shader from './shader.wgsl?raw';
import { finiteUniform as finite } from '../../_shared/effectUniformParams';
import type { EffectDefinition, EffectPreset } from '../../types';
import { FEEDBACK_PARAMETERS } from '../../_shared/feedbackParameters';
import { rom1ParamWarnings, ROM1_TRAIL_DEFAULT, ROM1_TRAIL_MAX } from './warnings';

/** Named starting points (Preset row, docs presets loop); each was rendered on the moving dancer and the neon street. */
export const ROM1_PRESETS: readonly EffectPreset[] = [
  // Opacity 0.6 keeps the face readable: the trails stay a faint glow beside the figure, not stepped copies over it.
  { id: 'soft-echo', name: 'Soft Echo', params: { opacity: 0.6, trail: 0.8, strength: 0.12 } },
  { id: 'light-trails', name: 'Light Trails', params: { opacity: 0.8, trail: 0.95, strength: 0.25, gainX: 1, gainY: 0, density: 1 } },
  { id: 'dripping-light', name: 'Dripping Light', params: { trail: 0.97, gain: 0.05, speed: 10, strength: 0.5, gainX: 0, gainY: 1, density: 1 } },
  { id: 'smoke-storm', name: 'Smoke Storm', params: { trail: 0.99, speed: 10, strength: 0.5, density: 3 } },
];

export const rom1: EffectDefinition = {
  id: 'rom1',
  name: 'Rom1',
  category: 'stylize',

  shader,
  entryPoint: 'rom1Fragment',
  uniformSize: 48,
  usesFeedback: true,
  requiresContinuousRender: true,

  presets: ROM1_PRESETS,
  paramWarnings: rom1ParamWarnings,

  params: {
    ...FEEDBACK_PARAMETERS,
    opacity: {
      type: 'number',
      label: 'Opacity',
      default: 1,
      min: 0,
      max: 1,
      step: 0.01,
      animatable: true,
    },
    trail: {
      type: 'number',
      label: 'Trail',
      default: ROM1_TRAIL_DEFAULT,
      min: 0,
      max: ROM1_TRAIL_MAX,
      step: 0.005,
      animatable: true,
    },
    gain: {
      type: 'number',
      label: 'Gain',
      default: 0.01,
      min: 0,
      max: 1,
      step: 0.001,
      animatable: true,
    },
    speed: {
      type: 'number',
      label: 'Speed',
      default: 4,
      min: 0,
      max: 40,
      step: 0.1,
      animatable: true,
    },
    detail: {
      type: 'number',
      label: 'Detail',
      default: 4,
      min: 0,
      max: 8,
      step: 0.1,
      animatable: true,
    },
    strength: {
      type: 'number',
      label: 'Strength',
      default: 0.32,
      min: 0,
      max: 1,
      step: 0.01,
      animatable: true,
    },
    density: {
      type: 'number',
      label: 'Density',
      default: 4,
      min: 0,
      max: 100,
      step: 0.1,
      animatable: true,
    },
    gainX: {
      type: 'number',
      label: 'Gain X',
      default: 0.3,
      min: 0,
      max: 1,
      step: 0.01,
      animatable: true,
    },
    gainY: {
      type: 'number',
      label: 'Gain Y',
      default: 0.3,
      min: 0,
      max: 1,
      step: 0.01,
      animatable: true,
    },
    reset: {
      type: 'boolean',
      label: 'Reset',
      default: false,
      animatable: false,
    },
  },

  packUniforms: (params, width, height, timelineTimeSeconds = 0) => {
    return new Float32Array([
      finite(params.opacity, 1),
      // The shader passes Gain through the knee (smokeGainUpgrade.ts), as the graph does.
      finite(params.gain, 0.01),
      finite(params.speed, 4),
      finite(params.detail, 4),
      finite(params.strength, 0.32),
      finite(params.density, 4),
      finite(params.gainX, 0.3),
      finite(params.gainY, 0.3),
      width,
      height,
      Number.isFinite(timelineTimeSeconds) ? timelineTimeSeconds : 0,
      finite(params.trail, ROM1_TRAIL_DEFAULT),
    ]);
  },
};
