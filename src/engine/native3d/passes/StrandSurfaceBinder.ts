import shader from '../shaders/StrandSurfaceBind.wgsl?raw';
import type { CurveSet } from '../../../services/operators/geometry/geometryEvaluation';
import type { ClothGrid } from '../../../services/operators/geometry/clothSurface';
import { FIELD_FUNCTIONS_WGSL } from '../../../services/operators/fields/fieldFunctionsWgsl';
import { strandRadiusFieldCode, type StrandFieldCode } from './strandFieldShader';
import { StrandFramesPass } from './StrandFramesPass';

/**
 * Rest curves of one layer on the GPU: (x, y, z, radius scale) and (arc length, strand) per point,
 * (start, count) per strand.
 */
export interface StrandRestCurves { rest: GPUBuffer; arcs: GPUBuffer; ranges: GPUBuffer; points: number; strands: number }
/** Thread Along applied before binding (see threadAlong.ts): uniform progress and clamped shape. */
export interface StrandThreadParams { progress: number; stagger: number; lift: number; liftLength: number; settle: number }
const PARAMS_BYTES = 64;
/** Pipelines per generated field code, least recently used first. */
const PIPELINE_LIMIT = 8;
export const NO_STRAND_FIELDS = strandRadiusFieldCode([]);

/**
 * Surface Bind on the GPU (StrandSurfaceBind.wgsl): the rest curves are uploaded once per topology,
 * then every frame only the simulated cloth grid. Writes the packed strand points the strand pass
 * reads, so the CPU neither binds nor builds frames for animated cloth.
 */
export class StrandSurfaceBinder {
  private device: GPUDevice | null = null;
  private layout: GPUBindGroupLayout | null = null;
  private readonly pipelines = new Map<string, GPUComputePipeline>();
  private readonly frames = new StrandFramesPass();

