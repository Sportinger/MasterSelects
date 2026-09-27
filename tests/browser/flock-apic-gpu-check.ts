import { FlockFluidGrid } from '../../src/engine/flock/gpu/FlockFluidGrid';
import { FlockCpuFluid } from '../../src/engine/flock/cpu/flockCpuFluid';
import { affineFieldFixture } from '../fixtures/flockApicFixtures';

export async function checkApicTransfer(device: GPUDevice) {
  const cases: unknown[] = [];
  const read = async (source: GPUBuffer) => {
    const staging = device.createBuffer({ size: source.size, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const encoder = device.createCommandEncoder(); encoder.copyBufferToBuffer(source, 0, staging, 0, source.size);
    device.queue.submit([encoder.finish()]);
    try { await staging.mapAsync(GPUMapMode.READ); return new Float32Array(staging.getMappedRange().slice(0)); }
    finally { staging.destroy(); }
  };
  const error = (a: Float32Array, b: Float32Array, limit: number, label: string) => {
    let max = 0;
    for (let i = 0; i < a.length; i++) {
      const difference = Math.abs(a[i] - b[i]); max = Math.max(max, difference);
      if (!Number.isFinite(b[i]) || difference > limit) throw new Error(`${label}/${i}: ${a[i]} vs ${b[i]} (limit ${limit})`);
    }
    return max;
  };
  for (const kind of ['affine-half', 'affine-unit', 'affine-double', 'projected', 'respawn', 'pic', 'wall']) {
    const { spec, state, affine, count } = affineFieldFixture(kind === 'affine-half' ? 0.5 : kind === 'affine-double' ? 2 : 1);
    if (kind === 'projected') {
      spec.iterations = 24;
      for (let i = 0; i < count; i++) {
        state[i * 16 + 4] += state[i * 16] * 0.5;
        affine[i * 9] += 0.5;
      }
    }
    const strength = kind === 'pic' ? 0 : 1, dt = kind === 'projected' ? 1 / 60 : 0;
    const repeats = kind.startsWith('affine') ? 8 : 3;
    if (kind === 'respawn') for (let i = 0; i < count; i++) state[i * 16 + 3] = 0;
    if (kind === 'wall') {
      for (let i = 0; i < count; i++) {
        state.set([0, -4.99, 0, 1, 2, 0, 3], i * 16);
      }
      affine.fill(0);
    }
    const cpu = new FlockCpuFluid(spec, count); cpu.affine.set(affine);
    const expected = state.slice();
    const particles = device.createBuffer({ size: state.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
    const gpu = new FlockFluidGrid(device, spec, [particles], 1, { dispatchWidth: 2 });
    try {
      device.queue.writeBuffer(particles, 0, state);
      device.queue.writeBuffer(gpu.affine, 0, kind === 'respawn' ? new Float32Array(affine.length).fill(999) : affine);
      gpu.stageParams(0, { count, affineStrength: strength, dt }); gpu.uploadParams(1);
      for (let i = 0; i < repeats; i++) {
        cpu.step(expected, count, strength, dt);
        const encoder = device.createCommandEncoder(); gpu.encode(encoder, 0, 0, count); device.queue.submit([encoder.finish()]);
      }
      const actual = await read(particles), actualAffine = await read(gpu.affine);
      const tolerance = kind.startsWith('affine') ? 1e-5 : 0.003;
      const stateError = error(expected, actual, tolerance, `${kind} state`);
      const affineError = error(cpu.affine, actualAffine, tolerance, `${kind} affine`);
      if (kind === 'projected' && !actual.some((v, i) => Math.abs(v - state[i]) > 0.01)) throw new Error('Projection fixture did not exercise pressure');
      if (kind.startsWith('affine')) {
        error(state, actual, 1e-5, `${kind} analytical velocity`);
        error(affine, actualAffine, 1e-5, `${kind} analytical gradient`);
      }
      cases.push({ kind, count, repeats, stateError, affineError });
    } finally { gpu.dispose(); particles.destroy(); }
  }
  return { apicTransfer: cases };
}
