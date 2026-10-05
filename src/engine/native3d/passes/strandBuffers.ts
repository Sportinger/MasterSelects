import type { SceneStrandLayer } from '../../scene/types';
import { evaluateGeometryProgram, type CurveSet } from '../../../services/operators/geometry/geometryEvaluation';
import { clothGridAt } from '../../../services/operators/geometry/clothSurface';
import { rodRestFor, rodStepAt } from '../../../services/operators/geometry/rodCurves';
import { packStrandPoints, STRAND_POINT_FLOATS } from './strandFrames';
import { StrandSurfaceBinder, type StrandRestCurves } from './StrandSurfaceBinder';
import { rodChain, surfaceBindChain, type RodChain } from './strandGpuChains';
import { RodGpuSimulation } from '../rods/RodGpuSimulation';
import { packStrandColors } from './strandColors';

/** Segment flags above the 30-bit point index: the strand continues before / after the segment. */
export const SEGMENT_HAS_PREVIOUS = 0x80000000;
export const SEGMENT_HAS_NEXT = 0x40000000;
/** Evaluated curve buffers kept across frames and render targets, least recently used first. */
const CACHE_LIMIT = 24;

/**
 * First point of every drawable segment (consecutive points inside one strand), flagged when the
 * strand continues, so ribbons can share a joint direction with their neighbours.
 */
export function strandSegmentStarts(starts: Uint32Array, counts: Uint32Array): Uint32Array {
  let total = 0;
  for (const count of counts) total += Math.max(0, count - 1);
  const segments = new Uint32Array(total);
  let cursor = 0;
  for (let strand = 0; strand < counts.length; strand++) {
    for (let point = 0; point + 1 < counts[strand]; point++) {
      segments[cursor++] = (starts[strand] + point) | (point > 0 ? SEGMENT_HAS_PREVIOUS : 0) | (point + 2 < counts[strand] ? SEGMENT_HAS_NEXT : 0);
    }
  }
  return segments;
}

/**
 * Curve buffers of one strand layer. `signature` is the full program the points were built from;
 * `topology` the part that fixes points and segments. For cloth, the points are rebound on the GPU
 * every frame from `rest`, so only the cloth time changes the signature; for rods, `rods` simulates
 * on the GPU and writes the points.
 * `segmentLength`: mean local length of a curve segment; `extent`: largest local distance of a point from the origin.
 */
export interface StrandBuffers {
  signature: string;
  topology: string;
  positions: GPUBuffer;
  segments: GPUBuffer;
  colors?: GPUBuffer;
  colorSignature?: string;
  segmentCount: number;
  segmentLength: number;
  extent: number;
  rest?: StrandRestCurves & { extent: number; lift: number };
  rods?: RodGpuSimulation;
}

/** Strand curve buffers per layer: evaluated on the CPU, with cloth bound and rods simulated on the GPU each frame. */
export class StrandBufferCache {
  private readonly cache = new Map<string, StrandBuffers>();
  private readonly binder = new StrandSurfaceBinder();
  /** Rod topologies the GPU could not take (device limits); they stay on the CPU. */
  private readonly rodFailures = new Set<string>();

  /** Up to date buffers for `layer`, or null when it has nothing to draw; replaced buffers retire with this frame. */
  prepare(device: GPUDevice, layer: SceneStrandLayer, temporaryBuffers: GPUBuffer[]): StrandBuffers | null {
    const program = layer.strands.program;
    const signature = JSON.stringify(program.stages);
    // A final Surface Bind (and a Thread Along before it) or a Rod Simulation runs on the GPU from the rest curves.
    // Position-dependent colors must see the same final curves as the renderer.
    // Colored cloth/rods therefore use the CPU curve evaluator for both geometry and color.
    const colorField = program.render?.colorField;
    const chain = colorField ? null : surfaceBindChain(program.stages);
    const candidate = chain || colorField ? null : rodChain(program.stages);
    const rods = candidate && !this.rodFailures.has(candidate.topology) ? candidate : null;
    const stages = chain ? chain.restStages : rods ? rods.restStages : program.stages;
    const topology = chain ? JSON.stringify(stages) : rods ? rods.topology : signature;
    let buffers = this.cache.get(layer.layerId);
    if (!buffers || buffers.topology !== topology) {
      if (buffers) this.retire(buffers, temporaryBuffers);
      const curves = evaluateGeometryProgram({ ...program, stages });
      buffers = (rods && this.buildRods(device, layer.layerId, curves, rods))
        ?? this.build(device, layer.layerId, rods ? evaluateGeometryProgram(program) : curves, signature, rods ? signature : topology, !!chain);
    }
    if (rods && buffers.rods && buffers.signature !== signature) {
      const { step, alpha } = rodStepAt(rods.rod);
      buffers.rods.writeOutput(buffers.positions, rods.fields, buffers.rods.prepare(step, alpha), temporaryBuffers);
      buffers.extent = buffers.rods.extent;
      buffers.signature = signature;
    }
    if (chain && buffers.signature !== signature) {
      const { bind, thread, fields } = chain, grid = clothGridAt(bind.cloth, bind.time);
      this.binder.bind(device, buffers.rest!, grid, bind.height, buffers.positions, temporaryBuffers, thread, fields);
      let reach = 0;
      for (let index = 0; index < grid.positions.length; index += 3) {
        reach = Math.max(reach, Math.hypot(grid.positions[index], grid.positions[index + 1], grid.positions[index + 2]));
      }
      // Thread Along lifts by at most lift · (1 + settle) ahead of its tip.
      const lift = buffers.rest!.lift + (thread ? Math.abs(thread.lift) * (1 + Math.max(0, thread.settle)) : 0);
      buffers.extent = Math.max(buffers.rest!.extent, reach) + lift * Math.abs(bind.height);
      buffers.signature = signature;
    }
    const colorSignature = colorField ? JSON.stringify([signature, colorField]) : undefined;
    if (buffers.colorSignature !== colorSignature) {
      if (buffers.colors) temporaryBuffers.push(buffers.colors);
      buffers.colors = undefined;
      if (colorField) {
        const colors = packStrandColors(evaluateGeometryProgram(program), colorField);
        buffers.colors = device.createBuffer({ size: Math.max(16, colors.byteLength),
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, label: `native-strands-colors-${layer.layerId}` });
        if (colors.byteLength) device.queue.writeBuffer(buffers.colors, 0, colors.buffer, colors.byteOffset, colors.byteLength);
      }
      buffers.colorSignature = colorSignature;
    }
    this.cache.delete(layer.layerId);
    this.cache.set(layer.layerId, buffers);
    while (this.cache.size > CACHE_LIMIT) {
      const [oldest, retired] = this.cache.entries().next().value!;
      this.cache.delete(oldest);
      this.retire(retired, temporaryBuffers);
    }
    return buffers.segmentCount ? buffers : null;
  }

