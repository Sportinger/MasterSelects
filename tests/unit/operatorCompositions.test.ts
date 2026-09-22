import * as compositionRegistry from '../../src/services/operators/operatorCompositionRegistry';
import { describe, expect, it, vi } from 'vitest';
import type { EffectOperatorGraph, OperatorDefinition } from '../../src/types/operatorGraph';
import { COORDINATE_COMPOSITIONS } from '../../src/services/operators/coordinateCompositions';
import { expandOperatorCompositions, packOperatorCompositions } from '../../src/services/operators/operatorComposition';
import { recognizeOperatorCompositions } from '../../src/services/operators/recognizeOperatorCompositions';
import { createDefaultUvDistortGraph } from '../../src/services/operators/uvDistortEffectGraphs';
import { compileImageOperatorGraph, compileImageOperatorPreview, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import { readEffectGraph, validateEffectGraph } from '../../src/services/operators/effectGraph';
import { getAllEffects } from '../../src/effects';
import { effectOperatorGraph, isImageGraphEffectType } from '../../src/services/operators/effectGraphOwner';

const flat = () => { const graph = structuredClone(expandOperatorCompositions(createDefaultUvDistortGraph('kaleidoscope'))); delete graph.groups; delete graph.compositionRules; return graph; };
const compounds = (graph: EffectOperatorGraph) => graph.nodes.filter(node => COORDINATE_COMPOSITIONS.some(def => def.id === node.operator));

describe('reusable coordinate compositions', () => {
  it('keeps every registered image-effect default readable and compilable through automatic recognition', () => {
    const effects = getAllEffects().filter(effect => isImageGraphEffectType(effect.id));
    expect(effects.length).toBeGreaterThan(70);
    for (const effect of effects) expect(() => effectOperatorGraph({ type: effect.id, params: {} }), effect.id).not.toThrow();
  });
  it('stores three shared instances, expands stable leaf IDs and round-trips without copying parameter owners', () => {
    const graph = createDefaultUvDistortGraph('kaleidoscope');
    expect(graph.nodes).toHaveLength(14); expect(compounds(graph)).toHaveLength(3);
    expect(validateEffectGraph(graph)).toEqual([]);
    const restored = readEffectGraph(JSON.stringify(graph), () => { throw new Error('No fallback'); });
    const expanded = expandOperatorCompositions(restored);
    expect(expanded.nodes).toHaveLength(26);
    expect(expanded.nodes.find(node => node.id === 'rotation')?.bindings).toEqual({ value: 'rotation' });
    expect(expanded.nodes.find(node => node.id === 'base-angle')?.operator).toBe('math.atan2.scalar');
    expect(packOperatorCompositions(expanded)).toEqual(packOperatorCompositions(expandOperatorCompositions(graph)));
    expect(recognizeOperatorCompositions(graph)).toEqual(graph);
  });

  it('keeps the old UV formula across sector seams, the center, negative angles and segment counts', () => {
    for (const segments of [1, 2, 6, 17]) for (const rotation of [-9, -.01, 0, Math.PI, 12]) {
      const plan = compileImageOperatorGraph(createDefaultUvDistortGraph('kaleidoscope'), { segments, rotation });
      for (const uv of [[0, 0], [.5, .5], [.5, .9], [.9, .5], [.17, .73], [1, 1]] as [number, number][]) {
        const x = uv[0] - .5, y = uv[1] - .5, period = Math.PI * 2 / segments;
        const phase = (Math.atan2(y, x) + rotation) / period;
        const wrapped = (phase - Math.floor(phase)) * period, angle = wrapped > period * .5 ? period - wrapped : wrapped;
        const radius = Math.hypot(x, y), expected = [Math.cos(angle) * radius + .5, Math.sin(angle) * radius + .5];
        const actual = evaluateImageOperatorPlan(plan, [0, 0, 0, 1], { uv, sampleImage: at => [at[0], at[1], .25, .75] });
        expect(actual[0]).toBeCloseTo(expected[0], 7); expect(actual[1]).toBeCloseTo(expected[1], 7);
        expect(actual.slice(2)).toEqual([.25, .75]);
      }
    }
  });

  it('recognizes renamed graphs, rejects changed constants and unexpected intermediate fan-out', () => {
    const graph = flat();
    const ids = new Map(graph.nodes.map((node, i) => [node.id, `renamed-${i}`]));
    graph.nodes.forEach(node => { node.id = ids.get(node.id)!; });
    graph.edges.forEach(edge => { edge.from = ids.get(edge.from)!; edge.to = ids.get(edge.to)!; });
    graph.layout = Object.fromEntries(Object.entries(graph.layout).map(([id, point]) => [ids.get(id)!, point]));
    expect(compounds(recognizeOperatorCompositions(graph))).toHaveLength(3);
    const changed = flat();
    changed.nodes.find(node => node.id.endsWith('--half'))!.constants = { value: .4 };
    expect(compounds(recognizeOperatorCompositions(changed)).some(node => node.operator === 'math.mirror-repeat.scalar')).toBe(false);
    const fanout = flat();
    fanout.nodes.push({ id: 'extra', operator: 'math.sin.scalar', operatorVersion: 1, bindings: {} });
    fanout.edges.push({ id: 'extra-edge', from: 'segment-fract', output: 'value', to: 'extra', input: 'value' });
    expect(compounds(recognizeOperatorCompositions(fanout)).some(node => node.operator === 'math.mirror-repeat.scalar')).toBe(false);
  });

  it('detaches an edited interior and retains unrelated shared instances', () => {
    const expanded = structuredClone(expandOperatorCompositions(createDefaultUvDistortGraph('kaleidoscope')));
    expanded.nodes.find(node => node.id === 'segment-fract')!.operator = 'math.sin.scalar';
    const packed = packOperatorCompositions(expanded);
    expect(compounds(packed)).toHaveLength(2);
    expect(packed.nodes.find(node => node.id === 'segment-fract')?.operator).toBe('math.sin.scalar');
    expect(packed.groups).toHaveLength(1);
    expect(packed.groups![0].composition).toBeUndefined();
  });

  it('keeps one period input across all four consumers and supports instance previews', () => {
    const graph = createDefaultUvDistortGraph('kaleidoscope');
    const instance = graph.nodes.find(node => node.operator === 'math.mirror-repeat.scalar')!;
    expect(graph.edges.filter(edge => edge.to === instance.id && edge.input === 'period')).toHaveLength(1);
    const expanded = expandOperatorCompositions(graph);
    expect(expanded.edges.filter(edge => edge.from === 'segment-angle' && ['segment-progress', 'fold-angle', 'half-segment', 'reflected-angle'].includes(edge.to))).toHaveLength(4);
    expect(compileImageOperatorPreview(graph, { segments: 6, rotation: 0 }, { nodeId: instance.id, portId: 'value', direction: 'output' }).instructions.length).toBeGreaterThan(0);
  });

  it('expands and repacks nested definitions and rejects recursive expansion', () => {
    const mirror = COORDINATE_COMPOSITIONS.find(def => def.id === 'math.mirror-repeat.scalar')!;
    const wrapper: OperatorDefinition = { ...mirror, id: 'test.nested', composition: {
      graph: { version: 1, schemaVersion: 1, domain: 'image', nodes: [{ id: 'child', operator: mirror.id, operatorVersion: 1, bindings: {} }], edges: [], layout: {} },
      inputs: { value: [{ nodeId: 'child', portId: 'value' }], period: [{ nodeId: 'child', portId: 'period' }] }, outputs: { value: { nodeId: 'child', portId: 'value' } },
    } };
    const lookup = compositionRegistry.getOperatorComposition;
    const registry = vi.spyOn(compositionRegistry, 'getOperatorComposition').mockImplementation(id => id === wrapper.id ? wrapper : lookup(id));
    try {
      const graph: EffectOperatorGraph = { version: 1, domain: 'image', nodes: [{ id: 'outer', operator: wrapper.id, operatorVersion: 1, bindings: {} }], edges: [], layout: {} };
      const expanded = expandOperatorCompositions(graph);
      expect(expanded.groups).toHaveLength(2); expect(expanded.nodes).toHaveLength(8);
      expect(packOperatorCompositions(expanded).nodes.map(node => node.operator)).toEqual(['test.nested']);
      wrapper.composition!.graph.nodes[0].operator = wrapper.id;
      expect(() => expandOperatorCompositions(graph)).toThrow(/four levels/);
    } finally { registry.mockRestore(); }
  });
});
