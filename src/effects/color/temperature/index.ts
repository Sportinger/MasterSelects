// Color Temperature Effect

import shader from './shader.wgsl?raw';
import type { EffectDefinition, EffectPreset } from '../../types';
import { TEMPERATURE_PARAMS } from '../remainingColorParams';

/** Light moods from warm to cold, and the green cast of old tube light. */
export const TEMPERATURE_PRESETS: readonly EffectPreset[] = [
  // Late afternoon sun: warmer, with a touch of magenta so skin does not turn yellow.
  { id: 'golden-hour', name: 'Golden Hour', params: { temperature: 0.5, tint: 0.08 } },
  // Deep orange, like a room lit by flames or an old tungsten bulb.
  { id: 'candlelight', name: 'Candlelight', params: { temperature: 1, tint: 0.12 } },
  // Cold blue night; the slight magenta keeps it blue instead of cyan.
  { id: 'moonlight', name: 'Moonlight', params: { temperature: -0.8, tint: 0.1 } },
  // The green cast of old fluorescent tubes: an office at night, a hospital corridor, unease.
  { id: 'fluorescent', name: 'Fluorescent', params: { temperature: -0.15, tint: -0.45 } },
];

export const temperature: EffectDefinition = {
  id: 'temperature',
  name: 'Temperature',
  category: 'color',

  shader,
  entryPoint: 'temperatureFragment',
  uniformSize: 16,

  params: TEMPERATURE_PARAMS,

  presets: TEMPERATURE_PRESETS,

  packUniforms: (params) => {
    return new Float32Array([
      params.temperature as number ?? 0,
      params.tint as number ?? 0,
      0, 0,
    ]);
  },
};
