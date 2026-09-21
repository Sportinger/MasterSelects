// Physically based fisheye / defisheye lens effect.

import coordinateRotation from '../../_shared/coordinateRotation.wgsl?raw';
import radialProjection from '../../_shared/radialProjection.wgsl?raw';
import fisheyeShader from './shader.wgsl?raw';
import type { EffectDefinition } from '../../types';
import { imageDegreesToRadians } from '../../../services/operators/imageAngleSemantics';
import { normalizeFisheyeParameters } from './normalization';
import { FISHEYE_PARAMS } from './parameters';

const optionIndex = (id: 'projection' | 'edgeMode', value: string) =>
  FISHEYE_PARAMS[id].options.findIndex(option => option.value === value);

export const fisheye: EffectDefinition = {
  id: 'fisheye',
  name: 'Fisheye Lens',
  category: 'distort',
  shader: `${coordinateRotation}\n${radialProjection}\n${fisheyeShader}`,
  entryPoint: 'fisheyeFragment',
  uniformSize: 96,
  params: FISHEYE_PARAMS,
  packUniforms: (params, width, height) => {
    const value = normalizeFisheyeParameters(params);
    const safeWidth = Math.max(1, width), safeHeight = Math.max(1, height);
    return new Float32Array([
      value.strength as number,
      imageDegreesToRadians(value.fieldOfView as number),
      value.radius as number,
      value.zoom as number,
      value.centerX as number,
      value.centerY as number,
      value.squeeze as number,
      imageDegreesToRadians(value.rotation as number),
      safeWidth / safeHeight,
      optionIndex('projection', value.projection as string),
      optionIndex('edgeMode', value.edgeMode as string),
      value.outside === 'transparent' ? 1 : 0,
      value.feather as number,
      value.edgeFeather as number,
      value.chromaticAberration as number,
      value.vignette as number,
      value.vignetteSoftness as number,
      value.samples as number,
      value.preserveAspect === false ? 0 : 1,
      value.curveBias as number,
      1 / safeWidth,
      1 / safeHeight,
      0,
      0,
    ]);
  },
};

export { FISHEYE_PARAMS, normalizeFisheyeParameters };
