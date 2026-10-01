import shader from '../shaders/StrandSurfaceBind.wgsl?raw';
import type { CurveSet } from '../../../services/operators/geometry/geometryEvaluation';
import type { ClothGrid } from '../../../services/operators/geometry/clothSurface';

/** Rest curves of one layer on the GPU: (x, y, z, radius scale) per point and (start, count) per strand. */
export interface StrandRestCurves { rest: GPUBuffer; ranges: GPUBuffer; points: number; strands: number }

/**
 * Surface Bind on the GPU (StrandSurfaceBind.wgsl): the rest curves are uploaded once per topology,
 * then every frame only the simulated cloth grid. Writes the packed strand points the strand pass
 * reads, so the CPU neither binds nor builds frames for animated cloth.
 */
export class StrandSurfaceBinder {
  private device: GPUDevice | null = null;
  private layout: GPUBindGroupLayout | null = null;
  private bindPipeline: GPUComputePipeline | null = null;
  private framesPipeline: GPUComputePipeline | null = null;

  private initialize(device: GPUDevice): void {
    if (this.device === device) return;
    this.device = device;
    const storage = (binding: number, type: GPUBufferBindingType): GPUBindGroupLayoutEntry =>
      ({ binding, visibility: GPUShaderStage.COMPUTE, buffer: { type } });
    this.layout = device.createBindGroupLayout({ label: 'strand-surface-bind', entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      storage(1, 'read-only-storage'), storage(2, 'read-only-storage'), storage(3, 'read-only-storage'), storage(4, 'storage')] });
    const module = device.createShaderModule({ label: 'strand-surface-bind', code: shader });
    const layout = device.createPipelineLayout({ bindGroupLayouts: [this.layout] });
    this.bindPipeline = device.createComputePipeline({ label: 'strand-surface-bind-points', layout, compute: { module, entryPoint: 'bindPoints' } });
    this.framesPipeline = device.createComputePipeline({ label: 'strand-surface-bind-frames', layout, compute: { module, entryPoint: 'strandFrames' } });
  }

  /** Uploads rest curves; the caller owns and destroys the returned buffers. */
  upload(device: GPUDevice, curves: CurveSet, label: string): StrandRestCurves {
    const points = curves.positions.length / 3, strands = curves.counts.length;
    const rest = new Float32Array(Math.max(1, points) * 4), ranges = new Uint32Array(Math.max(1, strands) * 2);
    for (let index = 0; index < points; index++) {
      rest.set(curves.positions.subarray(index * 3, index * 3 + 3), index * 4);
      rest[index * 4 + 3] = curves.radius ? curves.radius[index] : 1;
    }
    for (let strand = 0; strand < strands; strand++) { ranges[strand * 2] = curves.starts[strand]; ranges[strand * 2 + 1] = curves.counts[strand]; }
    const buffer = (data: Float32Array<ArrayBuffer> | Uint32Array<ArrayBuffer>, name: string) => {
      const target = device.createBuffer({ label: `${label}-${name}`, size: data.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(target, 0, data);
      return target;
    };
    return { rest: buffer(rest, 'rest'), ranges: buffer(ranges, 'ranges'), points, strands };
  }

  /**
   * Binds the rest curves onto `grid` and writes packed strand points into `target`. The work is
   * submitted on its own, ahead of the frame that reads `target`.
   */
  bind(device: GPUDevice, curves: StrandRestCurves, grid: ClothGrid, height: number, target: GPUBuffer, temporaryBuffers: GPUBuffer[]): void {
    if (!curves.points) return;
    this.initialize(device);
    const nodes = device.createBuffer({ label: 'strand-surface-bind-grid', size: grid.positions.length * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(nodes, 0, Float32Array.from(grid.positions));
    const maxWidth = device.limits.maxComputeWorkgroupsPerDimension;
    const pointGroups = Math.ceil(curves.points / 256), strandGroups = Math.ceil(curves.strands / 64);
    const params = (dispatchWidth: number) => {
      const data = new ArrayBuffer(32), words = new Uint32Array(data), floats = new Float32Array(data);
      words.set([grid.columns, grid.rows, curves.strands, curves.points]);
      floats.set([grid.width, grid.height, height], 4);
      words[7] = dispatchWidth;
      const uniform = device.createBuffer({ label: 'strand-surface-bind-params', size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(uniform, 0, data);
      temporaryBuffers.push(uniform);
      return uniform;
    };
    temporaryBuffers.push(nodes);
    const group = (uniform: GPUBuffer) => device.createBindGroup({ layout: this.layout!, entries: [
      { binding: 0, resource: { buffer: uniform } }, { binding: 1, resource: { buffer: curves.rest } },
      { binding: 2, resource: { buffer: nodes } }, { binding: 3, resource: { buffer: curves.ranges } },
      { binding: 4, resource: { buffer: target } }] });
    const pointWidth = Math.min(pointGroups, maxWidth), strandWidth = Math.min(strandGroups, maxWidth);
    const encoder = device.createCommandEncoder({ label: 'strand-surface-bind' });
    const pass = encoder.beginComputePass({ label: 'strand-surface-bind' });
    pass.setPipeline(this.bindPipeline!);
    pass.setBindGroup(0, group(params(pointWidth)));
    pass.dispatchWorkgroups(pointWidth, Math.ceil(pointGroups / pointWidth));
    pass.setPipeline(this.framesPipeline!);
    pass.setBindGroup(0, group(params(strandWidth)));
    pass.dispatchWorkgroups(strandWidth, Math.ceil(strandGroups / strandWidth));
    pass.end();
    device.queue.submit([encoder.finish()]);
  }

  dispose(): void {
    this.bindPipeline = this.framesPipeline = null;
    this.layout = null;
    this.device = null;
  }
}
