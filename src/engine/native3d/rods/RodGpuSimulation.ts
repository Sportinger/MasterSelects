import { knitCycleGuideTable, CYCLE_GUIDE_POINTS, CYCLE_GUIDE_PHASES } from '../../../services/operators/geometry/knitCycleGuides';
import { Logger } from '../../../services/logger';
import solverShader from '../shaders/RodSolver.wgsl?raw';
import cycleShader from '../shaders/RodCycleGuide.wgsl?raw';
import motionGuardShader from '../shaders/RodMotionGuard.wgsl?raw';
import outputShader from '../shaders/RodOutput.wgsl?raw';
import { FlockRadixSort } from '../../flock/gpu/FlockRadixSort';
import { FIELD_FUNCTIONS_WGSL } from '../../../services/operators/fields/fieldFunctionsWgsl';
import type { CurveSet } from '../../../services/operators/geometry/geometryEvaluation';
import type { RodSpec } from '../../../services/operators/geometry/rodProgram';
import type { RodRest } from '../../../services/operators/geometry/rodRest';
import { buildRodTopology, type RodTopology } from '../../../services/operators/geometry/rodTopology';
import { ROD_KINETIC, ROD_SELF_GAP, rodCellSize } from '../../../services/operators/geometry/rodContacts';
import { ROD_AIR_DRAG, ROD_FORM_TRAVEL, ROD_MAX_TRAVEL, ROD_STEP_LIMIT, ROD_STEP_RATE, rodBendModulus, rodInverseMass,
  rodStretchModulus } from '../../../services/operators/geometry/rodSolver';
import { windVelocity } from '../../../services/operators/geometry/simulationForces';
import { strandRodFieldCode, type StrandFieldCode } from '../passes/strandFieldShader';
import { StrandFramesPass } from '../passes/StrandFramesPass';

const PARAMS_BYTES = 304;
const PASS_BYTES = 48;
const NO_SEGMENT = 0xffffffff;
/** Form time of nodes that are never formed: WGSL may assume finite floats. */
const NEVER = 3e38;
const CHECKPOINT_INTERVAL = 30;
/** GPU memory bound: when full, every other checkpoint is dropped and the spacing doubles. */
const CHECKPOINT_LIMIT = 40;
const NO_FIELDS = strandRodFieldCode([]);
const SOLVER_ENTRIES = ['predict', 'stretch', 'bend', 'limitMotion', 'measureSegments', 'motionBounds', 'cellKeys', 'cellRangesOf', 'contacts', 'correctContacts', 'apply', 'nodeExtent'] as const;
type SolverEntry = typeof SOLVER_ENTRIES[number];

interface DevicePipelines {
  solverLayout: GPUBindGroupLayout;
  solver: Record<SolverEntry, GPUComputePipeline>;
  outputLayout: GPUBindGroupLayout;
  outputs: Map<string, GPUComputePipeline>;
}
const pipelinesByDevice = new WeakMap<GPUDevice, DevicePipelines>();

