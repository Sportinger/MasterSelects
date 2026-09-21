import type { EffectParam } from '../../types';

/** Canonical UI-unit schema. Angular values intentionally remain degrees. */
export const FISHEYE_PARAMS = {
  projection: { type: 'select', label: 'Projection', default: 'equidistant', options: [
    { value: 'equidistant', label: 'Equidistant' }, { value: 'equisolid', label: 'Equisolid Angle' },
    { value: 'stereographic', label: 'Stereographic' }, { value: 'orthographic', label: 'Orthographic' },
  ], group: 'lens' },
  strength: { type: 'number', label: 'Strength', default: 1, min: -1, max: 1, step: .01, animatable: true, group: 'lens' },
  fieldOfView: { type: 'number', label: 'Field of View', default: 140, min: 20, max: 175, step: 1, animatable: true, group: 'lens' },
  curveBias: { type: 'number', label: 'Curve Bias', default: 0, min: -1, max: 1, step: .01, animatable: true, group: 'lens' },
  radius: { type: 'number', label: 'Lens Radius', default: 2.1, min: .1, max: 3, step: .01, animatable: true, group: 'framing' },
  zoom: { type: 'number', label: 'Zoom', default: 1, min: .25, max: 4, step: .01, animatable: true, group: 'framing' },
  centerX: { type: 'number', label: 'Center X', default: .5, min: 0, max: 1, step: .01, animatable: true, group: 'framing' },
  centerY: { type: 'number', label: 'Center Y', default: .5, min: 0, max: 1, step: .01, animatable: true, group: 'framing' },
  squeeze: { type: 'number', label: 'Anamorphic Squeeze', default: 1, min: .25, max: 4, step: .01, animatable: true, group: 'framing' },
  rotation: { type: 'number', label: 'Lens Rotation', default: 0, min: -180, max: 180, step: .1, animatable: true, group: 'framing' },
  preserveAspect: { type: 'boolean', label: 'Pixel-correct Aspect', default: true, group: 'framing' },
  outside: { type: 'select', label: 'Outside Lens', default: 'original', options: [
    { value: 'original', label: 'Original Image' }, { value: 'transparent', label: 'Transparent' },
  ], group: 'edges' },
  feather: { type: 'number', label: 'Lens Feather', default: .05, min: 0, max: .5, step: .005, animatable: true, group: 'edges' },
  edgeMode: { type: 'select', label: 'Frame Edges', default: 'transparent', options: [
    { value: 'transparent', label: 'Transparent' }, { value: 'clamp', label: 'Clamp' },
    { value: 'mirror', label: 'Mirror' }, { value: 'repeat', label: 'Repeat' },
  ], group: 'edges' },
  edgeFeather: { type: 'number', label: 'Edge Feather', default: .005, min: 0, max: .1, step: .001, animatable: true, group: 'edges' },
  chromaticAberration: { type: 'number', label: 'Chromatic Aberration', default: 0, min: 0, max: .05, step: .0005, animatable: true, group: 'optics' },
  vignette: { type: 'number', label: 'Lens Vignette', default: 0, min: 0, max: 1, step: .01, animatable: true, group: 'optics' },
  vignetteSoftness: { type: 'number', label: 'Vignette Softness', default: .25, min: .01, max: 1, step: .01, animatable: true, group: 'optics' },
  samples: { type: 'number', label: 'Edge Sampling', default: 4, min: 1, max: 8, step: 1, animatable: false, quality: true },
} satisfies Record<string, EffectParam>;
