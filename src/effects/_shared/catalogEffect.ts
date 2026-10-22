import type {
  EffectCategory,
  EffectDefinition,
  EffectParam,
  EffectPreset,
} from '../types';
import { colorToRgba } from './catalogColor';

type Primitive = number | boolean | string;

export interface CatalogEffectOptions {
  id: string;
  name: string;
  category: EffectCategory;
  shader: string;
  entryPoint: string;
  params?: Record<string, EffectParam>;
  animated?: boolean;
  clock?: 'timeline';
  variantMap?: Record<string, number>;
  /** Shared base parameters this effect never reads, with the reason tools return; kept hidden so saved values still load. */
  retired?: Record<string, string>;
  /** Notes for values the recipe clamps or cannot show (see FullscreenEffectDefinition.paramWarnings). */
  paramWarnings?: (params: Record<string, number | boolean | string>, width?: number, height?: number) => string[];
  /** Why the effect is still experimental (FullscreenEffectDefinition.experimental). */
  experimental?: string;
  /** Named starting points picked in the effect card (EffectPreset). */
  presets?: readonly EffectPreset[];
}
const BASE_PARAMS: Record<string, EffectParam> = {
  scale: {
    type: 'number', label: 'Scale', default: 14, min: 2, max: 80, step: 1,
    animatable: true, group: 'Pattern',
  },
  amount: {
    // 'Mix', not 'Style': the card's Style menu switches the look itself.
    type: 'number', label: 'Amount', default: 0.75, min: 0, max: 1, step: 0.01,
    animatable: true, group: 'Mix',
  },
  angle: {
    type: 'number', label: 'Angle', default: 0, min: -180, max: 180, step: 1,
    animatable: true, group: 'Pattern',
  },
  colorA: { type: 'color', label: 'Ink', default: '#111827', group: 'Color' },
  colorB: { type: 'color', label: 'Paper', default: '#f8fafc', group: 'Color' },
};

type BaseParam = 'scale' | 'angle' | 'colorA' | 'colorB';

/** A shared base parameter with a look's own additions (a unit, a reported render limit). */
export function catalogBaseParam(key: BaseParam | 'amount', overrides: Partial<EffectParam>): EffectParam {
  return { ...BASE_PARAMS[key], ...overrides } as EffectParam;
}

const BASE_PARAM_NAMES: Record<BaseParam, string> = { scale: 'scale', angle: 'angle', colorA: 'ink color', colorB: 'paper color' };

/**
 * `retired` entries for shared base parameters a look's recipe never reads: the card hides them,
 * tools say the value is ignored, and saved values still load (a style switch keeps them).
 * tests/unit/effectControlsRead.test.ts fails when a shown control is not read.
 */
export function ignoredBaseParams(name: string, keys: readonly BaseParam[]): Record<string, string> {
  return Object.fromEntries(keys.map(key => [key, `${name} has no ${BASE_PARAM_NAMES[key]}; the value is ignored.`]));
}

function numberParam(params: Record<string, Primitive>, key: string, fallback: number): number {
  const value = params[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function createCatalogEffect(options: CatalogEffectOptions): EffectDefinition {
  const params = Object.fromEntries(
    Object.entries({ ...BASE_PARAMS, ...options.params }).map(([name, param]) => {
      const animatable = param.type === 'number' && param.animatable === undefined ? { ...param, animatable: true } : param;
      return [name, options.retired?.[name] ? { ...animatable, deprecated: options.retired[name] } : animatable];
    }),
  );
  if (options.animated && !params.speed) {
    params.speed = {
      type: 'number', label: 'Speed', default: 1, min: 0, max: 5, step: 0.05,
      animatable: true, group: 'Motion',
    };
  }

  return {
    id: options.id,
    name: options.name,
    category: options.category,
    shader: options.shader,
    entryPoint: options.entryPoint,
    uniformSize: 64,
    params,
    // A timeline clock holds still while paused: no continuous rendering, but the picture still moves.
    requiresContinuousRender: options.clock === 'timeline' ? false : options.animated,
    ...(options.animated && options.clock === 'timeline' ? { timelineAnimated: true } : {}),
    ...(options.presets ? { presets: options.presets } : {}),
    ...(options.paramWarnings ? { paramWarnings: options.paramWarnings } : {}),
    ...(options.experimental ? { experimental: options.experimental } : {}),
    packUniforms: (values, width, height, timelineTimeSeconds = 0) => {
      const colorA = colorToRgba(values.colorA, '#111827');
      const colorB = colorToRgba(values.colorB, '#f8fafc');
      const variantValue = values.variant ?? values.kernel ?? values.shape ?? '';
      const variant = typeof variantValue === 'number'
        ? variantValue
        : options.variantMap?.[String(variantValue)] ?? 0;
      return new Float32Array([
        width, height,
        numberParam(values, 'scale', 14),
        numberParam(values, 'amount', 0.75),
        numberParam(values, 'angle', 0),
        options.clock === 'timeline' ? timelineTimeSeconds : typeof performance === 'undefined' ? 0 : performance.now() / 1_000,
        numberParam(values, 'speed', 0),
        variant,
        ...colorA,
        ...colorB,
      ]);
    },
  };
}
