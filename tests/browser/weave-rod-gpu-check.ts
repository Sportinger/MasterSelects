import { RodGpuSimulation } from '../../src/engine/native3d/rods/RodGpuSimulation';
import { knotCurves, KNOT_SHAPES } from '../../src/services/operators/geometry/knotCurves';
import { buildRodRest, type RodRest } from '../../src/services/operators/geometry/rodRest';
import { RodSimulation } from '../../src/services/operators/geometry/rodSolver';
import type { RodSpec } from '../../src/services/operators/geometry/rodProgram';
import type { CurveSet } from '../../src/services/operators/geometry/geometryEvaluation';

/**
 * GPU rod solver against the CPU reference (same scheme, f32 against f64), determinism of the GPU
 * state across scrubbing, contact separation on the GPU, and the GPU cost per step.
 */
const RADIUS = 0.03;
const spec = (extra: Partial<RodSpec> = {}): RodSpec => ({ nodeId: 'rod', radius: RADIUS, segmentLength: 0, stretch: 0.9, bend: 0.5,
  friction: 0.3, damping: 0.5, substeps: 16, preroll: 0, pin: 2, pull: 0, pullTime: 2, floor: false, floorHeight: 0,
  gravity: 0, drag: 0, winds: [], turbulence: [], ...extra });

function threads(count: number, points = 61, length = 1.6): CurveSet {
  const positions = new Float32Array(count * points * 3);
  for (let strand = 0; strand < count; strand++) {
    const angle = strand * 2.399, height = 0.1 + strand * 0.08;
    for (let k = 0; k < points; k++) {
      const t = k / (points - 1) - 0.5;
      positions.set([Math.cos(angle) * t * length + 0.05 * Math.sin(strand), height, Math.sin(angle) * t * length], (strand * points + k) * 3);
    }
  }
  return { positions, starts: Uint32Array.from({ length: count }, (_, s) => s * points), counts: Uint32Array.from({ length: count }, () => points) };
}

/** Largest and mean distance between GPU (xyzw, f32) and CPU (xyz, f64) node positions. */
function compare(gpu: Float32Array, cpu: Float64Array) {
  let max = 0, sum = 0;
  const count = cpu.length / 3;
  for (let node = 0; node < count; node++) {
    const d = Math.hypot(gpu[node * 4] - cpu[node * 3], gpu[node * 4 + 1] - cpu[node * 3 + 1], gpu[node * 4 + 2] - cpu[node * 3 + 2]);
    max = Math.max(max, d); sum += d;
  }
  return { max: +max.toExponential(2), mean: +(sum / count).toExponential(2) };
}

/** Smallest distance between segments that are not neighbours along one rod (the contact rule). */
function closestApproach(rest: RodRest, nodes: Float32Array) {
  const at = (node: number) => [nodes[node * 4], nodes[node * 4 + 1], nodes[node * 4 + 2]];
  const segments: Array<{ a: number; b: number; rod: number; arc: number; length: number; total: number; ring: boolean }> = [];
  for (let rod = 0; rod < rest.counts.length; rod++) {
    const start = rest.starts[rod], count = rest.counts[rod], ring = rest.closed[rod] === 1, links = ring ? count : count - 1;
    const local: typeof segments = [];
    let arc = 0;
    for (let k = 0; k < links; k++) {
      const a = start + k, b = start + (k + 1) % count;
      const length = Math.hypot(...[0, 1, 2].map(axis => rest.positions[b * 3 + axis] - rest.positions[a * 3 + axis]));
      local.push({ a, b, rod, arc: arc + length / 2, length, total: 0, ring }); arc += length;
    }
    local.forEach(item => { item.total = arc; });
    segments.push(...local);
  }
  const distance = (a0: number[], a1: number[], b0: number[], b1: number[]) => {
    const d1 = a1.map((v, i) => v - a0[i]), d2 = b1.map((v, i) => v - b0[i]), r = a0.map((v, i) => v - b0[i]);
    const dot = (x: number[], y: number[]) => x[0] * y[0] + x[1] * y[1] + x[2] * y[2], clamp = (v: number) => Math.min(1, Math.max(0, v));
    const a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r), c = dot(d1, r), b = dot(d1, d2), den = a * e - b * b;
    let s = den > 0 ? clamp((b * f - c * e) / den) : 0, t = (b * s + f) / e;
    if (t < 0) { t = 0; s = clamp(-c / a); } else if (t > 1) { t = 1; s = clamp((b - c) / a); }
    return Math.hypot(...[0, 1, 2].map(i => r[i] + d1[i] * s - d2[i] * t));
  };
  let closest = Infinity;
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const c = segments[i], d = segments[j];
      if (c.rod === d.rod) {
        let gap = Math.abs(c.arc - d.arc);
        if (c.ring) gap = Math.min(gap, c.total - gap);
        if (gap - (c.length + d.length) / 2 < 2.2 * RADIUS) continue;
      }
      closest = Math.min(closest, distance(at(c.a), at(c.b), at(d.a), at(d.b)));
    }
  }
  return closest;
}

