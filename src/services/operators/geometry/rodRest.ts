import type { CurveSet } from './geometryEvaluation';
import { ROD_CURVE_LIMIT, ROD_NODE_LIMIT } from './rodOperators';

/**
 * Rods built from curves, one per curve: rest node positions, node ranges, rings, pins and pull
 * directions, plus where each curve point sits on its rod so the result keeps the input points.
 * The rods begin at `start` (the rest positions, or straight threads) and each node is drawn onto
 * its rest position from its `form` time on (Infinity: never); pinned nodes begin their pull at
 * their `pullStart` time.
 */
export interface RodRest {
  positions: Float64Array;
  start: Float64Array; form: Float64Array; pullStart: Float64Array;
  starts: Uint32Array; counts: Uint32Array; closed: Uint8Array;
  pinned: Uint8Array;
  /** Original curve parameter at each material node, retained through arc-length resampling. */
  material: Float64Array;
  /** Per node: unit pull direction, or zero. Free nodes and rings without a direction field stay zero. */
  pull: Float64Array;
  /** Per curve point: rod node and fraction toward the next node, and its offset from the rest rod curve. */
  pointNode: Uint32Array; pointFraction: Float64Array; detail: Float64Array;
}

/** A curve whose last point repeats its first is a ring (knots, Celtic loops). */
const RING_TOLERANCE = 1e-5;
const PIN_NONE = 0, PIN_START = 1;

interface Polyline { start: number; count: number; closed: boolean; length: number; arcs: Float64Array }

function polyline(points: Float32Array, start: number, count: number): Polyline {
  const arcs = new Float64Array(Math.max(1, count));
  for (let index = 1; index < count; index++) {
    const a = (start + index - 1) * 3, b = (start + index) * 3;
    arcs[index] = arcs[index - 1] + Math.hypot(points[b] - points[a], points[b + 1] - points[a + 1], points[b + 2] - points[a + 2]);
  }
  const length = count > 1 ? arcs[count - 1] : 0;
  const first = start * 3, last = (start + count - 1) * 3;
  const gap = count > 3 ? Math.hypot(points[last] - points[first], points[last + 1] - points[first + 1], points[last + 2] - points[first + 2]) : Infinity;
  return { start, count, closed: length > 0 && gap <= RING_TOLERANCE * length, length, arcs };
}

/** Rod nodes of one curve: its points, or evenly spaced along it when coarsened to `segment`. */
const nodeCount = (line: Polyline, segment: number) => {
  const points = line.closed ? line.count - 1 : line.count;
  if (segment <= 0 || line.length <= 0) return points;
  return line.closed ? Math.max(3, Math.round(line.length / segment)) : Math.max(1, Math.round(line.length / segment)) + 1;
};

/** Uniform Catmull-Rom on a rod's nodes; open rods repeat their end nodes, rings wrap. */
export function rodCurvePoint(nodes: Float64Array, start: number, count: number, closed: boolean, node: number, fraction: number, out: number[]) {
  const at = (index: number) => start + (closed ? (index + count) % count : Math.max(0, Math.min(count - 1, index)));
  const p0 = at(node - 1) * 3, p1 = at(node) * 3, p2 = at(node + 1) * 3, p3 = at(node + 2) * 3;
  const t = fraction, t2 = t * t, t3 = t2 * t;
  for (let axis = 0; axis < 3; axis++) {
    const a = nodes[p0 + axis], b = nodes[p1 + axis], c = nodes[p2 + axis], d = nodes[p3 + axis];
    out[axis] = 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (3 * (b - c) + d - a) * t3);
  }
}

/** Fixed fields over the rest curves: pins, form/pull times and optional pull directions; open rods can start straight. */
export interface RodRestOptions {
  pinValue?: (index: number) => number; formValue?: (index: number) => number; pullStartValue?: (index: number) => number; straight?: boolean;
  pullDirectionValue?: (index: number) => readonly number[];
}

/** A per-point time at a rod node a fraction `f` from point a to b; Infinity (never) is not blended. */
const blendTime = (a: number, b: number, f: number) => Number.isFinite(a) && Number.isFinite(b) ? a + (b - a) * f : f < 0.5 ? a : b;

/**
 * Builds the rods. `segment` 0 uses the curve points as nodes; coarser rods (and any input above
 * ROD_NODE_LIMIT nodes) are resampled evenly by arc length. Pins hold curve starts or ends of open
 * curves and the nodes nearest to points whose `pinValue` exceeds 0.5. Form and pull start times
 * and explicit pull vectors are interpolated along the curve. Directions are then normalized only for
 * pinned nodes, including field-selected pins on rings; zero directions stay stationary.
 * A straight start lays each open rod along its chord through its centroid, keeping
 * every segment length, so it is a thread of the same length that can be formed into the curve.
 */
