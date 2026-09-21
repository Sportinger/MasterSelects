import type {
  EffectCategory,
  EffectDefinition,
  EffectParam,
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
}
const BASE_PARAMS: Record<string, EffectParam> = {
  scale: {
    type: 'number', label: 'Scale', default: 14, min: 2, max: 80, step: 1,
    animatable: true, group: 'Pattern',
  },
  amount: {
    type: 'number', label: 'Amount', default: 0.75, min: 0, max: 1, step: 0.01,
    animatable: true, group: 'Style',
  },
  angle: {
    type: 'number', label: 'Angle', default: 0, min: -180, max: 180, step: 1,
    animatable: true, group: 'Pattern',
  },
  colorA: { type: 'color', label: 'Ink', default: '#111827', group: 'Color' },
  colorB: { type: 'color', label: 'Paper', default: '#f8fafc', group: 'Color' },
};

function numberParam(params: Record<string, Primitive>, key: string, fallback: number): number {
  const value = params[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function createCatalogEffect(options: CatalogEffectOptions): EffectDefinition {
  const params = Object.fromEntries(
    Object.entries({ ...BASE_PARAMS, ...options.params }).map(([name, param]) => [
      name,
      param.type === 'number' && param.animatable === undefined
        ? { ...param, animatable: true }
        : param,
    ]),
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
    requiresContinuousRender: options.clock === 'timeline' ? false : options.animated,
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
