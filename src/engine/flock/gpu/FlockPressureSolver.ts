import type { FlockVec3 } from '../../../types/flock';
import { flockPressureLevels, type FlockPressureLevel } from '../shared/flockPressureLayout';
import { FLOCK_PRESSURE_WGSL } from '../shaders/flockPressureWgsl';
import { createCheckedModule, watchValidation } from './FlockGpuPipelines';

const ENTRIES = ['pressureInit', 'pressureCoarsen', 'pressureSmoothAB', 'pressureSmoothBA', 'pressureRestrict',
  'pressureProlong', 'pressureCoarseSolve', 'pressureRho', 'pressureReduceRho', 'pressureDirection', 'pressureProduct', 'pressureReduceAlpha', 'pressureUpdate'] as const;
type Entry = typeof ENTRIES[number];
interface Pipelines { layout: GPUBindGroupLayout; controlLayout: GPUBindGroupLayout; entries: Record<Entry, GPUComputePipeline> }
const CONTROLS = new Set<Entry>(['pressureInit', 'pressureReduceRho', 'pressureReduceAlpha']);
const byDevice = new WeakMap<GPUDevice, Pipelines>();

function pipelines(device: GPUDevice): Pipelines {
  const cached = byDevice.get(device); if (cached) return cached;
  const finish = watchValidation(device, 'flock MGPCG pressure');
  const layout = device.createBindGroupLayout({ entries: [
    ...[0, 1, 2, 3, 4].map(binding => ({ binding, visibility: GPUShaderStage.COMPUTE,
      buffer: { type: (binding === 0 ? 'read-only-storage' : 'storage') as GPUBufferBindingType } })),
    { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform', hasDynamicOffset: true } },
  ] });
  const module = createCheckedModule(device, FLOCK_PRESSURE_WGSL, 'flock-pressure-mgpcg');
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
  const controlLayout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }] });
  const controlPipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout, controlLayout] });
  const entries = Object.fromEntries(ENTRIES.map(entryPoint => [entryPoint,
    device.createComputePipeline({ layout: CONTROLS.has(entryPoint) ? controlPipelineLayout : pipelineLayout, compute: { module, entryPoint } }),
  ])) as Record<Entry, GPUComputePipeline>;
  const value = { layout, controlLayout, entries }; byDevice.set(device, value); finish(); return value;
}

/** Owns only pressure scratch; no particle state, readback or persistent solver history. */
export class FlockPressureSolver {
  readonly gpuBytes: number;
  private readonly levels: FlockPressureLevel[];
  private readonly buffers: GPUBuffer[];
  private readonly group: GPUBindGroup;
  private readonly pipelines: Pipelines;
  private readonly width: number;
  private readonly dispatch: GPUBuffer;
  private readonly controlGroup: GPUBindGroup;

  constructor(device: GPUDevice, dims: FlockVec3, counts: GPUBuffer, cells: GPUBuffer, dispatchWidth = device.limits.maxComputeWorkgroupsPerDimension) {
    this.levels = flockPressureLevels(dims); this.pipelines = pipelines(device);
    this.width = Math.max(1, Math.min(dispatchWidth, device.limits.maxComputeWorkgroupsPerDimension));
    const total = this.levels.at(-1)!.offset + this.levels.at(-1)!.count;
    const fineCount = this.levels[0].count;
    const matrix = device.createBuffer({ size: total * 16, usage: GPUBufferUsage.STORAGE, label: 'flock-pressure-matrix' });
    const multigrid = device.createBuffer({ size: total * 16, usage: GPUBufferUsage.STORAGE, label: 'flock-pressure-vcycle' });
    const cg = device.createBuffer({ size: (fineCount + 2 + Math.ceil(fineCount / 256)) * 16, usage: GPUBufferUsage.STORAGE, label: 'flock-pressure-cg' });
    const params = device.createBuffer({ size: this.levels.length * 256, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.dispatch = device.createBuffer({ size: this.levels.length * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT });
    this.controlGroup = device.createBindGroup({ layout: this.pipelines.controlLayout, entries: [{ binding: 0, resource: { buffer: this.dispatch } }] });
    const data = new Uint32Array(this.levels.length * 64);
    this.levels.forEach((level, index) => {
      const fine = this.levels[Math.max(0, index - 1)], coarse = this.levels[Math.min(index + 1, this.levels.length - 1)];
      data.set([...level.dims, level.count, level.offset, fine.offset, coarse.offset, this.width * 256,
        ...fine.dims, fineCount, ...coarse.dims, Math.ceil(fineCount / 256)], index * 64);
    });
    device.queue.writeBuffer(params, 0, data);
    this.buffers = [matrix, multigrid, cg, params, this.dispatch]; this.gpuBytes = this.buffers.reduce((sum, buffer) => sum + buffer.size, 0);
    this.group = device.createBindGroup({ layout: this.pipelines.layout, entries: [counts, cells, matrix, multigrid, cg, params]
      .map((buffer, binding) => ({ binding, resource: binding === 5 ? { buffer, size: 64 } : { buffer } })) });
  }

  /** Follows divergence; writes pressure into cells[nC..2*nC) for projection. */
  encode(pass: GPUComputePassEncoder, maxIterations: number): void {
    const run = (entry: Entry, level = 0, reduction = false) => {
      pass.setPipeline(this.pipelines.entries[entry]); pass.setBindGroup(0, this.group, [level * 256]);
      pass.setBindGroup(1, CONTROLS.has(entry) ? this.controlGroup : null);
      if (!CONTROLS.has(entry) && entry !== 'pressureCoarsen') pass.dispatchWorkgroupsIndirect(this.dispatch, level * 16);
      else {
        const groups = reduction ? 1 : Math.ceil(this.levels[level].count / 256);
        pass.dispatchWorkgroups(Math.min(groups, this.width), Math.ceil(groups / this.width));
      }
    };
    const smooth = (level: number, sweeps: number) => {
      for (let i = 0; i < sweeps; i += 2) { run('pressureSmoothAB', level); run('pressureSmoothBA', level); }
    };
    const last = this.levels.length - 1;
    run('pressureInit');
    for (let l = 1; l <= last; l++) run('pressureCoarsen', l);
    for (let iteration = 0; iteration < maxIterations; iteration++) {
      for (let l = 0; l < last; l++) { smooth(l, 2); run('pressureRestrict', l + 1); }
      run('pressureCoarseSolve', last);
      for (let l = last - 1; l >= 0; l--) { run('pressureProlong', l); smooth(l, 2); }
      run('pressureRho'); run('pressureReduceRho', 0, true);
      run('pressureDirection'); run('pressureProduct'); run('pressureReduceAlpha', 0, true); run('pressureUpdate');
    }
    pass.setBindGroup(1, null);
  }

  dispose(): void { for (const buffer of this.buffers) buffer.destroy(); }
}
