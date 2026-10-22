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
      // Irregularity is named by no preset of the effect, so it keeps its value.
      expect(effect.params).toMatchObject({ weave_value: 2, reveal_value: 0.32, irregularity_value: 1 });
      expect(matchingEffectPreset(effect)?.id).toBe('nest');
      getHistoryStateView().undo();
      expect(useTimelineStore.getState().clips[0].effects[0].params).toMatchObject({ weave_value: 1, reveal_value: 1 });
    });
  });

  it('give the same picture whatever preset came before: a graph value another preset names returns to the default graph', () => {
    const presets: EffectPreset[] = [{ id: 'nest', name: 'Nest', params: { weave_value: 2, reveal_value: 0.32 } }, { id: 'calm', name: 'Calm', params: { weave_value: 0.5 } }];
    const run = (sequence: string[]) => {
      const clip = createMockClip({ id: 'weave-clip', effects: [{ id: 'fx', type: 'weave', name: 'Weave', enabled: true, operatorGraph: createDefaultWeaveGraph(), params: { irregularity_value: 1 } }] });
      useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: clip.trackId })], clipKeyframes: new Map(), isExporting: false });
      for (const id of sequence) applyEffectPreset('weave-clip', 'fx', id);
      return useTimelineStore.getState().clips[0].effects[0];
    };
    withDefinition('weave', { presets }, () => {
      const calmAlone = run(['calm']), afterNest = run(['nest', 'calm']);
      // Reveal has no literal in the default graph: it runs at the Value operator's default, 1.
      expect(afterNest.params.reveal_value).toBe(1);
      expect(calmAlone.params.reveal_value ?? 1).toBe(1);
      expect(matchingEffectPreset(afterNest)?.id).toBe('calm');
      expect(matchingEffectPreset(calmAlone)?.id).toBe('calm');
    });
  });

  it('set graph values on an instance that runs its default graph (no stored graph)', () => {
    const clip = createMockClip({ id: 'weave-clip', effects: [{ id: 'fx', type: 'weave', name: 'Weave', enabled: true, params: {} }] });
    useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: clip.trackId })], clipKeyframes: new Map(), isExporting: false });
    withDefinition('weave', { presets: [{ id: 'nest', name: 'Nest', params: { weave_value: 2 } }] }, () => {
      const result = applyEffectPreset('weave-clip', 'fx', 'nest');
      expect(result.kept).toEqual([]);
      expect(result.changed).toEqual(['weave_value']);
      expect(useTimelineStore.getState().clips[0].effects[0].params.weave_value).toBe(2);
      expect(effectPresetNotice({ ...result, kept: [{ key: 'x_value', label: 'X', reason: 'missing' }] })).toBe("Nest: X is not in this effect's graph.");
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
      expect(effectPresetNotice(result)).toBe("Nest: Reveal is not in this effect's saved node graph.");
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
        // From Qualle, a preset that does not name the Form returns to Cloth: judged there, Pulse is hidden and stays.
        const qualle = { type: 'drift-lines', params: { form: 'qualle', pulse: 1.5, scale: 14 } };
        expect(resolveEffectPreset(qualle, { id: 'cloth', name: 'Cloth', params: { scale: 20 } })).toMatchObject({ form: 'cloth', scale: 20 });
        // A preset that stays in the Cloth form leaves the hidden Pulse alone.
        expect(resolveEffectPreset(cloth, { id: 'cloth', name: 'Cloth', params: { scale: 20 } })).not.toHaveProperty('pulse');
      });
    } finally { spy.mockRestore(); }
  });
});
