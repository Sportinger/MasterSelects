import { describe, expect, it } from 'vitest';
import { createDefaultFisheyeGraph } from '../../src/services/operators/fisheyeEffectGraph';
import { organizeFisheyeGraph } from '../../src/services/operators/fisheyeGraphPresentation';
import { recognizeOperatorCompositions } from '../../src/services/operators/recognizeOperatorCompositions';
import { expandOperatorCompositions, packOperatorCompositions } from '../../src/services/operators/operatorComposition';
import { compileImageOperatorGraph } from '../../src/services/operators/imageOperatorGraph';
import { effectOperatorGraph, effectOperatorParams, effectOperatorCompileContext } from '../../src/services/operators/effectGraphOwner';
import { validateEffectGraph } from '../../src/services/operators/effectGraph';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';
import { createDefaultUvDistortGraph } from '../../src/services/operators/uvDistortEffectGraphs';

const semantic = (graph: EffectOperatorGraph) => ({
  nodes: graph.nodes.toSorted((a, b) => a.id.localeCompare(b.id)),
  links: graph.edges.map(({ from, output, to, input }) => `${from}:${output}>${to}:${input}`).toSorted(),
});
const composed = () => recognizeOperatorCompositions(organizeFisheyeGraph(createDefaultFisheyeGraph()));

describe('Fisheye shared nested compositions', () => {
  it('recognizes three lens transforms with six nested divides while retaining every original leaf and connection', () => {
    const original = createDefaultFisheyeGraph(), graph = composed(), expanded = expandOperatorCompositions(graph);
    expect(graph.nodes.filter(node => node.operator === 'coordinates.restore-lens.vec2')).toHaveLength(3);
    expect(expanded.groups!.filter(group => group.composition?.instance.operator === 'coordinates.divide-x.vec2')).toHaveLength(6);
    expect(expanded.nodes).toHaveLength(250);
    expect(expanded.groups).toHaveLength(26);
    expect(semantic(expanded)).toEqual(semantic(original));
    expect(validateEffectGraph(graph)).toEqual([]);
    let roundTrip = graph;
    for (let index = 0; index < 3; index++) roundTrip = packOperatorCompositions(expandOperatorCompositions(roundTrip));
    expect(semantic(expandOperatorCompositions(roundTrip))).toEqual(semantic(original));
    expect(expandOperatorCompositions(roundTrip).layout).toEqual(expanded.layout);
    expect(recognizeOperatorCompositions(graph)).toBe(graph);
  });

  it('produces the identical single-pass program, sampling scopes and dynamic values for all projection/edge choices', () => {
    const original = createDefaultFisheyeGraph(), graph = composed();
    for (const projection of ['equidistant', 'equisolid', 'stereographic', 'orthographic']) {
      const effect = { type: 'fisheye', params: { projection, rotation: 37, samples: 8, chromaticAberration: .08, preserveAspect: true, strength: -.6, edgeMode: 'mirror' } };
      const params = effectOperatorParams(effect), context = effectOperatorCompileContext(effect);
      const before = compileImageOperatorGraph(original, params, context), after = compileImageOperatorGraph(graph, params, context);
      expect(after.passes).toBeUndefined();
      expect(after.wgsl).toBe(before.wgsl);
      expect(after.values).toEqual(before.values);
      expect(after.sampleScopes).toEqual(before.sampleScopes);
    }
  });

  it('detaches an edited nested divide and its parent without changing the other channels', () => {
    const expanded = expandOperatorCompositions(composed());
    expanded.nodes.find(node => node.id === 'red-unsqueeze-x')!.operator = 'math.multiply.scalar';
    const packed = packOperatorCompositions(expanded);
    expect(packed.nodes.filter(node => node.operator === 'coordinates.restore-lens.vec2')).toHaveLength(2);
    expect(packed.nodes.find(node => node.id === 'red-unsqueeze-x')?.operator).toBe('math.multiply.scalar');
    expect(expandOperatorCompositions(packed).nodes.find(node => node.id === 'blue-unsqueeze-x')?.operator).toBe('math.divide-ieee.scalar');
    expect(validateEffectGraph(packed)).toEqual([]);
    expect(recognizeOperatorCompositions(packed)).toBe(packed);
  });

  it('upgrades revision-one graphs without rerunning old rules and refuses cross-folder matches or private fan-out', () => {
    const legacy = createDefaultFisheyeGraph(); legacy.compositionRules = 1;
    expect(recognizeOperatorCompositions(legacy).nodes.filter(node => node.operator === 'coordinates.restore-lens.vec2')).toHaveLength(3);
    const ungrouped = expandOperatorCompositions(createDefaultUvDistortGraph('kaleidoscope'));
    delete ungrouped.groups; ungrouped.compositionRules = 1;
    expect(recognizeOperatorCompositions(ungrouped).nodes).toEqual(ungrouped.nodes);
    const split = createDefaultFisheyeGraph();
    split.groups!.find(group => group.id === 'fisheye-chroma')!.nodeIds = split.groups!.find(group => group.id === 'fisheye-chroma')!.nodeIds.filter(id => id !== 'red-unsqueeze-x');
    split.groups!.push({ id: 'custom', label: 'My math', color: '#ffffff', nodeIds: ['red-unsqueeze-x'] });
    const recognized = recognizeOperatorCompositions(split);
    expect(recognized.nodes.find(node => node.id === 'red-unsqueeze-x')).toBeDefined();
    expect(recognized.groups!.find(group => group.id === 'custom')?.nodeIds).toEqual(['red-unsqueeze-x']);
    const fanout = createDefaultFisheyeGraph();
    fanout.nodes.push({ id: 'extra', operator: 'math.sin.scalar', operatorVersion: 1, bindings: {} });
    fanout.edges.push({ id: 'extra-link', from: 'red-unsqueeze-x', output: 'value', to: 'extra', input: 'value' });
    expect(recognizeOperatorCompositions(fanout).nodes.find(node => node.id === 'red-unsqueeze-x')).toBeDefined();
  });

  it('keeps all six areas, separates the sample input from its resolve and respects custom grouping', () => {
    const source = createDefaultFisheyeGraph(), graph = organizeFisheyeGraph(source);
    expect(graph.nodes).toBe(source.nodes); expect(graph.edges).toBe(source.edges);
    expect(graph.groups!.filter(group => !group.parentId)).toHaveLength(6);
    expect(graph.groups!.find(group => group.id === 'fisheye-sample-average')?.nodeIds).toContain('aa-reduce');
    expect(graph.groups!.some(group => group.nodeIds.includes('frame') || group.nodeIds.includes('output'))).toBe(false);
    expect(organizeFisheyeGraph(graph)).toBe(graph);
    const custom = createDefaultFisheyeGraph(); custom.groups![0].label = 'My settings';
    expect(organizeFisheyeGraph(custom)).toBe(custom);
    expect(effectOperatorGraph({ type: 'fisheye', params: {}, operatorGraph: source }).groups).toHaveLength(26);
  });
});
