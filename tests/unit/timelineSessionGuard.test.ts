import { beforeEach, describe, expect, it, vi } from 'vitest';
import { engine } from '../../src/engine/WebGPUEngine';
import { layerBuilder } from '../../src/services/layerBuilder';
import { useTimelineStore } from '../../src/stores/timeline';

const initialTimelineState = useTimelineStore.getState();

describe('timeline session guard', () => {
  beforeEach(() => {
    useTimelineStore.setState(initialTimelineState);
    (engine as { clearCaches?: () => void }).clearCaches = vi.fn();
    (layerBuilder as { getVideoSyncManager?: () => { reset: () => void } }).getVideoSyncManager = () => ({
      reset: vi.fn(),
    });
  });

  it('increments the session id when clearing the timeline', () => {
    useTimelineStore.setState({
      timelineSessionId: 7,
      duration: 123,
      selectedClipIds: new Set(['clip-1']),
      primarySelectedClipId: 'clip-1',
    });

    useTimelineStore.getState().clearTimeline();

    const state = useTimelineStore.getState();
    expect(state.timelineSessionId).toBe(8);
    expect(state.selectedClipIds.size).toBe(0);
    expect(state.primarySelectedClipId).toBeNull();
  });

  it('preserves the bumped session id when loadState resets to a blank timeline', async () => {
    useTimelineStore.setState({
      timelineSessionId: 11,
      duration: 123,
      zoom: 80,
      scrollX: 240,
      selectedClipIds: new Set(['clip-1']),
      primarySelectedClipId: 'clip-1',
    });

    await useTimelineStore.getState().loadState(undefined);

    const state = useTimelineStore.getState();
    expect(state.timelineSessionId).toBe(12);
    expect(state.clips).toEqual([]);
    expect(state.duration).toBe(60);
    expect(state.zoom).toBe(50);
    expect(state.scrollX).toBe(0);
    expect(state.selectedClipIds.size).toBe(0);
    expect(state.primarySelectedClipId).toBeNull();
  });
});