export function buildRodRest(curves: CurveSet, segment: number, pin: number, options: RodRestOptions = {}): RodRest {
  const { pinValue, formValue, pullStartValue, pullDirectionValue } = options;
  const formAt = (point: number) => { const value = formValue ? formValue(point) : Infinity; return Number.isFinite(value) ? value : Infinity; };
  const pullAt = (point: number) => { const value = pullStartValue ? pullStartValue(point) : 0; return Number.isFinite(value) ? value : 0; };
  const { positions: points, starts, counts } = curves;
  const lines = Array.from(counts, (count, strand) => polyline(points, starts[strand], count));
  if (lines.length > ROD_CURVE_LIMIT) throw new Error(`Rod Simulation supports up to ${ROD_CURVE_LIMIT.toLocaleString('en-US')} curves.`);
  const total = () => lines.reduce((sum, line) => sum + nodeCount(line, segment), 0);
  const length = lines.reduce((sum, line) => sum + line.length, 0);
  for (let attempt = 0, nodes = total(); nodes > ROD_NODE_LIMIT; nodes = total(), attempt++) {
    if (attempt >= 64 || !(length > 0)) throw new Error(`Rod Simulation supports up to ${ROD_NODE_LIMIT.toLocaleString('en-US')} rod nodes.`);
    segment = Math.max(segment, length / ROD_NODE_LIMIT) * (nodes / ROD_NODE_LIMIT) * 1.02;
  }
  const rodStarts = new Uint32Array(lines.length), rodCounts = new Uint32Array(lines.length), closed = new Uint8Array(lines.length);
  lines.forEach((line, rod) => {
    rodCounts[rod] = nodeCount(line, segment); closed[rod] = line.closed ? 1 : 0;
    rodStarts[rod] = rod ? rodStarts[rod - 1] + rodCounts[rod - 1] : 0;
  });
  const nodeTotal = total(), pointTotal = points.length / 3;
  const rest: RodRest = { positions: new Float64Array(nodeTotal * 3), start: new Float64Array(nodeTotal * 3), form: new Float64Array(nodeTotal),
    pullStart: new Float64Array(nodeTotal),
    starts: rodStarts, counts: rodCounts, closed,
    pinned: new Uint8Array(nodeTotal), material: new Float64Array(nodeTotal), pull: new Float64Array(nodeTotal * 3),
    pointNode: new Uint32Array(pointTotal), pointFraction: new Float64Array(pointTotal), detail: new Float64Array(pointTotal * 3) };
  const sample = [0, 0, 0];
  lines.forEach((line, rod) => {
    const start = rodStarts[rod], count = rodCounts[rod], ring = line.closed;
    const resampled = segment > 0 && line.length > 0, intervals = ring ? count : count - 1;
    // Rest nodes: the curve points, or points at even arc length along the polyline.
    for (let node = 0, cursor = 0; node < count; node++) {
      if (!resampled) {
        rest.material[start + node] = node / Math.max(1, line.count - 1);
        for (let axis = 0; axis < 3; axis++) rest.positions[(start + node) * 3 + axis] = points[(line.start + node) * 3 + axis];
        rest.form[start + node] = formAt(line.start + node); rest.pullStart[start + node] = pullAt(line.start + node);
        continue;
      }
      const arc = intervals > 0 ? node / intervals * line.length : 0;
      while (cursor < line.count - 2 && line.arcs[cursor + 1] < arc) cursor++;
      const span = line.arcs[cursor + 1] - line.arcs[cursor], f = span > 0 ? Math.min(1, Math.max(0, (arc - line.arcs[cursor]) / span)) : 0;
      const a = (line.start + cursor) * 3, b = a + 3;
      rest.material[start + node] = (cursor + f) / Math.max(1, line.count - 1);
      for (let axis = 0; axis < 3; axis++) rest.positions[(start + node) * 3 + axis] = points[a + axis] + (points[b + axis] - points[a + axis]) * f;
      const next = line.start + Math.min(line.count - 1, cursor + 1);
      rest.form[start + node] = blendTime(formAt(line.start + cursor), formAt(next), f);
      rest.pullStart[start + node] = blendTime(pullAt(line.start + cursor), pullAt(next), f);
    }
    layStart(rest, start, count, ring || !options.straight);
    // Every curve point keeps its place on the rod and its offset from the rest rod curve.
    for (let index = 0; index < line.count; index++) {
      const point = line.start + index;
      let node = index, fraction = 0;
      if (ring && index === line.count - 1) node = 0;
      else if (resampled && count > 1) {
        const t = line.arcs[index] / line.length * intervals;
        node = Math.min(intervals - 1, Math.floor(t)); fraction = Math.min(1, t - node);
      } else if (count === 1) node = 0;
      rest.pointNode[point] = node; rest.pointFraction[point] = fraction;
      rodCurvePoint(rest.positions, start, count, ring, node, fraction, sample);
      for (let axis = 0; axis < 3; axis++) rest.detail[point * 3 + axis] = points[point * 3 + axis] - sample[axis];
      if (pinValue && pinValue(point) > 0.5) rest.pinned[start + ((node + (fraction >= 0.5 ? 1 : 0)) % count)] = 1;
    }
    if (count < 1) return;
    if (!ring) {
      if (pin !== PIN_NONE) rest.pinned[start] = 1;
      if (pin > PIN_START) rest.pinned[start + count - 1] = 1;
    }
    if (pullDirectionValue) {
      for (let node = 0; node < count; node++) {
        if (!rest.pinned[start + node]) continue;
        const at = rest.material[start + node] * Math.max(1, line.count - 1), index = Math.floor(at), fraction = at - index;
        const a = pullDirectionValue(line.start + index);
        const b = pullDirectionValue(line.start + Math.min(index + 1, line.count - 1));
        if (a.length !== 3 || b.length !== 3 || !a.every(Number.isFinite) || !b.every(Number.isFinite)) {
          throw new Error('Rod Pull Direction needs finite Vector 3 values.');
        }
        const direction = a.map((value, axis) => value * (1 - fraction) + b[axis] * fraction);
        const scale = Math.max(...direction.map(Math.abs));
        if (!scale) continue;
        // Scale first so even very large finite input vectors normalize without overflowing.
        const normalized = direction.map(value => value / scale), size = Math.hypot(...normalized);
        rest.pull.set(normalized.map(value => value / size), (start + node) * 3);
      }
      return;
    }
    if (ring || count < 2) return;
    // Pinned nodes are pulled outward along the tangent of their nearer end.
    const outward = (from: number, to: number) => {
      const a = (start + from) * 3, b = (start + to) * 3;
      const dx = rest.positions[a] - rest.positions[b], dy = rest.positions[a + 1] - rest.positions[b + 1], dz = rest.positions[a + 2] - rest.positions[b + 2];
      const size = Math.hypot(dx, dy, dz) || 1;
      return [dx / size, dy / size, dz / size];
    };
    const head = outward(0, 1), tail = outward(count - 1, count - 2);
    for (let node = 0; node < count; node++) {
      if (!rest.pinned[start + node]) continue;
      rest.pull.set(node <= (count - 1) / 2 ? head : tail, (start + node) * 3);
    }
  });
  return rest;
}

