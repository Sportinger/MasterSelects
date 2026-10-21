import { afterEach, describe, expect, it } from 'vitest';
import type { Effect } from '../../src/types/effects';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';
import { createLegacyKaleidoscopeGraph } from '../../src/services/operators/legacyMirrorPixelEffectGraphs';
import { createLegacyBulgeGraph, createLegacyTwirlGraph, createLegacyWaveGraph } from '../../src/services/operators/legacyUvDistortEffectGraphs';
import { createDefaultBulgeGraph, createDefaultTwirlGraph, createDefaultWaveGraph } from '../../src/services/operators/uvDistortRecipes';
import { matchesEffectRecipe } from '../../src/services/operators/effectFamilyPresentation';
import { rendersBuiltInUvDistortRecipe } from '../../src/services/operators/uvDistortIdentity';
import { workerSoftwareEffectPlanForLayer } from '../../src/services/render/workerSoftwareEffectPlan';
import type { Layer } from '../../src/types';
import { EFFECT_PRESET_STORAGE_KEY, instantiateEffectPreset, listEffectPresets, removeEffectPreset, saveEffectPreset } from '../../src/services/nodeGraph/effectPresetLibrary';
import { applyEffectPreset } from '../../src/services/nodeGraph/applyEffectPreset';
import { useTimelineStore } from '../../src/stores/timeline';
import { createMockClip, createMockTrack } from '../helpers/mockData';

const memory = () => {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
};
/** A user-edited Kaleidoscope graph (the pre-review recipe with a changed circle constant), kept as saved. */
const editedKaleidoscope = () => {
  const graph = createLegacyKaleidoscopeGraph();
  graph.nodes.find(node => node.id === 'tau')!.constants = { value: 7 };
  return graph;
};
const source = (): Effect => ({ id: 'original', name: 'Custom kaleidoscope', type: 'kaleidoscope', enabled: true,
  params: { segments: 11, rotation: 0.3 }, operatorGraph: editedKaleidoscope() });
afterEach(() => useTimelineStore.setState({ clips: [], tracks: [], isExporting: false }));

describe('effect preset library', () => {
  it('persists the edited graph and parameters, with independent source, library and instance ownership', () => {
    const store = memory(), original = source();
    original.operatorGraph!.layout.sample = { x: 123, y: 456 };
    const preset = saveEffectPreset(original, ' My effect ', store);
    original.params.segments = 4;
    original.operatorGraph!.layout.sample.x = 0;
    const restored = listEffectPresets(store)[0];
    expect(restored.label).toBe('My effect');
    expect(restored.effect.params.segments).toBe(11);
    expect(restored.effect.operatorGraph!.layout.sample).toEqual({ x: 123, y: 456 });
    const first = instantiateEffectPreset(restored), second = instantiateEffectPreset(restored);
    expect(new Set([original.id, first.id, second.id]).size).toBe(3);
    first.params.segments = 2;
    first.operatorGraph!.nodes[0].bypassed = true;
    expect(second.params.segments).toBe(11);
    expect(second.operatorGraph!.nodes[0].bypassed).not.toBe(true);
    removeEffectPreset(preset.id, store);
    expect(listEffectPresets(store)).toEqual([]);
    expect(second.operatorGraph!.edges).toEqual(restored.effect.operatorGraph!.edges);
  });

  it.each([
    ['wave', createLegacyWaveGraph, createDefaultWaveGraph, { amplitudeX: .03, amplitudeY: .01, frequencyX: 6, frequencyY: 2 }, { speed: 0, phase: 0, edges: 'clamp' }],
    ['twirl', createLegacyTwirlGraph, createDefaultTwirlGraph, { amount: 3, radius: .7, centerX: .4, centerY: .6 }, { shape: 'frame', edges: 'clamp' }],
    ['bulge', createLegacyBulgeGraph, createDefaultBulgeGraph, { amount: .5, radius: .5, centerX: .5, centerY: .5 }, { shape: 'frame', edges: 'clamp' }],
  ] as [string, () => EffectOperatorGraph, () => EffectOperatorGraph, Record<string, number>, Record<string, number | string>][])(
    'instantiates a %s preset saved with the retired recipe as the current recipe with its original look', (type, legacy, current, params, legacyParams) => {
      // Presets saved before the distort rebuild always stored the (then current) recipe graph.
      const preset = { id: 'old', label: `Old ${type}`, effect: { type, enabled: true, params: { ...params }, operatorGraph: legacy() } };
      const effect = instantiateEffectPreset(preset);
      expect(matchesEffectRecipe(effect.operatorGraph!, current())).toBe(true);
      expect(effect.params).toEqual({ ...params, ...legacyParams });
      // It renders like the reloaded project: the built-in recipe, so the worker CPU uses the hand-written pass.
      expect(rendersBuiltInUvDistortRecipe(effect)).toBe(true);
      const plan = workerSoftwareEffectPlanForLayer({ id: 'layer', effects: [effect] } as unknown as Layer)!;
      expect(plan.pixelEffects.uvDistortAdjustments).toHaveLength(1);
      expect(plan.pixelEffects.imageOperatorPlans).toBeUndefined();
      // The stored preset itself is not changed.
      expect(preset.effect.params).toEqual(params);
    });

  it('does not overwrite unreadable libraries and reports quota failures', () => {
    const store = memory(); store.setItem(EFFECT_PRESET_STORAGE_KEY, '{');
    expect(() => saveEffectPreset(source(), 'Test', store)).toThrow();
    expect(store.getItem(EFFECT_PRESET_STORAGE_KEY)).toBe('{');
    expect(() => saveEffectPreset(source(), 'Test', { getItem: () => null, setItem: () => { throw new Error('quota'); } })).toThrow('Browser storage');
    expect(() => saveEffectPreset(source(), ' ', memory())).toThrow('Enter a name');
  });

  it('adds copies to the destination while preserving existing effects', () => {
    const clip = createMockClip({ effects: [source()] });
    useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: clip.trackId })] });
    const preset = saveEffectPreset(source(), 'Saved', memory());
    const id = applyEffectPreset(clip.id, preset);
    const effects = useTimelineStore.getState().clips[0].effects;
    expect(effects).toHaveLength(2);
    expect(effects[0]).toEqual(clip.effects[0]);
    expect(id).toBe(`effect-${effects[1].id}`);
    expect(effects[1].name).toBe('Saved');
    expect(effects[1].operatorGraph).toEqual(preset.effect.operatorGraph);
  });

  it.each(['locked', 'exporting'])('rejects insertion while %s without changing the clip', reason => {
    const clip = createMockClip();
    useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: clip.trackId, locked: reason === 'locked' })], isExporting: reason === 'exporting' });
    expect(() => applyEffectPreset(clip.id, saveEffectPreset(source(), 'Saved', memory()))).toThrow('locked or exporting');
    expect(useTimelineStore.getState().clips[0]).toEqual(clip);
  });
});
