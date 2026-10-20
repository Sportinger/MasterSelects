import { describe, expect, it } from 'vitest';
import type { Effect } from '../../src/types/effects';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';
import { effectOperatorGraph, migratePersistedEffectOperatorGraph } from '../../src/services/operators/effectGraphOwner';
import { matchesEffectRecipe } from '../../src/services/operators/effectFamilyPresentation';
import { recognizeOperatorCompositions } from '../../src/services/operators/recognizeOperatorCompositions';
import { packOperatorCompositions } from '../../src/services/operators/operatorComposition';
import { createLegacyBulgeGraph, createLegacyTwirlGraph, createLegacyWaveGraph } from '../../src/services/operators/legacyUvDistortEffectGraphs';
import { createDefaultBulgeGraph, createDefaultTwirlGraph, createDefaultWaveGraph } from '../../src/services/operators/uvDistortRecipes';
import { buildEffectMaterializationFromRecipe } from '../../src/services/timeline/transitionCompositionRecipeTemplate';

type Case = [Effect['type'], () => EffectOperatorGraph, () => EffectOperatorGraph, Record<string, number>, Record<string, number | string>];
const cases: Case[] = [
  ['wave', createLegacyWaveGraph, createDefaultWaveGraph, { amplitudeX: .03, amplitudeY: .01, frequencyX: 6, frequencyY: 2 }, { speed: 0, phase: 0, edges: 'clamp' }],
  ['twirl', createLegacyTwirlGraph, createDefaultTwirlGraph, { amount: 3, radius: .7, centerX: .4, centerY: .6 }, { shape: 'frame', edges: 'clamp' }],
  ['bulge', createLegacyBulgeGraph, createDefaultBulgeGraph, { amount: .5, radius: .5, centerX: .5, centerY: .5 }, { shape: 'frame', edges: 'clamp' }],
];

/** A graph as projects saved it before this change: packed compositions, folders and a moved layout. */
function savedForm(legacy: EffectOperatorGraph): EffectOperatorGraph {
  const packed = packOperatorCompositions(recognizeOperatorCompositions(legacy));
  return { ...packed, effectPresentationRules: 1, groups: [...(packed.groups ?? []), { id: 'organized-coordinates', label: 'Coordinates',
    color: '#6b99bd', nodeIds: packed.nodes.filter(node => node.id !== 'frame' && node.id !== 'output').map(node => node.id), collapsedByDefault: true }],
    layout: Object.fromEntries(packed.nodes.map(node => [node.id, { x: 11, y: 13 }])) };
}
const effect = (type: Effect['type'], params: Effect['params'], operatorGraph?: EffectOperatorGraph): Effect =>
  ({ id: `${type}-saved`, name: type, type, enabled: true, params, ...(operatorGraph ? { operatorGraph } : {}) });

describe('saved Wave, Twirl and Bulge upgrade', () => {
  it.each(cases)('moves an untouched saved %s to the current recipe and fills the new controls with the original look', (type, legacy, current, params, legacyParams) => {
    const migrated = migratePersistedEffectOperatorGraph(effect(type, { ...params }, savedForm(legacy())));
    expect(matchesEffectRecipe(migrated.operatorGraph!, current())).toBe(true);
    expect(migrated.params).toEqual({ ...params, ...legacyParams });
    // Saving and loading again keeps the result stable.
    const again = migratePersistedEffectOperatorGraph(migrated);
    expect(again.params).toEqual(migrated.params);
    expect(matchesEffectRecipe(again.operatorGraph!, current())).toBe(true);
  });

  it.each(cases)('keeps an edited saved %s graph and its parameters exactly as the user left them', (type, legacy, _current, params) => {
    const edited = legacy();
    const literal = edited.nodes.find(node => node.operator === 'values.number' && node.constants && !Object.keys(node.bindings).length)!;
    literal.constants = { value: Number(literal.constants!.value) + 0.5 };
    const migrated = migratePersistedEffectOperatorGraph(effect(type, { ...params }, edited));
    expect(migrated.params).toEqual(params);
    expect(matchesEffectRecipe(migrated.operatorGraph!, legacy())).toBe(false);
    expect(matchesEffectRecipe(effectOperatorGraph(migrated), edited)).toBe(true);
  });

  it.each(cases)('leaves a new %s without a saved graph on the current defaults', (type, _legacy, current, params) => {
    const migrated = migratePersistedEffectOperatorGraph(effect(type, { ...params }));
    expect(matchesEffectRecipe(migrated.operatorGraph!, current())).toBe(true);
    expect(migrated.params).toEqual(params);
  });

  it('materializes transition swirls and drops with the frame-shaped, clamped look of the compositor transition', () => {
    for (const distortion of ['swirl', 'water-drop'] as const) {
      const { effects } = buildEffectMaterializationFromRecipe([{ kind: 'distortion', target: 'outgoing', distortion } as never], 'outgoing', 'clip', 1);
      expect(effects[0].params).toMatchObject({ shape: 'frame', edges: 'clamp' });
    }
  });
});
