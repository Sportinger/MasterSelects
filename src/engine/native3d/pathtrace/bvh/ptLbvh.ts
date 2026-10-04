import lbvhSource from './PtLbvh.wgsl?raw';
import boundsSource from './PtPrimitiveBounds.wgsl?raw';
import { FlockRadixSort } from '../../../flock/gpu/FlockRadixSort';
import { PT_COMMON_WGSL } from '../contracts/ptBindings';
import { PT_BVH_NODE, PT_PRIMITIVE, type PtPrimitiveKind } from '../contracts/ptLayouts';
import { ptComputePipeline, ptDispatch, ptDispatchShape, ptShaderModule, ptStorageBuffer, ptUniformBuffer } from '../ptCompute';

/** Primitive source of a BLAS (or of the TLAS: `kind` 'instance'). */
export interface PtBoundsInput {
  kind: PtPrimitiveKind | 'instance';
  count: number;
  /** First fiber record, first vec4 of the triangles/shapes, or first instance. */
  base: number;
  fibers: GPUBufferBinding;
  objects: GPUBuffer;
  nodePages: readonly [GPUBuffer, GPUBuffer];
  nodePage1Start: number;
}

const BOUNDS_ENTRY: Record<PtBoundsInput['kind'], string> = {
  [PT_PRIMITIVE.fiber]: 'fiberBounds', [PT_PRIMITIVE.triangle]: 'triangleBounds', [PT_PRIMITIVE.quad]: 'quadBounds',
  [PT_PRIMITIVE.sphere]: 'sphereBounds', [PT_PRIMITIVE.box]: 'boxBounds', instance: 'instanceBounds',
};
const LBVH_ENTRIES = ['resetCounters', 'centroidBounds', 'mortonCodes', 'hierarchy', 'bottomUp', 'finalize'] as const;
type LbvhEntry = typeof LBVH_ENTRIES[number];

interface Pipelines {
  lbvhLayout: GPUBindGroupLayout;
  boundsLayout: GPUBindGroupLayout;
  lbvh: Record<LbvhEntry, GPUComputePipeline>;
  bounds: Record<string, GPUComputePipeline>;
}
const pipelineCache = new WeakMap<GPUDevice, Pipelines>();

function pipelines(device: GPUDevice): Pipelines {
  const cached = pipelineCache.get(device);
  if (cached) return cached;
  const storage = (binding: number, type: GPUBufferBindingType): GPUBindGroupLayoutEntry =>
    ({ binding, visibility: GPUShaderStage.COMPUTE, buffer: { type } });
  const uniform: GPUBindGroupLayoutEntry = { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } };
  const lbvhLayout = device.createBindGroupLayout({ label: 'pt-lbvh', entries: [uniform, storage(1, 'read-only-storage'),
    ...[2, 3, 4, 5, 6].map(binding => storage(binding, 'storage'))] });
  const boundsLayout = device.createBindGroupLayout({ label: 'pt-bounds', entries: [uniform,
    ...[1, 2, 3, 4].map(binding => storage(binding, 'read-only-storage')), storage(5, 'storage')] });
  const lbvhModule = ptShaderModule(device, 'pt-lbvh', `${PT_COMMON_WGSL}\n${lbvhSource}`);
  const boundsModule = ptShaderModule(device, 'pt-bounds', `${PT_COMMON_WGSL}\n${boundsSource}`);
  const lbvhPipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [lbvhLayout] });
  const boundsPipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [boundsLayout] });
  const result: Pipelines = {
    lbvhLayout, boundsLayout,
    lbvh: Object.fromEntries(LBVH_ENTRIES.map(entry => [entry, ptComputePipeline(device, 'pt-lbvh', lbvhModule, entry, lbvhPipelineLayout)])) as Pipelines['lbvh'],
    bounds: Object.fromEntries(Object.values(BOUNDS_ENTRY).map(entry => [entry, ptComputePipeline(device, 'pt-bounds', boundsModule, entry, boundsPipelineLayout)])),
  };
  pipelineCache.set(device, result);
  return result;
}

/** Nodes of an LBVH over `count` primitives (internal nodes, then leaves). */
export const ptLbvhNodeCount = (count: number) => Math.max(1, 2 * count - 1);

