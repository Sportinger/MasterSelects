import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTimelineStore } from '../../src/stores/timeline';
import { initHistoryStoreRefs, useHistoryStore } from '../../src/stores/historyStore';
import { createMockClip, createMockTrack } from '../helpers/mockData';
import { installFakeMediaStore } from '../helpers/fakeMediaStore';
import { getInternalPlaybackPosition, playheadState, setMasterAudioClock, startInternalPosition, stopInternalPosition } from '../../src/services/layerBuilder/PlayheadState';

function installGapTimeline(playheadPosition: number) {
  useTimelineStore.setState({
    tracks: [createMockTrack({ id: 'video-1', type: 'video' })],
    clips: [
      createMockClip({ id: 'a', trackId: 'video-1', startTime: 0, duration: 2 }),
      createMockClip({ id: 'b', trackId: 'video-1', startTime: 5, duration: 2 }),
    ],
    selectedClipIds: new Set(), primarySelectedClipId: null,
    propertiesSelection: null, playheadPosition, duration: 60,
    isPlaying: false, isExporting: false, isDraggingPlayhead: false,
  });
  useTimelineStore.getState().setPlayheadPosition(playheadPosition);
}

describe('gap deletion playhead mapping', () => {
  beforeEach(() => {
    stopInternalPosition();
    installFakeMediaStore();
    initHistoryStoreRefs({
      timeline: { getState: useTimelineStore.getState, setState: useTimelineStore.setState },
      media: {
        getState: () => ({
          files: [], compositions: [], folders: [], selectedIds: [], expandedFolderIds: [],
          textItems: [], solidItems: [], mathSceneItems: [], motionShapeItems: [],
          signalAssets: [], signalArtifacts: [], signalGraphs: [], signalOperators: [],
        }),
        setState: vi.fn(),
      },
      dock: { getState: () => ({ layout: null as never }), setState: vi.fn() },
    });
    useHistoryStore.getState().clearHistory();
    installGapTimeline(0);
  });

  afterEach(() => {
    stopInternalPosition();
    useTimelineStore.setState({ isPlaying: false });
    useHistoryStore.getState().clearHistory();
    vi.restoreAllMocks();
  });

  it.each([[1, 1], [2, 2], [3, 2], [5, 2], [6, 3], [10, 7]])(
    'maps playhead %s to %s when removing the 2-5 second gap', (before, after) => {
      installGapTimeline(before);
      expect(useTimelineStore.getState().deleteGapAtTime(3).success).toBe(true);
      expect(useTimelineStore.getState().playheadPosition).toBe(after);
      expect(playheadState.position).toBe(after);
    },
  );

  it('removes cumulative gaps once, while preserving linked audio timing', () => {
    const video = [
      createMockClip({ id: 'a', trackId: 'video-1', startTime: 1, duration: 2, linkedClipId: 'audio-a' }),
      createMockClip({ id: 'b', trackId: 'video-1', startTime: 6, duration: 2, linkedClipId: 'audio-b' }),
      createMockClip({ id: 'c', trackId: 'video-1', startTime: 10, duration: 2, linkedClipId: 'audio-c' }),
    ];
    useTimelineStore.setState({
      tracks: [createMockTrack({ id: 'video-1' }), createMockTrack({ id: 'audio-1', type: 'audio' })],
      clips: [...video, ...video.map(clip => ({ ...clip, id: `audio-${clip.id}`, trackId: 'audio-1', linkedClipId: clip.id }))],
      playheadPosition: 11,
    });
    useTimelineStore.getState().deleteAllGaps();
    expect(useTimelineStore.getState().playheadPosition).toBe(5);
    expect(useTimelineStore.getState().clips.map(clip => clip.startTime)).toEqual([0, 2, 4, 0, 2, 4]);
  });

  it('only maps gaps removed after the requested starting time', () => {
    useTimelineStore.setState({
      clips: [
        createMockClip({ id: 'a', trackId: 'video-1', startTime: 2, duration: 2 }),
        createMockClip({ id: 'b', trackId: 'video-1', startTime: 7, duration: 2 }),
        createMockClip({ id: 'c', trackId: 'video-1', startTime: 12, duration: 2 }),
      ],
      playheadPosition: 13,
    });
    useTimelineStore.getState().deleteAllGaps(['video-1'], 10);
    expect(useTimelineStore.getState().playheadPosition).toBe(10);
    expect(useTimelineStore.getState().clips.map(clip => clip.startTime)).toEqual([2, 7, 9]);
  });

  it('uses the selected affected track when tracks have different gaps', () => {
    useTimelineStore.setState({
      tracks: [createMockTrack({ id: 'video-1' }), createMockTrack({ id: 'audio-1', type: 'audio' })],
      clips: [...useTimelineStore.getState().clips,
        createMockClip({ id: 'audio-a', trackId: 'audio-1', startTime: 0, duration: 1 }),
        createMockClip({ id: 'audio-b', trackId: 'audio-1', startTime: 4, duration: 2 }),
      ],
      primarySelectedClipId: 'audio-b', selectedClipIds: new Set(['audio-b']), playheadPosition: 3,
    });
    useTimelineStore.getState().deleteGapAtTime(3);
    expect(useTimelineStore.getState().playheadPosition).toBe(1);
  });

  it('keeps overlapping clips aligned while removing earlier gaps', () => {
    useTimelineStore.setState({
      clips: [
        createMockClip({ id: 'a', trackId: 'video-1', startTime: 3, duration: 4 }),
        createMockClip({ id: 'b', trackId: 'video-1', startTime: 4, duration: 2 }),
      ],
      playheadPosition: 5,
    });
    useTimelineStore.getState().deleteAllGaps();
    expect(useTimelineStore.getState().clips.map(clip => clip.startTime)).toEqual([0, 1]);
    expect(useTimelineStore.getState().playheadPosition).toBe(2);
  });

  it('does not seek for a no-op or locked track', () => {
    installGapTimeline(6);
    const seek = vi.spyOn(useTimelineStore.getState(), 'setPlayheadPosition');
    useTimelineStore.getState().deleteGapAtTime(1);
    useTimelineStore.setState({ tracks: [createMockTrack({ id: 'video-1', locked: true })] });
    useTimelineStore.getState().deleteGapAtTime(3, ['video-1']);
    useTimelineStore.getState().deleteAllGaps(['video-1']);
    expect(useTimelineStore.getState().playheadPosition).toBe(6);
    expect(seek).not.toHaveBeenCalled();
  });

  it('keeps gap deletion in one undoable edit', () => {
    installGapTimeline(6);
    useTimelineStore.getState().deleteGapAtTime(3);
    expect(useTimelineStore.getState().clips[1].startTime).toBe(2);
    expect(useHistoryStore.getState().undo()).toMatchObject({ operation: 'undo' });
    expect(useTimelineStore.getState().clips[1].startTime).toBe(5);
    expect(useHistoryStore.getState().redo()).toMatchObject({ operation: 'redo' });
    expect(useTimelineStore.getState().clips[1].startTime).toBe(2);
  });

  it('rebases the live playback clock instead of jumping back to the removed time', () => {
    installGapTimeline(5.9);
    vi.spyOn(performance, 'now').mockReturnValue(1000);
    useTimelineStore.setState({ isPlaying: true, playbackSpeed: 1 });
    startInternalPosition(6, 1);
    setMasterAudioClock(() => 1, 5, 0, 1);
    useTimelineStore.getState().deleteGapAtTime(3);
    expect(useTimelineStore.getState().isPlaying).toBe(true);
    expect(useTimelineStore.getState().playheadPosition).toBe(3);
    expect(getInternalPlaybackPosition()).toBe(3);
    expect(playheadState.hasMasterAudio).toBe(false);
  });
});
