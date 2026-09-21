// Physically based fisheye / defisheye lens effect.

import coordinateRotation from '../../_shared/coordinateRotation.wgsl?raw';
import radialProjection from '../../_shared/radialProjection.wgsl?raw';
import fisheyeShader from './shader.wgsl?raw';
import type { EffectDefinition } from '../../types';

const PROJECTION_IDS: Record<string, number> = {
  equidistant: 0,
  equisolid: 1,
  stereographic: 2,
  orthographic: 3,
};

const EDGE_MODE_IDS: Record<string, number> = {
  transparent: 0,
  clamp: 1,
  mirror: 2,
  repeat: 3,
};

function finiteNumber(
  params: Record<string, number | boolean | string>,
  key: string,
  fallback: number,
): number {
  const value = params[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function selectId(value: unknown, ids: Record<string, number>, fallback: number): number {
  return typeof value === 'string' ? ids[value] ?? fallback : fallback;
}

function sampleCount(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (parsed >= 8) return 8;
  if (parsed >= 4) return 4;
  return 1;
}

export const fisheye: EffectDefinition = {
  id: 'fisheye',
  name: 'Fisheye Lens',
  category: 'distort',

  shader: `${coordinateRotation}\n${radialProjection}\n${fisheyeShader}`,
  entryPoint: 'fisheyeFragment',
  uniformSize: 96,

  params: {
    projection: {
      type: 'select',
      label: 'Projection',
      default: 'equidistant',
      options: [
        { value: 'equidistant', label: 'Equidistant' },
        { value: 'equisolid', label: 'Equisolid Angle' },
        { value: 'stereographic', label: 'Stereographic' },
        { value: 'orthographic', label: 'Orthographic' },
      ],
      group: 'lens',
    },
    strength: {
      type: 'number',
      label: 'Strength',
      default: 1,
      min: -1,
      max: 1,
      step: 0.01,
      animatable: true,
      group: 'lens',
    },
    fieldOfView: {
      type: 'number',
      label: 'Field of View',
      default: 140,
      min: 20,
      max: 175,
      step: 1,
      animatable: true,
      group: 'lens',
    },
    curveBias: {
      type: 'number',
      label: 'Curve Bias',
      default: 0,
      min: -1,
      max: 1,
      step: 0.01,
      animatable: true,
      group: 'lens',
    },
    radius: {
      type: 'number',
      label: 'Lens Radius',
      default: 2.1,
      min: 0.1,
      max: 3,
      step: 0.01,
      animatable: true,
      group: 'framing',
    },
    zoom: {
      type: 'number',
      label: 'Zoom',
      default: 1,
      min: 0.25,
      max: 4,
      step: 0.01,
      animatable: true,
      group: 'framing',
    },
    centerX: {
      type: 'number',
      label: 'Center X',
      default: 0.5,
      min: 0,
      max: 1,
      step: 0.01,
      animatable: true,
      group: 'framing',
    },
    centerY: {
      type: 'number',
      label: 'Center Y',
      default: 0.5,
      min: 0,
      max: 1,
      step: 0.01,
      animatable: true,
      group: 'framing',
    },
    squeeze: {
      type: 'number',
      label: 'Anamorphic Squeeze',
      default: 1,
      min: 0.25,
      max: 4,
      step: 0.01,
      animatable: true,
      group: 'framing',
    },
    rotation: {
      type: 'number',
      label: 'Lens Rotation',
      default: 0,
      min: -180,
      max: 180,
      step: 0.1,
      animatable: true,
      group: 'framing',
    },
    preserveAspect: {
      type: 'boolean',
      label: 'Pixel-correct Aspect',
      default: true,
      group: 'framing',
    },
    outside: {
      type: 'select',
      label: 'Outside Lens',
      default: 'original',
      options: [
        { value: 'original', label: 'Original Image' },
        { value: 'transparent', label: 'Transparent' },
      ],
      group: 'edges',
    },
    feather: {
      type: 'number',
      label: 'Lens Feather',
      default: 0.05,
      min: 0,
      max: 0.5,
      step: 0.005,
      animatable: true,
      group: 'edges',
    },
    edgeMode: {
      type: 'select',
      label: 'Frame Edges',
      default: 'transparent',
      options: [
        { value: 'transparent', label: 'Transparent' },
        { value: 'clamp', label: 'Clamp' },
        { value: 'mirror', label: 'Mirror' },
        { value: 'repeat', label: 'Repeat' },
      ],
      group: 'edges',
    },
    edgeFeather: {
      type: 'number',
      label: 'Edge Feather',
      default: 0.005,
      min: 0,
      max: 0.1,
      step: 0.001,
      animatable: true,
      group: 'edges',
    },
    chromaticAberration: {
      type: 'number',
      label: 'Chromatic Aberration',
      default: 0,
      min: 0,
      max: 0.05,
      step: 0.0005,
      animatable: true,
      group: 'optics',
    },
    vignette: {
      type: 'number',
      label: 'Lens Vignette',
      default: 0,
      min: 0,
      max: 1,
      step: 0.01,
      animatable: true,
      group: 'optics',
    },
    vignetteSoftness: {
      type: 'number',
      label: 'Vignette Softness',
      default: 0.25,
      min: 0.01,
      max: 1,
      step: 0.01,
      animatable: true,
      group: 'optics',
    },
    samples: {
      type: 'number',
      label: 'Edge Sampling',
      default: 4,
      min: 1,
      max: 8,
      step: 1,
      animatable: false,
      quality: true,
    },
  },

  packUniforms: (params, width, height) => {
    const safeWidth = Math.max(1, width);
    const safeHeight = Math.max(1, height);
    return new Float32Array([
      clamp(finiteNumber(params, 'strength', 1), -1, 1),
      clamp(finiteNumber(params, 'fieldOfView', 140), 20, 175) * Math.PI / 180,
      clamp(finiteNumber(params, 'radius', 2.1), 0.1, 3),
      clamp(finiteNumber(params, 'zoom', 1), 0.25, 4),
      clamp(finiteNumber(params, 'centerX', 0.5), 0, 1),
      clamp(finiteNumber(params, 'centerY', 0.5), 0, 1),
      clamp(finiteNumber(params, 'squeeze', 1), 0.25, 4),
      clamp(finiteNumber(params, 'rotation', 0), -180, 180) * Math.PI / 180,
      safeWidth / safeHeight,
      selectId(params.projection, PROJECTION_IDS, 0),
      selectId(params.edgeMode, EDGE_MODE_IDS, 0),
      params.outside === 'transparent' ? 1 : 0,
      clamp(finiteNumber(params, 'feather', 0.05), 0, 0.5),
      clamp(finiteNumber(params, 'edgeFeather', 0.005), 0, 0.1),
      clamp(finiteNumber(params, 'chromaticAberration', 0), 0, 0.05),
      clamp(finiteNumber(params, 'vignette', 0), 0, 1),
      clamp(finiteNumber(params, 'vignetteSoftness', 0.25), 0.01, 1),
      sampleCount(params.samples),
      params.preserveAspect === false ? 0 : 1,
      clamp(finiteNumber(params, 'curveBias', 0), -1, 1),
      1 / safeWidth,
      1 / safeHeight,
      0,
      0,
    ]);
  },
};
