import type { EffectDefinition, EffectParam } from '../../types';
import shader from './shader.wgsl?raw';
import { LENS_PROFILE_OPTIONS, lensProfileUniforms } from './lensProfile';
import { lensFullImageScale } from './lensFrameFit';

const number = (label: string, value: number, min: number, max: number, step: number, group: string): EffectParam =>
  ({ type: 'number', label, default: value, min, max, step, animatable: true, group });
export const LENS_CORRECTION_PARAMS: Record<string, EffectParam> = {
  profile: { type: 'select', label: 'Lens Profile', default: 'manual', options: LENS_PROFILE_OPTIONS, group: 'profile' },
  focalLength: number('Focal Length', 24, 24, 105, 0.1, 'profile'),
  aperture: number('Aperture', 4, 4, 22, 0.1, 'profile'),
  focusDistance: number('Focus Distance', 1000, 0.45, 1000, 0.05, 'profile'),
  cropFactor: number('Sensor Crop', 1, 1, 2, 0.001, 'profile'),
  sourceAspect: { type: 'number', label: 'Source Aspect', default: 0, min: 0, max: 100, hidden: true },
  distortion: number('Remove Distortion', 0, -100, 100, 0.1, 'geometry'),
  fineDistortion: number('Fine Distortion', 0, -50, 50, 0.1, 'geometry'),
  scale: number('Scale', 100, 50, 200, 0.1, 'geometry'),
  fitFullImage: { type: 'boolean', label: 'Fit Entire Photo', default: false, animatable: false, group: 'geometry' },
  centerX: number('Optical Center X', 0.5, 0, 1, 0.001, 'geometry'),
  centerY: number('Optical Center Y', 0.5, 0, 1, 0.001, 'geometry'),
  redFringe: number('Red/Cyan Fringe', 0, -20, 20, 0.1, 'chromatic aberration'),
  blueFringe: number('Blue/Yellow Fringe', 0, -20, 20, 0.1, 'chromatic aberration'),
  vignette: number('Vignette Amount', 0, -100, 100, 0.1, 'vignette'),
  vignetteEnabled: { type: 'boolean', label: 'Vignette Correction', default: true, animatable: false, group: 'vignette' },
  midpoint: number('Midpoint', 50, 0, 100, 0.1, 'vignette'),
};

export function normalizeLensCorrection(params: Record<string, number | boolean | string>): Record<string, number> {
  return Object.fromEntries(Object.entries(LENS_CORRECTION_PARAMS).map(([key, definition]) => {
    if (definition.type !== 'number') return [];
    const value = params[key];
    return [key, typeof value === 'number' && Number.isFinite(value)
      ? Math.min(definition.max!, Math.max(definition.min!, value)) : definition.default as number];
  }).filter(entry => entry.length));
}

export const lensCorrection: EffectDefinition = {
  id: 'lens-correction', name: 'Lens Correction', category: 'distort',
  shader, entryPoint: 'lensCorrectionFragment', uniformSize: 96,
  params: LENS_CORRECTION_PARAMS,
  packUniforms: (params, width, height) => {
    const p = normalizeLensCorrection(params);
    const vignetteEnabled = params.vignetteEnabled !== false;
    const profile = lensProfileUniforms(String(params.profile), p.focalLength, p.aperture, p.focusDistance);
    if (!vignetteEnabled) profile.fill(0, 8);
    const aspect = p.sourceAspect || Math.max(1,width)/Math.max(1,height);
    const scale = params.fitFullImage === true ? Math.min(p.scale/100,lensFullImageScale({
      aspect,centerX:p.centerX,centerY:p.centerY,cropFactor:p.cropFactor,
      distortion:p.distortion/100,fineDistortion:p.fineDistortion/100,profile,
    })) : p.scale/100;
    return new Float32Array([
      p.distortion / 100, p.fineDistortion / 100, scale, aspect,
      p.centerX, p.centerY, p.redFringe / 1000, p.blueFringe / 1000,
      vignetteEnabled ? p.vignette / 100 : 0, p.midpoint / 100, p.cropFactor, 0,
      ...profile,
    ]);
  },
};
