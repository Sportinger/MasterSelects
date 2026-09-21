import { describe, expect, it } from 'vitest';
import { getEffect } from '../../src/effects';
import { compileComputeImageGraph } from '../../src/services/operators/computeImageGraph';
import { createDefaultContourGraph } from '../../src/services/operators/contourEffectGraph';
import { addableEffectOperators, effectOperatorCompileContext, effectOperatorGraph, effectOperatorParams,
  hasEffectOperatorGraph, isComputeImageEffectType, migratePersistedEffectOperatorGraph } from '../../src/services/operators/effectGraphOwner';
import type { Effect } from '../../src/types/effects';

const effect = (operatorGraph = createDefaultContourGraph()): Effect => ({ id: 'contour-owner', type: 'contour',
  name: 'Contour', enabled: true, params: {}, operatorGraph });

describe('Contour compute graph ownership', () => {
  it('uses the canonical graph and authoritative catalog schema', () => {
    expect(isComputeImageEffectType('contour')).toBe(true); expect(hasEffectOperatorGraph('contour')).toBe(true);
    expect(effectOperatorGraph({ type: 'contour', params: {} })).toEqual(createDefaultContourGraph());
    expect(getEffect('contour')?.params).toMatchObject({ scale: { default: 12, min: 4, max: 48 },
      threshold: { default: .5, min: 0, max: 1 }, amount: { default: .8 },
      colorA: { default: '#111827' }, colorB: { default: '#f8fafc' } });
    const params = effectOperatorParams({ type: 'contour', params: {} });
    expect(params).toMatchObject({ scale: 12, threshold: .5, amount: .8, colorA: '#111827', colorB: '#f8fafc' });
    expect(() => compileComputeImageGraph(createDefaultContourGraph(), params,
      effectOperatorCompileContext({ type: 'contour' }))).not.toThrow();
  });

  it('preserves canonical edits, rejects malformed graphs, and hides the internal topology primitive', () => {
    const edited = createDefaultContourGraph(); edited.layout.topology = { x: 812, y: 240 };
    expect(migratePersistedEffectOperatorGraph(effect(edited)).operatorGraph?.layout.topology).toEqual({ x: 812, y: 240 });
    const invalid = createDefaultContourGraph(); invalid.edges = invalid.edges.filter(edge => !(edge.to === 'topology' && edge.input === 'tl'));
    expect(() => migratePersistedEffectOperatorGraph(effect(invalid))).toThrow();
    expect(addableEffectOperators('contour').some(operator => operator.id === 'geometry.marching-squares-topology')).toBe(false);
  });
});
