import { describe, expect, it } from 'vitest';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';
import { compileGeometryGraph } from '../../src/services/operators/geometry/geometryProgram';
import { geometryParameterReader } from '../../src/services/operators/geometry/weaveGraph';
import { evaluateFieldColumn } from '../../src/services/operators/geometry/curveFieldColumns';
import { strandPointFieldCode } from '../../src/engine/native3d/passes/strandFieldShader';

function repeatedNoise(count: number, distinct = false, bound = false): EffectOperatorGraph {
  const g: EffectOperatorGraph = { version: 1, domain: 'geometry', nodes: [], edges: [], layout: {} };
  const node = (id: string, operator: string, constants: Record<string, number | string> = {}) => {
    g.nodes.push({ id, operator, operatorVersion: 1, bindings: {}, constants });
    g.layout[id] = { x: 0, y: 0 };
  };
  const wire = (from: string, output: string, to: string, input: string) =>
    g.edges.push({ id: `${from}-${to}-${input}`, from, output, to, input });
  node('line', 'geometry.curve-line', { points: 3, length: 1, axis: 'x' });
  node('zero', 'values.number', { value: 0 });
  let sum = '';
  for (let i = 0; i < count; i++) {
    const id = `noise-${i}`;
    node(id, 'field.noise', { frequency: 1.3, amplitude: 1, seed: distinct ? i : 42, octaves: 1 });
    if (bound && i === count - 1) g.nodes.at(-1)!.bindings.seed = 'lastSeed';
    if (i === 0) sum = id;
    else {
      const next = `sum-${i}`; node(next, 'math.add.scalar');
      wire(sum, 'value', next, 'a'); wire(id, 'value', next, 'b'); sum = next;
    }
  }
  node('offset', 'vector.combine.vec3');
  wire(sum, 'value', 'offset', 'x');
  wire('zero', 'value', 'offset', 'y'); wire('zero', 'value', 'offset', 'z');
  node('deform', 'geometry.set-position'); node('render', 'render.strands'); node('output', 'scene.output');
  wire('line', 'curves', 'deform', 'curves'); wire('offset', 'value', 'deform', 'offset');
  wire('deform', 'curves', 'render', 'curves'); wire('render', 'scene', 'output', 'scene');
  return g;
}

const curves = { positions: new Float32Array([.13, .27, -.51, -.32, .72, .19]), starts: Uint32Array.of(0), counts: Uint32Array.of(2) };
function compile(g: EffectOperatorGraph, lastSeed = 42) {
  const p = compileGeometryGraph(g, geometryParameterReader({ lastSeed }));
  const s = p.stages.find(s => s.kind === 'set-position');
  if (!s || s.kind !== 'set-position' || !s.offset) throw new Error('Missing offset');
  return { field: s.offset, value: evaluateFieldColumn(s.offset, curves), stages: [s] };
}

describe('geometry field expression sharing', () => {
  it('fits repeated pure samples in the field budget without changing CPU or GPU lowering', () => {
    const repeated = compile(repeatedNoise(100)), single = compile(repeatedNoise(1));
    expect(repeated.field.instructions.filter(i => i.operation === 'noise3')).toHaveLength(1);
    for (let i = 0; i < 2; i++) expect((repeated.value(i) as number[])[0]).toBeCloseTo((single.value(i) as number[])[0] * 100, 8);
    expect(() => strandPointFieldCode(repeated.stages)).not.toThrow();
  });

  it('keeps animated parameter owners independent even when values coincide', () => {
    const g = repeatedNoise(100, false, true), unchanged = compile(g), changed = compile(g, 17);
    expect(changed.field.instructions.filter(i => i.operation === 'noise3')).toHaveLength(2);
    const common = compile(repeatedNoise(1)), special = compile(repeatedNoise(1, false, true), 17);
    for (let i = 0; i < 2; i++) expect((changed.value(i) as number[])[0]).toBeCloseTo((common.value(i) as number[])[0] * 99 + (special.value(i) as number[])[0], 8);
    expect(compile(g).field).toEqual(unchanged.field);
    const code = strandPointFieldCode(unchanged.stages).code;
    for (const value of [0, 1, 1.3, 17, 42]) expect(strandPointFieldCode(compile(g, value).stages).code).toBe(code);
  });

  it('keeps clock-derived folded expressions stable across numeric collisions', () => {
    const g = repeatedNoise(1);
    g.nodes.push({ id: 'clock', operator: 'geometry.clip-time', operatorVersion: 1, bindings: {} },
      { id: 'double', operator: 'math.multiply.scalar', operatorVersion: 1, bindings: {}, constants: {} },
      { id: 'two', operator: 'values.number', operatorVersion: 1, bindings: {}, constants: { value: 2 } });
    g.edges.push({ id: 'c', from: 'clock', output: 'value', to: 'double', input: 'a' },
      { id: 'two', from: 'two', output: 'value', to: 'double', input: 'b' },
      { id: 'seed', from: 'double', output: 'value', to: 'noise-0', input: 'seed' });
    let code: string | undefined;
    for (const simulationTime of [0, .5, .65, 1, 21, 1 / 30]) {
      const p = compileGeometryGraph(g, geometryParameterReader({}), undefined, { simulationTime });
      const stages = p.stages.filter(s => s.kind === 'set-position');
      const lowered = strandPointFieldCode(stages);
      code ??= lowered.code;
      expect(lowered.code).toBe(code);
      const field = stages[0].offset!;
      const sample = evaluateFieldColumn(field, curves)(0) as number[];
      const expected = compile(repeatedNoise(1, false, true), simulationTime * 2).value(0) as number[];
      expect(sample[0]).toBeCloseTo(expected[0], 8);
    }
  });

  it('still rejects genuinely large fields with their owner and instruction count', () => {
    expect(() => compile(repeatedNoise(250, true), 249)).toThrow(/deform.offset.*instruction budget \(\d+\/640\)/);
  });
});
