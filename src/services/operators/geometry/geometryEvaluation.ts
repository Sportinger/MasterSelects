import { pointwiseOperation, type PointwiseValue } from '../fields/pointwiseOperations';
import { weavePatternPointCount, type GeometryField, type GeometryProgram, type GeometryStage } from './geometryProgram';
import { warpOver } from './weaveOperators';
import { bindToCloth, clothGridAt } from './clothSurface';

/**
 * Polylines as flat XYZ positions; strand `i` owns points `starts[i]` … `starts[i] + counts[i] - 1`.
 * `radius` is an optional per-point yarn radius scale written by Yarn Profile (absent means 1).
 */
export interface CurveSet { positions: Float32Array; starts: Uint32Array; counts: Uint32Array; radius?: Float32Array }
interface CurvePointContext { position: [number, number, number]; u: number; point: number; strand: number; points: number; strands: number }

/** Evaluates one field for one point. This is the CPU reference of the GPU curve kernels. */
export function evaluateGeometryField(field: GeometryField, context: CurvePointContext): PointwiseValue {
  const values: PointwiseValue[] = [];
  for (const item of field.instructions) {
    const args = item.inputs.map(input => values[input]);
    switch (item.operation) {
      case 'constant': values.push(item.value ?? 0); break;
      case 'position': values.push(context.position); break;
      case 'curve-u': values.push(context.u); break;
      case 'point-index': values.push(context.point); break;
      case 'strand-index': values.push(context.strand); break;
      case 'point-count': values.push(context.points); break;
      case 'strand-count': values.push(context.strands); break;
      default: {
        const operation = pointwiseOperation(item.operation);
        if (!operation) throw new Error(`Unsupported curve field operation: ${item.operation}`);
        values.push(operation.evaluate(args, item.value));
      }
    }
  }
  return values[field.output];
}

/** Cosine crimp between crossings at t = k + 0.5; ends hold their outer crossing height. */
function crimpHeight(t: number, crossings: number, lift: (crossing: number) => number): number {
  const c = t - 0.5;
  if (c <= 0) return lift(0);
  if (c >= crossings - 1) return lift(crossings - 1);
  const k = Math.floor(c), f = c - k, a = lift(k);
  return a + (lift(k + 1) - a) * (0.5 - 0.5 * Math.cos(Math.PI * f));
}

/** Warps run vertically (index across X), wefts horizontally; the draft decides which lies in front (+Z). */
function weavePattern(stage: Extract<GeometryStage, { kind: 'weave-pattern' }>): CurveSet {
  const { warps, wefts, width, height, crimp, resolution, pattern } = stage;
  const positions = new Float32Array(weavePatternPointCount(stage) * 3);
  const starts = new Uint32Array(warps + wefts), counts = new Uint32Array(warps + wefts);
  let cursor = 0;
  const thread = (strand: number, crossings: number, place: (t: number) => [number, number, number]) => {
    starts[strand] = cursor; counts[strand] = crossings * resolution + 1;
    for (let point = 0; point < counts[strand]; point++, cursor++) positions.set(place(point / resolution), cursor * 3);
  };
  for (let i = 0; i < warps; i++) {
    const x = ((i + 0.5) / warps - 0.5) * width;
    thread(i, wefts, t => [x, (t / wefts - 0.5) * height, crimpHeight(t, wefts, j => warpOver(pattern, i, j) ? crimp : -crimp)]);
  }
  for (let j = 0; j < wefts; j++) {
    const y = ((j + 0.5) / wefts - 0.5) * height;
    thread(warps + j, warps, t => [(t / warps - 0.5) * width, y, crimpHeight(t, warps, i => warpOver(pattern, i, j) ? -crimp : crimp)]);
  }
  return { positions, starts, counts };
}

function forEachPoint(curves: CurveSet, visit: (index: number, context: CurvePointContext) => void) {
  const { positions, starts, counts } = curves;
  for (let strand = 0; strand < counts.length; strand++) {
    const points = counts[strand];
    for (let point = 0; point < points; point++) {
      const index = starts[strand] + point, base = index * 3;
      visit(index, { position: [positions[base], positions[base + 1], positions[base + 2]],
        u: points > 1 ? point / (points - 1) : 0, point, strand, points, strands: counts.length });
    }
  }
}

