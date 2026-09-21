import { describe, expect, it } from 'vitest';
import { ANALOG_SIGNAL_LAB_PARAMS } from '../../src/effects/analog/signal-lab/parameters';
import { createAnalogDisplayResolveIsland } from '../../src/services/operators/analogDisplayResolveGraph';
import { compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import type { BoundOperatorNode, EffectOperatorGraph } from '../../src/types/operatorGraph';

const named = (id: string): BoundOperatorNode => ({ id, operator: 'image.named-input', operatorVersion: 1, bindings: { resource: id } });
const defaults = Object.fromEntries(Object.entries(ANALOG_SIGNAL_LAB_PARAMS).map(([id, spec]) => [id, spec.default]));
function fixture(signal = 0) {
  const source = named('source'), decoded = named('decoded');
  const signalNode: BoundOperatorNode = { id: 'effective-signal', operator: 'values.number', operatorVersion: 1, bindings: {}, constants: { value: signal } };
  const island = createAnalogDisplayResolveIsland({ prefix: 'resolve', source: { node: source.id, port: 'image' },
    decoded: { node: decoded.id, port: 'image' }, signalAmount: { node: signalNode.id, port: 'value' }, anchor: { x: 600, y: 200 } });
  const output: BoundOperatorNode = { id: 'output', operator: 'image.output', operatorVersion: 1, bindings: {} };
  const graph: EffectOperatorGraph = { version: 1, schemaVersion: 1, domain: 'image', nodes: [source, decoded, signalNode, ...island.nodes, output],
    edges: [...island.edges, { id: 'resolve-output', from: island.output.node, output: island.output.port, to: output.id, input: 'image' }],
    layout: island.layout, groups: island.groups };
  return { graph, island };
}
const context = { namedImages: [
  { id: 'source', sampling: 'manual-bilinear-clamp' as const }, { id: 'decoded', sampling: 'manual-bilinear-clamp' as const },
] };

describe('Analog Display Resolve image island', () => {
  it('is a flat, grouped graph built only from registered generic operators', () => {
    const { island } = fixture();
    expect(island.nodes).toHaveLength(133);
    expect(island.edges).toHaveLength(202);
    expect(island.output).toEqual({ node: 'resolve-active-select', port: 'image' });
    expect(island.groups[0].nodeIds).toHaveLength(island.nodes.length);
    expect(island.layout['resolve-zero']).toEqual({ x: 600, y: 200 });
    const bindings = island.nodes.filter(node => Object.keys(node.bindings).length).map(node => node.bindings.value as string).toSorted();
    expect(bindings).toEqual(['amount', 'bloom', 'crtAmount', 'curvature', 'flicker', 'maskStrength', 'scanlines'].toSorted());
    for (const id of bindings) {
      const schema = ANALOG_SIGNAL_LAB_PARAMS[id as keyof typeof ANALOG_SIGNAL_LAB_PARAMS];
      expect(schema.type).toBe('number');
      if (schema.type !== 'number') throw new Error(`${id} must retain its numeric Analog Signal schema.`);
      expect(Number.isFinite(schema.default)).toBe(true);
      expect(Number.isFinite(schema.min)).toBe(true);
      expect(Number.isFinite(schema.max)).toBe(true);
    }
    expect(island.nodes.some(node => node.operator === 'image.named-input' || node.operator.startsWith('analog.'))).toBe(false);
  });

  it('lazily returns the original source when both signal and CRT are inactive', () => {
    const { graph } = fixture(0), plan = compileImageOperatorGraph(graph, { ...defaults, crtAmount: 0 }, context);
    const resources: string[] = [];
    const result = evaluateImageOperatorPlan(plan, [0, 0, 0, 0], { uv: [.2, .7], resolution: [47, 29], timelineTimeSeconds: 3,
      sampleImage: () => [0, 0, 0, 0], sampleResource: (id, uv) => { resources.push(id); return id === 'source' ? [uv[0], uv[1], .25, .6] : [.8, .6, .4, 1]; } });
    expect(result).toEqual([.2, .7, .25, .6]);
    expect(resources).toEqual(['source']);
  });

  it('mixes the decoded signal while preserving original straight alpha', () => {
    const { graph } = fixture(1), params = { ...defaults, amount: 1, crtAmount: 0, curvature: 0, bloom: 0,
      scanlines: 0, maskStrength: 0, flicker: 0 };
    const plan = compileImageOperatorGraph(graph, params, context);
    const result = evaluateImageOperatorPlan(plan, [0, 0, 0, 0], { uv: [.2, .7], resolution: [47, 29], timelineTimeSeconds: 0,
      sampleImage: () => [0, 0, 0, 0], sampleResource: id => id === 'source' ? [.1, .2, .3, .35] : [.8, .6, .4, 1] });
    expect(result[0]).toBeCloseTo(.8, 12); expect(result[1]).toBeCloseTo(.6, 12); expect(result[2]).toBeCloseTo(.4, 12);
    expect(result[3]).toBeCloseTo(.35, 12);
  });
});
