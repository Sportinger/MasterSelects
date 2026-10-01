import { StrandBufferCache } from '../../src/engine/native3d/passes/strandBuffers';
import { packStrandPoints, STRAND_POINT_FLOATS } from '../../src/engine/native3d/passes/strandFrames';
import { createDefaultWeaveGraph } from '../../src/services/operators/geometry/weaveGraph';
import { buildStrandsLayerSources } from '../../src/services/operators/geometry/strandsLayerSource';
import { evaluateGeometryProgram } from '../../src/services/operators/geometry/geometryEvaluation';
import type { SceneStrandLayer } from '../../src/engine/scene/types';
import type { Effect } from '../../src/types/effects';

/**
 * GPU Surface Bind against the CPU reference (bindToCloth + packStrandPoints) for the default weave,
 * and the CPU cost per animated frame of both paths.
 */
const identity = Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const effect: Effect = { id: 'fx', name: 'Weave', type: 'weave', enabled: true, params: {}, operatorGraph: createDefaultWeaveGraph() };
const programAt = (time: number) => buildStrandsLayerSources({ id: 'bind', effects: [effect], startTime: 0, inPoint: 0, outPoint: 10, duration: 10 }, time, [])[0].source.strands.program;
const layerFor = (program: SceneStrandLayer['strands']['program'], id = 'bind'): SceneStrandLayer => ({ kind: 'strands', layerId: id, clipId: id, opacity: 1,
  blendMode: 'normal', sourceWidth: 1920, sourceHeight: 1080, worldMatrix: identity, strands: { clipId: id, effectId: 'fx', program } });

async function check() {
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('No WebGPU adapter');
  const device = await adapter.requestDevice();
  const errors: string[] = [];
  device.addEventListener('uncapturederror', event => errors.push(event.error.message));
  const cache = new StrandBufferCache();
  const results: Record<string, unknown> = {};
  try {
    for (const time of [1.5, 6, 9.2]) {
      const program = programAt(time);
      if (program.stages.at(-1)?.kind !== 'surface-bind') throw new Error('Default weave no longer ends with Surface Bind');
      const temporary: GPUBuffer[] = [];
      const buffers = cache.prepare(device, layerFor(program), temporary)!;
      const reference = packStrandPoints(evaluateGeometryProgram(program));
      const readback = device.createBuffer({ size: reference.byteLength, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const encoder = device.createCommandEncoder();
      encoder.copyBufferToBuffer(buffers.positions, 0, readback, 0, reference.byteLength);
      device.queue.submit([encoder.finish()]);
      await readback.mapAsync(GPUMapMode.READ);
      const gpu = new Float32Array(readback.getMappedRange().slice(0));
      readback.unmap(); readback.destroy(); temporary.forEach(buffer => buffer.destroy());
      let position = 0, arc = 0, normal = 1, tangent = 1, radius = 0, mismatches = 0;
      for (let point = 0; point < reference.length / STRAND_POINT_FLOATS; point++) {
        const base = point * STRAND_POINT_FLOATS;
        const at = (data: Float32Array, offset: number) => [data[base + offset], data[base + offset + 1], data[base + offset + 2]];
        const delta = Math.hypot(...at(gpu, 0).map((value, axis) => value - at(reference, 0)[axis]));
        const dot = (offset: number) => at(gpu, offset).reduce((sum, value, axis) => sum + value * at(reference, offset)[axis], 0);
        position = Math.max(position, delta);
        arc = Math.max(arc, Math.abs(gpu[base + 3] - reference[base + 3]));
        normal = Math.min(normal, dot(4));
        tangent = Math.min(tangent, dot(8));
        // The radius fields run in f32 on the GPU; hidden points (radius 0) must stay hidden exactly.
        radius = Math.max(radius, Math.abs(gpu[base + 7] - reference[base + 7]));
        if ((gpu[base + 7] === 0) !== (reference[base + 7] === 0) || gpu[base + 11] !== reference[base + 11]) mismatches++;
      }
      results[`t${time}`] = { points: reference.length / STRAND_POINT_FLOATS, maxPosition: position, maxArc: arc, minNormalDot: normal, minTangentDot: tangent, maxRadius: radius, mismatches };
      if (position > 2e-4 || arc > 2e-3 || normal < 0.999 || tangent < 0.9999 || radius > 1e-4 || mismatches) throw new Error(`GPU bind differs at ${time}s: ${JSON.stringify(results[`t${time}`])}`);
    }
    // CPU cost per animated frame while threads are pulled in (0.5–3.5 s) and once woven (5–8 s, wind only):
    // the GPU path against the CPU reference path. Medians and 95th percentiles in ms.
    const gpuPath = new StrandBufferCache(), retired: GPUBuffer[] = [];
    const time = (frames: SceneStrandLayer['strands']['program'][], run: (program: SceneStrandLayer['strands']['program']) => void) => {
      const samples = frames.map(program => { const start = performance.now(); run(program); return performance.now() - start; }).toSorted((a, b) => a - b);
      return { median: +samples[Math.floor(samples.length / 2)].toFixed(2), p95: +samples[Math.floor(samples.length * 0.95)].toFixed(2) };
    };
    for (const [phase, from] of [['weaveIn', 0.5], ['woven', 5]] as const) {
      const frames = Array.from({ length: 90 }, (_, index) => programAt(from + index / 30));
      results[`cpuMsPerFrame.${phase}`] = {
        gpuPath: time(frames, program => { gpuPath.prepare(device, layerFor(program, `timed-${phase}`), retired); }),
        cpuPath: time(frames, program => { packStrandPoints(evaluateGeometryProgram(program)); }),
      };
    }
    await device.queue.onSubmittedWorkDone();
    retired.forEach(buffer => buffer.destroy()); gpuPath.dispose();
    if (errors.length) throw new Error(errors.join('\n'));
    return { pass: true, ...results };
  } finally {
    cache.dispose();
    await device.queue.onSubmittedWorkDone();
    device.destroy();
  }
}

check().then(result => { document.querySelector('#result')!.textContent = JSON.stringify(result, null, 2); })
  .catch(error => { document.querySelector('#result')!.textContent = `FAIL: ${error.stack ?? error}`; });
