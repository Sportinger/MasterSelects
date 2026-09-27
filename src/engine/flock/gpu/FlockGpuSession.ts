import type { FlockEvaluationContext } from '../../../services/flock/compiler/flockParamEvaluation';
import { FlockFluidGrid } from './FlockFluidGrid';
import { FlockGpuCheckpoints } from './FlockGpuCheckpoints';
import { FlockParticleOrder } from './FlockParticleOrder';
import { flockPressureMemory } from '../shared/flockPressureLayout';
import { flockGpuTimings } from './FlockGpuTimings';
import { OP_KIND_CODES } from '../shared/flockCodes';
import { resolveFlockStep } from '../../../services/flock/compiler/flockParamEvaluation';
import { nextPowerOfTwo, selectTrailSlots } from '../../../services/flock/compiler/flockCompilerSupport';
import { FLOCK_PARTICLE_BYTES, type FlockProgram } from '../../../services/flock/compiler/flockProgramTypes';
import { prepareCpuStepParams } from '../cpu/flockCpuStepParams';
import { buildInitialFlockState } from '../shared/flockInitialState';
import type { FlockGpuPipelines } from './FlockGpuPipelines';
import {
  SORT_PARAMS_STRIDE,
  STEP_BLOCK_STRIDE,
  TRAIL_PARAMS_STRIDE,
  buildBitonicPasses,
  packStepBlock,
} from './flockGpuLayout';

export const FLOCK_MAX_STEPS_PER_SUBMIT = 24;
const WORKGROUP = 256;

interface TrailResources {
  slotCount: number;
  samples: number;
  interval: number;
  slots: GPUBuffer;
  ring: GPUBuffer;
  bindGroups: [GPUBindGroup, GPUBindGroup];
}

interface LinkResources {
  perParticle: number;
  buffer: GPUBuffer;
  params: GPUBuffer;
  bindGroups: [GPUBindGroup, GPUBindGroup];
  signature: string;
}

export interface FlockLinkRequest {
  branchIndex: number;
  radius: number;
  perParticle: number;
  fraction: number;
  salt: number;
}

export interface FlockSessionStats {
  alive: number;
  /** Particles whose neighborhood exceeded the candidate budget and was stride-sampled. */
  sampled: number;
  neighborLimited: number;
  gpuBytes: number;
  checkpointBytes: number;
  checkpointSteps: number[];
}

/** Buffer sizes a session would allocate; checked against device limits before creation. */
export function estimateFlockSessionBuffers(program: FlockProgram): { largestBinding: number; total: number } {
  const sortCount = nextPowerOfTwo(Math.max(2, program.capacity));
  const tableSize = nextPowerOfTwo(Math.max(4096, program.capacity * 2));
  const state = program.capacity * FLOCK_PARTICLE_BYTES;
  const cells = tableSize * 16;
  const ring = Math.max(0, ...program.trails.map((trail) => trail.slotCount * trail.samples * 16));
  const [nx, ny, nz] = program.fluid?.dims ?? [0, 0, 0];
  const fluidFaces = (nx + 1) * ny * nz + nx * (ny + 1) * nz + nx * ny * (nz + 1);
  const fluidCells = nx * ny * nz;
  const pressure = program.fluid ? flockPressureMemory(program.fluid.dims) : { total: 0, largestBinding: 0 };
  const fluidBytes = program.fluid ? fluidFaces * 20 + fluidCells * 12
    + state + program.capacity * 24 + Math.ceil(program.capacity / 256) * 64 + 2164 + pressure.total : 0;
  return {
    largestBinding: Math.max(state, cells, sortCount * 4, ring, fluidFaces * 12, fluidCells * 8, pressure.largestBinding),
    total: state * 2 + cells + sortCount * 8 + fluidBytes + program.trails.reduce((sum, trail) => sum + trail.slotCount * (trail.samples * 16 + 4), 0),
  };
}

/**
 * GPU owner of one flock simulation: fixed-step state ping-pong, deterministic
 * sorted spatial index, trail history rings, sparse restart checkpoints.
 * `step` is the number of completed steps represented by the current buffer.
 */
