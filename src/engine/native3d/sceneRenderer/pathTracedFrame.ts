import type { SceneSplatEffectorRuntimeData, ScenePlaneLayer } from '../../scene/types';
import type { ModelRuntimeCache } from '../assets/ModelRuntimeCache';
import type { MeshPass, SceneNativeMeshLayer } from '../passes/MeshPass';
import { resolveModelMatrix } from '../passes/meshPass/transforms';
import type { PlanePass } from '../passes/PlanePass';
import type { PreparedStrandLayer, StrandShadowFrame } from '../passes/StrandPass';
import type { PtMeshInput, PtPlaneInput, PtStrandInput, PtVoxelInput } from '../pathtrace/scene/ptSceneBuilder';
import type { SceneVoxelRenderLayer } from '../passes/VoxelPass';

/** Strand shadow frame of a path traced frame: the path tracer shadows itself, no maps are drawn. */
export const NO_STRAND_SHADOWS: StrandShadowFrame = { draws: [], targets: [], receiver: null };

/**
 * Layers the path tracer takes from the native scene: prepared strand curves, mesh geometry as the
 * raster draws it (with effectors), planes with their current (effected) texture and voxel relief
 * blocks. Slit Scan surfaces stay rasterized over the path traced image.
 */
export function collectPathTraceInputs(device: GPUDevice, args: {
  strandPlans: readonly PreparedStrandLayer[];
  meshLayers: readonly SceneNativeMeshLayer[];
  planeLayers: readonly ScenePlaneLayer[];
  meshPass: MeshPass;
  planePass: PlanePass;
  modelRuntimeCache: ModelRuntimeCache;
  effectors: SceneSplatEffectorRuntimeData[];
  effectedTextureViews: ReadonlyMap<string, GPUTextureView>;
  voxels: readonly SceneVoxelRenderLayer[];
}): { strands: PtStrandInput[]; meshes: PtMeshInput[]; planes: PtPlaneInput[]; voxels: PtVoxelInput[] } {
  const strands = args.strandPlans.map(plan => ({ layer: plan.layer, buffers: plan.buffers }));
  const meshes = args.meshLayers.flatMap(layer => {
    if (layer.wireframe === true) return [];
    const primitives = args.meshPass.pathTraceGeometry(device, layer, args.modelRuntimeCache);
    return primitives?.length ? [{ layer, primitives, modelMatrix: resolveModelMatrix(layer, args.effectors) }] : [];
  });
  const planes = args.planeLayers.filter(layer => !layer.slitScanGeometry).map(layer => {
    const textureView = args.effectedTextureViews.get(layer.layerId) ?? args.planePass.resolveTextureView(device, layer);
    // Video and canvas sources change every frame; the media time keys their texture version.
    const dynamic = !!(layer.videoElement || layer.videoFrame || layer.canvas || args.effectedTextureViews.has(layer.layerId));
    return { layer, textureView, version: dynamic ? `${layer.layerId}:${layer.mediaTime ?? performance.now()}` : `${layer.layerId}:static` };
  });
  const voxels = args.voxels.map(({ layer, textureView }) => {
    const dynamic = !!(layer.videoElement || layer.videoFrame || layer.canvas || args.effectedTextureViews.has(layer.layerId));
    return { layer, textureView, version: dynamic ? `${layer.layerId}:${layer.mediaTime ?? performance.now()}` : `${layer.layerId}:static` };
  });
  return { strands, meshes, planes, voxels };
}
