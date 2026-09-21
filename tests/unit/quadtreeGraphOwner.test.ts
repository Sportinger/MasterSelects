import { describe, expect, it } from 'vitest';
import { getEffect } from '../../src/effects';
import { effectOperatorGraph, effectOperatorParams, hasEffectOperatorGraph, migratePersistedEffectOperatorGraph } from '../../src/services/operators/effectGraphOwner';
import { createDefaultQuadtreeGraph } from '../../src/services/operators/quadtreeEffectGraph';
import type { Effect } from '../../src/types/effects';

const effect = (operatorGraph = createDefaultQuadtreeGraph()): Effect => ({ id: 'quadtree-owner', type: 'quadtree-zoom',
  name: 'Quadtree Zoom', enabled: true, params: {}, operatorGraph });

describe('Quadtree Zoom compute graph ownership', () => {
  it('uses its canonical graph and authoritative catalog schema', () => {
    expect(hasEffectOperatorGraph('quadtree-zoom')).toBe(true);
    expect(effectOperatorGraph({ type: 'quadtree-zoom', params: {} })).toEqual(createDefaultQuadtreeGraph());
    expect(getEffect('quadtree-zoom')?.params).toMatchObject({ scale: { default: 8, min: 2, max: 32 },
      threshold: { default: .025, min: .001, max: .2 }, amount: { default: .8 }, speed: { default: .5 } });
    expect(effectOperatorParams({ type: 'quadtree-zoom', params: {} }))
      .toMatchObject({ scale: 8, threshold: .025, amount: .8, speed: .5 });
  });

  it('preserves edits and rejects malformed canonical graphs', () => {
    const edited = createDefaultQuadtreeGraph(); edited.layout.partition = { x: 812, y: 240 };
    expect(migratePersistedEffectOperatorGraph(effect(edited)).operatorGraph?.layout.partition).toEqual({ x: 812, y: 240 });
    const invalid = createDefaultQuadtreeGraph();
    invalid.edges = invalid.edges.filter(edge => !(edge.to === 'partition' && edge.input === 'threshold'));
    expect(() => migratePersistedEffectOperatorGraph(effect(invalid))).toThrow(/connect Threshold/i);
  });
});
