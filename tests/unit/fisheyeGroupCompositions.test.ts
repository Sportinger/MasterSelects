import { describe, expect, it } from 'vitest';
import { FISHEYE_GROUP_COMPOSITIONS } from '../../src/services/operators/fisheyeGroupCompositions';
import { createDefaultFisheyeGraph } from '../../src/services/operators/fisheyeEffectGraph';
import { expandOperatorCompositions, packOperatorCompositions } from '../../src/services/operators/operatorComposition';
import { validateEffectGraph } from '../../src/services/operators/effectGraph';
import { addableEffectOperators, effectOperatorParams, effectOperatorCompileContext } from '../../src/services/operators/effectGraphOwner';
import { compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import { getEffectOperator } from '../../src/services/operators/operatorRegistry';
import type { OperatorDefinition } from '../../src/types/operatorGraph';

// Replace a real processing area with a menu instance and reconnect its public boundary.
function replaceArea(definition: OperatorDefinition) {
  const graph = createDefaultFisheyeGraph(), body = definition.composition!;
  const members = new Set(body.graph.nodes.filter(node => !node.operator.startsWith('values.')).map(node => node.id));
  const oldEdges = graph.edges;
  graph.nodes = graph.nodes.filter(node => !members.has(node.id));
  graph.nodes.push({ id: 'reusable', operator: definition.id, operatorVersion: 1, bindings: {} });
  graph.edges = oldEdges.filter(edge => !members.has(edge.from) && !members.has(edge.to));
  for (const [input, endpoints] of Object.entries(body.inputs)) {
    const original = oldEdges.find(edge => edge.to === endpoints[0].nodeId && edge.input === endpoints[0].portId)!;
    graph.edges.push({ ...original, id: `input-${input}`, to: 'reusable', input });
  }
  for (const [output, endpoint] of Object.entries(body.outputs)) {
    for (const edge of oldEdges.filter(edge => edge.from === endpoint.nodeId && edge.output === endpoint.portId && !members.has(edge.to))) {
      graph.edges.push({ ...edge, from: 'reusable', output });
    }
  }
  delete graph.groups;
  for (const id of members) delete graph.layout[id];
  graph.layout.reusable = { x: 100, y: 100 };
  return graph;
}

describe('Fisheye processing groups in the reusable node menu', () => {
  it('offers every processing area and subgroup in image graphs, with no effect-owned parameter bindings', () => {
    expect(FISHEYE_GROUP_COMPOSITIONS).toHaveLength(15);
    for (const definition of FISHEYE_GROUP_COMPOSITIONS) {
      expect(getEffectOperator(definition.id)).toBe(definition);
      expect(addableEffectOperators('invert')).toContain(definition);
      expect(addableEffectOperators('fisheye')).toContain(definition);
      expect(addableEffectOperators('face-cables')).not.toContain(definition);
      expect(definition.outputs.length, definition.id).toBeGreaterThan(0);
      expect(definition.composition!.graph.nodes.every(node => !Object.keys(node.bindings).length)).toBe(true);
    }
  });

  for (const definition of FISHEYE_GROUP_COMPOSITIONS) it(`${definition.label} retains rendering, typed connections and save/restore`, () => {
    const graph = replaceArea(definition);
    expect(validateEffectGraph(graph), definition.id).toEqual([]);
    const expanded = expandOperatorCompositions(graph);
    expect(expanded.groups?.[0].label).toBe(definition.label);
    const restored = packOperatorCompositions(expanded);
    expect(restored.nodes.some(node => node.operator === definition.id)).toBe(true);
    expect(validateEffectGraph(restored)).toEqual([]);
    for (const settings of [
      { strength: .6, samples: 1, chromaticAberration: 0, edgeMode: 'clamp', projection: 'equidistant' },
      { strength: -.4, samples: 4, chromaticAberration: .08, edgeMode: 'mirror', projection: 'stereographic', vignette: .7, feather: .15 },
    ]) {
      const effect = { type: 'fisheye', params: settings };
      const params = effectOperatorParams(effect), context = effectOperatorCompileContext(effect);
      const original = compileImageOperatorGraph(createDefaultFisheyeGraph(), params, context);
      const actual = compileImageOperatorGraph(restored, params, context);
      for (const uv of [[.5, .5], [.12, .23], [.9, .82]] as [number, number][]) {
        const evaluation = { uv, resolution: [320, 180] as [number, number], sampleImage: (at: [number, number]) => [at[0], at[1], .3, .7] as [number, number, number, number] };
        const expected = evaluateImageOperatorPlan(original, [.2, .4, .6, .7], evaluation);
        const result = evaluateImageOperatorPlan(actual, [.2, .4, .6, .7], evaluation);
        result.forEach((value, index) => expect(value, `${definition.id} channel ${index}`).toBeCloseTo(expected[index], 6));
      }
    }
  });
});
