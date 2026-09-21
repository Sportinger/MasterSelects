import { describe, expect, it } from 'vitest';
import { compileImageOperatorGraph, createDefaultInvertImageGraph } from '../../src/services/operators/imageOperatorGraph';
import { splitLayerEffects } from '../../src/engine/render/layerEffectStack';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';
import type { Effect } from '../../src/types/effects';

const node = (id: string, operator: string) => ({ id, operator, operatorVersion: 1 as const, bindings: {} });
const edge = (id: string, from: string, output: string, to: string, input: string) => ({ id, from, output, to, input });

function sharedMaterializedGraph(): EffectOperatorGraph {
  const nodes = [node('frame', 'image.frame'), node('materialize', 'image.materialize'), node('split-a', 'vector.split.rgba'),
    node('split-b', 'vector.split.rgba'), { ...node('half', 'values.number'), constants: { value: 0.5 } }, node('mix', 'math.mix.rgb'),
    node('combine', 'vector.combine.rgba'), node('output', 'image.output')];
  return { version: 1, schemaVersion: 1, domain: 'image', nodes, edges: [
    edge('frame-materialize', 'frame', 'image', 'materialize', 'image'),
    edge('materialize-a', 'materialize', 'image', 'split-a', 'image'),
    edge('materialize-b', 'materialize', 'image', 'split-b', 'image'),
    edge('a-mix', 'split-a', 'rgb', 'mix', 'a'), edge('b-mix', 'split-b', 'rgb', 'mix', 'b'), edge('half-mix', 'half', 'value', 'mix', 't'),
    edge('mix-combine', 'mix', 'value', 'combine', 'rgb'), edge('alpha-combine', 'split-a', 'alpha', 'combine', 'alpha'),
    edge('combine-output', 'combine', 'image', 'output', 'image'),
  ], layout: Object.fromEntries(nodes.map((item, index) => [item.id, { x: index * 240, y: 0 }])) };
}

describe('image graph materialization integration', () => {
  it('materializes a shared producer once for two consumer branches', () => {
    const plan = compileImageOperatorGraph(sharedMaterializedGraph(), {});
    expect(plan.resources).toHaveLength(1);
    expect(plan.passes).toHaveLength(2);
    expect(plan.passes?.filter(pass => pass.outputResource)).toHaveLength(1);
    expect(plan.passes?.[1].inputResources).toEqual([plan.resources?.[0].id]);
    expect(plan.passes?.[1].program.resourceInputs).toEqual([plan.resources?.[0].id]);
  });

  it('routes a formerly local graph through fullscreen execution once materialized', () => {
    const graph = createDefaultInvertImageGraph();
    const outputEdge = graph.edges.find(item => item.to === 'output')!;
    graph.nodes.push(node('materialize', 'image.materialize'));
    graph.edges = graph.edges.filter(item => item !== outputEdge);
    graph.edges.push(edge('image-materialize', outputEdge.from, outputEdge.output, 'materialize', 'image'),
      edge('materialize-output', 'materialize', 'image', 'output', 'image'));
    const effect: Effect = { id: 'materialized-invert', type: 'invert', name: 'Invert', enabled: true, params: {}, operatorGraph: graph };
    const stack = splitLayerEffects([effect]);
    expect(stack.inlineEffects.operatorProgram).toBeUndefined();
    expect(stack.complexEffects).toEqual([effect]);
    expect(compileImageOperatorGraph(graph, {}).passes).toHaveLength(2);
  });
});
