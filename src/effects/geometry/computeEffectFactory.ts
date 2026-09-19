import type { ComputeEffectDefinition, EffectCategory, EffectParam } from '../types';
import computeShader from './compute.wgsl?raw';

interface ComputeEffectOptions {
  id: string;
  name: string;
  entryPoint: string;
  params?: Record<string, EffectParam>;
  animated?: boolean;
  variant?: number;
  category?: EffectCategory;
  computeMode?: ComputeEffectDefinition['computeMode'];
  colors?: boolean;
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function colorValue(value: unknown, fallback: string): [number, number, number, number] {
  const candidate = typeof value === 'string' && /^#[\da-f]{6}$/i.test(value) ? value : fallback;
  return [
    Number.parseInt(candidate.slice(1, 3), 16) / 255,
    Number.parseInt(candidate.slice(3, 5), 16) / 255,
    Number.parseInt(candidate.slice(5, 7), 16) / 255,
    1,
  ];
}

export function createComputeEffect(options: ComputeEffectOptions): ComputeEffectDefinition {
  const rawParams: Record<string, EffectParam> = {
      scale: { type: 'number' as const, label: 'Cell / Segment Size', default: 24, min: 4, max: 96, step: 1, animatable: true, group: 'Structure' },
      amount: { type: 'number' as const, label: 'Amount', default: 0.8, min: 0, max: 1, step: 0.01, animatable: true, group: 'Style' },
      threshold: { type: 'number' as const, label: 'Threshold', default: 0.45, min: 0, max: 1, step: 0.01, animatable: true, group: 'Style' },
      ...(options.animated ? {
        speed: { type: 'number' as const, label: 'Speed', default: 0.5, min: 0, max: 4, step: 0.05, animatable: true, group: 'Motion' },
      } : {}),
      ...(options.colors ? {
        colorA: { type: 'color' as const, label: 'Line', default: '#111827', group: 'Color' },
        colorB: { type: 'color' as const, label: 'Paper', default: '#f8fafc', group: 'Color' },
      } : {}),
    ...options.params,
  };
  const params: Record<string, EffectParam> = Object.fromEntries(
    Object.entries(rawParams).map(([name, param]) => [
      name,
      param.type === 'number' && param.animatable === undefined
        ? { ...param, animatable: true }
        : param,
    ]),
  );
  return {
    pipelineKind: 'compute',
    id: options.id,
    name: options.name,
    category: options.category ?? 'geometry',
    shader: computeShader,
    entryPoint: options.entryPoint,
    uniformSize: 64,
    workgroupSize: [8, 8],
    computeMode: options.computeMode ?? 'single',
    requiresContinuousRender: options.animated,
    params,
    packUniforms: (params, width, height) => {
      const colorA = colorValue(params.colorA, '#111827');
      const colorB = colorValue(params.colorB, '#f8fafc');
      return new Float32Array([
        width,
        height,
        numberValue(params.amount, 0.8),
        numberValue(params.scale, 24),
        numberValue(params.threshold, 0.45),
        typeof performance === 'undefined' ? 0 : performance.now() / 1_000,
        numberValue(params.speed, 0),
        options.variant ?? 0,
        ...colorA,
        ...colorB,
      ]);
    },
  };
}
