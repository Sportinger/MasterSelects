import { StrandBufferCache } from '../../src/engine/native3d/passes/strandBuffers';
import { packStrandPoints } from '../../src/engine/native3d/passes/strandFrames';
import { createJellyfishReferenceGraph } from '../../src/services/operators/geometry/jellyfishReferenceGraph';
import { buildStrandsLayerSources } from '../../src/services/operators/geometry/strandsLayerSource';
import { evaluateGeometryProgram } from '../../src/services/operators/geometry/geometryEvaluation';
import { collectTemporalPreparations } from '../../src/effects/time/temporalResourcePreparation';
import type { GeometryField, GeometryProgram } from '../../src/services/operators/geometry/geometryProgram';
import type { SceneStrandLayer } from '../../src/engine/scene/types';
import type { Effect } from '../../src/types/effects';

const identity = Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const effect: Effect = { id: 'fx', name: 'Weave', type: 'weave', enabled: true, params: {}, operatorGraph: createJellyfishReferenceGraph() };
const programAt = (time: number) => buildStrandsLayerSources({ id: 'jelly', effects: [effect], startTime: 0, inPoint: 0, outPoint: 30, duration: 30 }, time, [])[0].source.strands.program;
const layerFor = (program: GeometryProgram): SceneStrandLayer => ({ kind: 'strands', layerId: 'fields', clipId: 'fields', opacity: 1,
  blendMode: 'normal', sourceWidth: 1920, sourceHeight: 1080, worldMatrix: identity, strands: { clipId: 'fields', effectId: 'fx', program } });
const position: GeometryField = { instructions: [{ nodeId: 'p', operation: 'position', type: 'vec3', inputs: [] }], output: 0 };
const radius: GeometryField = { instructions: [
  { nodeId: 'u', operation: 'curve-u', type: 'scalar', inputs: [] },
  { nodeId: 'i', operation: 'point-index', type: 'scalar', inputs: [] },
  { nodeId: 's', operation: 'strand-index', type: 'scalar', inputs: [] },
  { nodeId: 'p', operation: 'point-count', type: 'scalar', inputs: [] },
  { nodeId: 'n', operation: 'strand-count', type: 'scalar', inputs: [] },
  { nodeId: 'a', operation: 'add-scalar', type: 'scalar', inputs: [0, 1] },
  { nodeId: 'b', operation: 'add-scalar', type: 'scalar', inputs: [2, 3] },
  { nodeId: 'c', operation: 'add-scalar', type: 'scalar', inputs: [5, 6] },
  { nodeId: 'd', operation: 'add-scalar', type: 'scalar', inputs: [7, 4] },
], output: 8 };
const simple = (length: number, points = 9): GeometryProgram => ({ stages: [
  { kind: 'curve-line', nodeId: 'line', points, length, axis: 0 },
  { kind: 'strand-array', nodeId: 'array', count: 3, spacing: 1, axis: 1 },
  { kind: 'set-position', nodeId: 'double', position, offset: position },
  { kind: 'yarn-profile', nodeId: 'radius', radius },
  { kind: 'set-position', nodeId: 'double-again', offset: position },
  { kind: 'yarn-profile', nodeId: 'radius-again', radius },
], pointCount: points * 3, strandCount: 3 });
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };

