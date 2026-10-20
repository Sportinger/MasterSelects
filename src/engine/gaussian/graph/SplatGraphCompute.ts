import { reportShaderCompilation } from '../../core/shaderCompilationDiagnostics';
import type { SplatGraphOperation } from '../../../types/splatGraph';
import shader from './splatGraphCompute.wgsl?raw';

const codes: Record<SplatGraphOperation['kind'], number> = { limit: 1, scale: 2, rotate: 3, color: 4, select: 5, noise: 6, particles: 7, 'camera-fade': 8, 'sphere-crop': 9, conveyor: 10, 'falloff-box': 11, release: 12, 'ring-bend': 13 };
/** Operations that move splat centers need fresh depth order and cannot share pre-motion crops. */
export const movesSplatCenters = (op: SplatGraphOperation) =>
  ['particles', 'conveyor', 'release', 'ring-bend'].includes(op.kind) || (op.kind === 'noise' && op.values[0] === 0);
export function prepareSplatSampling(operations: SplatGraphOperation[], sourceCount: number, budget = 0) {
  const selection = operations.findIndex(op => op.kind === 'select');
  const fraction = selection >= 0 ? operations[selection].values[0] : 1;
  const count = Math.min(Math.floor(sourceCount * fraction), budget > 0 ? budget : sourceCount);
  const offset = selection >= 0 ? Math.floor(operations[selection].values[1] * 2654435761) % Math.max(1, sourceCount) : 0;
  // File order is not spatially representative. A reduced prefix can omit the
  // visible surface entirely; sample across the full source and sort that output.
  return { count, offset, remapped: selection >= 0 || count < sourceCount, operations: operations.filter((_, i) => i !== selection) };
}
export function packSplatOperations(operations: SplatGraphOperation[]): Float32Array {
  if (operations.length > 24) throw new Error('Splat operation budget exceeded.');
  // Each operation is header + a + b + c: the header's first lane is the code, values 0-7 fill a/b,
  // values 8-11 fill c and values 12-14 use the spare header lanes.
  const data = new Float32Array(24 * 16);
  operations.forEach((op, i) => {
    if (op.values.length > 15) throw new Error(`Splat operation ${op.kind} packs at most 15 values.`);
    data[i * 16] = codes[op.kind]; data.set(op.values.slice(0, 8), i * 16 + 4);
    data.set(op.values.slice(8, 12), i * 16 + 12); data.set(op.values.slice(12), i * 16 + 1);
  });
  return data;
}
interface Slot { output: GPUBuffer; ids: GPUBuffer; uniform: GPUBuffer; operations: GPUBuffer; capacity: number }
/** Graph output plus the source splat id of every output splat (for per-source data such as SH). */
export interface SplatGraphComputeResult { output: GPUBuffer; ids: GPUBuffer }
/** Per-render-call slots prevent queue writes for another branch/view corrupting encoded work. */
export class SplatGraphCompute {
  private pipeline?: GPUComputePipeline;
  private emptyIndices?: GPUBuffer;
  private slots: Slot[] = [];
  private cursor = 0;
  private prepared: { source: GPUBuffer; sourceIndices?: GPUBuffer; encoder: GPUCommandEncoder; key: string; result: SplatGraphComputeResult }[] = [];
  beginFrame() { this.cursor = 0; this.prepared = []; }
  execute(device: GPUDevice, encoder: GPUCommandEncoder, source: GPUBuffer, count: number, operations: SplatGraphOperation[], time: number,
    world: Float32Array, camera: { x: number; y: number; z: number }, sourceCount = count, offset = 0, remapped = false, sourceIndices?: GPUBuffer): SplatGraphComputeResult {
    // Color and depth share the exact attributes, including particle integration.
    // Restrict reuse to one encoder so the producing dispatch is always ordered first.
    const key = JSON.stringify([count, operations, time, Array.from(world), camera, sourceCount, offset, remapped]);
    const cached = this.prepared.find(entry => entry.source === source && entry.sourceIndices === sourceIndices && entry.encoder === encoder && entry.key === key);
    if (cached) return cached.result;
    if (!this.pipeline) {
      const module = device.createShaderModule({ code: shader, label: 'Splat graph compute shader' });
      void reportShaderCompilation(module, 'SplatGraphCompute', 'Splat graph compute shader');
      this.pipeline = device.createComputePipeline({ label: 'Splat graph compute', layout: 'auto', compute: { module, entryPoint: 'main' } });
    }
    const index = this.cursor++;
    let slot = this.slots[index];
    if (!slot || slot.capacity < count) {
      if (slot) { slot.output.destroy(); slot.ids.destroy(); slot.uniform.destroy(); slot.operations.destroy(); }
      slot = { capacity: count,
        output: device.createBuffer({ size: count * 56, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC }),
        ids: device.createBuffer({ size: Math.max(4, count * 4), usage: GPUBufferUsage.STORAGE }),
        uniform: device.createBuffer({ size: 112, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
        operations: device.createBuffer({ size: 24 * 64, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }),
      }; this.slots[index] = slot;
    }
    const data = new Float32Array(28); const ints = new Uint32Array(data.buffer);
    data.set(world); data.set([camera.x, camera.y, camera.z, 1, time], 16); ints[21] = count; ints[22] = operations.length; ints[23] = sourceCount; ints[24] = sourceIndices ? 2 : remapped ? 1 : 0; ints[25] = offset;
    device.queue.writeBuffer(slot.uniform, 0, data); device.queue.writeBuffer(slot.operations, 0, packSplatOperations(operations).buffer as ArrayBuffer);
    const indices = sourceIndices ?? (this.emptyIndices ??= device.createBuffer({ size: 4, usage: GPUBufferUsage.STORAGE }));
    const bind = device.createBindGroup({ layout: this.pipeline.getBindGroupLayout(0), entries: [source, slot.output, slot.uniform, slot.operations, indices, slot.ids].map((buffer, binding) => ({ binding, resource: { buffer } })) });
    const pass = encoder.beginComputePass({ label: 'Splat attribute graph' }); pass.setPipeline(this.pipeline); pass.setBindGroup(0, bind); pass.dispatchWorkgroups(Math.ceil(count / 256)); pass.end();
    const result = { output: slot.output, ids: slot.ids };
    this.prepared.push({ source, sourceIndices, encoder, key, result });
    return result;
  }
  dispose() { for (const s of this.slots) { s.output.destroy(); s.ids.destroy(); s.uniform.destroy(); s.operations.destroy(); } this.emptyIndices?.destroy(); this.emptyIndices = undefined; this.slots = []; this.prepared = []; this.cursor = 0; this.pipeline = undefined; }
}
