import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getEffect } from '../../src/effects';
import type { EffectParam, EffectPreset } from '../../src/effects/types';
import { applyEffectPreset, effectPresetNotice, matchingEffectPreset, resolveEffectPreset } from '../../src/services/effects/effectPresets';
import { createDefaultWeaveGraph } from '../../src/services/operators/geometry/weaveGraph';
import { useTimelineStore } from '../../src/stores/timeline';
import { getHistoryStateView, initHistoryStoreRefs, setHistoryCallbacks } from '../../src/stores/historyStore';
import { createMockClip, createMockTrack } from '../helpers/mockData';

beforeEach(() => {
  setHistoryCallbacks({ flushPendingCapture: () => undefined, suppressCaptures: () => undefined });
  initHistoryStoreRefs({ timeline: { getState: useTimelineStore.getState, setState: useTimelineStore.setState },
    media: { getState: () => ({ files: [], compositions: [], folders: [], selectedIds: [], expandedFolderIds: [], textItems: [], solidItems: [], mathSceneItems: [], motionShapeItems: [], signalAssets: [], signalArtifacts: [], signalGraphs: [], signalOperators: [] }), setState: () => undefined },
    dock: { getState: () => ({ layout: null }), setState: () => undefined } });
  getHistoryStateView().clearHistory();
});
afterEach(() => {
  getHistoryStateView().clearHistory();
  useTimelineStore.setState({ clips: [], tracks: [], clipKeyframes: new Map(), isExporting: false });
});

/** Temporarily gives a registered effect presets (and parameters) for one test. */
function withDefinition<T>(type: string, change: { presets: readonly EffectPreset[]; params?: Record<string, EffectParam> }, run: () => T): T {
  const definition = getEffect(type)! as { presets?: readonly EffectPreset[]; params: Record<string, EffectParam> };
  const presets = definition.presets, params = definition.params;
  definition.presets = change.presets;
  if (change.params) definition.params = { ...params, ...change.params };
  try { return run(); } finally { definition.presets = presets; definition.params = params; }
}

describe('presets of a graph effect', () => {
  it('set the exposed graph values a preset names (Weave Speed, Reveal) in one undo step', () => {
    const graph = createDefaultWeaveGraph();
    const clip = createMockClip({ id: 'weave-clip', effects: [{ id: 'fx', type: 'weave', name: 'Weave', enabled: true, operatorGraph: graph,
      params: { weave_value: 1, reveal_value: 1, irregularity_value: 1 } }] });
    useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: clip.trackId })], clipKeyframes: new Map(), isExporting: false });
    const nest: EffectPreset = { id: 'nest', name: 'Nest', params: { weave_value: 2, reveal_value: 0.32 } };
    withDefinition('weave', { presets: [nest, { id: 'calm', name: 'Calm', params: { weave_value: 0.5 } }] }, () => {
      const result = applyEffectPreset('weave-clip', 'fx', 'nest');
      expect(result.changed).toEqual(['weave_value', 'reveal_value']);
      const effect = useTimelineStore.getState().clips[0].effects[0];
      // Graph values the preset leaves out keep theirs.
      expect(effect.params).toMatchObject({ weave_value: 2, reveal_value: 0.32, irregularity_value: 1 });
      expect(matchingEffectPreset(effect)?.id).toBe('nest');
      getHistoryStateView().undo();
      expect(useTimelineStore.getState().clips[0].effects[0].params).toMatchObject({ weave_value: 1, reveal_value: 1 });
    });
  });

  it('names a graph value the edited graph no longer exposes instead of dropping it silently', () => {
    const graph = createDefaultWeaveGraph();
    const reveal = graph.nodes.find(node => node.id === 'reveal')!;
    delete reveal.exposed; reveal.bindings = {}; reveal.constants = { value: 1 };
    const clip = createMockClip({ id: 'weave-clip', effects: [{ id: 'fx', type: 'weave', name: 'Weave', enabled: true, operatorGraph: graph,
      params: { weave_value: 1, irregularity_value: 1 } }] });
    useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: clip.trackId })], clipKeyframes: new Map(), isExporting: false });
    withDefinition('weave', { presets: [{ id: 'nest', name: 'Nest', params: { weave_value: 2, reveal_value: 0.32 } }] }, () => {
      const result = applyEffectPreset('weave-clip', 'fx', 'nest');
      expect(result.changed).toEqual(['weave_value']);
      expect(result.kept).toEqual([{ key: 'reveal_value', label: 'Reveal', reason: 'missing' }]);
      expect(effectPresetNotice(result)).toBe("Nest: Reveal is not in this effect's edited graph.");
    });
  });
});

describe('presets that switch a mode', () => {
  // A Form choice decides which controls show (as Weave's Woven Cloth / Qualle on its own branch).
  const params: Record<string, EffectParam> = {
    form: { type: 'select', label: 'Form', default: 'cloth', options: [{ value: 'cloth', label: 'Cloth' }, { value: 'qualle', label: 'Qualle' }] },
    pulse: { type: 'number', label: 'Pulse', default: 0.4, min: 0, max: 2, step: 0.01, hidden: true },
  };

  it('judge the controls with the preset in place, so the controls of the new mode reset and named ones apply', async () => {
    const visibility = await import('../../src/services/operators/effectParamVisibility');
    const original = visibility.effectParamDefinitions;
    // Pulse shows in the Qualle form only.
    const spy = (await import('vitest')).vi.spyOn(visibility, 'effectParamDefinitions').mockImplementation(effect => {
      const definitions = original(effect);
      return effect.params.form === 'qualle' ? { ...definitions, pulse: { ...definitions.pulse, hidden: false } } : definitions;
    });
    try {
      withDefinition('drift-lines', { params, presets: [
        { id: 'qualle', name: 'Qualle', params: { form: 'qualle' } },
        { id: 'fast-qualle', name: 'Fast Qualle', params: { form: 'qualle', pulse: 1.5 } },
        { id: 'cloth', name: 'Cloth', params: { scale: 20 } }] }, () => {
        const cloth = { type: 'drift-lines', params: { form: 'cloth', pulse: 1.2, scale: 14 } };
        // The Qualle form's Pulse returns to its default, though it is hidden in the current Cloth form.
        expect(resolveEffectPreset(cloth, { id: 'qualle', name: 'Qualle', params: { form: 'qualle' } })).toMatchObject({ form: 'qualle', pulse: 0.4 });
        expect(resolveEffectPreset(cloth, { id: 'fast-qualle', name: 'Fast Qualle', params: { form: 'qualle', pulse: 1.5 } }).pulse).toBe(1.5);
        // A preset that stays in the Cloth form leaves the hidden Pulse alone.
        expect(resolveEffectPreset(cloth, { id: 'cloth', name: 'Cloth', params: { scale: 20 } })).not.toHaveProperty('pulse');
      });
    } finally { spy.mockRestore(); }
  });
});