/** Start nodes of one rod: its rest nodes, or (open rods) a straight thread along its chord through its centroid. */
function layStart(rest: RodRest, start: number, count: number, keep: boolean) {
  const from = start * 3, to = (start + count) * 3, nodes = rest.positions;
  rest.start.set(nodes.subarray(from, to), from);
  if (keep || count < 2) return;
  const last = to - 3, centroid = [0, 0, 0];
  let dx = nodes[last] - nodes[from], dy = nodes[last + 1] - nodes[from + 1], dz = nodes[last + 2] - nodes[from + 2];
  const chord = Math.hypot(dx, dy, dz);
  if (chord > 1e-9) { dx /= chord; dy /= chord; dz /= chord; } else { dx = 1; dy = 0; dz = 0; }
  for (let index = from; index < to; index += 3) for (let axis = 0; axis < 3; axis++) centroid[axis] += nodes[index + axis] / count;
  const arcs = new Float64Array(count);
  for (let node = 1; node < count; node++) {
    const a = from + (node - 1) * 3, b = a + 3;
    arcs[node] = arcs[node - 1] + Math.hypot(nodes[b] - nodes[a], nodes[b + 1] - nodes[a + 1], nodes[b + 2] - nodes[a + 2]);
  }
  for (let node = 0; node < count; node++) {
    const along = arcs[node] - arcs[count - 1] / 2, at = from + node * 3;
    rest.start[at] = centroid[0] + dx * along; rest.start[at + 1] = centroid[1] + dy * along; rest.start[at + 2] = centroid[2] + dz * along;
  }
}

/** Curve positions from simulated rod nodes: each point follows its place on the rod plus its detail. */
export function rodCurvePositions(rest: RodRest, nodes: Float64Array, curves: CurveSet, capsuleLine = false): Float32Array {
  const out = new Float32Array(curves.positions.length), sample = [0, 0, 0];
  for (let rod = 0; rod < curves.counts.length; rod++) {
    const start = rest.starts[rod], count = rest.counts[rod], ring = rest.closed[rod] === 1;
    for (let point = curves.starts[rod], end = point + curves.counts[rod]; point < end; point++) {
      if (!count) continue;
      rodCurvePoint(nodes, start, count, ring, rest.pointNode[point], rest.pointFraction[point], sample);
      for (let axis = 0; axis < 3; axis++) out[point * 3 + axis] = sample[axis] + rest.detail[point * 3 + axis];
      if (capsuleLine) {
        const k = rest.pointNode[point], next = ring ? (k + 1) % count : Math.min(k + 1, count - 1);
        const t = rest.pointFraction[point];
        for (let axis = 0; axis < 3; axis++) {
          out[point * 3 + axis] = nodes[(start+k)*3+axis]*(1-t) + nodes[(start+next)*3+axis]*t;
        }
      }
    }
  }
  return out;
}