function devicePipelines(device: GPUDevice): DevicePipelines {
  let pipelines = pipelinesByDevice.get(device);
  if (pipelines) return pipelines;
  const entry = (binding: number, type: GPUBufferBindingType, dynamic = false): GPUBindGroupLayoutEntry =>
    ({ binding, visibility: GPUShaderStage.COMPUTE, buffer: { type, hasDynamicOffset: dynamic } });
  const solverLayout = device.createBindGroupLayout({ label: 'rod-solver', entries: [entry(0, 'uniform'), entry(1, 'uniform', true),
    entry(2, 'read-only-storage'), entry(3, 'storage'), entry(4, 'storage'), entry(5, 'storage'), entry(6, 'storage'), entry(7, 'read-only-storage')] });
  const module = device.createShaderModule({ label: 'rod-solver', code: solverShader.replace('//@cycle-guide', cycleShader).replace('//@motion-guard', motionGuardShader) });
  void module.getCompilationInfo().then(info => { for (const message of info.messages) if (message.type === 'error') Logger.create('RodGpuSimulation').error(message.message); });
  const layout = device.createPipelineLayout({ bindGroupLayouts: [solverLayout] });
  device.pushErrorScope('validation');
  const solver = Object.fromEntries(SOLVER_ENTRIES.map(name => [name,
    device.createComputePipeline({ label: `rod-${name}`, layout, compute: { module, entryPoint: name } })])) as Record<SolverEntry, GPUComputePipeline>;
  void device.popErrorScope().then(error => { if (error) Logger.create('RodGpuSimulation').error(error.message); });
  const outputLayout = device.createBindGroupLayout({ label: 'rod-output', entries: [entry(0, 'uniform'), entry(1, 'read-only-storage'),
    entry(2, 'read-only-storage'), entry(3, 'read-only-storage'), entry(4, 'read-only-storage'), entry(5, 'storage'), entry(6, 'read-only-storage'), entry(7, 'storage')] });
  pipelines = { solverLayout, solver, outputLayout, outputs: new Map() };
  pipelinesByDevice.set(device, pipelines);
  return pipelines;
}

function outputPipeline(device: GPUDevice, pipelines: DevicePipelines, fields: StrandFieldCode): GPUComputePipeline {
  let pipeline = pipelines.outputs.get(fields.code);
  if (!pipeline) {
    const code = outputShader.replace('//@strand-fields', `${fields === NO_FIELDS ? '' : FIELD_FUNCTIONS_WGSL}\n${fields.code}`);
    pipeline = device.createComputePipeline({ label: 'rod-output', layout: device.createPipelineLayout({ bindGroupLayouts: [pipelines.outputLayout] }),
      compute: { module: device.createShaderModule({ label: 'rod-output', code }), entryPoint: 'rodOutput' } });
    pipelines.outputs.set(fields.code, pipeline);
  }
  return pipeline;
}

/**
 * Rod Simulation on the GPU (RodSolver.wgsl): the scheme of RodSimulation (rodSolver.ts) in f32,
 * with the topology uploaded once and the state kept on the GPU. Steps advance and checkpoint like
 * the CPU solver, so scrubbing resumes from exact GPU states; the output pass writes the strand
 * points of every incoming curve point (RodOutput.wgsl, StrandFrames.wgsl). Deterministic on one
 * device; f32 and the parallel order make it differ slightly from the CPU reference.
 */
export class RodGpuSimulation {
  /** Largest distance of a node from the layer origin, a frame behind the simulation. */
  extent: number;
  private readonly device: GPUDevice;
  private readonly spec: RodSpec;
  private readonly topology: RodTopology;
  private readonly pipelines: DevicePipelines;
  private readonly nodeCount: number;
  private readonly segmentCount: number;
  private readonly slots: Array<{ entry: 'stretch' | 'bend'; offset: number; count: number }> = [];
  private readonly state: GPUBuffer;
  private readonly earlier: GPUBuffer;
  private readonly params: GPUBuffer;
  private readonly passes: GPUBuffer;
  private readonly buffers: GPUBuffer[] = [];
  private readonly sort: FlockRadixSort | null;
  private readonly group: GPUBindGroup;
  private readonly frames = new StrandFramesPass();
  private readonly pointRods: GPUBuffer;
  private readonly pointGeometry: GPUBuffer;
  private readonly ranges: GPUBuffer;
  private readonly points: number;
  private readonly strands: number;
  private readonly extentBits: GPUBuffer;
  private readonly extentRead: GPUBuffer;
  private extentPending = false;
  private readonly checkpoints = new Map<number, GPUBuffer>();
  private interval = CHECKPOINT_INTERVAL;
  private step = 0;
  private earlierStep = -1;
  private stamp = 0;

