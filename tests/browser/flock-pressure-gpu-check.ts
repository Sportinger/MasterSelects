import { FlockPressureSolver } from '../../src/engine/flock/gpu/FlockPressureSolver';
import { FlockCpuPressure } from '../../src/engine/flock/cpu/flockCpuPressure';
import { pressureCases, pressureFixture, pressureResidual } from '../fixtures/flockPressureFixtures';

async function check() {
  const adapter = await navigator.gpu.requestAdapter(); if (!adapter) throw new Error('No GPU adapter');
  const device = await adapter.requestDevice(); const errors: string[] = [], results: unknown[] = [];
  device.addEventListener('uncapturederror', event => errors.push(event.error.message));
  try {
    for (const definition of pressureCases) {
      const { counts, divergence } = pressureFixture(definition), count = counts.length;
      const occupancy = device.createBuffer({ size: count * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      const cells = device.createBuffer({ size: count * 8, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
      const readback = device.createBuffer({ size: count * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
      const solver = new FlockPressureSolver(device, definition.dims, occupancy, cells, 2);
      const cpu = new FlockCpuPressure(definition.dims), expected = new Float64Array(count);
      cpu.solve(counts, divergence, expected, 32);
      const run = async (mask: Uint32Array) => {
        device.queue.writeBuffer(occupancy, 0, mask);
        device.queue.writeBuffer(cells, 0, new Float32Array(divergence));
        const encoder = device.createCommandEncoder(), pass = encoder.beginComputePass();
        solver.encode(pass, 32); pass.end(); encoder.copyBufferToBuffer(cells, count * 4, readback, 0, count * 4);
        device.queue.submit([encoder.finish()]); await readback.mapAsync(GPUMapMode.READ);
        const actual = Float64Array.from(new Float32Array(readback.getMappedRange().slice(0))); readback.unmap(); return actual;
      };
      const actual = await run(counts), residual = pressureResidual(definition.dims, counts, divergence, actual);
      if (!actual.every(Number.isFinite) || residual.relative > 3e-5) throw new Error(`${definition.name}: residual ${JSON.stringify(residual)}`);
      // Pressure in a closed box has an arbitrary additive constant. Compare its
      // mean-free field to the double-precision CPU solution as well as true residual.
      let mean = 0, active = 0;
      for (let i = 0; i < count; i++) if (counts[i]) { mean += actual[i] - expected[i]; active++; }
      mean /= Math.max(1, active); let maxError = 0;
      for (let i = 0; i < count; i++) maxError = Math.max(maxError, Math.abs(actual[i] - expected[i] - (counts[i] ? mean : 0)));
      if (maxError > 0.002) throw new Error(`${definition.name}: CPU pressure mismatch ${maxError}`);
      const empty = await run(new Uint32Array(count)); if (!empty.every(value => value === 0)) throw new Error('Stale empty pressure');
      const repeat = await run(counts); if (!repeat.every((value, i) => value === actual[i])) throw new Error('Non-deterministic pressure');
      results.push({ name: definition.name, cells: count, residual, cpuIterations: cpu.iterations, maxCpuError: maxError, repeat: 'exact' });
      solver.dispose(); occupancy.destroy(); cells.destroy(); readback.destroy();
    }
    await device.queue.onSubmittedWorkDone(); if (errors.length) throw new Error(errors.join('\n'));
    return { success: true, results };
  } catch (error) { throw new Error(`${String(error)}\n${errors.join('\n')}`); }
  finally { device.destroy(); }
}
check().then(result => { document.querySelector('#result')!.textContent = JSON.stringify(result, null, 2); })
  .catch(error => { document.querySelector('#result')!.textContent = JSON.stringify({ success: false, error: String(error) }); });
