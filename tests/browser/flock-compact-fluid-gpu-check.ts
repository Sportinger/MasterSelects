import { FlockFluidGrid } from '../../src/engine/flock/gpu/FlockFluidGrid';
import { FlockParticleOrder } from '../../src/engine/flock/gpu/FlockParticleOrder';
import { packFlockFluidState, type FlockParticleLayout } from '../../src/engine/flock/shared/flockParticleLayout';
import type { FlockFluidSpec } from '../../src/services/flock/compiler/flockProgramTypes';

/** Exercises genuine 32-byte storage through order, APIC, pressure and separation. */
export async function checkCompactFluid(device: GPUDevice) {
  const count = 1025;
  const spec: FlockFluidSpec = { nodeId: 'fluid', sourceNodeId: 'simulation', origin: [-4, -4, -4],
    dims: [8, 8, 8], cellSize: 1, iterations: 12 };
  const initial = new Float32Array(count * 16);
  for (let i = 0; i < count; i++) {
    initial.set([((i * 13) % 61) / 20 - 1.5, ((i * 19) % 59) / 20 - 1.5, ((i * 29) % 53) / 20 - 1.5,
      i % 19 === 0 ? -1 : i % 23 === 0 ? 0 : 1,
      (i % 7) / 4, -(i % 11) / 4, (i % 13) / 4, 10, 0.25, 0.5, 0.75, 2, i / count, i % 5, 3, 7], i * 16);
  }
  const initialAffine = Float32Array.from({ length: count * 9 }, (_, i) => ((i * 7) % 31 - 15) / 100);
  const buffer = (bytes: number) => device.createBuffer({ size: bytes,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
  const read = async (source: GPUBuffer) => {
    const staging = device.createBuffer({ size: source.size, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const encoder = device.createCommandEncoder(); encoder.copyBufferToBuffer(source, 0, staging, 0, source.size);
    device.queue.submit([encoder.finish()]);
    try { await staging.mapAsync(GPUMapMode.READ); return new Float32Array(staging.getMappedRange().slice(0)); }
    finally { staging.destroy(); }
  };
  const equal = (a: Float32Array, b: Float32Array, label: string) => {
    if (a.length !== b.length) throw new Error(`${label}: length differs`);
    for (let i = 0; i < a.length; i++) {
      if (!Number.isFinite(b[i]) || a[i] !== b[i]) throw new Error(`${label}/${i}: ${a[i]} vs ${b[i]}`);
    }
  };
  const variants = (['full64', 'fluid32'] as FlockParticleLayout[]).map(stateLayout => {
    const data = stateLayout === 'fluid32' ? packFlockFluidState(initial) : initial;
    const state = buffer(data.byteLength), canonical = buffer(data.byteLength);
    device.queue.writeBuffer(state, 0, data);
    const order = new FlockParticleOrder(device, [state], spec, 1, stateLayout);
    // Infer layout from the order owner, as the future compact session will.
    const fluid = new FlockFluidGrid(device, spec, [state], 1, { order, dispatchWidth: 1 });
    device.queue.writeBuffer(fluid.affine, 0, initialAffine);
    const encoder = device.createCommandEncoder(); order.reset(encoder); device.queue.submit([encoder.finish()]);
    return { stateLayout, state, canonical, order, fluid, saved: data, savedAffine: initialAffine };
  });
  try {
    const final: Float32Array[][] = [];
    for (let replay = 0; replay < 2; replay++) {
      if (replay) for (const v of variants) {
        device.queue.writeBuffer(v.state, 0, v.saved); device.queue.writeBuffer(v.fluid.affine, 0, v.savedAffine);
        const encoder = device.createCommandEncoder(); v.order.reset(encoder); device.queue.submit([encoder.finish()]);
      }
      for (let step = replay ? 4 : 0; step < 8; step++) {
        const encoder = device.createCommandEncoder();
        for (const v of variants) {
          v.fluid.stageParams(0, { count, affineStrength: 1, dt: 1 / 60, step,
            separationStrength: 0.15, separationDistance: 0.1, jitter: 0.002 });
          v.fluid.uploadParams(1);
          v.order.encodeBeforeStep(encoder, 0, step);
          v.fluid.encode(encoder, 0, 0, count);
          v.order.canonical(encoder, v.state, v.canonical);
        }
        device.queue.submit([encoder.finish()]);
        const states = await Promise.all(variants.map(v => read(v.canonical)));
        const affine = await Promise.all(variants.map(v => read(v.fluid.affine)));
        equal(packFlockFluidState(states[0]), states[1], `compact core ${replay}/${step}`);
        equal(affine[0], affine[1], `compact affine ${replay}/${step}`);
        // Full-state consumers must retain metadata while using the same kernels.
        for (let i = 0; i < count; i++) for (const offset of [7, 8, 9, 10, 11, 12, 14, 15]) {
          if (states[0][i * 16 + offset] !== initial[i * 16 + offset]) throw new Error('Full metadata changed');
        }
        if (step === 3) variants.forEach((v, i) => { v.saved = states[i]; v.savedAffine = affine[i]; });
        if (step === 7) {
          if (!replay) final.push(states, affine);
          else variants.forEach((_, i) => { equal(final[0][i], states[i], 'checkpoint state replay'); equal(final[1][i], affine[i], 'checkpoint affine replay'); });
        }
      }
    }
    const bytes = variants.map(v => v.state.size + v.order.gpuBytes + v.fluid.gpuBytes);
    if (bytes[0] - bytes[1] !== count * 64) throw new Error('Compact state and sort workspace did not halve particle bytes');
    let rejectedMismatch = false;
    try { new FlockFluidGrid(device, spec, [variants[1].state], 1, { order: variants[1].order, stateLayout: 'full64' }); }
    catch { rejectedMismatch = true; }
    if (!rejectedMismatch) throw new Error('Mixed fluid/order formats accepted');
    return { compactFluid: { count, steps: 8, replayedSteps: 4, exact: true,
      fullBytes: bytes[0], compactBytes: bytes[1], savedBytes: bytes[0] - bytes[1], rejectedMismatch } };
  } finally {
    for (const v of variants) { v.fluid.dispose(); v.order.dispose(); v.state.destroy(); v.canonical.destroy(); }
  }
}
