import type { FlockFluidSpec } from '../../../services/flock/compiler/flockProgramTypes';
import {
  FLOCK_FLUID_PARAMS_STRIDE,
  FLOCK_FLUID_WGSL,
  FLOCK_FLUID_WORKGROUP,
} from '../shaders/flockFluidWgsl';

type FluidEntry = 'fluidClear' | 'fluidP2G' | 'fluidNormalize' | 'fluidDivergence' | 'fluidJacobiAB' | 'fluidJacobiBA' | 'fluidProject' | 'fluidG2P';
const ENTRIES: FluidEntry[] = ['fluidClear', 'fluidP2G', 'fluidNormalize', 'fluidDivergence', 'fluidJacobiAB', 'fluidJacobiBA', 'fluidProject', 'fluidG2P'];

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
    ],
  });
  const module = device.createShaderModule({ code: FLOCK_FLUID_WGSL, label: 'flock-fluid' });
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout], label: 'flock-fluid-pipeline-layout' });
  const pipelines = Object.fromEntries(ENTRIES.map((entryPoint) => [entryPoint, device.createComputePipeline({
    label: `flock-${entryPoint}`,
    layout: pipelineLayout,
    compute: { module, entryPoint },
  })])) as Record<FluidEntry, GPUComputePipeline>;
  const created = { layout, pipelines };
  pipelinesByDevice.set(device, created);
  return created;
}

/**
 * GPU buffers and dispatch sequence for one flock clip's FLIP grid. The step
 * shader has already applied forces and advected particles; `encode` corrects
 * velocities and positions of the step's output state in place.
 */
export class FlockFluidGrid {
  readonly spec: FlockFluidSpec;
  readonly gpuBytes: number;
  private readonly device: GPUDevice;
  private readonly pipelines: FluidPipelines;
  private readonly faceTotal: number;
  private readonly cellTotal: number;
  private readonly buffers: GPUBuffer[];
  private readonly params: GPUBuffer;
  private readonly paramData: ArrayBuffer;
  private readonly bindGroups: GPUBindGroup[];

  constructor(device: GPUDevice, spec: FlockFluidSpec, states: GPUBuffer[], maxSlots: number) {
    this.device = device;
    this.paramData = new ArrayBuffer(FLOCK_FLUID_PARAMS_STRIDE * maxSlots);
    this.spec = spec;
    this.pipelines = fluidPipelines(device);
    const [nx, ny, nz] = spec.dims;
    this.faceTotal = (nx + 1) * ny * nz + nx * (ny + 1) * nz + nx * ny * (nz + 1);
    this.cellTotal = nx * ny * nz;
    const storage = GPUBufferUsage.STORAGE;
    const acc = device.createBuffer({ size: this.faceTotal * 2 * 4, usage: storage, label: 'flock-fluid-acc' });
    const faces = device.createBuffer({ size: this.faceTotal * 3 * 4, usage: storage, label: 'flock-fluid-faces' });
    const counts = device.createBuffer({ size: this.cellTotal * 4, usage: storage, label: 'flock-fluid-counts' });
    const cells = device.createBuffer({ size: this.cellTotal * 3 * 4, usage: storage, label: 'flock-fluid-cells' });
    this.params = device.createBuffer({ size: this.paramData.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, label: 'flock-fluid-params' });
    this.buffers = [acc, faces, counts, cells, this.params];
    this.gpuBytes = acc.size + faces.size + counts.size + cells.size;
    this.bindGroups = states.map((state, index) => device.createBindGroup({
      layout: this.pipelines.layout,
      entries: [
        { binding: 0, resource: { buffer: state } },
        { binding: 1, resource: { buffer: acc } },
        { binding: 2, resource: { buffer: faces } },
        { binding: 3, resource: { buffer: counts } },
        { binding: 4, resource: { buffer: cells } },
        { binding: 5, resource: { buffer: this.params, size: 48 } },
      ],
      label: `flock-fluid-${index}`,
    }));
  }

  /** Stages the per-step uniform for batch slot `slot`. */
  stageParams(slot: number, input: { count: number; flipRatio: number; dt: number }): void {
    const f = new Float32Array(this.paramData, slot * FLOCK_FLUID_PARAMS_STRIDE, 12);
    const u = new Uint32Array(this.paramData, slot * FLOCK_FLUID_PARAMS_STRIDE, 12);
    f[0] = this.spec.origin[0];
    f[1] = this.spec.origin[1];
    f[2] = this.spec.origin[2];
    f[3] = this.spec.cellSize;
    u[4] = this.spec.dims[0];
    u[5] = this.spec.dims[1];
    u[6] = this.spec.dims[2];
    u[7] = input.count;
    f[8] = input.flipRatio;
    f[9] = input.dt;
  }

  uploadParams(slots: number): void {
    this.device.queue.writeBuffer(this.params, 0, this.paramData, 0, slots * FLOCK_FLUID_PARAMS_STRIDE);
  }

  /** Runs the FLIP substep on state buffer `stateIndex` (the step's output). */
  encode(pass: GPUComputePassEncoder, stateIndex: number, slot: number, particleCount: number): void {
    const { pipelines } = this.pipelines;
    const group = this.bindGroups[stateIndex];
    const offset = slot * FLOCK_FLUID_PARAMS_STRIDE;
    const groups = (n: number) => Math.max(1, Math.ceil(n / FLOCK_FLUID_WORKGROUP));
    const run = (entry: FluidEntry, n: number) => {
      pass.setPipeline(pipelines[entry]);
      pass.setBindGroup(0, group, [offset]);
      pass.dispatchWorkgroups(groups(n));
    };
    run('fluidClear', Math.max(this.faceTotal * 2, this.cellTotal));
    run('fluidP2G', particleCount);
    run('fluidNormalize', this.faceTotal);
    run('fluidDivergence', this.cellTotal);
    const pairs = Math.ceil(this.spec.iterations / 2);
    for (let pair = 0; pair < pairs; pair += 1) {
      run('fluidJacobiAB', this.cellTotal);
      run('fluidJacobiBA', this.cellTotal);
    }
    run('fluidProject', this.faceTotal);
    run('fluidG2P', particleCount);
  }

  dispose(): void {
    for (const buffer of this.buffers) buffer.destroy();
  }
}
