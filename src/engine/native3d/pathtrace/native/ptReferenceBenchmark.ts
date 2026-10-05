import { ptPipelines } from '../runtime/ptPipelines';

export interface PtBenchmarkImage { pixels: Float32Array; width: number; height: number; samples: number; gpuMs: number | null; wallMs: number }

/** Fixed-sample reference, no denoiser, adaptive sampling, warm-up frames or scene rebuilding. */
export async function benchmarkPtReference(device: GPUDevice, frame: ArrayBuffer, groups: GPUBindGroup[], frameBuffer: GPUBuffer,
  samples: number, progress: (message: string) => void): Promise<PtBenchmarkImage> {
  const f = new Float32Array(frame), u = new Uint32Array(frame), width = f[68], height = f[69];
  const buffers: GPUBuffer[] = [], make = (size: number, usage: GPUBufferUsageFlags) => {
    const buffer = device.createBuffer({ size, usage }); buffers.push(buffer); return buffer;
  };
  const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC;
  const accumulation = make(width * height * 16, usage), auxiliary = make(width * height * 32, usage), state = make(width * height * 16, usage);
  const band = make(16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
  const output = make(width * height * 16, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);
  const timestamps = device.features.has('timestamp-query') ? device.createQuerySet({ type: 'timestamp', count: 2 }) : null;
  const query = timestamps ? make(256, GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC) : null;
  const queryRead = timestamps ? make(16, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST) : null;
  const pipeline = ptPipelines(device);
  const outputs = device.createBindGroup({ layout: pipeline.integratorOutputs, entries: [accumulation, auxiliary, state, band]
    .map((buffer, binding) => ({ binding, resource: { buffer } })) });
  const started = performance.now(); let gpuMs = 0, rows = 1;
  device.pushErrorScope('validation'); let scopeOpen = true;
  try {
    for (let sample = 0; sample < samples; sample++) {
      u[77] = sample; u[78] = 1;
      device.queue.writeBuffer(frameBuffer, 0, frame);
      for (let y = 0; y < height;) {
        if (performance.now() - started > 110_000) throw new Error('WebGPU reference exceeded 110 seconds');
        const count = Math.min(rows, height - y);
        device.queue.writeBuffer(band, 0, Uint32Array.of(y, count, 0, width));
        const encoder = device.createCommandEncoder({ label: 'optix-webgpu-reference' });
        const pass = encoder.beginComputePass({ ...(timestamps ? { timestampWrites: { querySet: timestamps, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 } } : {}) });
        pass.setPipeline(pipeline.integrator);
        groups.forEach((group, slot) => pass.setBindGroup(slot, group)); pass.setBindGroup(3, outputs, [0]);
        pass.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(count / 8)); pass.end();
        if (timestamps && query && queryRead) { encoder.resolveQuerySet(timestamps, 0, 2, query, 0); encoder.copyBufferToBuffer(query, 0, queryRead, 0, 16); }
        const before = performance.now(); device.queue.submit([encoder.finish()]);
        let ms: number;
        if (queryRead) {
          await queryRead.mapAsync(GPUMapMode.READ); const times = new BigUint64Array(queryRead.getMappedRange());
          ms = Number(times[1] - times[0]) / 1e6; gpuMs += ms; queryRead.unmap();
        } else { await device.queue.onSubmittedWorkDone(); ms = performance.now() - before; }
        y += count; rows = Math.max(1, Math.min(64, Math.floor(count * 8 / Math.max(ms, .1))));
        progress(`WebGPU: ${((sample + y / height) / samples * 100).toFixed(0)}%`);
        await new Promise(resolve => setTimeout(resolve, 4));
      }
    }
    const encoder = device.createCommandEncoder(); encoder.copyBufferToBuffer(accumulation, 0, output, 0, output.size); device.queue.submit([encoder.finish()]);
    await output.mapAsync(GPUMapMode.READ); const pixels = new Float32Array(output.getMappedRange().slice(0));
    for (let i = 0; i < pixels.length; i++) pixels[i] /= samples;
    scopeOpen = false; const error = await device.popErrorScope(); if (error) throw new Error(error.message);
    return { pixels, width, height, samples, gpuMs: timestamps ? gpuMs : null, wallMs: performance.now() - started };
  } catch (error) { if (scopeOpen) await device.popErrorScope().catch(() => null); throw error; }
  finally { timestamps?.destroy(); buffers.forEach(buffer => buffer.destroy()); }
}
