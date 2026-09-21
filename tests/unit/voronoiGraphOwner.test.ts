import { describe, expect, it } from 'vitest';
import { getEffect } from '../../src/effects';
import { addableEffectOperators, effectOperatorGraph, effectOperatorParams, hasEffectOperatorGraph,
  migratePersistedEffectOperatorGraph, validateEffectOwnerGraph } from '../../src/services/operators/effectGraphOwner';
import { createDefaultVoronoiGraph } from '../../src/services/operators/voronoiEffectGraph';
import type { Effect } from '../../src/types/effects';

const effect = (operatorGraph = createDefaultVoronoiGraph()): Effect => ({ id: 'voronoi-owner', type: 'voronoi', enabled: true,
  params: { scale: 31, amount: .62, threshold: .91, speed: 1.4 }, operatorGraph });

describe('Voronoi compute graph ownership', () => {
  it('supplies the canonical graph and authoritative catalog defaults without joining image-effect classification', () => {
    expect(hasEffectOperatorGraph('voronoi')).toBe(true);
    const definition = getEffect('voronoi')!;
    const graph = effectOperatorGraph({ type: 'voronoi', params: {} });
    expect(graph).toEqual(createDefaultVoronoiGraph());
    expect(effectOperatorParams({ type: 'voronoi', params: {} })).toEqual(
      Object.fromEntries(Object.entries(definition.params).map(([id, spec]) => [id, spec.default])));
  });

  it('keeps canonical layout, constants and stable bindings through legacy-field migration', () => {
    const graph = createDefaultVoronoiGraph();
    graph.layout.output = { x: 9123, y: 456 };
    const amount = graph.nodes.find(node => node.id === 'amount')!; amount.bindings = {}; amount.constants = { value: .37 };
    const legacy = effect(undefined as never); delete legacy.operatorGraph; legacy.params.operatorGraph = JSON.stringify(graph);
    const migrated = migratePersistedEffectOperatorGraph(legacy);
    expect(migrated.params.operatorGraph).toBeUndefined();
    expect(migrated.operatorGraph?.layout.output).toEqual({ x: 9123, y: 456 });
    expect(migrated.operatorGraph?.nodes.find(node => node.id === 'amount')?.constants).toEqual({ value: .37 });
    expect(migrated.operatorGraph?.nodes.find(node => node.id === 'seeds')?.bindings).toEqual({ scale: 'scale', speed: 'speed' });
  });

  it('validates edited graphs and exposes only supported compute/image operators', () => {
    const current = effect();
    expect(() => validateEffectOwnerGraph(current, current.operatorGraph!, current.params)).not.toThrow();
    const ids = addableEffectOperators('voronoi').map(operator => operator.id);
    expect(ids).toEqual(expect.arrayContaining(['geometry.voronoi-seeds', 'geometry.jump-flood', 'field.read-nearest-seed',
      'image.frame', 'image.load-pixel-clamped', 'values.number']));
    expect(ids).not.toEqual(expect.arrayContaining(['image.frame-history', 'glyph.atlas', 'image.materialize']));
  });
});