async function check() {
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('No WebGPU adapter');
  const device = await adapter.requestDevice();
  const errors: string[] = []; device.addEventListener('uncapturederror', e => errors.push(e.error.message));
  let wakes = 0;
  const cache = new StrandBufferCache(() => wakes++), temporary: GPUBuffer[] = [];
  const results: Record<string, unknown> = {};
  const settle = async (program: GeometryProgram) => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const finish = collectTemporalPreparations();
      const buffers = cache.prepare(device, layerFor(program), temporary), pending = finish();
      if (!pending.length) { assert(buffers, 'No prepared curves'); return buffers!; }
      await Promise.all(pending);
    }
    throw new Error('GPU preparation did not settle');
  };
  try {
    let owner: unknown;
    for (const [name, program] of [
      ['contexts', simple(2)], ['animated-input', simple(3)], ['seek-large', simple(600)],
      ['topology', simple(1, 17)], ['jelly-2', programAt(2)], ['jelly-11', programAt(11)], ['jelly-seek-back', programAt(.1)],
    ] as const) {
      const buffers = await settle(program);
      assert(buffers.fields && !buffers.fields.failed, 'Expected GPU fields, not CPU fallback');
      assert(buffers.signature === JSON.stringify(program.stages), 'Export barrier returned stale geometry');
      if (name === 'contexts') owner = buffers.fields;
      if (name === 'animated-input' || name === 'seek-large') assert(owner === buffers.fields, 'Animated prefix rebuilt topology');
      const reference = packStrandPoints(evaluateGeometryProgram(program));
      const readback = device.createBuffer({ size: reference.byteLength, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const encoder = device.createCommandEncoder(); encoder.copyBufferToBuffer(buffers.positions, 0, readback, 0, reference.byteLength);
      device.queue.submit([encoder.finish()]); await readback.mapAsync(GPUMapMode.READ);
      const gpu = new Float32Array(readback.getMappedRange());
      let maxPosition = 0, maxRadius = 0, minTangent = 1, minNormal = 1, extent = 0, arc = 0, segments = 0;
      for (let point = 0; point < reference.length / 12; point++) {
        const b = point * 12;
        maxPosition = Math.max(maxPosition, Math.hypot(...[0, 1, 2].map(i => gpu[b + i] - reference[b + i])));
        maxRadius = Math.max(maxRadius, Math.abs(gpu[b + 7] - reference[b + 7]));
        minTangent = Math.min(minTangent, [0, 1, 2].reduce((sum, i) => sum + gpu[b + 8 + i] * reference[b + 8 + i], 0));
        minNormal = Math.min(minNormal, [0, 1, 2].reduce((sum, i) => sum + gpu[b + 4 + i] * reference[b + 4 + i], 0));
        extent = Math.max(extent, Math.hypot(reference[b], reference[b + 1], reference[b + 2]));
        assert(gpu[b + 11] === reference[b + 11], 'Strand ID changed');
      }
      const curves = evaluateGeometryProgram(program);
      for (let s = 0; s < curves.counts.length; s++) {
        arc += reference[(curves.starts[s] + curves.counts[s] - 1) * 12 + 3]; segments += curves.counts[s] - 1;
      }
      readback.unmap(); readback.destroy();
      results[name] = { maxPosition, maxRadius, minTangent, minNormal, extent: buffers.extent, meanSegment: buffers.segmentLength };
      assert(maxPosition < 0.002 && maxRadius < 1e-4 && minTangent > .995 && minNormal > .98, `CPU/GPU mismatch: ${name} ${JSON.stringify(results[name])}`);
      assert(Math.abs(buffers.extent - extent) < .002 && Math.abs(buffers.segmentLength - arc / segments) < .0001, 'Bounds or subdivision metadata differ');
    }
    // Position-dependent material fields must read the deformed points, not the uploaded prefix.
    const spatial = simple(1); spatial.render = { ...programAt(1).render!, materials: [{ ...programAt(1).render!.materials![0], colorField: position }] };
    const cpu = await settle(spatial);
    assert(!cpu.fields && cpu.attributes, 'Spatial material did not retain CPU evaluation');
    assert(cpu.curves!.positions[0] === -2, 'Material coordinates are not final positions');
    // Retiring a still-pending topology must neither publish destroyed buffers nor wake its owner.
    const finish = collectTemporalPreparations(); cache.prepare(device, layerFor(simple(4)), temporary); const pending = finish();
    cache.dispose(); const before = wakes; await Promise.all(pending); assert(wakes === before, 'Disposed GPU owner published a frame');
    await device.queue.onSubmittedWorkDone();
    assert(!errors.length, errors.join('\n'));
    return { pass: true, wakes, ...results };
  } finally { cache.dispose(); temporary.forEach(b => b.destroy()); device.destroy(); }
}

check().then(result => { document.querySelector('#result')!.textContent = JSON.stringify(result, null, 2); })
  .catch(error => { document.querySelector('#result')!.textContent = `FAIL: ${error.stack ?? error}`; });
