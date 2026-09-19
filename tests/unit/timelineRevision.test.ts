import { afterEach, describe, expect, it } from 'vitest';

import { useTimelineStore } from '../../src/stores/timeline';
import {
  getTimelineRevision,
  restoreTimelineRevisionForHostedAgentResume,
  updateDerivedTimelineClips,
} from '../../src/stores/timeline/revisionMiddleware';

const initialTimelineState = useTimelineStore.getState();

describe('timeline revision middleware', () => {
  afterEach(() => {
    useTimelineStore.setState(initialTimelineState);
  });

  it('increments once per watched set call across actions and direct state injection', () => {
    const initialRevision = getTimelineRevision();

    const trackId = useTimelineStore.getState().addTrack('midi');
    expect(getTimelineRevision()).toBe(initialRevision + 1);

    // Actions may perform several watched set calls; the contract is one
    // increment per watched set call, so only assert "at least one" here.
    const clipId = useTimelineStore.getState().addMidiClip(trackId, 0, 4);
    expect(clipId).not.toBeNull();
    const revAfterClip = getTimelineRevision();
    expect(revAfterClip).toBeGreaterThan(initialRevision + 1);

    useTimelineStore.getState().setPlayheadPosition(1);
    expect(getTimelineRevision()).toBe(revAfterClip);

    const beforeDirectSet = useTimelineStore.getState();
    useTimelineStore.setState({ clips: [...beforeDirectSet.clips] });
    expect(getTimelineRevision()).toBe(revAfterClip + 1);

    const beforeMultiKeySet = useTimelineStore.getState();
    useTimelineStore.setState({
      clips: [...beforeMultiKeySet.clips],
      tracks: [...beforeMultiKeySet.tracks],
    });
    expect(getTimelineRevision()).toBe(revAfterClip + 2);

    useTimelineStore.setState({ timelineRevision: 0 });
    expect(getTimelineRevision()).toBe(revAfterClip + 2);
  });

  it('increments for duration changes but not playhead-only object patches', () => {
    const initialState = useTimelineStore.getState();
    const initialRevision = getTimelineRevision();

    useTimelineStore.setState({ duration: initialState.duration + 1 });
    expect(getTimelineRevision()).toBe(initialRevision + 1);

    const revisionAfterDuration = getTimelineRevision();
    const watchedClips = useTimelineStore.getState().clips;
    const watchedTracks = useTimelineStore.getState().tracks;
    useTimelineStore.setState({ playheadPosition: 1 });

    expect(getTimelineRevision()).toBe(revisionAfterDuration);
    expect(useTimelineStore.getState().clips).toBe(watchedClips);
    expect(useTimelineStore.getState().tracks).toBe(watchedTracks);
  });

  it('restores an exact reload-verified hosted-agent revision without changing timeline content', () => {
    const before = useTimelineStore.getState();
    const restoredRevision = getTimelineRevision() + 100;

    restoreTimelineRevisionForHostedAgentResume(restoredRevision);

    expect(getTimelineRevision()).toBe(restoredRevision);
    expect(useTimelineStore.getState().clips).toBe(before.clips);
    expect(useTimelineStore.getState().tracks).toBe(before.tracks);
  });

  it('keeps source intelligence and waveform projections outside the durable revision', () => {
    const trackId = useTimelineStore.getState().addTrack('midi');
    const clipId = useTimelineStore.getState().addMidiClip(trackId, 0, 4);
    expect(clipId).not.toBeNull();
    const revisionBeforeProjection = getTimelineRevision();

    updateDerivedTimelineClips(clips => clips.map(clip => clip.id === clipId
      ? {
          ...clip,
          transcript: [{ end: 0.5, start: 0, text: 'Hello' }],
          transcriptProgress: 100,
          transcriptStatus: 'ready',
          waveform: [0, 0.5, 1],
          waveformGenerating: false,
          waveformProgress: 100,
        }
      : clip));

    expect(getTimelineRevision()).toBe(revisionBeforeProjection);
    expect(useTimelineStore.getState().clips.find(clip => clip.id === clipId)).toMatchObject({
      transcriptStatus: 'ready',
      waveformProgress: 100,
    });
  });

  it('rejects durable mutations through the derived projection path', () => {
    const trackId = useTimelineStore.getState().addTrack('midi');
    const clipId = useTimelineStore.getState().addMidiClip(trackId, 0, 4);
    const revisionBeforeProjection = getTimelineRevision();

    expect(() => updateDerivedTimelineClips(clips => clips.map(clip => clip.id === clipId
      ? { ...clip, startTime: clip.startTime + 1 }
      : clip))).toThrow('cannot change durable clip field "startTime"');
    expect(getTimelineRevision()).toBe(revisionBeforeProjection);
  });

  it('allows the first analysis refs without allowing audio edits through the derived path', () => {
    const trackId = useTimelineStore.getState().addTrack('midi');
    const clipId = useTimelineStore.getState().addMidiClip(trackId, 0, 4);
    useTimelineStore.setState({ clips: useTimelineStore.getState().clips.map(clip => (
      clip.id === clipId ? { ...clip, audioState: undefined } : clip
    )) });
    const revision = getTimelineRevision();

    expect(() => updateDerivedTimelineClips(clips => clips.map(clip => clip.id === clipId
      ? { ...clip, audioState: { muted: true } } : clip)))
      .toThrow('cannot change durable clip field "audioState"');

    updateDerivedTimelineClips(clips => clips.map(clip => clip.id === clipId
      ? { ...clip, audioState: { sourceAnalysisRefs: { waveformPyramidId: 'waveform-1' } } }
      : clip));
    expect(useTimelineStore.getState().clips.find(clip => clip.id === clipId)?.audioState)
      .toEqual({ sourceAnalysisRefs: { waveformPyramidId: 'waveform-1' } });
    expect(getTimelineRevision()).toBe(revision);

    updateDerivedTimelineClips(clips => clips.map(clip => clip.id === clipId
      ? { ...clip, audioState: undefined } : clip));
    expect(getTimelineRevision()).toBe(revision);

    useTimelineStore.setState({ clips: useTimelineStore.getState().clips.map(clip => (
      clip.id === clipId ? { ...clip, audioState: { muted: true } } : clip
    )) });
    expect(() => updateDerivedTimelineClips(clips => clips.map(clip => clip.id === clipId
      ? { ...clip, audioState: undefined } : clip)))
      .toThrow('cannot change durable clip field "audioState"');
  });
});
