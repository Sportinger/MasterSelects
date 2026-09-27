// Score clip notation data persistence (issue #366, port phase 1).
//
// Covers the `clip.scoreData` integration points: the updateScoreData store
// action (clone semantics, guards, captureHistory gating), the in-memory
// serialize → clear → load round-trip, and history undo/redo restoring
// notation without marking the score clip needsReload (the inline-data rule).

import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { useTimelineStore } from '../../src/stores/timeline';
import {
  captureSnapshot,
  getHistoryStateView,
  initHistoryStoreRefs,
  setHistoryCallbacks,
  undo,
  redo,
  useHistoryStore,
} from '../../src/stores/historyStore';
import { ScoreModel } from '../../src/services/score/ScoreModel';
import { fracCreate as frac } from '../../src/services/score/fraction';
import type { ScoreData } from '../../src/types/scoreClip';

function makeScoreData(step: 'C' | 'D' | 'E' = 'C'): ScoreData {
  const model = new ScoreModel('Persistence Test', 96);
  model.addNote({ step, alter: 0, octave: 4, duration: 'q', measure: 1, beat: frac(0, 1) });
  model.addNote({ step: 'G', alter: 1, octave: 4, duration: '8', measure: 1, beat: frac(2, 1) });
  return model.toScoreData();
}

function initializeHistoryRefs(): void {
  initHistoryStoreRefs({
    timeline: {
      getState: useTimelineStore.getState,
      setState: useTimelineStore.setState,
    },
    media: {
      getState: () => ({
        files: [],
        compositions: [],
        folders: [],
        selectedIds: [],
        expandedFolderIds: [],
        textItems: [],
        solidItems: [],
        mathSceneItems: [],
        motionShapeItems: [],
        signalAssets: [],
        signalArtifacts: [],
        signalGraphs: [],
        signalOperators: [],
      }),
      setState: () => undefined,
    },
    dock: {
      getState: () => ({ layout: null }),
      setState: () => undefined,
    },
  });
}

function createScoreClip(): { trackId: string; clipId: string } {
  const store = useTimelineStore.getState();
  const trackId = store.addTrack('score');
  const clipId = store.addScoreClip(trackId, 1, 4);
  if (!clipId) throw new Error('Failed to create score clip');
  return { trackId, clipId };
}

const resetTimeline = () => {
  const store = useTimelineStore.getState();
  store.clearTimeline();
  store.clipKeyframes.clear();
};

describe('updateScoreData action', () => {
  beforeEach(() => {
    resetTimeline();
  });

  it('stores a deep clone of the score data', () => {
    const { clipId } = createScoreClip();
    const data = makeScoreData();
    useTimelineStore.getState().updateScoreData(clipId, data, { captureHistory: false });

    // Mutating the caller's object must not affect the stored clip data.
    data.title = 'Mutated After Commit';
    data.measures[0].slots.length = 0;

    const stored = useTimelineStore.getState().clips.find(c => c.id === clipId)?.scoreData;
    expect(stored?.title).toBe('Persistence Test');
    expect(stored?.tempo).toBe(96);
    expect(stored?.schemaVersion).toBe(1);
    expect(stored?.measures[0].slots.length).toBeGreaterThan(0);
  });

  it('refuses to write score data to non-score clips', () => {
    const store = useTimelineStore.getState();
    const midiTrackId = store.addTrack('midi');
    const midiClipId = store.addMidiClip(midiTrackId, 0, 4);
    if (!midiClipId) throw new Error('Failed to create MIDI clip');

    store.updateScoreData(midiClipId, makeScoreData(), { captureHistory: false });
    expect(useTimelineStore.getState().clips.find(c => c.id === midiClipId)?.scoreData).toBeUndefined();
  });
});

