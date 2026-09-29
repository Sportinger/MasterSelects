import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStore } from 'zustand/vanilla';
import { subscribeWithSelector } from 'zustand/middleware';
import { subscribeTimelineAnalysisRuntime } from '../../src/services/timeline/timelineRuntimeCoordinator';

afterEach(() => vi.unstubAllGlobals());

describe('timeline analysis subscriptions', () => {
  it('ignores playback and selection but observes sources, clips and project changes', () => {
    const timeline = createStore(subscribeWithSelector(() => ({ clips: [], playheadPosition: 0, isPlaying: false })));
    const media = createStore(subscribeWithSelector(() => ({ files: [], selectedIds: [], currentProjectId: 'a' })));
    vi.stubGlobal('__timelineStoreModule', { useTimelineStore: timeline });
    vi.stubGlobal('__mediaStoreModule', { useMediaStore: media });
    const listener = vi.fn();
    const dispose = subscribeTimelineAnalysisRuntime(listener);
    timeline.setState({ playheadPosition: 4, isPlaying: true });
    media.setState({ selectedIds: [] });
    expect(listener).not.toHaveBeenCalled();
    timeline.setState({ clips: [] });
    media.setState({ files: [] });
    media.setState({ currentProjectId: 'b' });
    expect(listener).toHaveBeenCalledTimes(3);
    dispose();
    timeline.setState({ clips: [] });
    expect(listener).toHaveBeenCalledTimes(3);
  });
});
