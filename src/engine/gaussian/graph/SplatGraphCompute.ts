import type { SplatGraphOperation } from '../../../types/splatGraph';
import shader from './splatGraphCompute.wgsl?raw';

const codes: Record<SplatGraphOperation['kind'], number> = { limit: 1, scale: 2, rotate: 3, color: 4, select: 5, noise: 6, particles: 7, 'camera-fade': 8, 'sphere-crop': 9 };
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
  const data = new Float32Array(24 * 12);
  operations.forEach((op, i) => { data[i * 12] = codes[op.kind]; data.set(op.values, i * 12 + 4); });
  return data;
}
interface Slot { output: GPUBuffer; uniform: GPUBuffer; operations: GPUBuffer; capacity: number }
/** Per-render-call slots prevent queue writes for another branch/view corrupting encoded work. */
export class SplatGraphCompute {
  private pipeline?: GPUComputePipeline;
  private slots: Slot[] = [];
  private cursor = 0;
  private prepared: { source: GPUBuffer; encoder: GPUCommandEncoder; key: string; output: GPUBuffer }[] = [];
  beginFrame() { this.cursor = 0; this.prepared = []; }
  execute(device: GPUDevice, encoder: GPUCommandEncoder, source: GPUBuffer, count: number, operations: SplatGraphOperation[], time: number,
    world: Float32Array, camera: { x: number; y: number; z: number }, sourceCount = count, offset = 0, remapped = false): GPUBuffer {
    // Color and depth share the exact attributes, including particle integration.
    // Restrict reuse to one encoder so the producing dispatch is always ordered first.
    const key = JSON.stringify([count, operations, time, Array.from(world), camera, sourceCount, offset, remapped]);
    const cached = this.prepared.find(entry => entry.source === source && entry.encoder === encoder && entry.key === key);
    if (cached) return cached.output;
    if (!this.pipeline) {
      const module = device.createShaderModule({ code: shader, label: 'Splat graph compute shader' });
      void module.getCompilationInfo().then(info => { for (const message of info.messages) if (message.type === 'error') console.error('SplatGraph shader', message.lineNum, message.message); });
      this.pipeline = device.createComputePipeline({ label: 'Splat graph compute', layout: 'auto', compute: { module, entryPoint: 'main' } });
    }
    const index = this.cursor++;
    let slot = this.slots[index];
    if (!slot || slot.capacity < count) {
      if (slot) { slot.output.destroy(); slot.uniform.destroy(); slot.operations.destroy(); }
      slot = { capacity: count,
        output: device.createBuffer({ size: count * 56, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC }),
        uniform: device.createBuffer({ size: 112, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
        operations: device.createBuffer({ size: 24 * 48, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }),
      }; this.slots[index] = slot;
    }
    const data = new Float32Array(28); const ints = new Uint32Array(data.buffer);
    data.set(world); data.set([camera.x, camera.y, camera.z, 1, time], 16); ints[21] = count; ints[22] = operations.length; ints[23] = sourceCount; ints[24] = remapped ? 1 : 0; ints[25] = offset;
    device.queue.writeBuffer(slot.uniform, 0, data); device.queue.writeBuffer(slot.operations, 0, packSplatOperations(operations).buffer as ArrayBuffer);
    const bind = device.createBindGroup({ layout: this.pipeline.getBindGroupLayout(0), entries: [source, slot.output, slot.uniform, slot.operations].map((buffer, binding) => ({ binding, resource: { buffer } })) });
    const pass = encoder.beginComputePass({ label: 'Splat attribute graph' }); pass.setPipeline(this.pipeline); pass.setBindGroup(0, bind); pass.dispatchWorkgroups(Math.ceil(count / 256)); pass.end();
    this.prepared.push({ source, encoder, key, output: slot.output });
    return slot.output;
  }
  dispose() { for (const s of this.slots) { s.output.destroy(); s.uniform.destroy(); s.operations.destroy(); } this.slots = []; this.prepared = []; this.cursor = 0; this.pipeline = undefined; }
}
