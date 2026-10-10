import { pointwiseOperation, type PointwiseValue, type PointwiseValueType } from '../fields/pointwiseOperations';
import type { GeometryField } from './geometryProgram';
import type { CurveSet } from './geometryEvaluation';

/** A field is either uniform or packed point-major. Doubles preserve the CPU reference precision. */
type PointColumn = { shared: false; values: Float64Array | Float32Array; width: number; boolean: boolean };
type Column = { shared: true; value: PointwiseValue } | PointColumn;
const widthOf = (type: PointwiseValueType) => type === 'vec2' ? 2 : type === 'vec3' || type === 'rgb' ? 3
  : type === 'vec4' || type === 'image' ? 4 : 1;

/** Per-point columns kept per input curve set; animated graphs usually change only a few expressions. */
const COLUMN_LIMIT = 32;
const columns = new WeakMap<CurveSet, Map<number, Column>>();
/** Sub-expression identities include every input and animated constant, but never grow recursively. */
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

/** Populate only the requested context column; Position can read the immutable input buffer directly. */
function contextColumn(operation: string, curves: CurveSet): PointColumn | undefined {
  if (operation === 'position') return { shared: false, values: curves.positions, width: 3, boolean: false };
  if (!['curve-u', 'point-index', 'strand-index', 'point-count'].includes(operation)) return undefined;
  const values = new Float64Array(curves.positions.length / 3);
  for (let strand = 0; strand < curves.counts.length; strand++) {
    const points = curves.counts[strand], start = curves.starts[strand];
    for (let point = 0; point < points; point++) {
      values[start + point] = operation === 'curve-u' ? points > 1 ? point / (points - 1) : 0
        : operation === 'point-index' ? point : operation === 'strand-index' ? strand : points;
    }
  }
  return { shared: false, values, width: 1, boolean: false };
}

/**
 * Evaluate instruction columns rather than interpreting the graph per point. Packed numeric
 * buffers avoid millions of short-lived argument/vector arrays in large animated Curl fields.
 * Cached columns are immutable; the returned reader owns its vector results, even after later
 * evaluations evict a column. Uniform expressions still run just once.
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
    column = evaluateInstruction(item.operation, item.type, item.value, args, curves);
    if (!column.shared) {
      cache.set(key, column);
      while (cache.size > COLUMN_LIMIT) cache.delete(cache.keys().next().value!);
    }
    results.push(column);
  }
  const output = results[field.output];
  if (output.shared) return () => output.value;
  if (output.width === 1) return output.boolean ? index => Boolean(output.values[index]) : index => output.values[index];
  return index => Array.from(output.values.subarray(index * output.width, (index + 1) * output.width));
}

function evaluateInstruction(operation: string, type: PointwiseValueType, value: number | undefined, args: Column[], curves: CurveSet): Column {
  if (operation === 'constant') return { shared: true, value: value ?? 0 };
  if (operation === 'strand-count') return { shared: true, value: curves.counts.length };
  const context = contextColumn(operation, curves);
  if (context) return context;
  const definition = pointwiseOperation(operation);
  if (!definition) throw new Error(`Unsupported curve field operation: ${operation}`);
  if (args.every(arg => arg.shared)) {
    return { shared: true, value: definition.evaluate(args.map(arg => (arg as Extract<Column, { shared: true }>).value), value) };
  }
  const width = widthOf(type), values = new Float64Array(curves.positions.length / 3 * width);
  // Scratch arguments belong to this instruction, not to its output or any cached column.
  // Some operations return an argument (identity) or this array itself (Combine Vector): copy
  // their components into the output before advancing to the next point.
  const operands: PointwiseValue[] = args.map(arg => arg.shared ? arg.value : arg.width === 1 ? 0 : new Array<number>(arg.width));
  const varying = args.flatMap((arg, slot) => arg.shared ? [] : [{ column: arg, slot }]);
  const { starts, counts } = curves;
  for (let strand = 0; strand < counts.length; strand++) {
    for (let index = starts[strand], end = index + counts[strand]; index < end; index++) {
      for (let input = 0; input < varying.length; input++) {
        const { column, slot } = varying[input];
        if (column.width === 1) operands[slot] = column.boolean ? Boolean(column.values[index]) : column.values[index];
        else {
          const vector = operands[slot] as number[], base = index * column.width;
          for (let component = 0; component < column.width; component++) vector[component] = column.values[base + component];
        }
      }
      const result = definition.evaluate(operands, value);
      if (width === 1) values[index] = typeof result === 'boolean' ? Number(result) : result as number;
      else for (let component = 0; component < width; component++) values[index * width + component] = (result as number[])[component];
    }
  }
  return { shared: false, values, width, boolean: type === 'boolean' };
}
