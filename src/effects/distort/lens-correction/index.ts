import type { EffectDefinition, EffectParam } from '../../types';
import shader from './shader.wgsl?raw';
import { LENS_PROFILE_OPTIONS, lensProfileUniforms } from './lensProfile';
import { lensFullImageScale, lensKnee, lensStretchRange } from './lensFrameFit';

const number = (label: string, value: number, min: number, max: number, step: number, group: string): EffectParam =>
  ({ type: 'number', label, default: value, min, max, step, animatable: true, group });
export const LENS_CORRECTION_PARAMS: Record<string, EffectParam> = {
  profile: { type: 'select', label: 'Lens', default: 'manual', options: LENS_PROFILE_OPTIONS, group: 'profile' },
  focalLength: number('Focal Length', 24, 24, 105, 0.1, 'profile'),
  aperture: number('Aperture', 4, 4, 22, 0.1, 'profile'),
  focusDistance: number('Focus Distance', 1000, 0.45, 1000, 0.05, 'profile'),
  cropFactor: number('Sensor Crop', 1, 1, 2, 0.001, 'profile'),
  sourceAspect: { type: 'number', label: 'Source Aspect', default: 0, min: 0, max: 100, step: 0.0001, hidden: true, animatable: false },
  distortion: number('Distortion', 0, -100, 100, 0.1, 'geometry'),
  fineDistortion: number('Fine Distortion', 0, -50, 50, 0.1, 'geometry'),
  scale: number('Scale', 100, 50, 200, 0.1, 'geometry'),
  fitFullImage: { type: 'boolean', label: 'Fit Entire Photo', default: false, animatable: false, group: 'geometry' },
  centerX: number('Center X', 0.5, 0, 1, 0.001, 'geometry'),
  centerY: number('Center Y', 0.5, 0, 1, 0.001, 'geometry'),
  redFringe: number('Red/Cyan', 0, -20, 20, 0.1, 'chromatic aberration'),
  blueFringe: number('Blue/Yellow', 0, -20, 20, 0.1, 'chromatic aberration'),
  vignette: number('Amount', 0, -100, 100, 0.1, 'vignette'),
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

/** Geometry the shader sees: scale after Fit, and the knee where the radius mapping turns into a straight line. */
function lensGeometry(params: LensParams, width: number, height: number) {
  const p = normalizeLensCorrection(params);
  const vignetteEnabled = params.vignetteEnabled !== false;
  const profile = lensProfileUniforms(String(params.profile), p.focalLength, p.aperture, p.focusDistance);
  if (!vignetteEnabled) profile.fill(0, 8);
  const aspect = p.sourceAspect || Math.max(1,width)/Math.max(1,height);
  const geometry = { aspect, centerX: p.centerX, centerY: p.centerY, cropFactor: p.cropFactor,
    distortion: p.distortion / 100, fineDistortion: p.fineDistortion / 100, profile };
  // Fit picks the scale itself (the card shows Scale only while it holds a value Fit ignores, which a warning names).
  const fit = params.fitFullImage === true ? lensFullImageScale(geometry) : undefined;
  const scale = fit ?? p.scale/100;
  // Largest output radius in the frame: the farthest corner from the optical centre, divided by scale.
  const radiusScale = 2 / Math.hypot(aspect, 1);
  const corner = Math.max(...[[0, 0], [1, 0], [0, 1], [1, 1]].map(([u, v]) =>
    Math.hypot((u - p.centerX) * aspect * radiusScale, (v - p.centerY) * radiusScale))) / Math.max(scale, 1e-4);
  return { p, vignetteEnabled, profile, aspect, scale, fit, corner, geometry, knee: lensKnee(geometry) };
}

/**
 * Whether this setting draws differently from 3.2.7, where strong barrel removal folded (the outer ring
 * stayed transparent) and Fit Entire Photo took the smaller of Scale and the fit. Saved AI Edge Fill
 * results made on such a setting are marked for regeneration (edgeFillSource).
 */
export function lensGeometryChangedSince327(params: LensParams, width = 1920, height = 1080): boolean {
  const { p, fit, corner, geometry } = lensGeometry(params, width, height);
  // Only a visible change counts: the knee's line moves the picture by half a percent or more inside the
  // frame (the same threshold as the card's stretch note, so a marked fill always has a note that explains it).
  return lensStretchRange(geometry, corner) !== undefined || (fit !== undefined && p.scale / 100 < fit);
}

/** Clamped values and ignored controls, for tool results and the inspector (never silent). */
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
  const { p, fit, corner, geometry } = lensGeometry(params, width, height);
  if (fit !== undefined && Math.abs(p.scale - 100) > 1e-6) {
    warnings.push(`Scale ${Number(p.scale.toFixed(1))}% is ignored while Fit Entire Photo is on: Fit sets the scale itself. Reset Scale to 100 % to clear this note, or turn Fit Entire Photo off to use Scale.`);
  }
  // Beyond the knee a straight line draws the picture instead of the lens model: say where, never silently.
  const stretch = lensStretchRange(geometry, corner);
  if (stretch) {
    const share = (radius: number) => Math.round(radius / corner * 100);
    const where = stretch.to < corner - 1e-4 ? `Between about ${share(stretch.from)} % and ${share(stretch.to)} %` : `Beyond about ${share(stretch.from)} %`;
    warnings.push(`${where} of the way to the frame corner the correction is stronger than the lens model allows, so the picture there is stretched evenly and its lines are not straightened.`);
  }
  return warnings;
}

export const lensCorrection: EffectDefinition = {
  id: 'lens-correction', name: 'Lens Correction', category: 'distort',
  shader, entryPoint: 'lensCorrectionFragment', uniformSize: 112,
  params: LENS_CORRECTION_PARAMS,
  presets: [
    { id: 'wide-angle', name: 'Wide Angle', params: { distortion: -14 } },
    { id: 'action-cam', name: 'Action Cam', params: { distortion: -28, scale: 120 } },
    { id: 'whole-photo', name: 'Whole Photo', params: { distortion: -14, fitFullImage: true } },
    { id: 'even-corners', name: 'Even Corners', params: { vignette: 40, midpoint: 30 } },
  ],
  paramWarnings: (params, width, height) => lensCorrectionWarnings(params, width, height),
  packUniforms: (params, width, height) => {
    const { p, vignetteEnabled, profile, aspect, scale, knee } = lensGeometry(params, width, height);
    return new Float32Array([
      p.distortion / 100, p.fineDistortion / 100, scale, aspect,
      p.centerX, p.centerY, p.redFringe / 1000, p.blueFringe / 1000,
      vignetteEnabled ? p.vignette / 100 : 0, p.midpoint / 100, p.cropFactor, knee.radius,
      ...profile,
      knee.source, knee.slope, 0, 0,
    ]);
  },
};