  private build(device: GPUDevice, layerId: string, curves: CurveSet, signature: string, topology: string, gpuBind: boolean): StrandBuffers {
    const segments = strandSegmentStarts(curves.starts, curves.counts);
    const upload = (data: Float32Array | Uint32Array, label: string) => {
      const buffer = device.createBuffer({ size: Math.max(16, Math.ceil(data.byteLength / 4) * 4),
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, label });
      if (data.byteLength) device.queue.writeBuffer(buffer, 0, data.buffer, data.byteOffset, data.byteLength);
      return buffer;
    };
    const { positions } = curves;
    let length = 0, extent = 0, lift = 0;
    for (const packed of segments) {
      const index = (packed & 0x3fffffff) * 3;
      length += Math.hypot(positions[index + 3] - positions[index], positions[index + 4] - positions[index + 1], positions[index + 5] - positions[index + 2]);
    }
    for (let index = 0; index < positions.length; index += 3) {
      extent = Math.max(extent, Math.hypot(positions[index], positions[index + 1], positions[index + 2]));
      lift = Math.max(lift, Math.abs(positions[index + 2]));
    }
    const pointBytes = (positions.length / 3) * STRAND_POINT_FLOATS * 4;
    return { signature: gpuBind ? '' : signature, topology, segmentCount: segments.length,
      segmentLength: segments.length ? length / segments.length : 0, extent,
      positions: gpuBind
        ? device.createBuffer({ size: Math.max(16, pointBytes), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC, label: `native-strands-points-${layerId}` })
        : upload(packStrandPoints(curves), `native-strands-points-${layerId}`),
      segments: upload(segments, `native-strands-segments-${layerId}`),
      ...(gpuBind ? { rest: { ...this.binder.upload(device, curves, `native-strands-rest-${layerId}`), extent, lift } } : {}) };
  }

  /**
   * Buffers whose points the GPU rod simulation writes every frame; null when the device cannot
   * hold it, after which the topology is simulated on the CPU.
   */
  private buildRods(device: GPUDevice, layerId: string, curves: CurveSet, chain: RodChain): StrandBuffers | null {
    let rods: RodGpuSimulation;
    try { rods = new RodGpuSimulation(device, chain.rod.rod, rodRestFor(chain.rod, curves), curves, `native-strands-rods-${layerId}`); }
    catch { this.rodFailures.add(chain.topology); return null; }
    const segments = strandSegmentStarts(curves.starts, curves.counts), { positions } = curves;
    let length = 0;
    for (const packed of segments) {
      const index = (packed & 0x3fffffff) * 3;
      length += Math.hypot(positions[index + 3] - positions[index], positions[index + 4] - positions[index + 1], positions[index + 5] - positions[index + 2]);
    }
    const points = device.createBuffer({ size: Math.max(16, (positions.length / 3) * STRAND_POINT_FLOATS * 4),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC, label: `native-strands-points-${layerId}` });
    const segmentBuffer = device.createBuffer({ size: Math.max(16, segments.byteLength), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      label: `native-strands-segments-${layerId}` });
    if (segments.byteLength) device.queue.writeBuffer(segmentBuffer, 0, segments.buffer, segments.byteOffset, segments.byteLength);
    return { signature: '', topology: chain.topology, positions: points, segments: segmentBuffer, segmentCount: segments.length,
      segmentLength: segments.length ? length / segments.length : 0, extent: rods.extent, rods };
  }

  private retire(buffers: StrandBuffers, temporaryBuffers: GPUBuffer[]): void {
    temporaryBuffers.push(buffers.positions, buffers.segments);
    if (buffers.colors) temporaryBuffers.push(buffers.colors);
    if (buffers.rest) temporaryBuffers.push(buffers.rest.rest, buffers.rest.ranges, buffers.rest.arcs);
    buffers.rods?.retire(temporaryBuffers);
  }

  dispose(): void {
    for (const buffers of this.cache.values()) {
      buffers.positions.destroy(); buffers.segments.destroy();
      buffers.colors?.destroy();
      buffers.rest?.rest.destroy(); buffers.rest?.ranges.destroy(); buffers.rest?.arcs.destroy();
      const retired: GPUBuffer[] = [];
      buffers.rods?.retire(retired);
      retired.forEach(buffer => buffer.destroy());
    }
    this.cache.clear();
    this.binder.dispose();
  }
}
