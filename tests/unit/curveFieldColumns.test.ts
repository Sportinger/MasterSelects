import { describe, expect, it } from 'vitest';
import { evaluateFieldColumn } from '../../src/services/operators/geometry/curveFieldColumns';
import { compileGeometryGraph, type GeometryField } from '../../src/services/operators/geometry/geometryProgram';
import type { CurveSet } from '../../src/services/operators/geometry/geometryEvaluation';
import { createJellyfishReferenceGraph } from '../../src/services/operators/geometry/jellyfishReferenceGraph';
import { geometryParameterReader } from '../../src/services/operators/geometry/weaveGraph';
import { pointwiseOperation, type PointwiseValue } from '../../src/services/operators/fields/pointwiseOperations';

// Two unequal strands, including a single-point strand; context indexing must restart per strand.
const curves: CurveSet = { positions: Float32Array.of(0.3, -0.2, 0.1, 1.1, 0.7, -0.9, -0.4, 0.8, 1.7, 0.2, -1, 0.6),
  starts: Uint32Array.of(0, 3), counts: Uint32Array.of(3, 1) };

/** Independent row-wise interpreter using the shared operation semantics, without columns or caching. */
function reference(field: GeometryField, index: number, input = curves): PointwiseValue {
  const strand = input.starts.findLastIndex(start => start <= index), point = index - input.starts[strand], points = input.counts[strand];
  const context: Record<string, PointwiseValue> = { position: Array.from(input.positions.slice(index * 3, index * 3 + 3)),
    'curve-u': points > 1 ? point / (points - 1) : 0, 'point-index': point, 'strand-index': strand,
    'point-count': points, 'strand-count': input.counts.length };
  const values: PointwiseValue[] = [];
  for (const item of field.instructions) values.push(item.operation === 'constant' ? item.value ?? 0
    : Object.hasOwn(context, item.operation) ? context[item.operation]
      : pointwiseOperation(item.operation)!.evaluate(item.inputs.map(input => values[input]), item.value));
  return values[field.output];
}
const result = (field: GeometryField) => Array.from({ length: 4 }, (_, i) => evaluateFieldColumn(field, curves)(i));
const expected = (field: GeometryField) => Array.from({ length: 4 }, (_, i) => reference(field, i));

describe('packed geometry field evaluation', () => {
  it('matches the row interpreter for every field of evolving opposing jellyfish curls at different times', () => {
    for (const time of [0, 1.25, 19.8, 180]) {
      const program = compileGeometryGraph(createJellyfishReferenceGraph(), geometryParameterReader({}), undefined, { time, simulationTime: time });
      const fields = program.stages.flatMap(stage => stage.kind === 'set-position' ? [stage.position, stage.offset]
        : stage.kind === 'yarn-profile' ? [stage.radius] : []).filter((f): f is GeometryField => !!f);
      expect(fields.some(f => f.instructions.length > 300)).toBe(true);
      for (const field of fields) expect(result(field)).toEqual(expected(field));
    }
  });

  it.each([2, 3, 4] as const)('owns each Combine Vector result and keeps %i components independent across points and calls', width => {
    const field: GeometryField = { instructions: [
      { nodeId: 'u', operation: 'curve-u', type: 'scalar', inputs: [] },
      { nodeId: 'strand', operation: 'strand-index', type: 'scalar', inputs: [] },
      { nodeId: 'count', operation: 'point-count', type: 'scalar', inputs: [] },
      { nodeId: 'point', operation: 'point-index', type: 'scalar', inputs: [] },
      { nodeId: 'combine', operation: 'combine-vector', type: `vec${width}`, inputs: [0, 1, 2, 3].slice(0, width) },
    ], output: 4 };
    const read = evaluateFieldColumn(field, curves), retained = read(0) as number[];
    expect(Array.from({ length: 4 }, (_, i) => read(i))).toEqual(expected(field));
    expect(retained).toEqual(reference(field, 0));
    retained[0] = 999; // A consumer cannot mutate a cached vector through its reader.
    expect(read(0)).toEqual(reference(field, 0));
    expect(result(field)).toEqual(expected(field));
  });

  it('preserves double precision, animated constants, input identity and old readers after cache eviction', () => {
    const make = (value: number): GeometryField => ({ instructions: [
      { nodeId: 'index', operation: 'point-index', type: 'scalar', inputs: [] },
      { nodeId: 'amount', operation: 'constant', type: 'scalar', inputs: [], value },
      { nodeId: 'sum', operation: 'add-scalar', type: 'scalar', inputs: [0, 1] },
    ], output: 2 });
    const field = make(1 + 2 ** -40), old = evaluateFieldColumn(field, curves);
    expect(old(0)).toBe(1 + 2 ** -40);
    for (let value = 2; value < 80; value++) expect(result(make(value))).toEqual(expected(make(value)));
    expect(old(2)).toBe(3 + 2 ** -40);
    const position: GeometryField = { instructions: [{ nodeId: 'p', operation: 'position', type: 'vec3', inputs: [] }], output: 0 };
    const moved = { ...curves, positions: new Float32Array(curves.positions).fill(7) };
    expect(evaluateFieldColumn(position, moved)(0)).toEqual([7, 7, 7]);
    expect(evaluateFieldColumn(position, curves)(0)).toEqual(reference(position, 0));
  });
});
