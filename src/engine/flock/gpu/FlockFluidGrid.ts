import { FLOCK_AFFINE_BYTES, FLOCK_PARTICLE_BYTES, type FlockFluidSpec } from '../../../services/flock/compiler/flockProgramTypes';
import { flockGpuTimings } from './FlockGpuTimings';
import { FlockPressureSolver } from './FlockPressureSolver';
import { FlockParticleOrder } from './FlockParticleOrder';
import { FlockFluidSeparation } from './FlockFluidSeparation';
import type { FlockFluidRegularization } from '../shared/flockFluidRegularization';
import { FLOCK_FLUID_BLOCK_TRANSFER_WGSL } from '../shaders/flockFluidTransferWgsl';
import { createCheckedModule, watchValidation } from './FlockGpuPipelines';
import {
  FLOCK_FLUID_PARAMS_STRIDE,
  FLOCK_FLUID_WGSL,
  FLOCK_FLUID_WORKGROUP,
} from '../shaders/flockFluidWgsl';

type FluidEntry = 'fluidClear' | 'fluidP2G' | 'fluidP2GBlock' | 'fluidNormalize' | 'fluidExtrapolateAB' | 'fluidExtrapolateBA' | 'fluidDivergence' | 'fluidProject' | 'fluidG2P';
const ENTRIES: FluidEntry[] = ['fluidClear', 'fluidP2G', 'fluidP2GBlock', 'fluidNormalize', 'fluidExtrapolateAB', 'fluidExtrapolateBA', 'fluidDivergence', 'fluidProject', 'fluidG2P'];

interface FluidPipelines {
  layout: GPUBindGroupLayout;
  pipelines: Record<FluidEntry, GPUComputePipeline>;
}

const pipelinesByDevice = new WeakMap<GPUDevice, FluidPipelines>();

function fluidPipelines(device: GPUDevice): FluidPipelines {
  const existing = pipelinesByDevice.get(device);
  if (existing) return existing;
  const C = GPUShaderStage.COMPUTE;
  const layout = device.createBindGroupLayout({
    label: 'flock-fluid-layout',
    entries: [
      { binding: 0, visibility: C, buffer: { type: 'storage' } },
      { binding: 1, visibility: C, buffer: { type: 'storage' } },
      { binding: 2, visibility: C, buffer: { type: 'storage' } },
      { binding: 3, visibility: C, buffer: { type: 'storage' } },
      { binding: 4, visibility: C, buffer: { type: 'storage' } },
      { binding: 5, visibility: C, buffer: { type: 'uniform', hasDynamicOffset: true } },
      { binding: 6, visibility: C, buffer: { type: 'storage' } },
      { binding: 7, visibility: C, buffer: { type: 'read-only-storage' } },
    ],
  });
  const finish = watchValidation(device, 'flock fluid');
  const module = createCheckedModule(device, FLOCK_FLUID_WGSL, 'flock-fluid');
  const blockModule = createCheckedModule(device, FLOCK_FLUID_BLOCK_TRANSFER_WGSL, 'flock-fluid-block-transfer');
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout], label: 'flock-fluid-pipeline-layout' });
  const pipelines = Object.fromEntries(ENTRIES.map((entryPoint) => [entryPoint, device.createComputePipeline({
    label: `flock-${entryPoint}`,
    layout: pipelineLayout,
    compute: { module: entryPoint === 'fluidP2GBlock' ? blockModule : module, entryPoint },
  })])) as Record<FluidEntry, GPUComputePipeline>;
  const created = { layout, pipelines };
  pipelinesByDevice.set(device, created);
  finish();
  return created;
}

/**
 * GPU buffers and dispatch sequence for one flock clip's APIC grid. The step
 * shader has already applied forces and advected particles; `encode` corrects
 * velocities and positions of the step's output state in place.
 */
export class FlockFluidGrid {
  readonly spec: FlockFluidSpec;
  readonly gpuBytes: number;
  readonly affine: GPUBuffer;
  private readonly device: GPUDevice;
  private readonly pipelines: FluidPipelines;
  private readonly faceTotal: number;
  private readonly cellTotal: number;
  private readonly buffers: GPUBuffer[];
  private readonly params: GPUBuffer;
  private readonly paramData: ArrayBuffer;
  private readonly bindGroups: GPUBindGroup[];
  private readonly blockTransfer: boolean;
  private readonly dispatchWidth: number;
  private readonly pressure: FlockPressureSolver;
  private readonly separation: FlockFluidSeparation;
  private readonly ownedOrder: FlockParticleOrder | null;