export class FlockGpuSession {
  readonly device: GPUDevice;
  readonly pipelines: FlockGpuPipelines;
  program: FlockProgram;
  readonly capacity: number;
  readonly sortCount: number;
  readonly tableSize: number;
  step = 0;
  gridValid = false;
  lastGridCellSize = 10;
  lastGridStamp = 0;
  stats: FlockSessionStats = { alive: 0, sampled: 0, neighborLimited: 0, gpuBytes: 0, checkpointBytes: 0, checkpointSteps: [] };
  checkpointInterval: number;
  get maxCheckpointBytes(): number { return this.checkpoints.maxBytes; }
  set maxCheckpointBytes(bytes: number) { this.checkpoints.maxBytes = bytes; }

  private context: FlockEvaluationContext;
  private readonly states: [GPUBuffer, GPUBuffer];
  private readonly fluid: FlockFluidGrid | null;
  private readonly order: FlockParticleOrder | null;
  readonly identityMapping: GPUBuffer;
  private currentIndex = 0;
  private readonly keys: GPUBuffer;
  private readonly vals: GPUBuffer;
  private readonly cells: GPUBuffer;
  private readonly stepBlocks: GPUBuffer;
  private readonly stepData: ArrayBuffer;
  private readonly sortParams: GPUBuffer;
  private readonly sortPassCount: number;
  private readonly trailParams: GPUBuffer;
  private readonly trailParamData: ArrayBuffer;
  private readonly statsBuffer: GPUBuffer;
  private readonly statsReadback: GPUBuffer;
  private statsPending = false;
  private readonly gridBindGroups: [GPUBindGroup, GPUBindGroup];
  private readonly simulateBindGroups: [GPUBindGroup, GPUBindGroup];
  private readonly sortBindGroup: GPUBindGroup;
  private readonly cellsBindGroup: GPUBindGroup;
  private readonly trails: TrailResources[];
  private readonly links = new Map<number, LinkResources>();
  private readonly checkpoints: FlockGpuCheckpoints;
  private stampCounter = 1;
  private disposed = false;