  constructor(device: GPUDevice, spec: RodSpec, rest: RodRest, curves: CurveSet, label: string) {
    this.device = device; this.spec = spec;
    this.topology = buildRodTopology(rest);
    this.pipelines = devicePipelines(device);
    const { segments, bends, nodeSegments, before, after, mass, stretchColors, bendColors } = this.topology;
    const nodes = this.nodeCount = this.topology.nodeCount, segmentCount = this.segmentCount = segments.a.length, bendCount = bends.prev.length;
    const create = (size: number, usage: number, name: string) => {
      const buffer = device.createBuffer({ label: `${label}-${name}`, size: Math.max(16, Math.ceil(size / 16) * 16), usage });
      this.buffers.push(buffer);
      return buffer;
    };
    const storage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
    // Topology words: nodes, segments, bends, then the colour lists (four entries per word).
    const colorEntries = [...stretchColors, ...bendColors].reduce((sum, list) => sum + list.length, 0);
    const segmentBase = nodes * 4, bendBase = segmentBase + segmentCount * 2, colorBase = bendBase + bendCount * 2;
    const words = new ArrayBuffer((colorBase + Math.ceil(colorEntries / 4) + 1) * 16);
    const u = new Uint32Array(words), f = new Float32Array(words);
    const stretch = rodStretchModulus(spec.stretch), bend = rodBendModulus(spec.bend);
    const inverseMass = new Float32Array(nodes);
    for (let node = 0; node < nodes; node++) {
      const word = node * 16;
      inverseMass[node] = rodInverseMass(mass[node], rest.pinned[node] === 1, spec.radius);
      f.set([rest.positions[node * 3], rest.positions[node * 3 + 1], rest.positions[node * 3 + 2], inverseMass[node]], word);
      // Pinned nodes never form: their slot holds the pull start instead.
      const time = rest.pinned[node] === 1 ? rest.pullStart[node] : Number.isFinite(rest.form[node]) ? rest.form[node] : NEVER;
      f.set([rest.pull[node * 3], rest.pull[node * 3 + 1], rest.pull[node * 3 + 2], time], word + 4);
      u.set([before[node], after[node], nodeSegments[node * 2] < 0 ? NO_SEGMENT : nodeSegments[node * 2],
        nodeSegments[node * 2 + 1] < 0 ? NO_SEGMENT : nodeSegments[node * 2 + 1]], word + 8);
    }
    for (let row = 0; row < rest.counts.length; row++) {
      for (let node = rest.starts[row], end = node + rest.counts[row]; node < end; node++) {
        f.set([rest.material[node], row, 0, 0], node * 16 + 12);
      }
    }
    for (let c = 0; c < segmentCount; c++) {
      const word = (segmentBase + c * 2) * 4;
      u.set([segments.a[c], segments.b[c], segments.rod[c], segments.rodClosed[segments.rod[c]]], word);
      f.set([segments.rest[c], segments.arc[c], segments.rodLength[segments.rod[c]], segments.rest[c] / stretch], word + 4);
    }
    for (let k = 0; k < bendCount; k++) {
      const word = (bendBase + k * 2) * 4;
      u.set([bends.prev[k], bends.mid[k], bends.next[k], 0], word);
      f.set([bends.inverse1[k], bends.inverse2[k], bends.length[k] / bend, 0], word + 4);
    }
    let cursor = 0;
    for (const [entry, lists] of [['stretch', stretchColors], ['bend', bendColors]] as const) {
      for (const list of lists) {
        u.set(list, colorBase * 4 + cursor);
        this.slots.push({ entry, offset: cursor, count: list.length });
        cursor += list.length;
      }
    }
    const topology = create(words.byteLength, storage, 'topology');
    device.queue.writeBuffer(topology, 0, words);
    // State: positions (xyz, inverse mass), velocities, predicted positions, two contact sums per segment.
    this.state = create((3 * nodes + (spec.cycle ? 3 : 2) * segmentCount) * 16, storage, 'state');
    const initial = new Float32Array(nodes * 4);
    for (let node = 0; node < nodes; node++) initial.set([rest.start[node * 3], rest.start[node * 3 + 1], rest.start[node * 3 + 2], inverseMass[node]], node * 4);
    device.queue.writeBuffer(this.state, 0, initial);
    this.earlier = create(nodes * 16, storage, 'earlier');
    let size = 1;
    while (size < segmentCount * 2) size *= 2;
    // Keys stay below 2^16 (at most 2^15 buckets); four passes leave the sorted keys in the input buffer.
    this.sort = segmentCount ? new FlockRadixSort(device, segmentCount, 0xffff) : null;
    if (this.sort && this.sort.output !== this.sort.input) throw new Error('Rod contact sort must sort in place.');
    const cells = create(size * 16, storage, 'cells');
    this.extentBits = create(16, storage, 'extent');
    this.extentRead = create(16, GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ, 'extent-read');
    let longest = 0;
    for (const length of segments.rest) longest = Math.max(longest, length);
    const dt = 1 / (ROD_STEP_RATE * spec.substeps);
    const data = new ArrayBuffer(PARAMS_BYTES), pu = new Uint32Array(data), pf = new Float32Array(data);
    pu.set([nodes, segmentCount, bendCount, size - 1]);
    pf.set([spec.radius, dt, Math.exp(-(spec.damping + spec.drag) * dt), spec.gravity,
      1 - Math.exp(-ROD_AIR_DRAG * dt), ROD_MAX_TRAVEL * spec.radius / dt, spec.friction, spec.floorHeight], 4);
    pu.set([spec.floor ? 1 : 0, Math.min(8, spec.turbulence.length)], 12);
    pf.set([rodCellSize(longest, spec.radius), ROD_SELF_GAP, ROD_KINETIC], 14);
    pu.set([segmentBase, bendBase, colorBase], 17);
    spec.turbulence.slice(0, 8).forEach((field, index) => pf.set([field.strength, field.frequency, 0, 0], 20 + index * 4));
    // The sign encodes constant-speed pulling without changing the uniform layout.
    pf.set([spec.formEase, ROD_FORM_TRAVEL * spec.radius, spec.pull, spec.pullLinear ? -spec.pullTime : spec.pullTime], 52);
    if (spec.cycle) {
      const s = spec.cycle;
      pf.set([1, s.rows, s.stitches, s.radius, s.spacing, s.height, s.depth, s.lean,
        s.width, s.entry, s.exit, s.period, s.strength, CYCLE_GUIDE_POINTS, CYCLE_GUIDE_PHASES, 0], 56);
    }
    // cycle3.w carries fixture motion independently of whether cycle guides are enabled.
    pf[71] = spec.pullOscillate ? 1 : 0;
    pf.set([spec.pullHold ?? 0, spec.pullPause ?? 0, 0, 0], 72);
    this.params = create(PARAMS_BYTES, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, 'params');
    device.queue.writeBuffer(this.params, 0, data);
    const stride = Math.max(256, device.limits.minUniformBufferOffsetAlignment);
    this.passes = create(spec.substeps * (1 + this.slots.length) * stride, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, 'passes');
    const placeholder = this.sort ? null : create(16, storage, 'no-sort');
    const guideData = spec.cycle ? knitCycleGuideTable(spec.cycle) : new Float32Array(4);
    const guideBuffer = create(guideData.byteLength, storage, 'cycle-guides');
    device.queue.writeBuffer(guideBuffer, 0, guideData as Float32Array<ArrayBuffer>);
    this.group = device.createBindGroup({ layout: this.pipelines.solverLayout, entries: [
      { binding: 0, resource: { buffer: this.params } }, { binding: 1, resource: { buffer: this.passes, size: PASS_BYTES } },
      { binding: 2, resource: { buffer: topology } }, { binding: 3, resource: { buffer: this.state } },
      { binding: 4, resource: { buffer: this.sort?.input ?? placeholder! } },
      { binding: 5, resource: { buffer: cells } }, { binding: 6, resource: { buffer: this.extentBits } }, { binding: 7, resource: { buffer: guideBuffer } }] });
    // Output: every incoming curve point on its rod, with its rest detail and radius scale.
    this.points = curves.positions.length / 3; this.strands = curves.counts.length;
    const rods = new Uint32Array(Math.max(1, this.points) * 4), geometry = new Float32Array(Math.max(1, this.points) * 8);
    const ranges = new Uint32Array(Math.max(1, this.strands) * 2);
    for (let strand = 0; strand < this.strands; strand++) {
      const start = curves.starts[strand], count = curves.counts[strand];
      ranges.set([start, count], strand * 2);
      for (let point = 0; point < count; point++) {
        const index = start + point;
        rods.set([rest.pointNode[index], rest.starts[strand], rest.counts[strand], rest.closed[strand] + (spec.cycle ? 2 : 0)], index * 4);
        geometry.set([rest.detail[index * 3], rest.detail[index * 3 + 1], rest.detail[index * 3 + 2], rest.pointFraction[index],
          curves.radius ? curves.radius[index] : 1, strand, point, count], index * 8);
      }
    }
    const upload = (values: Float32Array<ArrayBuffer> | Uint32Array<ArrayBuffer>, name: string) => {
      const buffer = create(values.byteLength, storage, name);
      device.queue.writeBuffer(buffer, 0, values);
      return buffer;
    };
    this.pointRods = upload(rods, 'point-rods'); this.pointGeometry = upload(geometry, 'point-geometry'); this.ranges = upload(ranges, 'ranges');
    let reach = 0;
    for (let index = 0; index < rest.positions.length; index += 3) {
      reach = Math.max(reach, Math.hypot(rest.positions[index], rest.positions[index + 1], rest.positions[index + 2]),
        Math.hypot(rest.start[index], rest.start[index + 1], rest.start[index + 2]));
    }
    this.extent = reach + Math.abs(spec.pull) + 4 * spec.radius;
    this.checkpoints.set(0, this.snapshot());
  }

