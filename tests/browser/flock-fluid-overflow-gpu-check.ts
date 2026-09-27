import { FlockFluidGrid } from '../../src/engine/flock/gpu/FlockFluidGrid';
import { FlockCpuFluid } from '../../src/engine/flock/cpu/flockCpuFluid';
import type { FlockFluidSpec } from '../../src/services/flock/compiler/flockProgramTypes';

/** Real GPU regression: fixed scales overflow on both dense and fast transfers. */
export async function checkFluidOverflow(device: GPUDevice) {
  const cases: unknown[] = [];
  const read = async (source: GPUBuffer) => {
    const staging = device.createBuffer({ size: source.size, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const encoder = device.createCommandEncoder(); encoder.copyBufferToBuffer(source, 0, staging, 0, source.size);
    device.queue.submit([encoder.finish()]);
    try { await staging.mapAsync(GPUMapMode.READ); return new Float32Array(staging.getMappedRange().slice(0)); }
    finally { staging.destroy(); }
  };
  for (const kind of ['dense', 'fast-affine', 'outside-wall'] as const) {
    const count = kind === 'dense' ? 65537 : kind === 'outside-wall' ? 32769 : 257;
    const spec: FlockFluidSpec = { nodeId: 'fluid', sourceNodeId: 'simulation', origin: [0, 0, 0],
      dims: [8, 8, 8], cellSize: 1, iterations: 0 };
    const state = new Float32Array(count * 16), affine = new Float32Array(count * 9);
    for (let i = 0; i < count; i++) {
      const position = kind === 'outside-wall' ? [-0.25, 3.5, 3.5] : [3, 3.5, 3.5];
      const velocity = kind === 'fast-affine' ? [500000, -300000, 100000] : [7, -11, 13];
      state.set([...position, 1, ...velocity, 0, 0, 0, 1, 0, i / count, 1, 0, 0], i * 16);
      if (kind === 'fast-affine') affine.set([200000, -400000, 100000, -300000, 200000, -100000, 100000, 0, -200000], i * 9);
    }
    const cpu = new FlockCpuFluid(spec, count); cpu.affine.set(affine);
    const expected = state.slice(); cpu.step(expected, count, 1, 0);
    let reference: Float32Array | undefined;
    for (const blockTransfer of [false, true]) {
      const particles = device.createBuffer({ size: state.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
      const gpu = new FlockFluidGrid(device, spec, [particles], 1, { blockTransfer, dispatchWidth: 2 });
      try {
        let maxStateError = 0, maxAffineError = 0;
        for (let repeat = 0; repeat < 2; repeat++) {
          // Reusing scratch must clear bounds as well as the accumulated sums.
          device.queue.writeBuffer(particles, 0, state); device.queue.writeBuffer(gpu.affine, 0, affine);
          gpu.stageParams(0, { count, affineStrength: 1, dt: 0 }); gpu.uploadParams(1);
          const encoder = device.createCommandEncoder(); gpu.encode(encoder, 0, 0, count); device.queue.submit([encoder.finish()]);
          const actual = await read(particles), actualAffine = await read(gpu.affine);
          const compare = (wanted: Float32Array, result: Float32Array, label: string) => {
            let max = 0;
            for (let i = 0; i < wanted.length; i++) {
              const error = Math.abs(wanted[i] - result[i]); max = Math.max(max, error);
              const tolerance = kind === 'fast-affine' ? 0.25 : 0.003;
              if (!Number.isFinite(result[i]) || error > tolerance) throw new Error(`${kind}/${label}/${i}: ${wanted[i]} vs ${result[i]}`);
            }
            return max;
          };
          maxStateError = Math.max(maxStateError, compare(expected, actual, 'state'));
          maxAffineError = Math.max(maxAffineError, compare(cpu.affine, actualAffine, 'affine'));
          if (reference) for (let i = 0; i < actual.length; i++) {
            if (actual[i] !== reference[i]) throw new Error(`${kind}: nondeterministic or block/direct mismatch at ${i}`);
          }
          reference ??= actual;
          if (kind === 'dense') for (const axis of [0, 1, 2]) {
            if (Math.abs(actual[4 + axis] - state[4 + axis]) > 0.003) throw new Error('Dense constant velocity was not preserved');
          }
        }
        cases.push({ kind, count, blockTransfer, repeats: 2, maxStateError, maxAffineError });
      } finally { gpu.dispose(); particles.destroy(); }
    }
  }
  return { overflowTransfer: cases };
}
