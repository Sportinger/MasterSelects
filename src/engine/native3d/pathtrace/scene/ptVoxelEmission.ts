import scalarFieldSource from '../../../../shaders/scalarField.wgsl?raw';
import voxelInstanceSource from '../../shaders/VoxelInstance.wgsl?raw';
import emissionSource from './PtVoxelEmission.wgsl?raw';
import type { SceneCamera, SceneVoxelLayer } from '../../../scene/types';
import { buildVoxelUniformData, resolveVoxelGridDimensions } from '../../passes/voxelPass/voxelUniforms';
import { compileVoxelGraph } from '../../../../services/operators/voxelGraph';
import { ptComputePipeline, ptDispatchShape, ptShaderModule, ptUniformBuffer } from '../ptCompute';

/** A voxel layer the path tracer takes: the layer and its current source texture. */
export interface PtVoxelInput {
  layer: SceneVoxelLayer;
  textureView: GPUTextureView;
  /** Changes when the source texture changes (video, canvas). */
  version: string;
}

export interface PtVoxelPlan {
  uniforms: Float32Array<ArrayBuffer>;
  count: number;
  sphere: boolean;
  /** Layer local space (the raster's voxel world matrix) to scene space. */
  world: Float32Array;
  /** Changes whenever the blocks may change. */
  signature: string;
}

/** The blocks of a voxel layer as the raster places them (VoxelInstance.wgsl), for this frame's camera. */
export function ptVoxelPlan(input: PtVoxelInput, camera: SceneCamera): PtVoxelPlan {
  const grid = resolveVoxelGridDimensions(input.layer);
  const uniforms = buildVoxelUniformData(input.layer, camera, grid) as Float32Array<ArrayBuffer>;
  const shape = (input.layer.voxelGraphPlan ?? compileVoxelGraph(input.layer.voxelParams)).primitiveShape;
  // Everything but the view-projection (the first 16 floats) decides the blocks.
  const signature = `${input.version}|${Array.from(uniforms.subarray(16, 72 + 32 * 4)).join(',')}`;
  return { uniforms, count: grid.columns * grid.rows, sphere: shape === 'sphere', world: uniforms.slice(16, 32), signature };
}

const pipelines = new WeakMap<GPUDevice, GPUComputePipeline>();

/** Writes a voxel layer's blocks as boxes or spheres into the object pool at vec4 `base` (PtVoxelEmission.wgsl). */
export function ptEmitVoxels(device: GPUDevice, encoder: GPUCommandEncoder, plan: PtVoxelPlan, textureView: GPUTextureView,
  objects: GPUBuffer, base: number, temporaries: GPUBuffer[]): void {
  let pipeline = pipelines.get(device);
  if (!pipeline) {
    const module = ptShaderModule(device, 'pt-voxel-emission', [scalarFieldSource, voxelInstanceSource, emissionSource].join('\n'));
    pipeline = ptComputePipeline(device, 'pt-voxel-emission', module, 'emitVoxels');
    pipelines.set(device, pipeline);
  }
  const shape = ptDispatchShape(device, plan.count);
  const uniforms = ptUniformBuffer(device, 'pt-voxel-uniforms', plan.uniforms, temporaries);
  const params = ptUniformBuffer(device, 'pt-voxel-emit', Uint32Array.of(base, plan.count, plan.sphere ? 1 : 0, shape.width), temporaries);
  const pass = encoder.beginComputePass({ label: 'pt-voxel-emission' });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
    { binding: 0, resource: { buffer: uniforms } }, { binding: 1, resource: textureView },
    { binding: 2, resource: { buffer: objects } }, { binding: 3, resource: { buffer: params } }] }));
  pass.dispatchWorkgroups(shape.x, shape.y);
  pass.end();
}
