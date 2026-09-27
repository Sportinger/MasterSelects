import { FlockRadixSort } from '../../src/engine/flock/gpu/FlockRadixSort';
import { FlockFluidGrid } from '../../src/engine/flock/gpu/FlockFluidGrid';
import { FlockParticleOrder } from '../../src/engine/flock/gpu/FlockParticleOrder';
import type { FlockFluidSpec } from '../../src/services/flock/compiler/flockProgramTypes';
import { checkOrderedSessions } from './flock-ordered-session-gpu-check';

async function check() {
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('No WebGPU adapter');
  const device = await adapter.requestDevice();
  const errors: string[] = [];
  device.addEventListener('uncapturederror', event => errors.push(event.error.message));
  const read = async (buffer: GPUBuffer) => {
    const output = device.createBuffer({ size: buffer.size, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const encoder = device.createCommandEncoder(); encoder.copyBufferToBuffer(buffer, 0, output, 0, buffer.size);
    device.queue.submit([encoder.finish()]); await output.mapAsync(GPUMapMode.READ);
    const data = output.getMappedRange().slice(0); output.unmap(); output.destroy(); return data;
  };
  const cases: unknown[] = [];
  try {
    for (const [count, maxKey] of [[1, 0], [255, 15], [257, 255], [8193, 0xffffffff], [65537, 0xffffffff]]) {
      // Odd last groups, unsigned high bits, repeated keys, forced 2D dispatch.
      const sorter = new FlockRadixSort(device, count, maxKey, 17);
      const pairs = new Uint32Array(count * 2);
      let random = 123;
      for (let i = 0; i < count; i++) {
        random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
        pairs[i * 2] = i % 3 === 0 ? maxKey : random & maxKey;
        pairs[i * 2 + 1] = i;
      }
      const expected = Array.from({ length: count }, (_, i) => i).toSorted((a, b) => pairs[a * 2] - pairs[b * 2]);
      for (let repeat = 0; repeat < 2; repeat++) {
        device.queue.writeBuffer(sorter.input, 0, pairs);
        const encoder = device.createCommandEncoder(); sorter.encode(encoder); device.queue.submit([encoder.finish()]);
        const actual = new Uint32Array(await read(sorter.output));
        for (let i = 0; i < count; i++) {
          if (actual[i * 2] !== pairs[expected[i] * 2] || actual[i * 2 + 1] !== expected[i]) throw new Error(`Unstable radix result at ${count}/${i}`);
        }
      }
      sorter.dispose(); cases.push({ sort: count, maxKey, repeats: 2 });
    }
    const count = 1025;
    const spec: FlockFluidSpec = { nodeId: 'fluid', sourceNodeId: 'simulation', origin: [-8, -8, -8], dims: [16, 16, 16], cellSize: 1, iterations: 12 };
    for (const dense of [false, true]) {
      const data = new Float32Array(count * 16);
      for (let i = 0; i < count; i++) {
        const x = dense ? (i % 7) / 30 : ((i * 17) % 193) / 12 - 8;
        const y = dense ? (i % 11) / 30 : ((i * 23) % 197) / 12 - 8;
        const z = dense ? (i % 13) / 30 : ((i * 29) % 199) / 12 - 8;
        data.set([x, y, z, i % 19 === 0 ? -1 : 0.2, (i % 7) - 3, (i % 11) - 5, (i % 5) - 2, 10, 1, 0, 0, 0, i / count, i, 0, i % 23], i * 16);
      }
      const states = [0, 1].map(() => {
        const state = device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
        device.queue.writeBuffer(state, 0, data); return state;
      });
      const reference = new FlockFluidGrid(device, spec, [states[0]], 1, { blockTransfer: false, dispatchWidth: 2 });
      const sorted = new FlockFluidGrid(device, spec, [states[1]], 1, { dispatchWidth: 2 });
      const order = new FlockParticleOrder(device, [states[1]], spec, 2);
      const canonical = device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
      for (const grid of [reference, sorted]) { grid.stageParams(0, { count, flipRatio: 0.95, dt: 1 / 60 }); grid.uploadParams(1); }
      let maxError = 0;
      for (let step = 0; step < 9; step++) {
        // Restore canonical checkpoint data between sort intervals. Permutation
        // may be stale, but neither identity nor the numerical result may change.
        if (step === 6) for (const state of states) device.queue.writeBuffer(state, 0, data);
        const encoder = device.createCommandEncoder();
        if (step === 0 || step === 6) order.reset(encoder);
        reference.encode(encoder, 0, 0, count); order.encode(encoder, 0, step); sorted.encode(encoder, 0, 0, count);
        order.canonical(encoder, states[1], canonical);
        device.queue.submit([encoder.finish()]);
        const a = new Float32Array(await read(states[0])), b = new Float32Array(await read(canonical));
        for (let i = 0; i < a.length; i++) {
          const error = Math.abs(a[i] - b[i]); maxError = Math.max(maxError, error);
          if (!Number.isFinite(b[i]) || error > 1e-5) throw new Error(`Fluid identity/numerical mismatch ${dense}/${step}/${i}: ${a[i]} vs ${b[i]}`);
        }
      }
      cases.push({ fluid: dense ? 'dense' : 'sparse', count, steps: 9, restored: true, maxError });
      reference.dispose(); sorted.dispose(); order.dispose(); canonical.destroy(); states.forEach(state => state.destroy());
    }
    cases.push(await checkOrderedSessions(device));
    await device.queue.onSubmittedWorkDone();
    if (errors.length) throw new Error(errors.join('\n'));
    return { success: true, cases, adapter: adapter.info };
  } finally { device.destroy(); }
}
check().then(result => { document.querySelector('#result')!.textContent = JSON.stringify(result, null, 2); })
  .catch(error => { document.querySelector('#result')!.textContent = JSON.stringify({ success: false, error: String(error) }); });
