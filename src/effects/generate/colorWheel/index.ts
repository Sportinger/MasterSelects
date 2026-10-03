// Color Wheel Effect - HSV wheel generator kept inside the layer alpha

import shader from './shader.wgsl?raw';
import type { EffectDefinition, EffectParam } from '../../types';

const number = (label: string, defaultValue: number, min: number, max: number, step = 0.01, animatable = true): EffectParam => ({
  type: 'number', label, default: defaultValue, min, max, step, animatable,
});

export const COLOR_WHEEL_PARAMS = {
  rotation: number('Hue Rotation', 0, -4, 4, 0.001),
  spin: number('Spin (turns/s)', 0, -4, 4, 0.01, false),
  saturation: number('Saturation', 1.2, 0, 4),
  value: number('Brightness', 1, 0, 1),
  mix: number('Mix', 1, 0, 1),
} satisfies Record<string, EffectParam>;

export const colorWheel: EffectDefinition = {
  id: 'color-wheel',
  name: 'Color Wheel',
  category: 'generate',

  shader,
  entryPoint: 'colorWheelFragment',
  uniformSize: 32,

  params: COLOR_WHEEL_PARAMS,

  packUniforms: (params, width, height, timelineTimeSeconds = 0) => new Float32Array([
    params.rotation as number ?? 0,
    params.spin as number ?? 0,
    params.saturation as number ?? 1.2,
    params.value as number ?? 1,
    params.mix as number ?? 1,
    width > 0 && height > 0 ? width / height : 1,
    Number.isFinite(timelineTimeSeconds) ? timelineTimeSeconds : 0,
    0,
  ]),
};
