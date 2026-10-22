import type { EffectDefinition, EffectParam } from '../../types';
import shader from './shader.wgsl?raw';
import { LENS_PROFILE_OPTIONS, lensProfileUniforms } from './lensProfile';
import { LENS_NO_FOLD, lensFoldRadius, lensFullImageScale } from './lensFrameFit';

// The profile group describes the camera that shot the picture (a CR2's measured lens), so presets keep it.
const number = (label: string, value: number, min: number, max: number, step: number, group: string): EffectParam =>
  ({ type: 'number', label, default: value, min, max, step, animatable: true, group, ...group === 'profile' ? { presetKeeps: true } : {} });
export const LENS_CORRECTION_PARAMS: Record<string, EffectParam> = {
  profile: { type: 'select', label: 'Lens Profile', default: 'manual', options: LENS_PROFILE_OPTIONS, group: 'profile', presetKeeps: true },
  focalLength: number('Focal Length', 24, 24, 105, 0.1, 'profile'),
  aperture: number('Aperture', 4, 4, 22, 0.1, 'profile'),
  focusDistance: number('Focus Distance', 1000, 0.45, 1000, 0.05, 'profile'),
  cropFactor: number('Sensor Crop', 1, 1, 2, 0.001, 'profile'),
  sourceAspect: { type: 'number', label: 'Source Aspect', default: 0, min: 0, max: 100, step: 0.0001, hidden: true, animatable: false },
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

type LensParams = Record<string, number | boolean | string>;

/** Geometry the shader sees: scale after Fit, and the fold radius in its normalized radius units. */
function lensGeometry(params: LensParams, width: number, height: number) {
  const p = normalizeLensCorrection(params);
  const vignetteEnabled = params.vignetteEnabled !== false;
  const profile = lensProfileUniforms(String(params.profile), p.focalLength, p.aperture, p.focusDistance);
  if (!vignetteEnabled) profile.fill(0, 8);
  const aspect = p.sourceAspect || Math.max(1,width)/Math.max(1,height);
  const geometry = { aspect, centerX: p.centerX, centerY: p.centerY, cropFactor: p.cropFactor,
    distortion: p.distortion / 100, fineDistortion: p.fineDistortion / 100, profile };
  const scale = params.fitFullImage === true ? Math.min(p.scale/100, lensFullImageScale(geometry)) : p.scale/100;
  // Largest output radius in the frame: the farthest corner from the optical centre, divided by scale.
  const radiusScale = 2 / Math.hypot(aspect, 1);
  const corner = Math.max(...[[0, 0], [1, 0], [0, 1], [1, 1]].map(([u, v]) =>
    Math.hypot((u - p.centerX) * aspect * radiusScale, (v - p.centerY) * radiusScale))) / Math.max(scale, 1e-4);
  return { p, vignetteEnabled, profile, aspect, scale, fold: lensFoldRadius(geometry, corner * 1.01) };
}

/** Clamped values and folded corners, for tool results and the inspector (never silent). */
export function lensCorrectionWarnings(params: LensParams, width = 1920, height = 1080): string[] {
  const warnings: string[] = [];
  for (const [key, definition] of Object.entries(LENS_CORRECTION_PARAMS)) {
    const value = params[key];
    if (definition.type !== 'number' || typeof value !== 'number') continue;
    if (!Number.isFinite(value)) warnings.push(`${key}: ${value} is not a number; using ${definition.default}.`);
    else if (value < definition.min! || value > definition.max!) {
      warnings.push(`${key}: ${value} is outside ${definition.min}..${definition.max}; using ${Math.min(definition.max!, Math.max(definition.min!, value))}.`);
    }
  }
  const { fold } = lensGeometry(params, width, height);
  if (fold < LENS_NO_FOLD) warnings.push('This much barrel correction would fold the outer picture back on itself, so the area beyond the fold stays transparent. Use less Remove Distortion or Fine Distortion, or raise Scale to crop it.');
  return warnings;
}

export const lensCorrection: EffectDefinition = {
  id: 'lens-correction', name: 'Lens Correction', category: 'distort',
  shader, entryPoint: 'lensCorrectionFragment', uniformSize: 96,
  params: LENS_CORRECTION_PARAMS,
  paramWarnings: (params, width, height) => lensCorrectionWarnings(params, width, height),
  packUniforms: (params, width, height) => {
    const { p, vignetteEnabled, profile, aspect, scale, fold } = lensGeometry(params, width, height);
    return new Float32Array([
      p.distortion / 100, p.fineDistortion / 100, scale, aspect,
      p.centerX, p.centerY, p.redFringe / 1000, p.blueFringe / 1000,
      vignetteEnabled ? p.vignette / 100 : 0, p.midpoint / 100, p.cropFactor, fold,
      ...profile,
    ]);
  },
};
