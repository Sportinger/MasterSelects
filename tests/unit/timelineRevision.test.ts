import { afterEach, describe, expect, it } from 'vitest';

import { useTimelineStore } from '../../src/stores/timeline';
import { getTimelineRevision } from '../../src/stores/timeline/revisionMiddleware';

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
});
