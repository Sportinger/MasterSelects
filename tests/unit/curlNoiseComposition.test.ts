import { describe, expect, it } from 'vitest';
import { geometryOwnerOperators, geometryParameterReader, validateWeaveGraph } from '../../src/services/operators/geometry/weaveGraph';
import { expandOperatorCompositions, packOperatorCompositions } from '../../src/services/operators/operatorComposition';
import { compileGeometryGraph } from '../../src/services/operators/geometry/geometryProgram';
import { evaluateFieldColumn } from '../../src/services/operators/geometry/curveFieldColumns';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';

function graph(detail = 3.5, strength = 0.18, evolution?: number): EffectOperatorGraph {
  const specs = [
    ['line', 'geometry.curve-line', { points: 4, length: 1, axis: 'x' }], ['position', 'geometry.position', {}],
    ['detail', 'values.number', { value: detail }], ['strength', 'values.number', { value: strength }],
    ['curl', evolution === undefined ? 'field.curl-noise3d' : 'field.curl-noise3d-evolving', {}], ['deform', 'geometry.set-position', {}],
    ['render', 'render.strands', {}], ['out', 'scene.output', {}],
  ] as const;
  const links = [['line', 'curves', 'deform', 'curves'], ['position', 'position', 'curl', 'position'],
    ['detail', 'value', 'curl', 'detail'], ['strength', 'value', 'curl', 'strength'],
    ['curl', 'vector', 'deform', 'offset'], ['deform', 'curves', 'render', 'curves'], ['render', 'scene', 'out', 'scene']];
  const evolutionNodes = evolution === undefined ? [] : [{ id: 'evolution', operator: 'values.number', constants: { value: evolution }, operatorVersion: 1, bindings: {} }];
  if (evolution !== undefined) links.push(['evolution', 'value', 'curl', 'evolution']);
  return { version: 1, domain: 'geometry', nodes: [...evolutionNodes, ...specs.map(([id, operator, constants]) => ({ id, operator, constants, operatorVersion: 1, bindings: {} }))],
    layout: Object.fromEntries(specs.map(([id], x) => [id, { x: x * 250, y: 0 }])),
    edges: links.map(([from, output, to, input], i) => ({ id: `e${i}`, from, output, to, input })) };
}

function field(points: number[][], detail = 3.5, strength = 0.18, evolution?: number) {
  const program = compileGeometryGraph(graph(detail, strength, evolution), geometryParameterReader({}));
  const stage = program.stages.find(stage => stage.kind === 'set-position')!;
  if (stage.kind !== 'set-position' || !stage.offset) throw new Error('Missing curl field');
  const values = evaluateFieldColumn(stage.offset, { positions: new Float32Array(points.flat()), starts: Uint32Array.of(0), counts: Uint32Array.of(points.length) });
  return points.map((_, i) => values(i) as number[]);
}

describe('reusable Curl Noise geometry node group', () => {
  it('is discoverable, expands into supported nodes, and survives pack/save/load', () => {
    expect(geometryOwnerOperators().find(op => op.id === 'field.curl-noise3d')?.composition).toBeDefined();
    const source = graph(), expanded = expandOperatorCompositions(source);
    expect(validateWeaveGraph(source)).toEqual([]);
    expect(validateWeaveGraph(expanded)).toEqual([]);
    expect(expanded.nodes.some(node => node.operator === 'field.curl-noise3d')).toBe(false);
    const restored = JSON.parse(JSON.stringify(packOperatorCompositions(expanded)));
    expect(compileGeometryGraph(restored, geometryParameterReader({}))).toEqual(compileGeometryGraph(source, geometryParameterReader({})));
  });

  it('retains the saved three-input node contract and evolves a separate compatible variant', () => {
    const saved = JSON.parse(JSON.stringify(packOperatorCompositions(expandOperatorCompositions(graph()))));
    expect(validateWeaveGraph(saved)).toEqual([]);
    const old = geometryOwnerOperators().find(op => op.id === 'field.curl-noise3d')!;
    expect(old.inputs.map(input => input.id)).toEqual(['position', 'detail', 'strength']);
    const points = [[.13, -.27, .41], [.7, .3, -.9], [-.2, .8, .5]];
    expect(field(points, 3.5, .18, 0)).toEqual(field(points));
    expect(field(points, 3.5, .18, .25)).not.toEqual(field(points));
    expect(field(points, 3.5, .18, 1).flat()).toEqual(expect.arrayContaining(field(points).flat().map(v => expect.closeTo(v, 5))));
    const evolving = graph(3.5, .18, .17);
    expect(validateWeaveGraph(evolving)).toEqual([]);
    const restored = JSON.parse(JSON.stringify(packOperatorCompositions(expandOperatorCompositions(evolving))));
    expect(compileGeometryGraph(restored, geometryParameterReader({}))).toEqual(compileGeometryGraph(evolving, geometryParameterReader({})));
  });

  it('is finite at zero and negative detail and has reversible linear strength', () => {
    const points = [[.13, -.27, .41], [.7, .3, -.9], [-.2, .8, .5]];
    expect(field(points, 0).flat().every(Number.isFinite)).toBe(true);
    expect(field(points, -3.5)).toEqual(field(points, 3.5));
    expect(field(points, 3.5, 0).flat().every(v => v === 0)).toBe(true);
    const forward = field(points), reverse = field(points, 3.5, -.18);
    forward.forEach((v, i) => v.forEach((n, axis) => expect(reverse[i][axis]).toBeCloseTo(-n, 6)));
  });

  it.each([undefined, .13, .37])('has near-zero divergence before masking at evolution %s', evolution => {
    const h = .01;
    for (const p of [[.13, -.27, .41], [.7, .3, -.9], [-.2, .8, .5]]) {
      const points = [0, 1, 2].flatMap(axis => [1, -1].map(sign => p.map((v, i) => v + (i === axis ? sign * h : 0))));
      const v = field(points, 3.5, .18, evolution);
      const divergence = [0, 1, 2].reduce((sum, axis) => sum + (v[axis * 2][axis] - v[axis * 2 + 1][axis]) / (2 * h), 0);
      expect(Math.abs(divergence)).toBeLessThan(0.001);
    }
  });
});