  private snapshot(): GPUBuffer {
    const buffer = this.device.createBuffer({ label: 'rod-checkpoint', size: this.nodeCount * 32, usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
    const encoder = this.device.createCommandEncoder({ label: 'rod-checkpoint' });
    encoder.copyBufferToBuffer(this.state, 0, buffer, 0, this.nodeCount * 32);
    this.device.queue.submit([encoder.finish()]);
    return buffer;
  }

  private restore(buffer: GPUBuffer): void {
    const encoder = this.device.createCommandEncoder({ label: 'rod-restore' });
    encoder.copyBufferToBuffer(buffer, 0, this.state, 0, this.nodeCount * 32);
    this.device.queue.submit([encoder.finish()]);
  }

  /** Node state after `target` steps: advances, or resumes from the latest checkpoint before it (as RodSimulation.positionsAt). */
  private goTo(target: number): void {
    target = Math.max(0, Math.min(ROD_STEP_LIMIT, Math.floor(target)));
    let best = 0;
    for (const step of this.checkpoints.keys()) if (step <= target && step > best) best = step;
    if (target < this.step || best > this.step) {
      this.restore(this.checkpoints.get(best)!);
      this.step = best;
    }
    while (this.step < target) {
      this.advance();
      this.step++;
      if (this.step % this.interval === 0 && !this.checkpoints.has(this.step)) this.remember();
    }
  }

  private remember(): void {
    if (this.checkpoints.size >= CHECKPOINT_LIMIT) {
      this.interval *= 2;
      for (const [step, buffer] of [...this.checkpoints]) if (step % this.interval !== 0) { buffer.destroy(); this.checkpoints.delete(step); }
      if (this.step % this.interval !== 0) return;
    }
    this.checkpoints.set(this.step, this.snapshot());
  }

  /** One fixed step: every substep predicts, solves stretch and bend by colour, gathers contacts and applies them. */
  private advance(): void {
    const { device, spec } = this, slots = 1 + this.slots.length, stride = Math.max(256, device.limits.minUniformBufferOffsetAlignment);
    const time = this.step / ROD_STEP_RATE - spec.preroll, wind = windVelocity(spec, time), dt = 1 / (ROD_STEP_RATE * spec.substeps);
    const data = new ArrayBuffer(spec.substeps * slots * stride), u = new Uint32Array(data), f = new Float32Array(data);
    for (let substep = 0; substep < spec.substeps; substep++) {
      const stamp = ++this.stamp >>> 0;
      for (let slot = 0; slot < slots; slot++) {
        const word = (substep * slots + slot) * stride / 4, color = slot ? this.slots[slot - 1] : null;
        f[word] = time; u[word + 2] = stamp;
        u[word + 3] = color?.offset ?? 0; u[word + 4] = color?.count ?? 0; f[word + 5] = time + (substep + 1) * dt;
        f.set([wind[0], wind[1], wind[2], 0], word + 8);
      }
    }
    device.queue.writeBuffer(this.passes, 0, data);
    const { solver } = this.pipelines, nodeGroups = Math.ceil(this.nodeCount / 256), segmentGroups = Math.ceil(this.segmentCount / 256);
    const encoder = device.createCommandEncoder({ label: 'rod-step' });
    for (let substep = 0; substep < spec.substeps; substep++) {
      const offset = (slot: number) => [(substep * slots + slot) * stride];
      if (spec.cycle) encoder.clearBuffer(this.extentBits, 4, 4);
      let pass = encoder.beginComputePass({ label: 'rod-substep' });
      pass.setBindGroup(0, this.group, offset(0));
      pass.setPipeline(solver.predict);
      pass.dispatchWorkgroups(nodeGroups);
      this.slots.forEach((color, index) => {
        pass.setBindGroup(0, this.group, offset(index + 1));
        pass.setPipeline(solver[color.entry]);
        pass.dispatchWorkgroups(Math.ceil(color.count / 64));
      });
      pass.setBindGroup(0, this.group, offset(0));
      if (spec.cycle) {
        pass.setPipeline(solver.limitMotion);
        pass.dispatchWorkgroups(nodeGroups);
        pass.setPipeline(solver.measureSegments);
        pass.dispatchWorkgroups(segmentGroups);
      }
      if (this.sort) {
        pass.setPipeline(solver.cellKeys);
        pass.dispatchWorkgroups(segmentGroups);
        pass.end();
        this.sort.encode(encoder, null);
        pass = encoder.beginComputePass({ label: 'rod-contacts' });
        pass.setBindGroup(0, this.group, offset(0));
        pass.setPipeline(solver.cellRangesOf);
        pass.dispatchWorkgroups(segmentGroups);
        if (spec.cycle) {
          pass.setPipeline(solver.motionBounds);
          pass.dispatchWorkgroups(Math.ceil(this.segmentCount / 64));
        }
        for (let iteration = 0; iteration < (spec.cycle ? 3 : 1); iteration++) {
          pass.setPipeline(solver.contacts);
          pass.dispatchWorkgroups(Math.ceil(this.segmentCount / 64));
          if (spec.cycle && iteration < 2) {
            pass.setPipeline(solver.correctContacts);
            pass.dispatchWorkgroups(nodeGroups);
          }
        }
      }
      pass.setPipeline(solver.apply);
      pass.dispatchWorkgroups(nodeGroups);
      pass.end();
    }
    device.queue.submit([encoder.finish()]);
  }

  /**
   * Brings the GPU state to the fixed step of `step` (and `step` + 1 when blending), as
   * rodCurves.ts does on the CPU. Returns the blend weight of the current state for the output.
   */
  prepare(step: number, alpha: number): number {
    if (alpha <= 1e-6) {
      this.goTo(step);
      return 1;
    }
    if (this.step !== step + 1 || this.earlierStep !== step) {
      this.goTo(step);
      const encoder = this.device.createCommandEncoder({ label: 'rod-earlier' });
      encoder.copyBufferToBuffer(this.state, 0, this.earlier, 0, this.nodeCount * 16);
      this.device.queue.submit([encoder.finish()]);
      this.earlierStep = step;
      this.goTo(step + 1);
    }
    return alpha;
  }

  /** Writes the strand points of every incoming curve point into `target`, then measures the rods' extent. */
  writeOutput(target: GPUBuffer, fields: StrandFieldCode | undefined, blend: number, temporaryBuffers: GPUBuffer[]): void {
    if (!this.points) return;
    const { device } = this, code = fields ?? NO_FIELDS;
    const groups = Math.ceil(this.points / 256), width = Math.min(groups, device.limits.maxComputeWorkgroupsPerDimension);
    const uniform = device.createBuffer({ label: 'rod-output-params', size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const params = new ArrayBuffer(16);
    new Uint32Array(params).set([this.points, this.strands, 0, width]);
    new Float32Array(params)[2] = blend;
    device.queue.writeBuffer(uniform, 0, params);
    const constants = device.createBuffer({ label: 'rod-output-constants', size: Math.max(1, code.constants.length) * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    if (code.constants.length) device.queue.writeBuffer(constants, 0, Float32Array.from(code.constants));
    temporaryBuffers.push(uniform, constants);
    const encoder = device.createCommandEncoder({ label: 'rod-output' });
    const measure = !this.extentPending;
    if (measure) encoder.clearBuffer(this.extentBits, 0, 16);
    const pass = encoder.beginComputePass({ label: 'rod-output' });
    pass.setPipeline(outputPipeline(device, this.pipelines, code));
    pass.setBindGroup(0, device.createBindGroup({ layout: this.pipelines.outputLayout, entries: [
      { binding: 0, resource: { buffer: uniform } }, { binding: 1, resource: { buffer: this.state, size: this.nodeCount * 16 } },
      { binding: 2, resource: { buffer: this.earlier } }, { binding: 3, resource: { buffer: this.pointRods } },
      { binding: 4, resource: { buffer: this.pointGeometry } }, { binding: 5, resource: { buffer: target } },
      { binding: 6, resource: { buffer: constants } }, { binding: 7, resource: { buffer: this.extentBits } }] }));
    pass.dispatchWorkgroups(width, Math.ceil(groups / width));
    this.frames.encode(device, pass, this.ranges, this.strands, target, temporaryBuffers);
    pass.end();
    if (measure) encoder.copyBufferToBuffer(this.extentBits, 0, this.extentRead, 0, 4);
    device.queue.submit([encoder.finish()]);
    if (!measure) return;
    this.extentPending = true;
    this.extentRead.mapAsync(GPUMapMode.READ).then(() => {
      const bits = new Uint32Array(this.extentRead.getMappedRange(0, 4))[0];
      this.extentRead.unmap();
      const reach = new Float32Array(Uint32Array.of(bits).buffer)[0];
      if (Number.isFinite(reach)) this.extent = reach + 4 * this.spec.radius;
    }).catch(() => undefined).finally(() => { this.extentPending = false; });
  }

  /** Node positions (xyz, inverse mass) of the current state, for checks against the CPU solver. */
  async readNodes(): Promise<Float32Array> {
    const read = this.device.createBuffer({ size: this.nodeCount * 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const encoder = this.device.createCommandEncoder();
    encoder.copyBufferToBuffer(this.state, 0, read, 0, this.nodeCount * 16);
    this.device.queue.submit([encoder.finish()]);
    await read.mapAsync(GPUMapMode.READ);
    const nodes = new Float32Array(read.getMappedRange().slice(0));
    read.unmap(); read.destroy();
    return nodes;
  }

  /** Hands every GPU buffer to `temporaryBuffers`, to be destroyed once the frame using them is done. */
  retire(temporaryBuffers: GPUBuffer[]): void {
    temporaryBuffers.push(...this.buffers, ...this.checkpoints.values());
    this.checkpoints.clear();
    this.sort?.dispose();
    this.frames.dispose();
  }
}
