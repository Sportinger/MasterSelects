// Voxel Relief - raymarched brightness-driven block extrusion.

import shader from './shader.wgsl?raw';
import scalarFieldShader from '../../../shaders/scalarField.wgsl?raw';
import { packScalarField } from '../../../services/operators/scalarField';
import type { EffectDefinition } from '../../types';
import { VOXEL_RELIEF_PARAMS } from './parameters';
import { compileVoxelGraph } from '../../../services/operators/voxelGraph';

export const voxelRelief: EffectDefinition = {
  id: 'voxel-relief',
  name: 'Voxel Relief',
  category: 'stylize',

  shader: scalarFieldShader + '\n' + shader,
  entryPoint: 'voxelReliefFragment',
  uniformSize: 704,
  usesFeedback: true,

  cameraInteraction: {
    yawParam: 'yaw',
    tiltParam: 'tilt',
    distanceParam: 'distance',
    centerXParam: 'centerX',
    centerYParam: 'centerY',
    yawWrap: true,
    tiltWrap: true,
  },

  params: VOXEL_RELIEF_PARAMS,

  packUniforms: (params, width, height) => {
    const graph = compileVoxelGraph(params);
    params = graph.params;
    const reset = params.reset === true ? 1 : 0;

    return new Float32Array([
      Number(params.columns ?? 107.4),
      Number(params.height ?? 1.2),
      Number(params.baseHeight ?? 0.015),
      Number(params.gap ?? 0.06),
      Number(params.tilt ?? 87),
      Number(params.yaw ?? 0),
      Number(params.perspective ?? 0.22),
      Number(params.heightContrast ?? 3),
      Number(params.ambient ?? 0.58),
      Number(params.lightStrength ?? 0.48),
      Number(params.temporalBlend ?? 0.08),
      Number(params.colorMix ?? 0.95),
      width,
      height,
      Number(params.maxSteps ?? 72),
      reset,
      Number(params.lightAngle ?? 310),
      Number(params.lightElevation ?? 45),
      Number(params.floorBrightness ?? 0.1),
      Number(params.edgeDarkness ?? 0.68),
      Number(params.distance ?? 1),
      Number(params.centerX ?? 0.5),
      Number(params.centerY ?? 0.5),
      Number(params.roll ?? 0),
      params.lightFollow === true ? 1 : 0,
      params.limitToVideo !== false ? 1 : 0,
      graph.primitiveShape === 'sphere' ? 1 : graph.primitiveShape === 'cylinder' ? 2 : 0,
      0,
      ...graph.heightUV,
      ...graph.colorUV,
      ...graph.tint, graph.opacity,
      graph.visible ? 1 : 0, graph.textured ? 1 : 0, graph.field.operations.length, graph.field.output,
      ...graph.boxSize, graph.maxHeight,
      ...packScalarField(graph.field),
    ]);
  },
};