/** Curves before the first Surface Bind do not change with time; results are kept per stage content. */
const PREFIX_LIMIT = 4;
const prefixes = new Map<string, CurveSet>();

/**
 * Runs the curve stages on the CPU. Modifiers read Position and fields on the incoming points.
 * With cloth, only the Surface Bind and later stages are evaluated again for a new frame.
 */
export function evaluateGeometryProgram(program: GeometryProgram): CurveSet {
  const split = program.stages.findIndex(stage => stage.kind === 'surface-bind');
  if (split <= 0) return evaluateStages(program.stages);
  const key = JSON.stringify(program.stages.slice(0, split));
  let prefix = prefixes.get(key);
  if (prefix) prefixes.delete(key);
  else prefix = evaluateStages(program.stages.slice(0, split));
  prefixes.set(key, prefix);
  while (prefixes.size > PREFIX_LIMIT) prefixes.delete(prefixes.keys().next().value!);
  return evaluateStages(program.stages.slice(split), prefix);
}

/** Stages never modify their input curves, so a cached prefix can be shared. */
function evaluateStages(stages: readonly GeometryStage[], initial?: CurveSet): CurveSet {
  let curves: CurveSet = initial ?? { positions: new Float32Array(0), starts: new Uint32Array(0), counts: new Uint32Array(0) };
  for (const stage of stages) {
    if (stage.kind === 'curve-line') {
      const positions = new Float32Array(stage.points * 3);
      for (let index = 0; index < stage.points; index++) positions[index * 3 + stage.axis] = (index / (stage.points - 1) - 0.5) * stage.length;
      curves = { positions, starts: Uint32Array.of(0), counts: Uint32Array.of(stage.points) };
    } else if (stage.kind === 'weave-pattern') {
      curves = weavePattern(stage);
    } else if (stage.kind === 'strand-array') {
      const { positions, starts, counts, radius } = curves;
      const pointTotal = positions.length / 3, strandTotal = counts.length;
      const next: CurveSet = { positions: new Float32Array(positions.length * stage.count),
        starts: new Uint32Array(strandTotal * stage.count), counts: new Uint32Array(strandTotal * stage.count),
        ...(radius ? { radius: new Float32Array(radius.length * stage.count) } : {}) };
      for (let copy = 0; copy < stage.count; copy++) {
        const shift = (copy - (stage.count - 1) / 2) * stage.spacing;
        next.positions.set(positions, copy * positions.length);
        if (radius) next.radius!.set(radius, copy * radius.length);
        for (let point = 0; point < pointTotal; point++) next.positions[(copy * pointTotal + point) * 3 + stage.axis] += shift;
        for (let strand = 0; strand < strandTotal; strand++) {
          next.starts[copy * strandTotal + strand] = copy * pointTotal + starts[strand];
          next.counts[copy * strandTotal + strand] = counts[strand];
        }
      }
      curves = next;
    } else if (stage.kind === 'set-position') {
      const next = new Float32Array(curves.positions.length);
      forEachPoint(curves, (index, context) => {
        const target = stage.position ? evaluateGeometryField(stage.position, context) as number[] : context.position;
        const offset = stage.offset ? evaluateGeometryField(stage.offset, context) as number[] : undefined;
        for (let component = 0; component < 3; component++) next[index * 3 + component] = target[component] + (offset?.[component] ?? 0);
      });
      curves = { ...curves, positions: next };
    } else if (stage.kind === 'surface-bind') {
      curves = { ...curves, positions: bindToCloth(curves.positions, clothGridAt(stage.cloth, stage.time), stage.height) };
    } else if (stage.radius) {
      const field = stage.radius, radius = new Float32Array(curves.positions.length / 3);
      forEachPoint(curves, (index, context) => { radius[index] = Math.max(0, Number(evaluateGeometryField(field, context))); });
      curves = { ...curves, radius };
    }
  }
  return curves;
}
