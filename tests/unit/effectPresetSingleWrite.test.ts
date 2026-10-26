// A preset writes its plain controls in one effect update: one write per control made a store update, a
// repository transaction and a graph compile each, which froze playback for 0.5 s when Analog Signal Lab
// switched to Worn VHS. Controls the card records as keys still take the card's own path.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDefaultEffectParams } from '../../src/stores/timeline/utils';
import { applyEffectPreset, matchingEffectPreset } from '../../src/services/effects/effectPresets';
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
  useTimelineStore.setState({ clips: [], tracks: [], clipKeyframes: new Map(), keyframeRecordingEnabled: new Set(), isExporting: false });
});

function setup() {
  const lab: Effect = { id: 'lab', type: 'analog-signal-lab', name: 'Analog Signal Lab', enabled: true, params: getDefaultEffectParams('analog-signal-lab') };
  const clip = createMockClip({ id: 'preset-clip', effects: [lab] });
  useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: clip.trackId })], clipKeyframes: new Map(), keyframeRecordingEnabled: new Set(), isExporting: false });
}
const effect = () => useTimelineStore.getState().clips[0].effects[0];
/** How often the clips change while `run` runs. */
function clipWrites(run: () => void): number {
  let writes = 0;
  const stop = useTimelineStore.subscribe(state => state.clips, () => { writes += 1; });
  try { run(); } finally { stop(); }
  return writes;
}

describe('a preset writes its controls at once', () => {
  it('applies every plain control of Worn VHS in one effect update and one undo step', () => {
    setup();
    // What one effect update writes (the update and its cache invalidation).
    const single = clipWrites(() => useTimelineStore.getState().updateClipEffect('preset-clip', 'lab', { amount: 0.9 }));
    getHistoryStateView().clearHistory();
    setup();
    const before = structuredClone(effect().params);
    let changed: string[] = [];
    expect(clipWrites(() => { changed = applyEffectPreset('preset-clip', 'lab', 'worn-vhs').changed; })).toBe(single);
    expect(changed.length).toBeGreaterThan(3);
    expect(effect().params).toMatchObject({ rfAmount: 0, vhsAmount: 1, tapeSpeed: 'lp', tracking: 0.3, tapeWear: 0.25 });
    expect(matchingEffectPreset(effect())?.id).toBe('worn-vhs');
    getHistoryStateView().undo();
    expect(effect().params).toEqual(before);
  });

  it('records a key for a control in keyframe recording, like the card does', () => {
    setup();
    useTimelineStore.setState({ keyframeRecordingEnabled: new Set(['preset-clip:effect.lab.tracking']) });
    applyEffectPreset('preset-clip', 'lab', 'worn-vhs');
    const keys = useTimelineStore.getState().clipKeyframes.get('preset-clip') ?? [];
    expect(keys.filter(key => key.property === 'effect.lab.tracking').map(key => key.value)).toEqual([0.3]);
    expect(effect().params.vhsAmount).toBe(1);
  });
});