async function check() {
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('No WebGPU adapter');
  const device = await adapter.requestDevice();
  const errors: string[] = [];
  device.addEventListener('uncapturederror', event => errors.push(event.error.message));
  const results: Record<string, unknown> = {};
  const failures: string[] = [];
  const reef = knotCurves({ shape: KNOT_SHAPES.indexOf('reef'), p: 2, q: 3, size: 0.6, depth: 0.12, points: 720 });
  const cases: Array<[string, CurveSet, Partial<RodSpec>, number]> = [
    ['reefKnot', reef, { pull: 0.3 }, 2],
    ['fallingThreads', threads(4), { pin: 0, floor: true, gravity: 9.8, friction: 0.6, winds: [{ direction: [1, 0, 0], strength: 0.4, gust: 0.3 }],
      turbulence: [{ strength: 0.2, frequency: 2 }] }, 0],
  ];
  for (const [name, curves, extra, pin] of cases) {
    const rodSpec = spec({ ...extra, pin });
    const rest = buildRodRest(curves, RADIUS, pin);
    const cpu = new RodSimulation(rodSpec, rest), gpu = new RodGpuSimulation(device, rodSpec, rest, curves, `check-${name}`);
    const steps: Record<string, unknown> = {};
    let closest = Infinity;
    for (const step of [1, 10, 60, 120, 180]) {
      gpu.prepare(step, 0);
      const nodes = await gpu.readNodes();
      steps[step] = compare(nodes, cpu.positionsAt(step));
      // The generated rest shape may overlap slightly where the ropes pass close; the first steps separate it.
      if (step >= 10) closest = Math.min(closest, closestApproach(rest, nodes));
    }
    const atEnd = await gpu.readNodes();
    gpu.prepare(30, 0); gpu.prepare(180, 0);
    const scrubbed = await gpu.readNodes();
    const fresh = new RodGpuSimulation(device, rodSpec, rest, curves, `check-${name}-fresh`);
    fresh.prepare(180, 0);
    const replayed = await fresh.readNodes();
    const identical = (a: Float32Array, b: Float32Array) => a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
    results[name] = { nodes: rest.positions.length / 3, gpuAgainstCpu: steps, closestApproach: +closest.toFixed(4),
      scrubIdentical: identical(atEnd, scrubbed), freshIdentical: identical(atEnd, replayed) };
    if (!identical(atEnd, scrubbed) || !identical(atEnd, replayed)) failures.push(`${name}: GPU state differs after scrubbing or replay`);
    if (closest < 0.9 * 2 * RADIUS) failures.push(`${name}: segments approach to ${closest}`);
    const retired: GPUBuffer[] = [];
    gpu.retire(retired); fresh.retire(retired);
    await device.queue.onSubmittedWorkDone();
    retired.forEach(buffer => buffer.destroy());
  }
  // GPU cost per step (16 substeps) against the CPU solver.
  const timings: Record<string, unknown> = {};
  for (const [label, curves, extra, pin, steps] of [
    ['reefKnot', reef, { pull: 0.3 }, 2, 60],
    ['16 threads', threads(16, 200), { pin: 0, floor: true, gravity: 9.8 }, 0, 60],
    ['64 threads', threads(64, 200), { pin: 0, floor: true, gravity: 9.8 }, 0, 60],
    ['256 threads', threads(256, 120, 3.2), { pin: 0, floor: true, gravity: 9.8 }, 0, 30],
  ] as Array<[string, CurveSet, Partial<RodSpec>, number, number]>) {
    const rodSpec = spec({ ...extra, pin }), rest = buildRodRest(curves, RADIUS, pin);
    const gpu = new RodGpuSimulation(device, rodSpec, rest, curves, `time-${label}`);
    gpu.prepare(1, 0); await gpu.readNodes();
    let start = performance.now();
    gpu.prepare(1 + steps, 0); await gpu.readNodes();
    const gpuMs = (performance.now() - start) / steps;
    let cpuMs: number | null = null;
    if (rest.positions.length / 3 <= 4000) {
      const cpu = new RodSimulation(rodSpec, rest);
      cpu.positionsAt(1);
      start = performance.now();
      cpu.positionsAt(1 + Math.min(steps, 20));
      cpuMs = (performance.now() - start) / Math.min(steps, 20);
    }
    timings[label] = { nodes: rest.positions.length / 3, gpuMsPerStep: +gpuMs.toFixed(2), cpuMsPerStep: cpuMs === null ? null : +cpuMs.toFixed(2) };
    const retired: GPUBuffer[] = [];
    gpu.retire(retired);
    await device.queue.onSubmittedWorkDone();
    retired.forEach(buffer => buffer.destroy());
  }
  results.timings = timings;
  device.destroy();
  if (errors.length) failures.push(...errors);
  return { pass: failures.length === 0, failures, ...results };
}

check().then(result => { document.querySelector('#result')!.textContent = JSON.stringify(result, null, 2); })
  .catch(error => { document.querySelector('#result')!.textContent = `FAIL: ${error.stack ?? error}`; });