describe('scoreData serialize/load round-trip', () => {
  beforeEach(() => {
    resetTimeline();
  });

  it('preserves notation through getSerializableState/loadState', async () => {
    const { clipId } = createScoreClip();
    useTimelineStore.getState().updateScoreData(clipId, makeScoreData('E'), { captureHistory: false });

    const serialized = useTimelineStore.getState().getSerializableState();
    const serializedClip = serialized.clips.find(c => c.id === clipId);
    expect(serializedClip?.sourceType).toBe('score');
    expect(serializedClip?.scoreData?.schemaVersion).toBe(1);

    resetTimeline();
    await useTimelineStore.getState().loadState(serialized);

    const restored = useTimelineStore.getState().clips.find(c => c.id === clipId);
    expect(restored?.source?.type).toBe('score');
    const score = restored?.scoreData;
    expect(score?.title).toBe('Persistence Test');
    expect(score?.tempo).toBe(96);

    // The chord content survives with exact-fraction beats and spelling intact.
    const chords = score!.measures[0].slots.filter(s => s.type === 'chord');
    expect(chords).toHaveLength(2);
    const [first, second] = chords;
    expect(first.type === 'chord' && first.notes[0].step).toBe('E');
    expect(first.beat).toEqual({ num: 0, den: 1 });
    expect(second.type === 'chord' && second.notes[0].step).toBe('G');
    expect(second.type === 'chord' && second.notes[0].alter).toBe(1);
    expect(second.beat).toEqual({ num: 2, den: 1 });
  });
});

describe('scoreData history undo/redo', () => {
  const initialTimelineState = useTimelineStore.getState();

  beforeEach(() => {
    setHistoryCallbacks({
      flushPendingCapture: () => undefined,
      suppressCaptures: () => undefined,
    });
    initializeHistoryRefs();
    useHistoryStore.setState({ batchId: null, batchLabel: null });
    getHistoryStateView().clearHistory();
    resetTimeline();
  });

  afterEach(() => {
    getHistoryStateView().clearHistory();
    useTimelineStore.setState(initialTimelineState);
  });

  it('undo/redo restores scoreData without marking the clip needsReload', () => {
    const { clipId } = createScoreClip();
    useTimelineStore.getState().updateScoreData(clipId, makeScoreData('C'), { captureHistory: false });
    captureSnapshot('initial');

    // Edit: replace with a different score (captures its own snapshot).
    useTimelineStore.getState().updateScoreData(clipId, makeScoreData('D'), { description: 'Edit score' });

    const stepAt = () => {
      const clip = useTimelineStore.getState().clips.find(c => c.id === clipId);
      const chord = clip?.scoreData?.measures[0].slots.find(s => s.type === 'chord');
      return chord?.type === 'chord' ? chord.notes[0].step : undefined;
    };

    expect(stepAt()).toBe('D');

    expect(undo()).toMatchObject({ operation: 'undo' });
    const afterUndo = useTimelineStore.getState().clips.find(c => c.id === clipId);
    expect(stepAt()).toBe('C');
    // Score clips are inline-data: undo must not schedule a media reload.
    expect(afterUndo?.needsReload).toBeFalsy();
    expect(afterUndo?.source?.type).toBe('score');

    expect(redo()).toMatchObject({ operation: 'redo' });
    expect(stepAt()).toBe('D');
    expect(useTimelineStore.getState().clips.find(c => c.id === clipId)?.needsReload).toBeFalsy();
  });

  it('captureHistory:false does not add an undo step', () => {
    const { clipId } = createScoreClip();
    captureSnapshot('initial');
    const nodeCountBefore = Object.keys(useHistoryStore.getState().nodes).length;

    useTimelineStore.getState().updateScoreData(clipId, makeScoreData(), { captureHistory: false });

    const nodeCountAfter = Object.keys(useHistoryStore.getState().nodes).length;
    expect(nodeCountAfter).toBe(nodeCountBefore);
    // The data change itself still lands.
    expect(useTimelineStore.getState().clips.find(c => c.id === clipId)?.scoreData?.schemaVersion).toBe(1);
  });
});