  constructor(device: GPUDevice, pipelines: FlockGpuPipelines, program: FlockProgram, context: FlockEvaluationContext, options: { spatialOrder?: boolean } = {}) {
    this.device = device;
    this.pipelines = pipelines;
    this.program = program;
    this.context = context;
    this.capacity = program.capacity;
    this.sortCount = nextPowerOfTwo(Math.max(2, program.capacity));
    this.tableSize = nextPowerOfTwo(Math.max(4096, program.capacity * 2));
    this.checkpointInterval = Math.max(1, program.stepRate);
    const stateBytes = this.capacity * FLOCK_PARTICLE_BYTES;
    const stateUsage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;
    this.states = [
      device.createBuffer({ size: stateBytes, usage: stateUsage, label: 'flock-state-a' }),
      device.createBuffer({ size: stateBytes, usage: stateUsage, label: 'flock-state-b' }),
    ];
    this.fluid = program.fluid ? new FlockFluidGrid(device, program.fluid, this.states, FLOCK_MAX_STEPS_PER_SUBMIT) : null;
    this.order = program.fluid && options.spatialOrder !== false ? new FlockParticleOrder(device, this.states, program.fluid) : null;
    this.identityMapping = this.order?.mapping ?? device.createBuffer({ size: 4, usage: GPUBufferUsage.STORAGE });
    this.keys = device.createBuffer({ size: this.sortCount * 4, usage: GPUBufferUsage.STORAGE, label: 'flock-grid-keys' });
    this.vals = device.createBuffer({ size: this.sortCount * 4, usage: GPUBufferUsage.STORAGE, label: 'flock-grid-vals' });
    this.cells = device.createBuffer({ size: this.tableSize * 16, usage: GPUBufferUsage.STORAGE, label: 'flock-grid-cells' });
    this.stepData = new ArrayBuffer(STEP_BLOCK_STRIDE * (FLOCK_MAX_STEPS_PER_SUBMIT + 1));
    this.stepBlocks = device.createBuffer({ size: this.stepData.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, label: 'flock-step-blocks' });

    const passes = buildBitonicPasses(this.sortCount);
    this.sortPassCount = passes.length;
    const sortData = new Uint32Array(passes.length * (SORT_PARAMS_STRIDE / 4));
    passes.forEach((pass, index) => {
      const o = index * (SORT_PARAMS_STRIDE / 4);
      sortData[o] = pass.k;
      sortData[o + 1] = pass.j;
      sortData[o + 2] = this.sortCount;
    });
    this.sortParams = device.createBuffer({ size: sortData.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, label: 'flock-sort-params' });
    device.queue.writeBuffer(this.sortParams, 0, sortData);

    this.trailParamData = new ArrayBuffer(TRAIL_PARAMS_STRIDE * FLOCK_MAX_STEPS_PER_SUBMIT * Math.max(1, program.trails.length));
    this.trailParams = device.createBuffer({ size: this.trailParamData.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, label: 'flock-trail-params' });
    this.statsBuffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST, label: 'flock-stats' });
    this.statsReadback = device.createBuffer({ size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST, label: 'flock-stats-readback' });

    const gridGroup = (stateIndex: number) => device.createBindGroup({
      layout: pipelines.gridLayout,
      entries: [
        { binding: 0, resource: { buffer: this.states[stateIndex] } },
        { binding: 1, resource: { buffer: this.keys } },
        { binding: 2, resource: { buffer: this.vals } },
        { binding: 3, resource: { buffer: this.stepBlocks, size: STEP_BLOCK_STRIDE } },
        { binding: 4, resource: { buffer: this.identityMapping } },
      ],
      label: `flock-grid-${stateIndex}`,
    });
    this.gridBindGroups = [gridGroup(0), gridGroup(1)];
    const simulateGroup = (inputIndex: number) => device.createBindGroup({
      layout: pipelines.simulateLayout,
      entries: [
        { binding: 0, resource: { buffer: this.states[inputIndex] } },
        { binding: 1, resource: { buffer: this.states[1 - inputIndex] } },
        { binding: 2, resource: { buffer: this.vals } },
        { binding: 3, resource: { buffer: this.cells } },
        { binding: 4, resource: { buffer: this.stepBlocks, size: STEP_BLOCK_STRIDE } },
        { binding: 5, resource: { buffer: this.statsBuffer } },
        { binding: 6, resource: { buffer: this.identityMapping } },
      ],
      label: `flock-simulate-${inputIndex}`,
    });
    this.simulateBindGroups = [simulateGroup(0), simulateGroup(1)];
    this.sortBindGroup = device.createBindGroup({
      layout: pipelines.sortLayout,
      entries: [
        { binding: 0, resource: { buffer: this.keys } },
        { binding: 1, resource: { buffer: this.vals } },
        { binding: 2, resource: { buffer: this.sortParams, size: SORT_PARAMS_STRIDE } },
      ],
      label: 'flock-sort',
    });
    this.cellsBindGroup = device.createBindGroup({
      layout: pipelines.cellsLayout,
      entries: [
        { binding: 0, resource: { buffer: this.keys } },
        { binding: 1, resource: { buffer: this.cells } },
        { binding: 2, resource: { buffer: this.stepBlocks, size: STEP_BLOCK_STRIDE } },
      ],
      label: 'flock-cells',
    });

    this.trails = program.trails.map((trail) => {
      const slotIndices = selectTrailSlots(this.capacity, trail.sampleFraction, trail.slotCount, trail.salt);
      const slotCount = Math.max(1, slotIndices.length);
      const slots = device.createBuffer({ size: slotCount * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, label: 'flock-trail-slots' });
      const slotData = slotIndices.length > 0 ? slotIndices : new Uint32Array([0]);
      device.queue.writeBuffer(slots, 0, slotData.buffer as ArrayBuffer, slotData.byteOffset, slotData.byteLength);
      const ring = device.createBuffer({
        size: slotCount * trail.samples * 16,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
        label: 'flock-trail-ring',
      });
      const trailGroup = (stateIndex: number) => device.createBindGroup({
        layout: pipelines.trailLayout,
        entries: [
          { binding: 0, resource: { buffer: this.states[stateIndex] } },
          { binding: 1, resource: { buffer: slots } },
          { binding: 2, resource: { buffer: ring } },
          { binding: 3, resource: { buffer: this.trailParams, size: TRAIL_PARAMS_STRIDE } },
          { binding: 4, resource: { buffer: this.identityMapping } },
        ],
        label: `flock-trail-${stateIndex}`,
      });
      return { slotCount: slotIndices.length, samples: trail.samples, interval: trail.interval, slots, ring, bindGroups: [trailGroup(0), trailGroup(1)] };
    });

    this.checkpoints = new FlockGpuCheckpoints(device, stateBytes, [], this.trails.map(trail => trail.ring), (checkpointBytes, checkpointSteps) => {
      this.stats = { ...this.stats, checkpointBytes, checkpointSteps };
    });
    this.resetState();
    this.stats.gpuBytes = stateBytes * 2 + this.sortCount * 8 + this.tableSize * 16
      + this.trails.reduce((sum, trail) => sum + trail.ring.size + trail.slots.size, 0)
      + (this.fluid?.gpuBytes ?? 0) + (this.order?.gpuBytes ?? this.identityMapping.size);
  }

  get currentState(): GPUBuffer {
    return this.states[this.currentIndex];
  }

  get previousState(): GPUBuffer {
    return this.states[1 - this.currentIndex];
  }

  get trailResources(): ReadonlyArray<Pick<TrailResources, 'slotCount' | 'samples' | 'interval' | 'slots' | 'ring'>> {
    return this.trails;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  setContext(program: FlockProgram, context: FlockEvaluationContext): void {
    this.program = program;
    this.context = context;
  }

  /** Drops checkpoints after `fromStep` and rewinds if the current state is affected. */
  invalidateFrom(fromStep: number): void {
    this.checkpoints.invalidateFrom(fromStep);
    if (this.step > fromStep) this.restoreAtOrBefore(fromStep);
  }

  hasCheckpointAtOrBefore(step: number): number { return this.checkpoints.atOrBefore(step); }

  /** Advances toward `targetStep` using at most `maxSteps`; returns whether it arrived. */
  advanceTo(targetStep: number, maxSteps: number): boolean {
    if (this.disposed) return false;
    if (targetStep < this.step) this.restoreAtOrBefore(targetStep);
    let remaining = Math.min(targetStep - this.step, Math.max(0, Math.floor(maxSteps)));
    while (remaining > 0) {
      const batch = Math.min(remaining, FLOCK_MAX_STEPS_PER_SUBMIT);
      this.encodeBatch(batch);
      remaining -= batch;
    }
    return this.step >= targetStep;
  }

  private encodeBatch(batch: number): void {
    const encoder = this.device.createCommandEncoder({ label: 'flock-steps' });
    const trailWrites: Array<{ step: number; trail: number; offset: number }> = [];
    const trailView = new Uint32Array(this.trailParamData);
    const needsGrid: boolean[] = [];
    for (let b = 0; b < batch; b += 1) {
      const stepIndex = this.step + b;
      const params = prepareCpuStepParams(resolveFlockStep(this.program, stepIndex, this.context));
      // Neighbor rules are the only step consumer of the spatial index; links rebuild it on demand.
      needsGrid.push(params.rules.length > 0);
      const stamp = this.stampCounter;
      this.stampCounter = (this.stampCounter + 1) >>> 0 || 1;
      packStepBlock(this.stepData, b * STEP_BLOCK_STRIDE, params, {
        count: this.capacity,
        sortCount: this.sortCount,
        tableMask: this.tableSize - 1,
        stamp,
        neighborLimit: this.program.simulation.neighborLimit,
        cellCandidates: this.program.simulation.cellCandidates,
      });
      if (this.fluid) {
        const fluidOp = params.fields.find((field) => field.kind === OP_KIND_CODES.fluid);
        this.fluid.stageParams(b, { count: this.capacity, flipRatio: fluidOp?.f[0] ?? 0.95, dt: params.dt });
      }
      if (b === batch - 1) {
        this.lastGridCellSize = params.cellSize;
        this.lastGridStamp = stamp;
      }
      this.trails.forEach((trail, trailIndex) => {
        const completed = stepIndex + 1;
        if (trail.slotCount === 0 || completed % trail.interval !== 0) return;
        const offset = (b * this.trails.length + trailIndex) * TRAIL_PARAMS_STRIDE;
        trailView[offset / 4] = Math.floor(completed / trail.interval) % trail.samples;
        trailView[offset / 4 + 1] = trail.samples;
        trailView[offset / 4 + 2] = trail.slotCount;
        trailWrites.push({ step: b, trail: trailIndex, offset });
      });
    }
    this.device.queue.writeBuffer(this.stepBlocks, 0, this.stepData, 0, batch * STEP_BLOCK_STRIDE);
    this.fluid?.uploadParams(batch);
    if (trailWrites.length > 0) this.device.queue.writeBuffer(this.trailParams, 0, this.trailParamData);
    this.device.queue.writeBuffer(this.statsBuffer, 0, new Uint32Array(4));

    const sortWorkgroups = Math.ceil(this.sortCount / WORKGROUP);
    const particleWorkgroups = Math.ceil(this.capacity / WORKGROUP);
    for (let b = 0; b < batch; b += 1) {
      const offset = b * STEP_BLOCK_STRIDE;
      this.order?.encodeBeforeStep(encoder, this.currentIndex, this.step);
      let pass = encoder.beginComputePass({ label: 'flock-step-pass', timestampWrites: flockGpuTimings(this.device).writes(encoder, 'simulate') });
      if (needsGrid[b]) this.encodeGrid(pass, offset, sortWorkgroups);
      pass.setPipeline(this.pipelines.simulatePipeline);
      pass.setBindGroup(0, this.simulateBindGroups[this.currentIndex], [offset]);
      pass.dispatchWorkgroups(particleWorkgroups);
      // FLIP corrects the step output in place before it becomes the current state.
      if (this.fluid) {
        pass.end();
        this.fluid.encode(encoder, 1 - this.currentIndex, b, this.capacity);
        pass = encoder.beginComputePass({ label: 'flock-trail-pass' });
      }
      this.currentIndex = 1 - this.currentIndex;
      for (const write of trailWrites) {
        if (write.step !== b) continue;
        const trail = this.trails[write.trail];
        pass.setPipeline(this.pipelines.trailPipeline);
        pass.setBindGroup(0, trail.bindGroups[this.currentIndex], [write.offset]);
        pass.dispatchWorkgroups(Math.ceil(trail.slotCount / WORKGROUP));
      }
      pass.end();
      this.step += 1;
      this.gridValid = needsGrid[b];
      if (this.step % this.checkpointInterval === 0 && !this.checkpoints.has(this.step)) {
        this.encodeCheckpoint(encoder, this.step);
      }
    }
    const readStats = !this.statsPending;
    if (readStats) encoder.copyBufferToBuffer(this.statsBuffer, 0, this.statsReadback, 0, 16);
    const readTimings = flockGpuTimings(this.device).resolve(encoder, `simulation:${this.program.hashes.topology}`);
    this.device.queue.submit([encoder.finish()]);
    this.checkpoints.releaseRetired();
    readTimings();
    if (readStats) this.readStats(batch);
  }

  private encodeGrid(pass: GPUComputePassEncoder, blockOffset: number, sortWorkgroups: number): void {
    pass.setPipeline(this.pipelines.hashPipeline);
    pass.setBindGroup(0, this.gridBindGroups[this.currentIndex], [blockOffset]);
    pass.dispatchWorkgroups(sortWorkgroups);
    pass.setPipeline(this.pipelines.sortPipeline);
    for (let sortPass = 0; sortPass < this.sortPassCount; sortPass += 1) {
      pass.setBindGroup(0, this.sortBindGroup, [sortPass * SORT_PARAMS_STRIDE]);
      pass.dispatchWorkgroups(sortWorkgroups);
    }
    pass.setPipeline(this.pipelines.cellsPipeline);
    pass.setBindGroup(0, this.cellsBindGroup, [blockOffset]);
    pass.dispatchWorkgroups(sortWorkgroups);
  }

  /** Rebuilds the spatial index for the current state (links after a restore). */
  encodeGridOnly(encoder: GPUCommandEncoder): void {
    const params = prepareCpuStepParams(resolveFlockStep(this.program, Math.max(0, this.step - 1), this.context));
    const stamp = this.stampCounter;
    this.stampCounter = (this.stampCounter + 1) >>> 0 || 1;
    const slot = FLOCK_MAX_STEPS_PER_SUBMIT * STEP_BLOCK_STRIDE;
    packStepBlock(this.stepData, slot, params, {
      count: this.capacity,
      sortCount: this.sortCount,
      tableMask: this.tableSize - 1,
      stamp,
      neighborLimit: this.program.simulation.neighborLimit,
      cellCandidates: this.program.simulation.cellCandidates,
    });
    this.device.queue.writeBuffer(this.stepBlocks, slot, this.stepData, slot, STEP_BLOCK_STRIDE);
    const pass = encoder.beginComputePass({ label: 'flock-grid-only' });
    this.encodeGrid(pass, slot, Math.ceil(this.sortCount / WORKGROUP));
    pass.end();
    this.lastGridCellSize = params.cellSize;
    this.lastGridStamp = stamp;
    this.gridValid = true;
  }

  /** Encodes neighbor-link extraction for one render branch into `encoder`; returns its buffer. */
  encodeLinks(encoder: GPUCommandEncoder, request: FlockLinkRequest): { buffer: GPUBuffer; perParticle: number } {
    const perParticle = Math.max(1, Math.min(8, Math.round(request.perParticle)));
    let resources = this.links.get(request.branchIndex);
    if (!resources || resources.perParticle !== perParticle) {
      resources?.buffer.destroy();
      resources?.params.destroy();
      const buffer = this.device.createBuffer({ size: this.capacity * perParticle * 4, usage: GPUBufferUsage.STORAGE, label: 'flock-links' });
      const params = this.device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, label: 'flock-link-params' });
      const group = (stateIndex: number) => this.device.createBindGroup({
        layout: this.pipelines.linksLayout,
        entries: [
          { binding: 0, resource: { buffer: this.states[stateIndex] } },
          { binding: 1, resource: { buffer: this.vals } },
          { binding: 2, resource: { buffer: this.cells } },
          { binding: 3, resource: { buffer } },
          { binding: 4, resource: { buffer: params } },
          { binding: 5, resource: { buffer: this.identityMapping } },
        ],
        label: `flock-links-${stateIndex}`,
      });
      resources = { perParticle, buffer, params, bindGroups: [group(0), group(1)], signature: '' };
      this.links.set(request.branchIndex, resources);
    }
    if (!this.gridValid) this.encodeGridOnly(encoder);
    const range = Math.max(1, Math.min(2, Math.ceil(request.radius / Math.max(this.lastGridCellSize, 1e-3))));
    const signature = `${this.step}|${this.lastGridStamp}|${request.radius}|${request.fraction}|${request.salt}|${this.currentIndex}`;
    if (resources.signature === signature) return { buffer: resources.buffer, perParticle };
    resources.signature = signature;
    const data = new ArrayBuffer(48);
    const f = new Float32Array(data);
    const u = new Uint32Array(data);
    f[0] = Math.min(request.radius, range * this.lastGridCellSize);
    f[1] = request.fraction;
    f[2] = this.lastGridCellSize;
    u[4] = request.salt >>> 0;
    u[5] = perParticle;
    u[6] = this.capacity;
    u[7] = this.tableSize - 1;
    u[8] = this.lastGridStamp;
    u[9] = range;
    u[10] = this.program.simulation.cellCandidates;
    this.device.queue.writeBuffer(resources.params, 0, data);
    const pass = encoder.beginComputePass({ label: 'flock-links-pass' });
    pass.setPipeline(this.pipelines.linksPipeline);
    pass.setBindGroup(0, resources.bindGroups[this.currentIndex]);
    pass.dispatchWorkgroups(Math.ceil(this.capacity / 128));
    pass.end();
    return { buffer: resources.buffer, perParticle };
  }

  private encodeCheckpoint(encoder: GPUCommandEncoder, step: number): void {
    this.checkpoints.capture(encoder, step, destination => {
      if (this.order) this.order.canonical(encoder, this.currentState, destination);
      else encoder.copyBufferToBuffer(this.currentState, 0, destination, 0, this.capacity * FLOCK_PARTICLE_BYTES);
    });
  }

  importCheckpoint(step: number, state: ArrayBuffer, rings: ArrayBuffer[]): boolean {
    return this.checkpoints.import(step, state, rings);
  }

  readCheckpoint(step: number): Promise<{ state: ArrayBuffer; rings: ArrayBuffer[] } | null> {
    return this.checkpoints.read(step);
  }

  /** Bounded identity-ordered sample, optionally from the previous interpolation state. */
  async sampleParticles(maxCount: number, state: 'current' | 'previous' = 'current'): Promise<Float32Array> {
    const count = Math.max(1, Math.min(this.capacity, maxCount));
    const size = count * FLOCK_PARTICLE_BYTES;
    const staging = this.device.createBuffer({ size, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST, label: 'flock-sample-readback' });
    const encoder = this.device.createCommandEncoder();
    const canonical = this.order ? this.device.createBuffer({ size, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC }) : null;
    const source = state === 'previous' ? this.previousState : this.currentState;
    if (canonical) this.order!.canonical(encoder, source, canonical);
    encoder.copyBufferToBuffer(canonical ?? source, 0, staging, 0, size);
    this.device.queue.submit([encoder.finish()]);
    canonical?.destroy();
    await staging.mapAsync(GPUMapMode.READ);
    const values = new Float32Array(staging.getMappedRange().slice(0));
    staging.unmap();
    staging.destroy();
    return values;
  }

  listCheckpointSteps(): number[] {
    return this.checkpoints.steps();
  }

  /** Jumps forward to a checkpoint nearer the target than the current state. */
  seekCheckpoint(targetStep: number): void {
    const best = this.hasCheckpointAtOrBefore(targetStep);
    if (best > this.step) this.restoreAtOrBefore(targetStep);
  }

  clearCheckpoints(): void { this.checkpoints.clear(); }

  /** Copies checkpoints from a session with compatible program semantics. */
  adoptCheckpoints(source: FlockGpuSession, steps: number[]): number {
    return this.checkpoints.adopt(source.checkpoints, steps);
  }

  private restoreAtOrBefore(targetStep: number): void {
    const best = this.hasCheckpointAtOrBefore(targetStep);
    if (best > 0) {
      const encoder = this.device.createCommandEncoder({ label: 'flock-restore' });
      this.checkpoints.restore(encoder, best, this.states);
      this.order?.reset(encoder);
      this.device.queue.submit([encoder.finish()]);
      this.step = best;
    } else {
      this.resetState();
    }
    this.gridValid = false;
  }

  private resetState(): void {
    const initial = buildInitialFlockState(this.program);
    const initialBytes = initial.buffer as ArrayBuffer;
    this.device.queue.writeBuffer(this.states[0], 0, initialBytes, initial.byteOffset, initial.byteLength);
    this.device.queue.writeBuffer(this.states[1], 0, initialBytes, initial.byteOffset, initial.byteLength);
    if (this.order) {
      const encoder = this.device.createCommandEncoder(); this.order.reset(encoder); this.device.queue.submit([encoder.finish()]);
    }
    for (const trail of this.trails) {
      this.device.queue.writeBuffer(trail.ring, 0, new Float32Array(trail.ring.size / 4));
    }
    this.currentIndex = 0;
    this.step = 0;
    this.gridValid = false;
  }

  private readStats(batch: number): void {
    this.statsPending = true;
    void this.statsReadback.mapAsync(GPUMapMode.READ).then(() => {
      const values = new Uint32Array(this.statsReadback.getMappedRange().slice(0));
      this.statsReadback.unmap();
      this.stats = {
        ...this.stats,
        sampled: Math.round(values[0] / batch),
        neighborLimited: Math.round(values[1] / batch),
        alive: Math.round(values[2] / batch),
      };
    }).catch(() => undefined).finally(() => {
      this.statsPending = false;
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.fluid?.dispose();
    if (this.order) this.order.dispose(); else this.identityMapping.destroy();
    this.checkpoints.clear();
    for (const link of this.links.values()) {
      link.buffer.destroy();
      link.params.destroy();
    }
    this.links.clear();
    for (const trail of this.trails) {
      trail.ring.destroy();
      trail.slots.destroy();
    }
    for (const buffer of [...this.states, this.keys, this.vals, this.cells, this.stepBlocks, this.sortParams, this.trailParams, this.statsBuffer]) {
      buffer.destroy();
    }
    if (!this.statsPending) this.statsReadback.destroy();
  }
}
