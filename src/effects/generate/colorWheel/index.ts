// Color Wheel Effect - HSV wheel generator, filling the layer alpha or drawn as a disc

import shader from './shader.wgsl?raw';
import type { EffectDefinition, EffectParam } from '../../types';
import { finiteParam, generatorChoiceWarnings } from '../generatorParams';

const number = (label: string, defaultValue: number, min: number, max: number, step = 0.01, animatable = true,
  extra: Partial<EffectParam> = {}): EffectParam => ({
  type: 'number', label, default: defaultValue, min, max, step, animatable, ...extra,
});

// Hue Rotation and Spin are stored in turns (1 = 360°) and shown in degrees.
const TURN_DEGREES = { displayScale: 360, unit: '°' } as const;

export const COLOR_WHEEL_PARAMS = {
  // Fill Layer is the original look (saved wheels have no Shape and keep it).
  shape: {
    type: 'select', label: 'Shape', default: 'fill',
    options: [{ value: 'fill', label: 'Fill layer' }, { value: 'disc', label: 'Disc' }],
  },
  rotation: number('Hue Rotation', 0, -4, 4, 1 / 360, true, TURN_DEGREES),
  spin: number('Spin', 0, -4, 4, 1 / 360, false, { ...TURN_DEGREES, unit: '°/s' }),
  saturation: number('Saturation', 1, 0, 4, 0.01, true, { renderMin: 0 }),
  value: number('Brightness', 1, 0, 1, 0.01, true, { renderMin: 0 }),
  mix: number('Mix', 1, 0, 1, 0.01, true, { renderMin: 0, renderMax: 1 }),
} satisfies Record<string, EffectParam>;

export const colorWheel: EffectDefinition = {
  id: 'color-wheel',
  name: 'Color Wheel',
  category: 'generate',

  shader,
  entryPoint: 'colorWheelFragment',
  uniformSize: 32,

  params: COLOR_WHEEL_PARAMS,
  // Clamps of number params are reported from renderMin/renderMax (paramRangeNotes).
  paramWarnings: params => generatorChoiceWarnings(COLOR_WHEEL_PARAMS, params, ['shape']),

  packUniforms: (params, width, height, timelineTimeSeconds = 0) => {
    const value = (key: keyof typeof COLOR_WHEEL_PARAMS) => finiteParam(params, key, COLOR_WHEEL_PARAMS[key].default as number);
    // Wrapped in double precision: Spin × time grows without bound on long timelines.
    const time = Number.isFinite(timelineTimeSeconds) ? timelineTimeSeconds : 0;
    const turns = value('rotation') + value('spin') * time;
    return new Float32Array([
      Number.isFinite(turns) ? turns - Math.floor(turns) : 0,
      Math.max(0, value('saturation')),
      Math.max(0, value('value')),
      Math.min(1, Math.max(0, value('mix'))),
      width > 0 && height > 0 ? width / height : 1,
      params.shape === 'disc' ? 1 : 0,
      width > 0 && height > 0 ? Math.min(width, height) : 1080,
      0,
    ]);
  },
};
