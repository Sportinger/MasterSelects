// Color Wheel Effect - HSV wheel generator, drawn as a disc or filling the layer alpha

import shader from './shader.wgsl?raw';
import type { EffectDefinition, EffectParam } from '../../types';
import { finiteParam, generatorChoiceWarnings } from '../generatorParams';

const number = (label: string, defaultValue: number, min: number, max: number, step = 0.01, animatable = true,
  extra: Partial<EffectParam> = {}): EffectParam => ({
  type: 'number', label, default: defaultValue, min, max, step, animatable, ...extra,
});

// Hue Rotation and Spin are stored in turns (1 = 360°) and shown in degrees.
const TURN_DEGREES = { displayScale: 360, unit: '°' } as const;
const PERCENT = { displayScale: 100, unit: '%' } as const;
export const COLOR_WHEEL_MIN_RADIUS = 0.001;
export const COLOR_WHEEL_MAX_RADIUS = 10;
// Saturation and Brightness multiply colours: kept finite in 32 bits (and in half-float targets).
export const COLOR_WHEEL_MAX_GAIN = 1000;
/** Runtime-only param: turns travelled under a keyframed Spin curve (EffectParam.integratedAs). */
export const COLOR_WHEEL_SPIN_TRAVEL = 'spinTravel';

// Wheels saved before Shape, Direction and Radius existed filled the layer, ran clockwise on screen
// and reached full colour at the shorter edge: their `legacyDefault`s keep that look.
export const COLOR_WHEEL_PARAMS = {
  shape: {
    type: 'select', label: 'Shape', default: 'disc', legacyDefault: 'fill',
    options: [{ value: 'disc', label: 'Disc' }, { value: 'fill', label: 'Fill layer' }],
  },
  radius: number('Radius', 0.45, 0.01, 1, 0.005, true,
    { ...PERCENT, legacyDefault: 0.5, renderMin: COLOR_WHEEL_MIN_RADIUS, renderMax: COLOR_WHEEL_MAX_RADIUS }),
  centerX: number('Center X', 0.5, 0, 1, 0.005, true, { ...PERCENT, renderMin: -10, renderMax: 11 }),
  centerY: number('Center Y', 0.5, 0, 1, 0.005, true, { ...PERCENT, renderMin: -10, renderMax: 11 }),
  direction: {
    type: 'select', label: 'Direction', default: 'ccw', legacyDefault: 'cw',
    options: [{ value: 'ccw', label: 'Counter-clockwise' }, { value: 'cw', label: 'Clockwise' }],
  },
  rotation: number('Hue Rotation', 0, -4, 4, 1 / 360, true, TURN_DEGREES),
  // Keyframeable: a keyed ramp turns by the angle travelled (integratedAs), not Spin × time.
  spin: number('Spin', 0, -4, 4, 1 / 360, true, { ...TURN_DEGREES, unit: '°/s', integratedAs: COLOR_WHEEL_SPIN_TRAVEL }),
  saturation: number('Saturation', 1, 0, 4, 0.01, true, { renderMin: 0, renderMax: COLOR_WHEEL_MAX_GAIN }),
  value: number('Brightness', 1, 0, 1, 0.01, true, { renderMin: 0, renderMax: COLOR_WHEEL_MAX_GAIN }),
  mix: number('Mix', 1, 0, 1, 0.01, true, { renderMin: 0, renderMax: 1 }),
} satisfies Record<string, EffectParam>;

type Params = Record<string, number | boolean | string>;
type NumberKey = 'radius' | 'centerX' | 'centerY' | 'rotation' | 'spin' | 'saturation' | 'value' | 'mix';
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
/** A choice as this instance renders it: saved without it, the legacy value. */
const choice = (params: Params, key: 'shape' | 'direction') => params[key] ?? COLOR_WHEEL_PARAMS[key].legacyDefault;
const numberParam = (params: Params, key: NumberKey) => {
  const definition: EffectParam = COLOR_WHEEL_PARAMS[key];
  return finiteParam(params, key, params[key] === undefined && definition.legacyDefault !== undefined
    ? definition.legacyDefault as number : definition.default as number);
};

export const colorWheel: EffectDefinition = {
  id: 'color-wheel',
  name: 'Color Wheel',
  category: 'generate',

  shader,
  entryPoint: 'colorWheelFragment',
  uniformSize: 48,

  params: COLOR_WHEEL_PARAMS,
  // Clamps of number params are reported from renderMin/renderMax (paramRangeNotes).
  paramWarnings: params => generatorChoiceWarnings(COLOR_WHEEL_PARAMS, params, ['shape', 'direction']),

  packUniforms: (params, width, height, timelineTimeSeconds = 0) => {
    // Wrapped in double precision: Spin × time grows without bound on long timelines.
    // A keyframed Spin arrives with the turns it has travelled since the clip start.
    const time = Number.isFinite(timelineTimeSeconds) ? timelineTimeSeconds : 0;
    const travel = finiteParam(params, COLOR_WHEEL_SPIN_TRAVEL, Number.NaN);
    const turns = numberParam(params, 'rotation') + (Number.isFinite(travel) ? travel : numberParam(params, 'spin') * time);
    const [outputWidth, outputHeight] = width > 0 && height > 0 ? [width, height] : [1920, 1080];
    return new Float32Array([
      Number.isFinite(turns) ? turns - Math.floor(turns) : 0,
      clamp(numberParam(params, 'saturation'), 0, COLOR_WHEEL_MAX_GAIN),
      clamp(numberParam(params, 'value'), 0, COLOR_WHEEL_MAX_GAIN),
      clamp(numberParam(params, 'mix'), 0, 1),
      outputWidth / outputHeight,
      // An unknown shape renders as the default, as the warning says.
      choice(params, 'shape') === 'fill' ? 0 : 1,
      Math.min(outputWidth, outputHeight),
      clamp(numberParam(params, 'radius'), COLOR_WHEEL_MIN_RADIUS, COLOR_WHEEL_MAX_RADIUS),
      clamp(numberParam(params, 'centerX'), -10, 11),
      clamp(numberParam(params, 'centerY'), -10, 11),
      choice(params, 'direction') === 'cw' ? 0 : 1,
      0,
    ]);
  },
};
