import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getAllEffects, getEffect } from '../../src/effects';
import { paramRangeNotes } from '../../src/effects/paramRangeNotes';
import { driftLinesWarnings } from '../../src/effects/halftone/driftLines';
import { applyEffectPreset, effectPresetNotice, matchingEffectPreset, resolveEffectPreset } from '../../src/services/effects/effectPresets';
import { useTimelineStore } from '../../src/stores/timeline';
import { getHistoryStateView, initHistoryStoreRefs, setHistoryCallbacks } from '../../src/stores/historyStore';
import type { Keyframe } from '../../src/types/keyframes';
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

function setup(params: Record<string, number | string | boolean> = {}, keyframes: Keyframe[] = []) {
  const clip = createMockClip({ id: 'preset-clip', effects: [
    { id: 'fx', type: 'drift-lines', name: 'drift-lines', enabled: true, params: { scale: 14, amount: 0.75, speed: 1, ...params } },
  ] });
  useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: clip.trackId })], clipKeyframes: new Map([[clip.id, keyframes]]), isExporting: false });
}
const effect = () => useTimelineStore.getState().clips[0].effects[0];

describe('effect presets', () => {
  it('declares three to five valid, distinct presets wherever an effect has them', () => {
    const withPresets = getAllEffects().filter(definition => definition.presets?.length);
    expect(withPresets.map(definition => definition.id)).toContain('drift-lines');
    for (const definition of withPresets) {
      const presets = definition.presets!;
      expect(presets.length, definition.id).toBeGreaterThanOrEqual(3);
      expect(presets.length, definition.id).toBeLessThanOrEqual(5);
      expect(new Set(presets.map(preset => preset.id)).size).toBe(presets.length);
      expect(new Set(presets.map(preset => preset.name)).size).toBe(presets.length);
      for (const preset of presets) {
        expect(preset.id, `${definition.id} preset id`).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
        for (const [key, value] of Object.entries(preset.params)) {
          const param = definition.params[key], where = `${definition.id} / ${preset.name} / ${key}`;
          expect(param, where).toBeDefined();
          expect(param.hidden || param.deprecated, `${where}: presets set shown controls only`).toBeFalsy();
          if (param.type === 'number') {
            expect(typeof value === 'number' && Number.isFinite(value), where).toBe(true);
            expect(value as number, where).toBeGreaterThanOrEqual(param.min ?? -Infinity);
            expect(value as number, where).toBeLessThanOrEqual(param.max ?? Infinity);
          } else if (param.type === 'select') expect(param.options?.some(option => option.value === value), where).toBe(true);
          else if (param.type === 'boolean') expect(typeof value, where).toBe('boolean');
          else expect(typeof value, where).toBe('string');
        }
      }
      // Distinct looks: no two presets resolve to the same values.
      const resolved = presets.map(preset => JSON.stringify(resolveEffectPreset({ type: definition.id, params: {} }, preset)));
      expect(new Set(resolved).size, definition.id).toBe(presets.length);
    }
  });

  it('applies a preset in one undo step and names it as the current preset', () => {
    setup({ scale: 30, amount: 0.4 });
    const result = applyEffectPreset('preset-clip', 'fx', 'rain-curtain');
    expect(result.kept).toEqual([]);
    // Values the preset leaves out return to their defaults (Speed, Drift and Angle are its own here).
    expect(effect().params).toMatchObject({ scale: 6, amount: 0.25, angle: 90, speed: 1.6 });
    expect(matchingEffectPreset(effect())?.name).toBe('Rain Curtain');
    expect(getHistoryStateView().undo()).toMatchObject({ operation: 'undo' });
    expect(effect().params).toMatchObject({ scale: 30, amount: 0.4, speed: 1 });
    expect(matchingEffectPreset(effect())).toBeUndefined();
  });

  it('keeps keyframed controls and says so', () => {
    const property = 'effect.fx.amount' as Keyframe['property'];
    setup({}, [{ id: 'k0', clipId: 'preset-clip', property, time: 0, value: 0, easing: 'linear' },
      { id: 'k1', clipId: 'preset-clip', property, time: 2, value: 1, easing: 'linear' }]);
    const result = applyEffectPreset('preset-clip', 'fx', 'heat-haze');
    expect(result.kept).toEqual([{ key: 'amount', label: 'Drift', reason: 'keyframes' }]);
    expect(effect().params).toMatchObject({ scale: 3, speed: 0.6 });
    expect(useTimelineStore.getState().clipKeyframes.get('preset-clip')?.map(key => key.value)).toEqual([0, 1]);
    expect(effectPresetNotice(result)).toBe('Heat Haze: Drift kept its keyframes.');
  });

  it('rejects unknown presets and locked tracks', () => {
    setup();
    expect(() => applyEffectPreset('preset-clip', 'fx', 'nope')).toThrow(/not a preset/u);
    useTimelineStore.setState({ tracks: useTimelineStore.getState().tracks.map(track => ({ ...track, locked: true })) });
    expect(() => applyEffectPreset('preset-clip', 'fx', 'torn-signal')).toThrow(/locked/u);
  });
});

describe('Drift Lines definition', () => {
  const definition = getEffect('drift-lines')!;

  it('moves with the playhead instead of re-rendering while paused', () => {
    expect(definition.requiresContinuousRender).toBe(false);
    expect('timelineAnimated' in definition && definition.timelineAnimated).toBe(true);
  });

  it('reports the Band Size clamp and bands thinner than a pixel', () => {
    expect(paramRangeNotes(definition.params, { scale: 0 })[0]).toMatchObject({ label: 'Band Size', rendered: 2 });
    expect(driftLinesWarnings({ scale: 2 }, 256, 144)[0]).toMatch(/thinner than one pixel on this 256×144 frame/u);
    expect(driftLinesWarnings({ scale: 2 }, 1920, 1080)).toEqual([]);
  });
});
