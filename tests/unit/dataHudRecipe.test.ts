import { describe, expect, it } from 'vitest';
import { compileImageOperatorGraph } from '../../src/services/operators/imageOperatorGraph';
import { createDefaultDataHudGraph } from '../../src/services/operators/dataHudRecipe';
import { effectOperatorGraph, isImageGraphEffectType } from '../../src/services/operators/effectGraphOwner';
import { getDefaultParams, getEffect } from '../../src/effects';

describe('Data HUD recipe', () => {
  it('is a graph-owned image effect whose default graph compiles with its label atlas', () => {
    expect(isImageGraphEffectType('data-hud')).toBe(true);
    const graph = effectOperatorGraph({ id: 'fx', name: 'Data HUD', type: 'data-hud', enabled: true, params: getDefaultParams('data-hud') });
    expect(graph.nodes.some(node => node.operator === 'glyph.text-atlas')).toBe(true);
    const plan = compileImageOperatorGraph(createDefaultDataHudGraph(), getDefaultParams('data-hud'), { parameterSchema: getEffect('data-hud')!.params });
    expect(plan.externalResources).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'glyph-atlas',
      options: expect.objectContaining({ charset: '0123456789xyABCDEFGHIJKLMNOPQRSTUVWXYZ.:-/' }) })]));
  });

  it('reports values outside the rendered range', () => {
    const definition = getEffect('data-hud')!;
    const notes = 'paramWarnings' in definition ? definition.paramWarnings?.({ ...getDefaultParams('data-hud'), boxes: 7, rate: -1 }) ?? [] : [];
    expect(notes.join(' ')).toContain('Boxes 7 is outside');
    expect(notes.join(' ')).toContain('Rate -1 is below 0');
  });
});