/**
 * GPU LBVH of one BLAS (or the TLAS) with refit. The node array is written into a caller-owned
 * region of a node page; scratch (bounds, sorted keys, parents, arrival counters) stays here so a
 * refit only recomputes bounds. A relative SAH estimate is read back after each build and refit:
 * once a refit tree costs `PT_REBUILD_SAH_RATIO` times its build, `needsRebuild` asks for a new build.
 */
export class PtLbvh {
  readonly count: number;
  private readonly device: GPUDevice;
  private readonly aabbs: GPUBuffer;
  private readonly sorted: GPUBuffer;
  private readonly parents: GPUBuffer;
  private readonly counters: GPUBuffer;
  private readonly bounds: GPUBuffer;
  private readonly sahReadback: GPUBuffer;
  private readonly radix: FlockRadixSort | null;
  private readbackBusy = false;
  private disposed = false;
  private sahPending = false;
  private buildSah = 0;
  private lastSah = 0;
  private sahIsBuild = false;
  built = false;

  constructor(device: GPUDevice, label: string, count: number) {
    if (!Number.isSafeInteger(count) || count < 1) throw new Error('PtLbvh needs at least one primitive');
    this.device = device;
    this.count = count;
    const nodes = ptLbvhNodeCount(count), internal = count - 1;
    this.aabbs = ptStorageBuffer(device, `${label}-aabbs`, count * 32);
    this.sorted = ptStorageBuffer(device, `${label}-sorted`, count * 8);
    this.parents = ptStorageBuffer(device, `${label}-parents`, nodes * 4);
    this.counters = ptStorageBuffer(device, `${label}-counters`, (internal + 7) * 4);
    this.bounds = ptStorageBuffer(device, `${label}-bounds`, nodes * 24);
    this.sahReadback = device.createBuffer({ label: `${label}-sah`, size: 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    this.radix = count > 1 ? new FlockRadixSort(device, count) : null;
  }

  get gpuBytes(): number {
    return this.aabbs.size + this.sorted.size + this.parents.size + this.counters.size + this.bounds.size + (this.radix?.gpuBytes ?? 0);
  }

  /** True when refits have degraded the tree enough that a new build pays off. */
  get needsRebuild(): boolean {
    return this.built && this.buildSah > 0 && this.lastSah > this.buildSah * PT_REBUILD_SAH_RATIO;
  }

  /** Relative SAH cost of the latest tree (internal node area 1.2, leaves 1, relative to the root). */
  get sahCost(): number { return this.lastSah; }

  private params(): GPUBuffer {
    const shape = ptDispatchShape(this.device, Math.max(this.count + 7, ptLbvhNodeCount(this.count)));
    return ptUniformBuffer(this.device, 'pt-lbvh-params', Uint32Array.of(this.count, shape.width, 0, 0));
  }

  private boundsPass(pass: GPUComputePassEncoder, input: PtBoundsInput, temporaries: GPUBuffer[]): void {
    const { device } = this, p = pipelines(device);
    const shape = ptDispatchShape(device, this.count);
    const uniform = ptUniformBuffer(device, 'pt-bounds-params', Uint32Array.of(this.count, input.base, shape.width, input.nodePage1Start), temporaries);
    pass.setPipeline(p.bounds[BOUNDS_ENTRY[input.kind]]);
    pass.setBindGroup(0, device.createBindGroup({ layout: p.boundsLayout, entries: [
      { binding: 0, resource: { buffer: uniform } }, { binding: 1, resource: input.fibers }, { binding: 2, resource: { buffer: input.objects } },
      { binding: 3, resource: { buffer: input.nodePages[0] } }, { binding: 4, resource: { buffer: input.nodePages[1] } },
      { binding: 5, resource: { buffer: this.aabbs } },
    ] }));
    pass.dispatchWorkgroups(shape.x, shape.y);
  }

  private group(nodes: GPUBufferBinding, sorted: GPUBuffer, uniform: GPUBuffer): GPUBindGroup {
    return this.device.createBindGroup({ layout: pipelines(this.device).lbvhLayout, entries: [
      { binding: 0, resource: { buffer: uniform } }, { binding: 1, resource: { buffer: this.aabbs } }, { binding: 2, resource: { buffer: sorted } },
      { binding: 3, resource: nodes }, { binding: 4, resource: { buffer: this.parents } }, { binding: 5, resource: { buffer: this.counters } },
      { binding: 6, resource: { buffer: this.bounds } },
    ] });
  }

  private run(pass: GPUComputePassEncoder, group: GPUBindGroup, entry: LbvhEntry, threads: number): void {
    pass.setPipeline(pipelines(this.device).lbvh[entry]);
    pass.setBindGroup(0, group);
    ptDispatch(pass, this.device, threads);
  }

  /** Full build into `nodes` (a binding of exactly `ptLbvhNodeCount(count)` nodes). */
  build(encoder: GPUCommandEncoder, input: PtBoundsInput, nodes: GPUBufferBinding, temporaries: GPUBuffer[]): void {
    const uniform = this.params();
    temporaries.push(uniform);
    const radixInput = this.radix?.input ?? this.sorted;
    const presort = this.group(nodes, radixInput, uniform);
    let pass = encoder.beginComputePass({ label: 'pt-lbvh-build' });
    this.boundsPass(pass, input, temporaries);
    this.run(pass, presort, 'resetCounters', this.count + 7);
    this.run(pass, presort, 'centroidBounds', this.count);
    this.run(pass, presort, 'mortonCodes', this.count);
    pass.end();
    if (this.radix) {
      const output = this.radix.encode(encoder, null);
      encoder.copyBufferToBuffer(output, 0, this.sorted, 0, this.count * 8);
    }
    const group = this.group(nodes, this.sorted, uniform);
    pass = encoder.beginComputePass({ label: 'pt-lbvh-hierarchy' });
    if (this.count > 1) this.run(pass, group, 'hierarchy', this.count - 1);
    this.finishBottomUp(pass, group);
    pass.end();
    this.queueSahReadback(encoder, true);
    this.built = true;
  }

  /** Recomputes bounds for unchanged topology (moved fibers, animated instances). */
  refit(encoder: GPUCommandEncoder, input: PtBoundsInput, nodes: GPUBufferBinding, temporaries: GPUBuffer[]): void {
    if (!this.built) { this.build(encoder, input, nodes, temporaries); return; }
    const uniform = this.params();
    temporaries.push(uniform);
    const group = this.group(nodes, this.sorted, uniform);
    const pass = encoder.beginComputePass({ label: 'pt-lbvh-refit' });
    this.boundsPass(pass, input, temporaries);
    this.run(pass, group, 'resetCounters', this.count + 7);
    this.finishBottomUp(pass, group);
    pass.end();
    this.queueSahReadback(encoder, false);
  }

  private finishBottomUp(pass: GPUComputePassEncoder, group: GPUBindGroup): void {
    this.run(pass, group, 'bottomUp', this.count);
    this.run(pass, group, 'finalize', ptLbvhNodeCount(this.count));
  }

  private queueSahReadback(encoder: GPUCommandEncoder, isBuild: boolean): void {
    if (this.readbackBusy) return;
    // The SAH accumulator follows the count - 1 arrival counters and the six centroid words.
    encoder.copyBufferToBuffer(this.counters, (this.count + 5) * 4, this.sahReadback, 0, 4);
    this.sahPending = true;
    this.sahIsBuild = isBuild;
  }

  /** Starts reading the SAH estimate back; call after the encoder from build/refit was submitted. */
  afterSubmit(): void {
    if (!this.sahPending || this.readbackBusy) return;
    this.sahPending = false;
    this.readbackBusy = true;
    const isBuild = this.sahIsBuild;
    this.sahReadback.mapAsync(GPUMapMode.READ).then(() => {
      const cost = new Uint32Array(this.sahReadback.getMappedRange(0, 4))[0] / 256;
      this.sahReadback.unmap();
      this.lastSah = cost;
      if (isBuild) this.buildSah = cost;
    }).catch(() => undefined).finally(() => {
      this.readbackBusy = false;
      if (this.disposed) this.sahReadback.destroy();
    });
  }

  /**
   * Releases the GPU resources. `defer` postpones the release until work already encoded with them
   * was submitted (the runtime releases after its next submit).
   */
  dispose(defer?: (release: () => void) => void): void {
    const release = () => {
      for (const buffer of [this.aabbs, this.sorted, this.parents, this.counters, this.bounds]) buffer.destroy();
      this.radix?.dispose();
      this.disposed = true;
      if (!this.readbackBusy) this.sahReadback.destroy();
    };
    if (defer) defer(release); else release();
  }
}

/** A refit tree is rebuilt once its SAH estimate exceeds this multiple of the cost right after the build. */
export const PT_REBUILD_SAH_RATIO = 1.5;
export const PT_NODE_BYTES = PT_BVH_NODE.size;
