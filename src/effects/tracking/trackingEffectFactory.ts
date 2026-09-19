import type { EffectDefinition, EffectParam } from '../types';
import shader from './shader.wgsl?raw';

interface TrackingEffectOptions {
  id: string;
  name: string;
  entryPoint: string;
  variant: number;
  animated?: boolean;
  feedback?: boolean;
  params?: Record<string, EffectParam>;
}

function numeric(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function color(value: unknown): [number, number, number, number] {
  const hex = typeof value === 'string' && /^#[\da-f]{6}$/i.test(value) ? value : '#36f59a';
  return [
    Number.parseInt(hex.slice(1, 3), 16) / 255,
    Number.parseInt(hex.slice(3, 5), 16) / 255,
    Number.parseInt(hex.slice(5, 7), 16) / 255,
    1,
  ];
}

export function createTrackingEffect(options: TrackingEffectOptions): EffectDefinition {
  return {
    id: options.id,
    name: options.name,
    category: 'tracking',
    shader,
    entryPoint: options.entryPoint,
    uniformSize: 64,
    landmarkPoints: true,
    usesFeedback: options.feedback,
    requiresContinuousRender: options.animated || options.feedback,
    params: {
      amount: { type: 'number', label: 'Amount', default: 0.8, min: 0, max: 1, step: 0.01, animatable: true, group: 'Style' },
      color: { type: 'color', label: 'Overlay', default: '#36f59a', group: 'Style' },
      ...(options.animated ? {
        speed: { type: 'number' as const, label: 'Speed', default: 1, min: 0, max: 5, step: 0.05, animatable: true, group: 'Motion' },
      } : {}),
      ...options.params,
    },
    packUniforms: (params, width, height) => new Float32Array([
      width,
      height,
      numeric(params.amount, 0.8),
      typeof performance === 'undefined' ? 0 : performance.now() / 1_000,
      numeric(params.speed, 0),
      numeric(params.trackingCenterX, 0.5),
      numeric(params.trackingCenterY, 0.5),
      Math.max(0.03, numeric(params.trackingSpread, 0.15)),
      numeric(params.trackingMotionX, 0),
      numeric(params.trackingMotionY, 0),
      numeric(params.trackingCount, 0),
      options.variant,
      ...color(params.color),
    ]),
  };
}
