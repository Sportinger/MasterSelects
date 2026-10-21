// Voxel Relief - raymarched brightness-driven block extrusion.

import shader from './shader.wgsl?raw';
import { scalarFieldShader } from '../../../shaders/scalarFieldShader';
import { packScalarField } from '../../../services/operators/scalarField';
import type { EffectDefinition } from '../../types';
import { voxelReliefParamWarnings } from './warnings';
import { VOXEL_RELIEF_PARAMS } from './parameters';
import { compileVoxelGraph } from '../../../services/operators/voxelGraph';

/** A non-numeric or non-finite value (tools, broken data) falls back to the default instead of NaN uniforms. */
const finite = (value: unknown, fallback: number) => {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(number) ? number : fallback;
};

export const voxelRelief: EffectDefinition = {
  id: 'voxel-relief',
  name: 'Voxel Relief',
  category: 'stylize',

  shader: scalarFieldShader('voxelEvaluateField', 'params.graphField') + '\n' + shader,
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
  paramWarnings: voxelReliefParamWarnings,

  packUniforms: (params, width, height) => {
    const graph = compileVoxelGraph(params);
    params = graph.params;
    const reset = params.reset === true ? 1 : 0;

    return new Float32Array([
      finite(params.columns, 107.4),
      finite(params.height, 1.2),
      finite(params.baseHeight, 0.015),
      finite(params.gap, 0.06),
      finite(params.tilt, 87),
      finite(params.yaw, 0),
      finite(params.perspective, 0.22),
      finite(params.heightContrast, 3),
      finite(params.ambient, 0.58),
      finite(params.lightStrength, 0.48),
      finite(params.temporalBlend, 0.08),
      finite(params.colorMix, 0.95),
      width,
      height,
      finite(params.maxSteps, 72),
      reset,
      finite(params.lightAngle, 310),
      finite(params.lightElevation, 45),
      finite(params.floorBrightness, 0.1),
      finite(params.edgeDarkness, 0.68),
      finite(params.distance, 1),
      finite(params.centerX, 0.5),
      finite(params.centerY, 0.5),
      finite(params.roll, 0),
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