  constructor(device: GPUDevice, spec: FlockFluidSpec, states: GPUBuffer[], maxSlots: number, options: { blockTransfer?: boolean; dispatchWidth?: number; order?: FlockParticleOrder } = {}) {
    this.device = device;
    this.paramData = new ArrayBuffer(FLOCK_FLUID_PARAMS_STRIDE * maxSlots);
    this.spec = spec;
    this.pipelines = fluidPipelines(device);
    const [nx, ny, nz] = spec.dims;
    this.faceTotal = (nx + 1) * ny * nz + nx * (ny + 1) * nz + nx * ny * (nz + 1);
    this.cellTotal = nx * ny * nz;
    this.dispatchWidth = Math.max(1, Math.min(options.dispatchWidth ?? device.limits.maxComputeWorkgroupsPerDimension, device.limits.maxComputeWorkgroupsPerDimension));
    const storage = GPUBufferUsage.STORAGE;
    const acc = device.createBuffer({ size: this.faceTotal * 2 * 4, usage: storage, label: 'flock-fluid-acc' });
    const faces = device.createBuffer({ size: this.faceTotal * 4 * 4, usage: storage, label: 'flock-fluid-faces' });
    const counts = device.createBuffer({ size: this.cellTotal * 4, usage: storage, label: 'flock-fluid-counts' });
    const cells = device.createBuffer({ size: this.cellTotal * 2 * 4, usage: storage, label: 'flock-fluid-cells' });
    this.pressure = new FlockPressureSolver(device, spec.dims, counts, cells, this.dispatchWidth);
    this.params = device.createBuffer({ size: this.paramData.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, label: 'flock-fluid-params' });
    this.blockTransfer = options.blockTransfer !== false;
    this.affine = device.createBuffer({ size: states[0].size / FLOCK_PARTICLE_BYTES * FLOCK_AFFINE_BYTES,
      usage: storage | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST, label: 'flock-fluid-affine' });
    this.ownedOrder = options.order ? null : new FlockParticleOrder(device, states, spec, this.dispatchWidth);
    const order = options.order ?? this.ownedOrder!;
    if (this.ownedOrder) {
      const encoder = device.createCommandEncoder(); this.ownedOrder.reset(encoder); device.queue.submit([encoder.finish()]);
    }
    const mapping = order.mapping;
    this.separation = new FlockFluidSeparation(device, spec, states, this.params, order, this.dispatchWidth);
    this.buffers = [acc, faces, counts, cells, this.params, this.affine];
    this.gpuBytes = this.buffers.reduce((sum, buffer) => sum + buffer.size, 0) + this.pressure.gpuBytes
      + this.separation.gpuBytes + (this.ownedOrder?.gpuBytes ?? 0);
    this.bindGroups = states.map((state, index) => device.createBindGroup({
      layout: this.pipelines.layout,
      entries: [
        { binding: 0, resource: { buffer: state } },
        { binding: 1, resource: { buffer: acc } },
        { binding: 2, resource: { buffer: faces } },
        { binding: 3, resource: { buffer: counts } },
        { binding: 4, resource: { buffer: cells } },
        { binding: 5, resource: { buffer: this.params, size: 64 } },
        { binding: 6, resource: { buffer: this.affine } },
        { binding: 7, resource: { buffer: mapping } },
      ],
      label: `flock-fluid-${index}`,
    }));
  }

  /** Stages the per-step uniform for batch slot `slot`. */
  stageParams(slot: number, input: { count: number; affineStrength: number; dt: number } & Partial<FlockFluidRegularization>): void {
    const f = new Float32Array(this.paramData, slot * FLOCK_FLUID_PARAMS_STRIDE, 16);
    const u = new Uint32Array(this.paramData, slot * FLOCK_FLUID_PARAMS_STRIDE, 16);
    f[0] = this.spec.origin[0];
    f[1] = this.spec.origin[1];
    f[2] = this.spec.origin[2];
    f[3] = this.spec.cellSize;
    u[4] = this.spec.dims[0];
    u[5] = this.spec.dims[1];
    u[6] = this.spec.dims[2];
    u[7] = input.count;
    f[8] = input.affineStrength;
    f[9] = input.dt;
    u[10] = this.dispatchWidth * FLOCK_FLUID_WORKGROUP;
    u[11] = input.step ?? 0;
    f[12] = input.separationStrength ?? 0;
    f[13] = input.separationDistance ?? 0;
    f[14] = input.jitter ?? 0;
  }

  uploadParams(slots: number): void {
    this.device.queue.writeBuffer(this.params, 0, this.paramData, 0, slots * FLOCK_FLUID_PARAMS_STRIDE);
  }

  /** Runs the APIC substep on state buffer `stateIndex` (the step's output). */
  encode(encoder: GPUCommandEncoder, stateIndex: number, slot: number, particleCount: number): void {
    const { pipelines } = this.pipelines;
    const group = this.bindGroups[stateIndex];
    const offset = slot * FLOCK_FLUID_PARAMS_STRIDE;
    const groups = (n: number) => Math.max(1, Math.ceil(n / FLOCK_FLUID_WORKGROUP));
    let pass: GPUComputePassEncoder;
    const begin = (label: string) => encoder.beginComputePass({
      label: `flock-${label}`, timestampWrites: flockGpuTimings(this.device).writes(encoder, label),
    });
    const run = (entry: FluidEntry, n: number) => {
      pass.setPipeline(pipelines[entry]);
      pass.setBindGroup(0, group, [offset]);
      pass.dispatchWorkgroups(Math.min(groups(n), this.dispatchWidth), Math.ceil(groups(n) / this.dispatchWidth));
    };
    pass = begin('p2g');
    run('fluidClear', Math.max(this.faceTotal * 2, this.cellTotal));
    run(this.blockTransfer ? 'fluidP2GBlock' : 'fluidP2G', particleCount);
    run('fluidNormalize', this.faceTotal);
    run('fluidExtrapolateAB', this.faceTotal);
    run('fluidExtrapolateBA', this.faceTotal);
    pass.end();
    pass = begin('pressure');
    run('fluidDivergence', this.cellTotal);
    this.pressure.encode(pass, this.spec.iterations);
    run('fluidProject', this.faceTotal);
    pass.end();
    pass = begin('g2p');
    run('fluidG2P', particleCount);
    pass.end();
    const f = new Float32Array(this.paramData, offset, 16);
    if (f[9] > 0 && f[12] > 0 && f[13] > 0) this.separation.encode(encoder, stateIndex, slot, particleCount);
  }

  dispose(): void {
    this.pressure.dispose();
    this.separation.dispose();
    this.ownedOrder?.dispose();
    for (const buffer of this.buffers) buffer.destroy();
  }
}
