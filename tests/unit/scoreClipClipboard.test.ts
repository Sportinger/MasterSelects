// Score clip copy/paste (issue #366, port phase 1).
//
// A score clip is data-only (like text/solid/flock): copy must carry
// clip.scoreData in the clipboard payload, and paste must restore it
// synchronously with a fresh clip id and no async media load.

import { beforeEach, describe, expect, it } from 'vitest';
import { useTimelineStore } from '../../src/stores/timeline';
import { ScoreModel } from '../../src/services/score/ScoreModel';
import { fracCreate as frac } from '../../src/services/score/fraction';

describe('score clip clipboard', () => {
  beforeEach(() => {
    const store = useTimelineStore.getState();
    store.clearTimeline();
    store.clipKeyframes.clear();
    useTimelineStore.setState({
      clipboardData: null,
      selectedClipIds: new Set(),
      playheadPosition: 10,
      targetTrackIdByType: {},
    });
  });

  it('copies and pastes a score clip with its notation data', () => {
    const store = useTimelineStore.getState();
    const trackId = store.addTrack('score');
    const clipId = store.addScoreClip(trackId, 0, 4);
    if (!clipId) throw new Error('Failed to create score clip');

    const model = new ScoreModel('Clipboard Test', 120);
    model.addNote({ step: 'A', alter: -1, octave: 3, duration: 'h', measure: 1, beat: frac(1, 1) });
    store.updateScoreData(clipId, model.toScoreData(), { captureHistory: false });

    useTimelineStore.setState({ selectedClipIds: new Set([clipId]) });
    useTimelineStore.getState().copyClips();

    const clipboard = useTimelineStore.getState().clipboardData;
    expect(clipboard).toHaveLength(1);
    expect(clipboard![0].sourceType).toBe('score');
    expect(clipboard![0].scoreData?.title).toBe('Clipboard Test');

    useTimelineStore.getState().pasteClips();

    const clips = useTimelineStore.getState().clips;
    expect(clips).toHaveLength(2);
    const pasted = clips.find(c => c.id !== clipId);
    expect(pasted).toBeDefined();
    expect(pasted!.source?.type).toBe('score');
    expect(pasted!.needsReload).toBeFalsy();
    expect(pasted!.isLoading).toBeFalsy();

    // Notation survives, deep-cloned (no aliasing with the source clip).
    const source = clips.find(c => c.id === clipId)!;
    expect(pasted!.scoreData?.title).toBe('Clipboard Test');
    expect(pasted!.scoreData).not.toBe(source.scoreData);
    const chord = pasted!.scoreData!.measures[0].slots.find(s => s.type === 'chord');
    expect(chord?.type === 'chord' && chord.notes[0].step).toBe('A');
    expect(chord?.type === 'chord' && chord.notes[0].alter).toBe(-1);
    expect(chord?.beat).toEqual({ num: 1, den: 1 });
  });
});
