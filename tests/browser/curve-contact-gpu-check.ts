import { StrandContactProjector } from '../../src/engine/native3d/passes/StrandContactProjector';
import { packStrandPoints } from '../../src/engine/native3d/passes/strandFrames';
import type { CurveSet } from '../../src/services/operators/geometry/geometryEvaluation';
import { separateCurveContacts, type CurveContactSpec } from '../../src/services/operators/geometry/curveContacts';
import { StrandBufferCache } from '../../src/engine/native3d/passes/strandBuffers';
import { collectTemporalPreparations } from '../../src/effects/time/temporalResourcePreparation';
import type { GeometryProgram } from '../../src/services/operators/geometry/geometryProgram';
import type { SceneStrandLayer } from '../../src/engine/scene/types';

const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
const spec = { radius: .02, iterations: 32, smoothing: .35 };
const crossing: CurveSet = { positions: Float32Array.of(-1, 0, 0, 1, 0, 0, 0, -1, 0, 0, 1, 0), starts: Uint32Array.of(0, 2), counts: Uint32Array.of(2, 2) };
async function check() {
  const adapter = await navigator.gpu.requestAdapter(); if (!adapter) throw new Error('No WebGPU adapter');
  const device = await adapter.requestDevice(), errors: string[] = [];
  device.addEventListener('uncapturederror', event => errors.push(event.error.message));
  const results: Record<string, unknown> = {}, owned: GPUBuffer[] = [];
  const buffer = (size: number, usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC) => {
    const value = device.createBuffer({ size: Math.max(16, size), usage }); owned.push(value); return value;
  };
  const read = async (packed: GPUBuffer, count: number) => {
    const readback = buffer(count * 48, GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ), encoder = device.createCommandEncoder();
    encoder.copyBufferToBuffer(packed, 0, readback, 0, count * 48); device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ); const values = new Float32Array(readback.getMappedRange()).slice(); readback.unmap();
    return Float32Array.from({ length: count * 3 }, (_, i) => values[Math.floor(i / 3) * 12 + i % 3]);
  };
  const project = async (curves: CurveSet, contact: CurveContactSpec) => {
    const count = curves.positions.length / 3, packed = buffer(count * 48), contexts = new Uint32Array(count * 4), ranges = new Uint32Array(curves.counts.length * 2);
    for (let s = 0; s < curves.counts.length; s++) {
      ranges.set([curves.starts[s], curves.counts[s]], s * 2);
      for (let i = 0; i < curves.counts[s]; i++) contexts.set([i, s, curves.counts[s], 0], (curves.starts[s] + i) * 4);
    }
    const c = buffer(contexts.byteLength), r = buffer(ranges.byteLength);
    device.queue.writeBuffer(c, 0, contexts); device.queue.writeBuffer(r, 0, ranges); device.queue.writeBuffer(packed, 0, packStrandPoints(curves));
    device.pushErrorScope('validation');
    const projector = new StrandContactProjector(device, count), encoder = device.createCommandEncoder();
    projector.encode(encoder, packed, c, r, contact); device.queue.submit([encoder.finish()]);
    const error = await device.popErrorScope(); assert(!error, error?.message ?? 'GPU validation');
    const output = await read(packed, count); projector.dispose();
    assert(output.every(Number.isFinite), 'Non-finite geometry'); return output;
  };
  try {
    const full = await project(crossing, spec), expected = separateCurveContacts(crossing, spec).positions;
    assert(full.every((x, i) => Math.abs(x - expected[i]) < 1e-5), 'Crossing capsules were not separated');
    const half = await project(crossing, { ...spec, strength: .5 }), zero = await project(crossing, { ...spec, strength: 0 });
    assert(half.every((x, i) => Math.abs(x - (crossing.positions[i] + full[i]) / 2) < 1e-5), 'Strength does not blend displacement');
    assert(zero.every((x, i) => x === crossing.positions[i]), 'Strength zero changed shape');
    const thin = { ...crossing, radius: Float32Array.of(.5, .5, 1, 1) }, thinResult = await project(thin, spec);
    assert(Math.abs(Math.abs(thinResult[2] - thinResult[8]) - .03) < 1e-5, 'Varying thickness was ignored');
    const distant = { ...crossing, positions: crossing.positions.slice() }; distant.positions[8] = distant.positions[11] = .2;
    assert((await project(distant, spec)).every((x, i) => x === distant.positions[i]), 'Separated curves changed');
    const rings: CurveSet = { positions: new Float32Array(2 * 65 * 3), starts: Uint32Array.of(0, 65), counts: Uint32Array.of(65, 65) };
    for (let s = 0; s < 2; s++) for (let i = 0; i < 65; i++) {
      const a = (i % 64) / 64 * Math.PI * 2; rings.positions.set([Math.cos(a), Math.sin(a), s * .01], (s * 65 + i) * 3);
    }
    const welded = await project(rings, spec);
    for (let s = 0; s < 2; s++) for (let a = 0; a < 3; a++) assert(welded[s * 65 * 3 + a] === welded[(s * 65 + 64) * 3 + a], 'Ring seam opened');
    let minDistance = Infinity;
    for (let i = 0; i < 65; i++) minDistance = Math.min(minDistance, Math.abs(welded[i * 3 + 2] - welded[(65 + i) * 3 + 2]));
    assert(minDistance > .038, 'Closed ring contacts did not converge');
    results.capsules = { separation: Math.abs(full[2] - full[8]), varyingThickness: Math.abs(thinResult[2] - thinResult[8]), closedRingSeparation: minDistance };

    // Exercise the actual export preparation barrier, uniform animation, and isolated layer owners.
    const identity = Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    const cache = new StrandBufferCache(), temporary: GPUBuffer[] = [];
    const program = (strength: number): GeometryProgram => ({ pointCount: 34, strandCount: 2, stages: [
      { kind: 'curve-line', nodeId: 'line', points: 17, length: 1, axis: 0 },
      { kind: 'strand-array', nodeId: 'array', count: 2, spacing: .01, axis: 1 },
      { kind: 'set-position', nodeId: 'deform' }, { kind: 'curve-contact', nodeId: 'contact', ...spec, strength },
    ] });
    const settle = async (p: GeometryProgram, id: string) => {
      const layer: SceneStrandLayer = { kind: 'strands', layerId: id, clipId: id, opacity: 1, blendMode: 'normal', sourceWidth: 100, sourceHeight: 100,
        worldMatrix: identity, strands: { clipId: id, effectId: 'fx', program: p } };
      for (let attempt = 0; attempt < 4; attempt++) {
        const finish = collectTemporalPreparations(), result = cache.prepare(device, layer, temporary), pending = finish();
        if (!pending.length) { assert(result?.fields && !result.fields.failed, 'CPU fallback instead of GPU contact'); return result!; }
        await Promise.all(pending);
      }
      throw new Error('Frame preparation never settled');
    };
    try {
      const first = await settle(program(1), 'one'), before = await read(first.positions, 34);
      const other = await settle(program(.25), 'two'); assert(first.fields !== other.fields, 'Layers share mutable scratch');
      assert((await read(first.positions, 34)).every((x, i) => x === before[i]), 'Another layer overwrote geometry');
      const changed = await settle(program(.5), 'one'); assert(changed.signature === JSON.stringify(program(.5).stages), 'Stale export frame');
      const repeat = await settle(program(1), 'one'); assert((await read(repeat.positions, 34)).every((x, i) => Math.abs(x - before[i]) < 1e-6), 'Seek depends on previous state');
      results.integration = { gpu: true, exactFrameBarrier: true, layersIsolated: true, deterministicSeek: true };
      const source = new URLSearchParams(location.search).get('program');
      if (source) {
        const programs: GeometryProgram[] = await (await fetch(source)).json(); const timings: number[] = [], outputs: unknown[] = [];
        for (const p of programs) {
          const start = performance.now(), prepared = await settle(p, 'authored');
          timings.push(performance.now() - start); outputs.push(Array.from(await read(prepared.positions, p.pointCount)));
        }
        results.authored = { milliseconds: timings, points: programs.map(p => p.pointCount), outputs };
      }
    } finally { cache.dispose(); temporary.forEach(b => b.destroy()); }
    await device.queue.onSubmittedWorkDone(); assert(!errors.length, errors.join('\n'));
    return { success: true, ...results, errors };
  } finally { owned.forEach(b => b.destroy()); device.destroy(); }
}
const result = await check().catch(error => ({ success: false, error: String(error), stack: error.stack }));
document.querySelector('#result')!.textContent = JSON.stringify(result, (key, value) => key === 'outputs' ? '[geometry stored in report]' : value, 2);
const report = new URLSearchParams(location.search).get('report');
if (report) await fetch(report, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ check: 'curve-contact', ...result }) });
