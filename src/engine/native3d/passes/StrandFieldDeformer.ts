import type { CurveSet } from '../../../services/operators/geometry/geometryEvaluation';
import { recordTemporalPreparation } from '../../../effects/time/temporalResourcePreparation';
import type { StrandFieldCode } from './strandFieldShader';
import type { StrandFieldExecutor } from './StrandFieldExecutor';
import { Logger } from '../../../services/logger';

const log = Logger.create('StrandFieldDeformer');

export interface StrandFieldSnapshot {
  signature: string; positions: GPUBuffer; extent: number; segmentLength: number; curves: CurveSet;
}

/**
 * Two output buffers let preview draw the last complete geometry while the next is computed.
 * Its exact bounds and mean segment length arrive together with the points, avoiding stale bounds
 * on seeks. Export uses the existing preparation barrier and always draws the requested frame.
 */
export class StrandFieldDeformer {
  readonly outputs: GPUBuffer[];
  ready?: StrandFieldSnapshot;
  failed = false;
  private pending?: Promise<void>;
  private disposed = false;
  private input?: CurveSet;
  private rest: GPUBuffer;
  private contexts: GPUBuffer;
  private ranges: GPUBuffer;
  private params: GPUBuffer;
  private metrics: GPUBuffer;
  private readback: GPUBuffer;
  private constants?: GPUBuffer;
  private values: Float32Array<ArrayBuffer>;
  private device: GPUDevice;
  private executor: StrandFieldExecutor;
  private requestRender: () => void;

  constructor(device: GPUDevice, curves: CurveSet, output: GPUBuffer, executor: StrandFieldExecutor,
    requestRender: () => void) {
    this.device = device; this.executor = executor; this.requestRender = requestRender;
    const points = curves.positions.length / 3, strands = curves.counts.length;
    const limit = Math.min(device.limits.maxBufferSize, device.limits.maxStorageBufferBindingSize);
    if (points * 48 > limit || strands * 8 > limit || !points || !strands
      || Math.ceil(points / 256) > device.limits.maxComputeWorkgroupsPerDimension ** 2
      || Math.ceil(strands / 64) > device.limits.maxComputeWorkgroupsPerDimension ** 2) throw new Error('Curve fields exceed GPU limits');
    const buffer = (size: number, label: string, usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST) =>
      device.createBuffer({ size: Math.max(16, size), label: `strand-fields-${label}`, usage });
    this.outputs = [output, buffer(output.size, 'output', GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC)];
    this.rest = buffer(points * 16, 'input'); this.contexts = buffer(points * 16, 'contexts');
    this.ranges = buffer(strands * 8, 'ranges');
    this.params = buffer(16, 'params', GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    this.metrics = buffer(strands * 8, 'metrics', GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);
    this.readback = buffer(strands * 8, 'readback', GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ);
    this.values = new Float32Array(points * 4);
    const contexts = new Uint32Array(points * 4), ranges = new Uint32Array(strands * 2);
    for (let strand = 0; strand < strands; strand++) {
      const start = curves.starts[strand], count = curves.counts[strand];
      ranges.set([start, count], strand * 2);
      for (let point = 0; point < count; point++) contexts.set([point, strand, count, 0], (start + point) * 4);
    }
    device.queue.writeBuffer(this.contexts, 0, contexts); device.queue.writeBuffer(this.ranges, 0, ranges);
  }

  prepare(curves: CurveSet, fields: StrandFieldCode, signature: string): StrandFieldSnapshot | undefined {
    if (this.disposed || this.failed) return undefined;
    if (this.ready?.signature === signature && !this.pending) return this.ready;
    if (!this.pending) {
      const target = this.ready?.positions === this.outputs[0] ? this.outputs[1] : this.outputs[0];
      const temporary: GPUBuffer[] = [];
      const device = this.device;
      device.pushErrorScope('validation');
      let submissionError: unknown;
      try {
        if (this.input !== curves) {
          for (let i = 0; i < this.values.length / 4; i++) {
            this.values[i * 4] = curves.positions[i * 3]; this.values[i * 4 + 1] = curves.positions[i * 3 + 1];
            this.values[i * 4 + 2] = curves.positions[i * 3 + 2]; this.values[i * 4 + 3] = curves.radius?.[i] ?? 1;
          }
          device.queue.writeBuffer(this.rest, 0, this.values); this.input = curves;
        }
        const size = Math.max(16, fields.constants.length * 4);
        if (!this.constants || this.constants.size < size) {
          this.constants?.destroy();
          this.constants = device.createBuffer({ size, label: 'strand-field-constants', usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
        }
        if (fields.constants.length) device.queue.writeBuffer(this.constants, 0, Float32Array.from(fields.constants));
        this.executor.submit(device, fields, [this.params, this.rest, this.contexts, this.ranges, this.constants, target, this.metrics],
          curves.positions.length / 3, curves.counts.length, this.readback, temporary);
      } catch (error) { submissionError = error; }
      const validation = device.popErrorScope();
      this.pending = (async () => {
        const error = await validation;
        if (submissionError || error) throw submissionError ?? error;
        if (this.disposed) return;
        await this.readback.mapAsync(GPUMapMode.READ);
        const data = new Float32Array(this.readback.getMappedRange());
        let extent = 0, length = 0, segments = 0;
        for (let strand = 0; strand < curves.counts.length; strand++) {
          extent = Math.max(extent, data[strand * 2]); length += data[strand * 2 + 1];
          segments += Math.max(0, curves.counts[strand] - 1);
        }
        this.readback.unmap();
        if (!Number.isFinite(extent + length)) throw new Error('Non-finite curve field geometry');
        if (!this.disposed) this.ready = { signature, positions: target, extent, segmentLength: segments ? length / segments : 0, curves };
      })().catch(error => {
        if (!this.disposed) { this.failed = true; log.warn('GPU curve fields failed; retaining CPU evaluation', error); }
      }).finally(() => {
        temporary.forEach(buffer => buffer.destroy()); this.pending = undefined;
        if (!this.disposed) this.requestRender();
      });
    }
    recordTemporalPreparation(this.pending);
    return this.ready;
  }

  /** In-flight completions cannot publish after retirement; the caller retires buffers after its draw. */
  retire(temporary: GPUBuffer[]): void {
    this.disposed = true;
    temporary.push(...this.outputs, this.rest, this.contexts, this.ranges, this.params, this.metrics, this.readback);
    if (this.constants) temporary.push(this.constants);
  }
}
