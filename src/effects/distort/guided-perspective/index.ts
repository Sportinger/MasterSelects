import type { EffectDefinition, EffectParam } from '../../types';
import { IDENTITY } from './guideGeometry';
import shader from './shader.wgsl?raw';
const params: Record<string, EffectParam> = {
  guides: { type: 'text', label: 'Guides', default: '[]', hidden: true },
  scale: { type: 'number', label: 'Scale', default: 100, min: 50, max: 300, step: 0.1, animatable: true },
  strength: { type: 'number', label: 'Strength', default: 100, min: 0, max: 100, step: 0.1, animatable: true },
};
IDENTITY.forEach((value, i) => { params[`matrix${i}`] = { type: 'number', label: `Matrix ${i}`, default: value, hidden: true, animatable: false }; });
export const guidedPerspective: EffectDefinition = {
  id: 'guided-perspective', name: 'Guided Perspective', category: 'distort', shader,
  entryPoint: 'guidedPerspectiveFragment', uniformSize: 64, params,
  packUniforms(values) {
    const m = IDENTITY.map((fallback, i) => typeof values[`matrix${i}`] === 'number'
      && Number.isFinite(values[`matrix${i}`]) ? Math.max(-10000, Math.min(10000, values[`matrix${i}`] as number)) : fallback);
    const bounded = (key: string, fallback: number, min: number, max: number) => typeof values[key] === 'number'
      && Number.isFinite(values[key]) ? Math.max(min, Math.min(max, values[key] as number)) : fallback;
    return new Float32Array([m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0,
      bounded('scale', 100, 50, 300) / 100, bounded('strength', 100, 0, 100) / 100, 0, 0]);
  },
};
