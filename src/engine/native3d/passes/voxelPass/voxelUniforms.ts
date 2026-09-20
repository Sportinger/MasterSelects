import type { SceneCamera, SceneVoxelLayer } from '../../../scene/types';
import { calculateSourcePixelScale } from '../../../../utils/sourcePixelScale';
import { WORLD_HEIGHT } from '../../sceneRenderer/constants';
import { compileVoxelGraph } from '../../../../services/operators/voxelGraph';
import { packScalarField } from '../../../../services/operators/scalarField';

export const VOXEL_UNIFORM_SIZE = 800;

export interface VoxelGridDimensions {
  columns: number;
  rows: number;
}

export interface VoxelFootprint {
  width: number;
  height: number;
  sourcePixelScale: number;
}

export function resolveVoxelGridDimensions(layer: SceneVoxelLayer): VoxelGridDimensions {
  layer = evaluatedVoxelLayer(layer);
  const columns = Math.min(240, Math.max(4, Math.round(numberParam(layer, 'columns', 107.4))));
  const aspect = layer.sourceWidth / Math.max(layer.sourceHeight, 1);
  return {
    columns,
    rows: Math.max(1, Math.round(columns / Math.max(aspect, 1e-6))),
  };
}

export function shouldRenderVoxelFloor(layer: SceneVoxelLayer): boolean {
  layer = evaluatedVoxelLayer(layer);
  return numberParam(layer, 'floorBrightness', 0.1) > 0.001;
}

/** Matches createPlaneScaleMatrix so voxels occupy the native plane footprint. */
export function resolveVoxelFootprint(layer: SceneVoxelLayer, camera: SceneCamera): VoxelFootprint {
  const outputAspect = camera.viewport.width / Math.max(camera.viewport.height, 1);
  const sourceAspect = layer.sourceWidth / Math.max(layer.sourceHeight, 1);
  const referenceSize = camera.referenceSize ?? camera.viewport;
  const sourcePixelScale = calculateSourcePixelScale(
    layer.sourceWidth,
    layer.sourceHeight,
    referenceSize.width,
    referenceSize.height,
  );
  const height = sourceAspect >= outputAspect
    ? WORLD_HEIGHT * outputAspect * sourcePixelScale / Math.max(sourceAspect, 1e-6)
    : WORLD_HEIGHT * sourcePixelScale;
  return {
    width: height * sourceAspect,
    height,
    sourcePixelScale,
  };
}

export function buildVoxelUniformData(
  layer: SceneVoxelLayer,
  camera: SceneCamera,
  grid: VoxelGridDimensions = resolveVoxelGridDimensions(layer),
): Float32Array {
  const graph = layer.voxelGraphPlan ?? compileVoxelGraph(layer.voxelParams);
  layer = { ...layer, voxelParams: graph.params };
  const footprint = resolveVoxelFootprint(layer, camera);
  const planeScale = new Float32Array([
    footprint.width, 0, 0, 0,
    0, footprint.height, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]);
  const data = new Float32Array(VOXEL_UNIFORM_SIZE / 4);
  data.set(multiplyMat4(camera.projectionMatrix, camera.viewMatrix), 0);
  data.set(multiplyMat4(layer.worldMatrix, planeScale), 16);
  data.set([grid.columns, grid.rows, numberParam(layer, 'gap', 0.06), footprint.height], 32);
  data.set([
    numberParam(layer, 'heightScale', numberParam(layer, 'height', 1.2)),
    numberParam(layer, 'baseHeight', 0.015),
    numberParam(layer, 'heightContrast', 3),
    layer.opacity,
  ], 36);
  data.set([
    numberParam(layer, 'lightAngle', 310),
    numberParam(layer, 'lightElevation', 45),
    numberParam(layer, 'ambient', 0.58),
    numberParam(layer, 'lightStrength', 0.48),
  ], 40);
  data.set([
    numberParam(layer, 'colorMix', 0.95),
    numberParam(layer, 'edgeDarkness', 0.68),
    numberParam(layer, 'floorBrightness', 0.1),
    layer.sourceWidth,
  ], 44);
  data.set([layer.sourceHeight, 0, graph.primitiveShape === 'sphere' ? 1 : graph.primitiveShape === 'cylinder' ? 2 : 0, 0], 48);
  data.set(graph.heightUV, 52);
  data.set(graph.colorUV, 56);
  data.set([...graph.tint, graph.opacity], 60);
  data.set([graph.visible ? 1 : 0, graph.textured ? 1 : 0, graph.field.operations.length, graph.field.output], 64);
  data.set([...graph.boxSize, graph.maxHeight], 68);
  data.set(packScalarField(graph.field), 72);
  // Scene camera replaces tilt/yaw/perspective/distance/centerX/centerY/roll;
  // temporalBlend/maxSteps/reset are intentionally ignored by native 3D.
  return data;
}

function evaluatedVoxelLayer(layer: SceneVoxelLayer): SceneVoxelLayer {
  return { ...layer, voxelParams: (layer.voxelGraphPlan ?? compileVoxelGraph(layer.voxelParams)).params };
}

function numberParam(layer: SceneVoxelLayer, key: string, fallback: number): number {
  const value = Number(layer.voxelParams[key]);
  return Number.isFinite(value) ? value : fallback;
}

function multiplyMat4(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row]! * b[col * 4 + k]!;
      out[col * 4 + row] = sum;
    }
  }
  return out;
}
