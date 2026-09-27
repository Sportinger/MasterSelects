import { FLOCK_RADIX_BITS, FLOCK_RADIX_SORT_WGSL, FLOCK_RADIX_WORKGROUP } from '../shaders/flockRadixSortWgsl';
import { createCheckedModule, watchValidation } from './FlockGpuPipelines';
import { flockGpuTimings } from './FlockGpuTimings';

type Entry = 'histogram' | 'scanHistogram' | 'scatter';
interface Pipelines { layout: GPUBindGroupLayout; entries: Record<Entry, GPUComputePipeline> }
const byDevice = new WeakMap<GPUDevice, Pipelines>();

function getPipelines(device: GPUDevice): Pipelines {
  const cached = byDevice.get(device);
  if (cached) return cached;
  const finish = watchValidation(device, 'flock radix sort');
  const layout = device.createBindGroupLayout({ entries: [
    ...Array.from({ length: 4 }, (_, binding) => ({ binding, visibility: GPUShaderStage.COMPUTE, buffer: { type: (binding === 0 ? 'read-only-storage' : 'storage') as GPUBufferBindingType } })),
    { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform', hasDynamicOffset: true } },
  ] });
  const module = createCheckedModule(device, FLOCK_RADIX_SORT_WGSL, 'flock-radix-sort');
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
  const entries = Object.fromEntries((['histogram', 'scanHistogram', 'scatter'] as Entry[]).map(entryPoint => [entryPoint,
    device.createComputePipeline({ label: `flock-radix-${entryPoint}`, layout: pipelineLayout, compute: { module, entryPoint } }),
  ])) as Record<Entry, GPUComputePipeline>;
  const pipelines = { layout, entries };
  byDevice.set(device, pipelines);
  finish();
  return pipelines;
}

/** Owns a stable GPU permutation. Callers populate input with (key, identity). */
export class FlockRadixSort {
  readonly input: GPUBuffer;
  readonly gpuBytes: number;
  private readonly device: GPUDevice;
  private readonly pipelines: Pipelines;
  private readonly buffers: GPUBuffer[];
  private readonly groups: [GPUBindGroup, GPUBindGroup];
  private readonly workgroups: number;
  private readonly dispatchWidth: number;
  private readonly passes: number;
  private readonly stride: number;

  constructor(device: GPUDevice, count: number, maxKey = 0xffffffff, dispatchWidth = device.limits.maxComputeWorkgroupsPerDimension) {
    if (!Number.isSafeInteger(count) || count < 1) throw new Error('Flock radix sort requires a positive particle count');
    if (!Number.isSafeInteger(maxKey) || maxKey < 0 || maxKey > 0xffffffff) throw new Error('Flock radix key must fit uint32');
    this.device = device;
    this.workgroups = Math.ceil(count / FLOCK_RADIX_WORKGROUP);
    this.dispatchWidth = Math.min(device.limits.maxComputeWorkgroupsPerDimension, Math.max(1, Math.floor(dispatchWidth)));
    this.passes = Math.max(1, Math.ceil((32 - Math.clz32(maxKey)) / FLOCK_RADIX_BITS));
    this.stride = Math.max(256, device.limits.minUniformBufferOffsetAlignment);
    const sizes = [count * 8, count * 8, this.workgroups * 16 * 4, 16 * 4];
    const limit = Math.min(device.limits.maxBufferSize, device.limits.maxStorageBufferBindingSize);
    if (sizes.some(size => size > limit) || Math.ceil(this.workgroups / this.dispatchWidth) > device.limits.maxComputeWorkgroupsPerDimension) {
      throw new Error('Flock radix sort exceeds device buffer or dispatch limits');
    }
    this.pipelines = getPipelines(device);
    const storage = sizes.map((size, i) => device.createBuffer({ size, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST, label: `flock-radix-${i}` }));
    this.input = storage[0];
    const data = new Uint32Array(this.stride * this.passes / 4);
    for (let i = 0; i < this.passes; i++) data.set([count, this.workgroups, i * FLOCK_RADIX_BITS, this.dispatchWidth], i * this.stride / 4);
    const uniform = device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(uniform, 0, data);
    this.buffers = [...storage, uniform];
    this.gpuBytes = this.buffers.reduce((sum, buffer) => sum + buffer.size, 0);
    this.groups = [0, 1].map(index => device.createBindGroup({ layout: this.pipelines.layout, entries: [
      { binding: 0, resource: { buffer: storage[index] } },
      { binding: 1, resource: { buffer: storage[1 - index] } },
      { binding: 2, resource: { buffer: storage[2] } },
      { binding: 3, resource: { buffer: storage[3] } },
      { binding: 4, resource: { buffer: uniform, size: 16 } },
    ] })) as [GPUBindGroup, GPUBindGroup];
  }

  get output(): GPUBuffer { return this.buffers[this.passes % 2]; }

  encode(encoder: GPUCommandEncoder): GPUBuffer {
    const pass = encoder.beginComputePass({ label: 'flock-fluid-sort', timestampWrites: flockGpuTimings(this.device).writes(encoder, 'fluidSort') });
    for (let digit = 0; digit < this.passes; digit++) {
      pass.setBindGroup(0, this.groups[digit % 2], [digit * this.stride]);
      for (const entry of ['histogram', 'scanHistogram', 'scatter'] as Entry[]) {
        pass.setPipeline(this.pipelines.entries[entry]);
        if (entry === 'scanHistogram') pass.dispatchWorkgroups(16);
        else pass.dispatchWorkgroups(Math.min(this.workgroups, this.dispatchWidth), Math.ceil(this.workgroups / this.dispatchWidth));
      }
    }
    pass.end();
    return this.output;
  }

  dispose(): void { for (const buffer of this.buffers) buffer.destroy(); }
}
