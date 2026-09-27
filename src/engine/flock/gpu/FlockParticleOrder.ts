import type { FlockFluidSpec } from '../../../services/flock/compiler/flockProgramTypes';
import { FLOCK_PARTICLE_BYTES } from '../../../services/flock/compiler/flockProgramTypes';
import { FLOCK_PARTICLE_ORDER_WGSL } from '../shaders/flockParticleOrderWgsl';
import { FlockRadixSort } from './FlockRadixSort';
import { createCheckedModule, watchValidation } from './FlockGpuPipelines';
import { flockGpuTimings } from './FlockGpuTimings';

type Entry = 'keys' | 'reorder' | 'canonical' | 'updateMapping' | 'resetMapping';
interface Pipelines { layout: GPUBindGroupLayout; entries: Record<Entry, GPUComputePipeline> }
const byDevice = new WeakMap<GPUDevice, Pipelines>();
function pipelines(device: GPUDevice): Pipelines {
  const cached = byDevice.get(device);
  if (cached) return cached;
  const finish = watchValidation(device, 'flock particle order');
  const layout = device.createBindGroupLayout({ entries: [
    ...[0, 1, 2, 3].map(binding => ({ binding, visibility: GPUShaderStage.COMPUTE, buffer: { type: (binding === 0 ? 'read-only-storage' : 'storage') as GPUBufferBindingType } })),
    { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
  ] });
  const module = createCheckedModule(device, FLOCK_PARTICLE_ORDER_WGSL, 'flock-particle-order');
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
  const entries = Object.fromEntries((['keys', 'reorder', 'canonical', 'updateMapping', 'resetMapping'] as Entry[]).map(entryPoint => [entryPoint,
    device.createComputePipeline({ layout: pipelineLayout, compute: { module, entryPoint } }),
  ])) as Record<Entry, GPUComputePipeline>;
  const result = { layout, entries }; byDevice.set(device, result); finish(); return result;
}

/** Keeps both interpolation states in the same persistent spatial order. */
export class FlockParticleOrder {
  readonly mapping: GPUBuffer;
  readonly gpuBytes: number;
  private readonly device: GPUDevice;
  private readonly states: GPUBuffer[];
  private readonly sort: FlockRadixSort;
  private readonly pipelines: Pipelines;
  private readonly scratch: GPUBuffer;
  private readonly params: GPUBuffer;
  private readonly keyGroups: GPUBindGroup[];
  private readonly reorderGroups: GPUBindGroup[];
  private readonly width: number;
  private readonly count: number;
  private dirty = true;

  constructor(device: GPUDevice, states: GPUBuffer[], spec: FlockFluidSpec, dispatchWidth = device.limits.maxComputeWorkgroupsPerDimension) {
    this.device = device; this.states = states; this.count = states[0].size / FLOCK_PARTICLE_BYTES;
    this.width = Math.min(device.limits.maxComputeWorkgroupsPerDimension, dispatchWidth);
    this.sort = new FlockRadixSort(device, this.count, spec.dims[0] * spec.dims[1] * spec.dims[2], this.width);
    this.pipelines = pipelines(device);
    this.scratch = device.createBuffer({ size: states[0].size, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    this.mapping = device.createBuffer({ size: (this.count * 2 + 1) * 4, usage: GPUBufferUsage.STORAGE });
    this.params = device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const data = new ArrayBuffer(48), f = new Float32Array(data), u = new Uint32Array(data);
    f.set([...spec.origin, spec.cellSize]); u.set([...spec.dims, this.count, this.width * 256], 4);
    device.queue.writeBuffer(this.params, 0, data);
    this.keyGroups = states.map(state => this.group(state, this.scratch, this.sort.input));
    this.reorderGroups = states.map(state => this.group(state, this.scratch, this.sort.output));
    this.gpuBytes = this.sort.gpuBytes + this.mapping.size + this.scratch.size + this.params.size;
  }

  reset(encoder: GPUCommandEncoder): void {
    this.run(encoder, 'resetMapping', this.keyGroups[0]); this.dirty = true;
  }

  get sortedPairs(): GPUBuffer { return this.sort.output; }
  /** Transient workspace; valid only until the next physical reorder. */
  get scratchState(): GPUBuffer { return this.scratch; }

  /** Fresh cell index without changing either state's physical layout. */
  encodeIndex(encoder: GPUCommandEncoder, stateIndex: number): void {
    this.run(encoder, 'keys', this.keyGroups[stateIndex]); this.sort.encode(encoder);
  }

  /**
   * Reorder the input immediately before a full simulation step. The step must
   * overwrite every output slot before either state is exposed to rendering.
   * Its input becomes the previous interpolation state, so sorting the old
   * output as well would only copy data that the simulation discards.
   */
  encodeBeforeStep(encoder: GPUCommandEncoder, stateIndex: number, completedStep: number): void {
    if (!this.dirty && completedStep % 4 !== 0) return;
    this.encodeIndex(encoder, stateIndex);
    this.run(encoder, 'reorder', this.reorderGroups[stateIndex]);
    encoder.copyBufferToBuffer(this.scratch, 0, this.states[stateIndex], 0, this.scratch.size);
    this.run(encoder, 'updateMapping', this.reorderGroups[0]); this.dirty = false;
  }

  canonical(encoder: GPUCommandEncoder, source: GPUBuffer, destination: GPUBuffer): void {
    this.run(encoder, 'canonical', this.group(source, destination, this.sort.output), destination.size / FLOCK_PARTICLE_BYTES);
  }

  private group(source: GPUBuffer, destination: GPUBuffer, permutation: GPUBuffer): GPUBindGroup {
    return this.device.createBindGroup({ layout: this.pipelines.layout, entries: [source, destination, this.mapping, permutation, this.params]
      .map((buffer, binding) => ({ binding, resource: { buffer } })) });
  }

  private run(encoder: GPUCommandEncoder, entry: Entry, group: GPUBindGroup, count = this.count): void {
    // Reset and diagnostic reads can submit their own encoders without a timing
    // resolve. Do not reserve a readback slot for those standalone commands.
    const timed = entry !== 'resetMapping' && entry !== 'canonical';
    const pass = encoder.beginComputePass({ label: `flock-order-${entry}`, timestampWrites: timed ? flockGpuTimings(this.device).writes(encoder, `order-${entry}`) : undefined });
    pass.setPipeline(this.pipelines.entries[entry]); pass.setBindGroup(0, group);
    const groups = Math.ceil(count / 256); pass.dispatchWorkgroups(Math.min(groups, this.width), Math.ceil(groups / this.width)); pass.end();
  }

  dispose(): void { this.sort.dispose(); this.mapping.destroy(); this.scratch.destroy(); this.params.destroy(); }
}
