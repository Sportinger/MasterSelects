import { pointwiseOperation, type PointwiseValue } from '../fields/pointwiseOperations';
import type { GeometryField } from './geometryProgram';
import type { CurveSet } from './geometryEvaluation';

/** A field's values for every point of a curve set, or one value every point shares. */
type Column = { shared: true; value: PointwiseValue } | { shared: false; values: PointwiseValue[] };
/** Per-point inputs, indexed like the curve positions. */
interface PointInputs { position: number[][]; u: number[]; point: number[]; strand: number[]; points: number[] }

/** Per-point columns kept per input curve set; animated graphs usually change only a few cheap expressions. */
const COLUMN_LIMIT = 32;
const columns = new WeakMap<CurveSet, Map<number, Column>>();
/**
 * Sub-expression identities: an instruction's key names its operation and its inputs' ids, so
 * keys stay short however deep the graph. Ids are never reused; a forgotten key only misses.
 */
const INTERN_LIMIT = 4096;
const interned = new Map<string, number>();
let nextId = 0;
function intern(key: string): number {
  let id = interned.get(key);
  if (id === undefined) id = nextId++;
  else interned.delete(key);
  interned.set(key, id);
  while (interned.size > INTERN_LIMIT) interned.delete(interned.keys().next().value!);
  return id;
}
const inputs = new WeakMap<CurveSet, PointInputs>();

function pointInputs(curves: CurveSet): PointInputs {
  let cached = inputs.get(curves);
  if (cached) return cached;
  const { positions, starts, counts } = curves, total = positions.length / 3;
  cached = { position: new Array(total), u: new Array(total).fill(0), point: new Array(total).fill(0),
    strand: new Array(total).fill(0), points: new Array(total).fill(0) };
  for (let strand = 0; strand < counts.length; strand++) {
    const points = counts[strand];
    for (let point = 0; point < points; point++) {
      const index = starts[strand] + point, base = index * 3;
      cached.position[index] = [positions[base], positions[base + 1], positions[base + 2]];
      cached.u[index] = points > 1 ? point / (points - 1) : 0;
      cached.point[index] = point; cached.strand[index] = strand; cached.points[index] = points;
    }
  }
  inputs.set(curves, cached);
  return cached;
}

/**
 * Evaluates a field for every point, one instruction at a time. Instructions that read no point
 * input are evaluated once. Point columns are reused while both the input curves and the
 * instruction's whole sub-expression are unchanged, so an animated constant recomputes only the
 * instructions that depend on it. Results equal a per-point evaluation in instruction order.
 */
export function evaluateFieldColumn(field: GeometryField, curves: CurveSet): (index: number) => PointwiseValue {
  let cache = columns.get(curves);
  if (!cache) { cache = new Map(); columns.set(curves, cache); }
  const keys: number[] = [], results: Column[] = [];
  for (const item of field.instructions) {
    const key = intern(`${item.operation}:${item.type}:${item.value ?? ''}(${item.inputs.map(input => keys[input]).join(',')})`);
    keys.push(key);
    const args = item.inputs.map(input => results[input]);
    let column = cache.get(key);
    if (column) { cache.delete(key); cache.set(key, column); results.push(column); continue; }
    column = evaluateInstruction(item.operation, item.value, args, curves);
    if (!column.shared) {
      cache.set(key, column);
      while (cache.size > COLUMN_LIMIT) cache.delete(cache.keys().next().value!);
    }
    results.push(column);
  }
  const output = results[field.output];
  return output.shared ? () => output.value : index => output.values[index];
}

function evaluateInstruction(operation: string, value: number | undefined, args: Column[], curves: CurveSet): Column {
  switch (operation) {
    case 'constant': return { shared: true, value: value ?? 0 };
    case 'strand-count': return { shared: true, value: curves.counts.length };
    case 'position': return { shared: false, values: pointInputs(curves).position };
    case 'curve-u': return { shared: false, values: pointInputs(curves).u };
    case 'point-index': return { shared: false, values: pointInputs(curves).point };
    case 'strand-index': return { shared: false, values: pointInputs(curves).strand };
    case 'point-count': return { shared: false, values: pointInputs(curves).points };
  }
  const definition = pointwiseOperation(operation);
  if (!definition) throw new Error(`Unsupported curve field operation: ${operation}`);
  if (args.every(arg => arg.shared)) {
    return { shared: true, value: definition.evaluate(args.map(arg => (arg as Extract<Column, { shared: true }>).value), value) };
  }
  const { starts, counts } = curves, values: PointwiseValue[] = new Array(curves.positions.length / 3);
  for (let strand = 0; strand < counts.length; strand++) {
    for (let index = starts[strand], end = index + counts[strand]; index < end; index++) {
      // A fresh argument list per point: some operations return it as their vector value.
      values[index] = definition.evaluate(args.map(arg => arg.shared ? arg.value : arg.values[index]), value);
    }
  }
  return { shared: false, values };
}
