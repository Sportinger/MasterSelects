import type { FlockParticleLayout } from '../shared/flockParticleLayout';
import type { FlockFluidSpec } from '../../../services/flock/compiler/flockProgramTypes';
import { flockFluidSeparationWgsl } from '../shaders/flockFluidSeparationWgsl';
import { FLOCK_FLUID_PARAMS_STRIDE } from '../shaders/flockFluidWgsl';
import { FlockParticleOrder } from './FlockParticleOrder';
import { createCheckedModule, watchValidation } from './FlockGpuPipelines';
import { flockGpuTimings } from './FlockGpuTimings';

const entries = ['clearRanges', 'buildRanges', 'computeCorrections', 'applyCorrections'] as const;
interface Pipelines { layout: GPUBindGroupLayout; passes: GPUComputePipeline[] }
const cache = new WeakMap<GPUDevice, Map<FlockParticleLayout, Pipelines>>();
function pipelines(device: GPUDevice, layoutKind: FlockParticleLayout): Pipelines {
  const existing = cache.get(device)?.get(layoutKind);
  if (existing) return existing;
  const finish = watchValidation(device, 'flock fluid separation');
  const layout = device.createBindGroupLayout({ entries: [
    ...[0, 1, 2, 3, 4].map(binding => ({ binding, visibility: GPUShaderStage.COMPUTE,
      buffer: { type: (binding === 1 || binding === 4 ? 'read-only-storage' : 'storage') as GPUBufferBindingType } })),
    { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform', hasDynamicOffset: true } },
  ] });
  const module = createCheckedModule(device, flockFluidSeparationWgsl(layoutKind), 'flock-fluid-separation');
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
  const passes = entries.map(entryPoint => device.createComputePipeline({ layout: pipelineLayout, compute: { module, entryPoint } }));
  const result = { layout, passes }; const variants = cache.get(device) ?? new Map();
  variants.set(layoutKind, result); cache.set(device, variants); finish(); return result;
}

/** Reuses the stable radix index and reorder scratch; only cell ranges are owned.
 * Scratch: N vec4 corrections followed by N vec4 sorted positions/ages (32N bytes).
 * Both supported particle layouts provide enough reorder space; no extra buffer.
 */
export class FlockFluidSeparation {
  private readonly device: GPUDevice;
  private readonly order: FlockParticleOrder;
  private readonly width: number;
  readonly gpuBytes: number;
  private readonly ranges: GPUBuffer;
  private readonly groups: GPUBindGroup[];
  private readonly pipelines: Pipelines;
  private readonly cells: number;

  constructor(device: GPUDevice, spec: FlockFluidSpec, states: GPUBuffer[], params: GPUBuffer,
    order: FlockParticleOrder, width: number) {
    this.device = device; this.order = order; this.width = width;
    this.cells = spec.dims[0] * spec.dims[1] * spec.dims[2];
    this.ranges = device.createBuffer({ size: this.cells * 8, usage: GPUBufferUsage.STORAGE, label: 'flock-separation-ranges' });
    this.gpuBytes = this.ranges.size;
    this.pipelines = pipelines(device, order.stateLayout);
    this.groups = states.map(state => device.createBindGroup({ layout: this.pipelines.layout, entries: [
      ...[state, order.sortedPairs, this.ranges, order.scratchState, order.mapping].map((buffer, binding) => ({ binding, resource: { buffer } })),
      { binding: 5, resource: { buffer: params, size: 64 } },
    ] }));
  }

  encode(encoder: GPUCommandEncoder, state: number, slot: number, count: number): void {
    this.order.encodeIndex(encoder, state);
    const pass = encoder.beginComputePass({ label: 'flock-separation', timestampWrites: flockGpuTimings(this.device).writes(encoder, 'separation') });
    pass.setBindGroup(0, this.groups[state], [slot * FLOCK_FLUID_PARAMS_STRIDE]);
    this.pipelines.passes.forEach((pipeline, index) => {
      pass.setPipeline(pipeline);
      const groups = Math.max(1, Math.ceil((index === 0 ? this.cells * 2 : count) / 256));
      pass.dispatchWorkgroups(Math.min(groups, this.width), Math.ceil(groups / this.width));
    });
    pass.end();
  }

  dispose(): void { this.ranges.destroy(); }
}
