// Presets leave setup and quality controls alone (EffectParam.presetKeeps), and a preset that cannot do
// what it says (controls a saved node graph lacks, or nothing to change) says so in the card, offering the
// effect's current graph when that graph has the missing controls.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getEffect } from '../../src/effects';
import { applyEffectPreset, effectPresetNotice, matchingEffectPreset, presetKeepsControl, resolveEffectPreset } from '../../src/services/effects/effectPresets';
import { migratePersistedEffectOperatorGraph } from '../../src/services/operators/effectGraphOwner';
import { useTimelineStore } from '../../src/stores/timeline';
import { getHistoryStateView, initHistoryStoreRefs, setHistoryCallbacks } from '../../src/stores/historyStore';
import type { Effect } from '../../src/types/effects';
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

function setup(effect: Effect) {
  const clip = createMockClip({ id: 'preset-clip', effects: [effect] });
  useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: clip.trackId })], clipKeyframes: new Map(), isExporting: false });
}
const effect = () => useTimelineStore.getState().clips[0].effects[0];
const keptKeys = (type: string) => Object.entries(getEffect(type)!.params).filter(([, param]) => presetKeepsControl(param)).map(([key]) => key);

describe('presets keep setup controls', () => {
  it('marks the shot setup of Chroma Key, Lens Correction and Stick Figure, and every quality control', () => {
    expect(keptKeys('chroma-key')).toEqual(['keyColor', 'screenColor', 'view']);
    expect(keptKeys('lens-correction')).toEqual(['profile', 'focalLength', 'aperture', 'focusDistance', 'cropFactor']);
    expect(keptKeys('stick-figure')).toEqual(['rootX', 'rootY', 'scale', 'groundMode', 'groundY', 'facing']);
    expect(keptKeys('fisheye')).toEqual(['samples']);
  });

  it('a Stick Figure preset keeps where the figure stands, its size and facing, and still names the preset', () => {
    setup({ id: 'fx', type: 'stick-figure', name: 'stick-figure', enabled: true,
      params: { ...Object.fromEntries(Object.entries(getEffect('stick-figure')!.params).map(([key, param]) => [key, param.default])),
        rootX: 240, rootY: -60, scale: 1.8, facing: 'left', opacity: 0.4 } });
    const result = applyEffectPreset('preset-clip', 'fx', 'arabesque');
    expect(result.changed).not.toContain('rootX');
    expect(effect().params).toMatchObject({ rootX: 240, rootY: -60, scale: 1.8, facing: 'left', opacity: 1, headStyle: 'ring', spine: 20 });
    expect(matchingEffectPreset(effect())?.id).toBe('arabesque');
    // Moving the figure afterwards keeps the preset's name: the setup is not part of the look.
    useTimelineStore.getState().updateClipEffect('preset-clip', 'fx', { rootX: -300 });
    expect(matchingEffectPreset(effect())?.id).toBe('arabesque');
  });

  it('leaves kept controls out of the values unless the preset names them', () => {
    const lens = resolveEffectPreset({ type: 'lens-correction', params: { profile: 'canon-rf-24-105-f4l', focalLength: 50, distortion: 30 } },
      { id: 'even', name: 'Even', params: { vignette: 40 } });
    expect(lens).toMatchObject({ vignette: 40, distortion: 0 });
    for (const key of keptKeys('lens-correction')) expect(lens).not.toHaveProperty(key);
    expect(resolveEffectPreset({ type: 'fisheye', params: { samples: 8 } }, { id: 'a', name: 'A', params: {} })).not.toHaveProperty('samples');
    expect(resolveEffectPreset({ type: 'fisheye', params: {} }, { id: 'b', name: 'B', params: { samples: 1 } })).toMatchObject({ samples: 1 });
    const key = resolveEffectPreset({ type: 'chroma-key', params: { keyColor: 'blue', view: 'matte' } }, { id: 'c', name: 'C', params: { clipBlack: 0.1 } });
    expect(key).toMatchObject({ clipBlack: 0.1, clipWhite: 0.85 });
    expect(key).not.toHaveProperty('keyColor');
    expect(key).not.toHaveProperty('view');
  });
});

describe('presets that cannot do what they say', () => {
  const SAVED: Record<string, { saved: Effect }> = JSON.parse(
    readFileSync(path.join(process.cwd(), 'tests', 'fixtures', 'glyph-graphs-saved-3.2.7.json'), 'utf8'));
  const savedAscii = () => migratePersistedEffectOperatorGraph(structuredClone(SAVED.ascii.saved));

  it('names the controls a 3.2.7 node setup lacks, never names the preset, and offers the current graph', () => {
    setup(savedAscii());
    const result = applyEffectPreset('preset-clip', 'fx', 'green-terminal');
    expect(result.kept.filter(item => item.reason === 'missing').map(item => item.key)).toEqual(['background', 'blackLevel']);
    expect(result.upgradable).toBe(true);
    expect(effectPresetNotice(result)).toBe("Green Terminal: Background and Black Level are not in this effect's saved node graph.");
    expect(effect().operatorGraph).toBeDefined();
    expect(matchingEffectPreset(effect())).toBeUndefined();
  });

  it('swaps in the current graph and applies the preset in one undo step', () => {
    setup(savedAscii());
    const before = structuredClone(effect());
    const result = applyEffectPreset('preset-clip', 'fx', 'green-terminal', { currentGraph: true });
    expect(result.graphReplaced).toBe(true);
    expect(result.kept).toEqual([]);
    expect(effectPresetNotice(result)).toBe('Green Terminal: the node graph is now the current one (Undo brings back the old one).');
    expect(effect().operatorGraph).toBeUndefined();
    expect(effect().params).toMatchObject({ background: 0.1, blackLevel: 0.2, colorMode: 'duotone' });
    expect(matchingEffectPreset(effect())?.id).toBe('green-terminal');
    getHistoryStateView().undo();
    expect(effect().operatorGraph).toEqual(before.operatorGraph);
    expect(effect().params).toEqual(before.params);
  });

  it('says so when a preset changes nothing', () => {
    setup(savedAscii());
    applyEffectPreset('preset-clip', 'fx', 'green-terminal', { currentGraph: true });
    expect(effectPresetNotice(applyEffectPreset('preset-clip', 'fx', 'green-terminal'))).toBe('Green Terminal: the card already has these values.');
    expect(effectPresetNotice({ preset: { id: 'p', name: 'Smoke', params: {} }, changed: [], kept: [{ key: 'flow', label: 'Flow', reason: 'missing' }], graphEdited: true }))
      .toBe("Smoke changed nothing: Flow is not in this effect's saved node graph.");
  });
});
