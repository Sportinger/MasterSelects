import { FlockFluidSeparation } from '../../src/engine/flock/gpu/FlockFluidSeparation';
import { FlockParticleOrder } from '../../src/engine/flock/gpu/FlockParticleOrder';
import { packFlockFluidState, type FlockParticleLayout } from '../../src/engine/flock/shared/flockParticleLayout';
import type { FlockFluidSpec } from '../../src/services/flock/compiler/flockProgramTypes';

/** Analytical pairs across a cell boundary, with inactive tails and physical reordering. */
export async function checkSeparationScratch(device: GPUDevice) {
  const cases: unknown[] = [];
  const spec: FlockFluidSpec = { nodeId: 'fluid', sourceNodeId: 'simulation', origin: [-4, -4, -4],
    dims: [8, 8, 8], cellSize: 1, iterations: 0 };
  for (const stateLayout of ['full64', 'fluid32'] as FlockParticleLayout[]) {
    for (const count of [2, 257]) for (const coincident of [false, true]) {
      const initial = new Float32Array(count * 16);
      for (let i = 0; i < count; i++) initial.set([-2, 3, 1, -1, 2, -3, 4, 10, 1, 0, 0, 0, i / count, 7, 3, 5], i * 16);
      initial.set([coincident ? 0 : 0.025, 0, 0, 1], 0);
      initial.set([coincident ? 0 : -0.025, 0, 0, 1], 16);
      const source = stateLayout === 'fluid32' ? packFlockFluidState(initial) : initial;
      const storage = () => device.createBuffer({ size: source.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
      const state = storage(), canonical = storage();
      const params = device.createBuffer({ size: 256, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      const staging = device.createBuffer({ size: source.byteLength, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      device.queue.writeBuffer(state, 0, source);
      const data = new ArrayBuffer(256), f = new Float32Array(data), u = new Uint32Array(data);
      f.set([...spec.origin, spec.cellSize]); u.set([...spec.dims, count], 4);
      f[9] = 1 / 60; u[10] = 256; f[12] = 0.5; f[13] = 0.1;
      device.queue.writeBuffer(params, 0, data);
      const order = new FlockParticleOrder(device, [state], spec, 1, stateLayout);
      const separation = new FlockFluidSeparation(device, spec, [state], params, order, 1);
      try {
        const encoder = device.createCommandEncoder();
        order.reset(encoder); order.encodeBeforeStep(encoder, 0, 0);
        separation.encode(encoder, 0, 0, count);
        order.canonical(encoder, state, canonical);
        encoder.copyBufferToBuffer(canonical, 0, staging, 0, source.byteLength);
        device.queue.submit([encoder.finish()]);
        await staging.mapAsync(GPUMapMode.READ);
        const result = new Float32Array(staging.getMappedRange().slice(0));
        const stride = stateLayout === 'fluid32' ? 8 : 16;
        const near = (actual: number, expected: number) => {
          if (!Number.isFinite(actual) || Math.abs(actual - expected) > 1e-6) {
            throw new Error(`Separation ${stateLayout}/${count}/${coincident}: ${actual} vs ${expected}`);
          }
        };
        if (coincident) {
          near(Math.hypot(result[0], result[1], result[2]), 0.025);
          for (let axis = 0; axis < 3; axis++) near(result[axis] + result[stride + axis], 0);
        } else {
          near(result[0], 0.0375); near(result[stride], -0.0375);
          for (const index of [1, 2, stride + 1, stride + 2]) near(result[index], 0);
        }
        for (let i = 0; i < result.length; i++) {
          if (Math.floor(i / stride) < 2 && i % stride < 3) continue;
          if (result[i] !== source[i]) throw new Error(`Separation changed inactive state or metadata at ${stateLayout}/${i}`);
        }
        cases.push({ stateLayout, count, coincident, forced2D: count > 256 });
      } finally {
        staging.destroy(); separation.dispose(); order.dispose(); state.destroy(); canonical.destroy(); params.destroy();
      }
    }
  }
  return { separationScratch: cases };
}
