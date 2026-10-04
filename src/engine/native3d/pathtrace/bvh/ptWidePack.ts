import packSource from './PtWidePack.wgsl?raw';
import { PT_COMMON_WGSL } from '../contracts/ptBindings';
import { ptComputePipeline, ptDispatchShape, ptShaderModule, ptUniformBuffer } from '../ptCompute';
import { ptWideNodeCount } from '../contracts/ptLayouts';

const cache = new WeakMap<GPUDevice, { layout: GPUBindGroupLayout; pipeline: GPUComputePipeline }>();

function packPipeline(device: GPUDevice) {
  let entry = cache.get(device);
  if (!entry) {
    const layout = device.createBindGroupLayout({ label: 'pt-wide-pack', entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    ] });
    const module = ptShaderModule(device, 'pt-wide-pack', `${PT_COMMON_WGSL}\n${packSource}`);
    entry = { layout, pipeline: ptComputePipeline(device, 'pt-wide-pack', module, 'packWide', device.createPipelineLayout({ bindGroupLayouts: [layout] })) };
    cache.set(device, entry);
  }
  return entry;
}

/**
 * Packs the Karras nodes of a BLAS over `count` primitives (`karras`, as PtLbvh writes them) into
 * `ptWideNodeCount(count)` traversal nodes of `page`, starting at node `offset` (PtWidePack.wgsl).
 */
export function ptPackWideNodes(device: GPUDevice, encoder: GPUCommandEncoder, karras: GPUBuffer, count: number, page: GPUBuffer,
  offset: number, temporaries: GPUBuffer[]): void {
  const { layout, pipeline } = packPipeline(device);
  const nodes = ptWideNodeCount(count), shape = ptDispatchShape(device, nodes);
  const params = ptUniformBuffer(device, 'pt-wide-pack-params', Uint32Array.of(Math.max(1, count), offset, shape.width, 0), temporaries);
  const pass = encoder.beginComputePass({ label: 'pt-wide-pack' });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, device.createBindGroup({ layout, entries: [
    { binding: 0, resource: { buffer: params } }, { binding: 1, resource: { buffer: karras } }, { binding: 2, resource: { buffer: page } }] }));
  pass.dispatchWorkgroups(shape.x, shape.y);
  pass.end();
}
