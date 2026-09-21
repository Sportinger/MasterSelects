import { describe, expect, it } from 'vitest';
import { getEffect } from '../../src/effects';
import { effectOperatorGraph, effectOperatorParams, hasEffectOperatorGraph,
  migratePersistedEffectOperatorGraph } from '../../src/services/operators/effectGraphOwner';
import { createDefaultPixelSortGraph } from '../../src/services/operators/pixelSortEffectGraph';
import type { Effect } from '../../src/types/effects';

const effect = (operatorGraph = createDefaultPixelSortGraph()): Effect => ({ id: 'pixel-sort-owner', type: 'pixel-sort',
  name: 'Pixel Sort', enabled: true, params: {}, operatorGraph });

describe('Pixel Sort compute graph ownership', () => {
  it('uses the canonical graph and authoritative catalog defaults', () => {
    expect(hasEffectOperatorGraph('pixel-sort')).toBe(true);
    expect(effectOperatorGraph({ type: 'pixel-sort', params: {} })).toEqual(createDefaultPixelSortGraph());
    expect(getEffect('pixel-sort')?.params).toMatchObject({
      amount: { default: .8, min: 0, max: 1 },
      threshold: { default: .45, min: 0, max: 1 },
      scale: { default: 16, min: 4, max: 16 },
    });
    expect(effectOperatorParams({ type: 'pixel-sort', params: {} })).toMatchObject({ amount: .8, threshold: .45, scale: 16 });
  });

  it('preserves persisted edits and fails closed for invalid canonical wiring', () => {
    const edited = createDefaultPixelSortGraph();
    edited.layout.sorted = { x: 901, y: 302 };
    edited.nodes.find(node => node.id === 'amount')!.bindings = { value: 'customAmount' };
    const migrated = migratePersistedEffectOperatorGraph(effect(edited));
    expect(migrated.operatorGraph?.layout.sorted).toEqual({ x: 901, y: 302 });
    expect(migrated.operatorGraph?.nodes.find(node => node.id === 'amount')?.bindings).toEqual({ value: 'customAmount' });

    const invalid = createDefaultPixelSortGraph();
    invalid.edges = invalid.edges.filter(edge => !(edge.to === 'sorted' && edge.input === 'scale'));
    expect(() => migratePersistedEffectOperatorGraph(effect(invalid))).toThrow(/connect Segment Size/i);
  });
});