  private initialize(device: GPUDevice): void {
    if (this.device === device) return;
    this.device = device;
    this.pipelines.clear();
    const storage = (binding: number, type: GPUBufferBindingType): GPUBindGroupLayoutEntry =>
      ({ binding, visibility: GPUShaderStage.COMPUTE, buffer: { type } });
    this.layout = device.createBindGroupLayout({ label: 'strand-surface-bind', entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      storage(1, 'read-only-storage'), storage(2, 'read-only-storage'), storage(3, 'read-only-storage'), storage(4, 'storage'),
      storage(5, 'read-only-storage'), storage(6, 'read-only-storage')] });
  }

  /** The bind pipeline with `fields` compiled in; generated per field structure and kept. */
  private pipelineFor(device: GPUDevice, fields: StrandFieldCode): GPUComputePipeline {
    let pipeline = this.pipelines.get(fields.code);
    if (pipeline) this.pipelines.delete(fields.code);
    else {
      const code = shader.replace('//@strand-fields', `${fields === NO_STRAND_FIELDS ? '' : FIELD_FUNCTIONS_WGSL}\n${fields.code}`);
      pipeline = device.createComputePipeline({ label: 'strand-surface-bind-points', layout: device.createPipelineLayout({ bindGroupLayouts: [this.layout!] }),
        compute: { module: device.createShaderModule({ label: 'strand-surface-bind', code }), entryPoint: 'bindPoints' } });
    }
    this.pipelines.set(fields.code, pipeline);
    while (this.pipelines.size > PIPELINE_LIMIT) this.pipelines.delete(this.pipelines.keys().next().value!);
    return pipeline;
  }

  /** Uploads rest curves; the caller owns and destroys the returned buffers. */
  upload(device: GPUDevice, curves: CurveSet, label: string): StrandRestCurves {
    const points = curves.positions.length / 3, strands = curves.counts.length;
    const rest = new Float32Array(Math.max(1, points) * 4), ranges = new Uint32Array(Math.max(1, strands) * 2);
    const arcs = new Float32Array(Math.max(1, points) * 2), { positions } = curves;
    for (let index = 0; index < points; index++) {
      rest.set(positions.subarray(index * 3, index * 3 + 3), index * 4);
      rest[index * 4 + 3] = curves.radius ? curves.radius[index] : 1;
    }
    for (let strand = 0; strand < strands; strand++) {
      const start = curves.starts[strand], count = curves.counts[strand];
      ranges[strand * 2] = start; ranges[strand * 2 + 1] = count;
      // Arc length along the rest curve, accumulated in double precision as in threadAlong.ts.
      let arc = 0;
      for (let point = 0; point < count; point++) {
        const base = (start + point) * 3;
        if (point > 0) arc += Math.hypot(positions[base] - positions[base - 3], positions[base + 1] - positions[base - 2], positions[base + 2] - positions[base - 1]);
        arcs[(start + point) * 2] = arc; arcs[(start + point) * 2 + 1] = strand;
      }
    }
    const buffer = (data: Float32Array<ArrayBuffer> | Uint32Array<ArrayBuffer>, name: string) => {
      const target = device.createBuffer({ label: `${label}-${name}`, size: data.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(target, 0, data);
      return target;
    };
    return { rest: buffer(rest, 'rest'), arcs: buffer(arcs, 'arcs'), ranges: buffer(ranges, 'ranges'), points, strands };
  }

  /**
   * Binds the rest curves onto `grid` and writes packed strand points into `target`, after pulling
   * them in with `thread` and scaling the radius by `fields` when given. The work is submitted on
   * its own, ahead of the frame that reads `target`.
   */
  bind(device: GPUDevice, curves: StrandRestCurves, grid: ClothGrid, height: number, target: GPUBuffer, temporaryBuffers: GPUBuffer[],
    thread: StrandThreadParams | null = null, fields: StrandFieldCode = NO_STRAND_FIELDS): void {
    if (!curves.points) return;
    this.initialize(device);
    const pipeline = this.pipelineFor(device, fields);
    const constants = device.createBuffer({ label: 'strand-surface-bind-field-constants', size: Math.max(1, fields.constants.length) * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    if (fields.constants.length) device.queue.writeBuffer(constants, 0, Float32Array.from(fields.constants));
    temporaryBuffers.push(constants);
    const nodes = device.createBuffer({ label: 'strand-surface-bind-grid', size: grid.positions.length * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(nodes, 0, Float32Array.from(grid.positions));
    const maxWidth = device.limits.maxComputeWorkgroupsPerDimension;
    const pointGroups = Math.ceil(curves.points / 256), pointWidth = Math.min(pointGroups, maxWidth);
    const params = (dispatchWidth: number) => {
      const data = new ArrayBuffer(PARAMS_BYTES), words = new Uint32Array(data), floats = new Float32Array(data);
      words.set([grid.columns, grid.rows, curves.strands, curves.points]);
      floats.set([grid.width, grid.height, height], 4);
      words[7] = dispatchWidth;
      if (thread) {
        words[8] = 1;
        floats.set([thread.progress, thread.stagger, thread.lift, thread.liftLength, thread.settle], 9);
      }
      const uniform = device.createBuffer({ label: 'strand-surface-bind-params', size: PARAMS_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(uniform, 0, data);
      temporaryBuffers.push(uniform);
      return uniform;
    };
    temporaryBuffers.push(nodes);
    const group = (uniform: GPUBuffer) => device.createBindGroup({ layout: this.layout!, entries: [
      { binding: 0, resource: { buffer: uniform } }, { binding: 1, resource: { buffer: curves.rest } },
      { binding: 2, resource: { buffer: nodes } }, { binding: 3, resource: { buffer: curves.ranges } },
      { binding: 4, resource: { buffer: target } }, { binding: 5, resource: { buffer: curves.arcs } },
      { binding: 6, resource: { buffer: constants } }] });
    const encoder = device.createCommandEncoder({ label: 'strand-surface-bind' });
    const pass = encoder.beginComputePass({ label: 'strand-surface-bind' });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, group(params(pointWidth)));
    pass.dispatchWorkgroups(pointWidth, Math.ceil(pointGroups / pointWidth));
    this.frames.encode(device, pass, curves.ranges, curves.strands, target, temporaryBuffers);
    pass.end();
    device.queue.submit([encoder.finish()]);
  }

  dispose(): void {
    this.pipelines.clear();
    this.frames.dispose();
    this.layout = null;
    this.device = null;
  }
}
