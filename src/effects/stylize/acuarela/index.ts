// Acuarela - watery smoke feedback effect inspired by Resolume's Wire patch.

import shader from './shader.wgsl?raw';
import type { EffectDefinition } from '../../types';

export const acuarela: EffectDefinition = {
  id: 'acuarela',
  name: 'Acuarela',
  category: 'stylize',

  shader,
  entryPoint: 'acuarelaFragment',
  uniformSize: 48,
  usesFeedback: true,
  requiresContinuousRender: true,

  params: {
    opacity: {
      type: 'number',
      label: 'Opacity',
      default: 1,
      min: 0,
      max: 1,
      step: 0.01,
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

  packUniforms: (params, width, height) => {
    const time = performance.now() / 1000;

    return new Float32Array([
      params.opacity as number ?? 1,
      params.gain as number ?? 0.01,
      params.speed as number ?? 4,
      params.detail as number ?? 4,
      params.strength as number ?? 0.32,
      params.density as number ?? 4,
      params.gainX as number ?? 0.3,
      params.gainY as number ?? 0.3,
      width,
      height,
      time,
      0,
    ]);
  },
};
