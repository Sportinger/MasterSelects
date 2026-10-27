import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  commitPhoneClipDrop,
  commitPhoneClipTrim,
  computePhoneTrimTiming,
  deleteSelectedClips,
  duplicateSelectedClips,
  rippleDeleteSelectedClips,
} from '../../src/components/mobileSkin/actions/phoneClipEditActions';
import { initHistoryStoreRefs, useHistoryStore } from '../../src/stores/historyStore';
import { useTimelineStore } from '../../src/stores/timeline';
import type { TimelineClip } from '../../src/types';
import { installFakeMediaStore } from '../helpers/fakeMediaStore';
import { createMockClip, createMockTrack } from '../helpers/mockData';

const originalState = useTimelineStore.getState();

function starts(): Array<[string, number, string]> {
  return useTimelineStore.getState().clips
    .map((clip): [string, number, string] => [clip.id, clip.startTime, clip.trackId])
    .toSorted((a, b) => a[2].localeCompare(b[2]) || a[1] - b[1]);
}

function videoClip(id: string, startTime: number, duration: number, extra: Partial<TimelineClip> = {}): TimelineClip {
  return createMockClip({
    id, trackId: 'video-1', startTime, duration, inPoint: 0, outPoint: duration,
    source: { type: 'video', naturalDuration: 20 }, ...extra,
  });
}

describe('phone clip edit actions', () => {
  beforeEach(() => {
    installFakeMediaStore();
    initHistoryStoreRefs({
      timeline: { getState: () => useTimelineStore.getState(), setState: (state) => useTimelineStore.setState(state) },
      media: { getState: () => ({ files: [], compositions: [], folders: [], selectedIds: [], expandedFolderIds: [], textItems: [], solidItems: [], mathSceneItems: [], motionShapeItems: [], signalAssets: [], signalArtifacts: [], signalGraphs: [], signalOperators: [] }), setState: vi.fn() },
      dock: { getState: () => ({ layout: null as never }), setState: vi.fn() },
    } as never);
    useHistoryStore.getState().clearHistory();
    useTimelineStore.setState({
      tracks: [
        createMockTrack({ id: 'video-2', type: 'video' }),
        createMockTrack({ id: 'video-1', type: 'video' }),
      ],
      clips: [videoClip('a', 0, 2), videoClip('b', 2, 3), videoClip('c', 5, 1)],
      selectedClipIds: new Set(),
      primarySelectedClipId: null,
      playheadPosition: 0,
      duration: 60,
      isPlaying: false,
      isExporting: false,
      clipboardData: null,
      clipboardKeyframes: null,
    });
  });

  afterEach(() => {
    useTimelineStore.setState({
      applyTimelineEditOperation: originalState.applyTimelineEditOperation,
      deleteClipSelection: originalState.deleteClipSelection,
      clips: [],
      selectedClipIds: new Set(),
    });
  });

  it('delete keeps the gap: later clips stay where they were', () => {
    useTimelineStore.setState({ selectedClipIds: new Set(['b']) });

    expect(deleteSelectedClips()).toEqual({ ok: true });
    expect(starts()).toEqual([['a', 0, 'video-1'], ['c', 5, 'video-1']]);
  });

  it('delete + close gap moves later clips left', () => {
    useTimelineStore.setState({ selectedClipIds: new Set(['b']) });

    expect(rippleDeleteSelectedClips()).toEqual({ ok: true });
    expect(starts()).toEqual([['a', 0, 'video-1'], ['c', 2, 'video-1']]);
  });

  it('passes the explicit selected ids to the store delete action', () => {
    const deleteClipSelection = vi.fn(() => ({ success: true, operationId: 'op', changedClipIds: [], warnings: [] }));
    useTimelineStore.setState({ selectedClipIds: new Set(['c', 'a', 'gone']), deleteClipSelection });

    deleteSelectedClips();

    expect(deleteClipSelection).toHaveBeenCalledWith(['a', 'c']);
  });

  it('asks for a selection and refuses during export', () => {
    expect(deleteSelectedClips()).toEqual({ ok: false, message: 'Select a clip first, then tap Delete.' });
    useTimelineStore.setState({ selectedClipIds: new Set(['a']), isExporting: true });
    expect(rippleDeleteSelectedClips()).toEqual({ ok: false, message: 'Delete + close gap is unavailable while an export is running.' });
    expect(useTimelineStore.getState().clips).toHaveLength(3);
  });

  it('surfaces the first warning of a rejected operation and thrown errors', () => {
    useTimelineStore.setState({
      selectedClipIds: new Set(['a']),
      deleteClipSelection: () => ({ success: false, operationId: 'op', changedClipIds: [], warnings: [{ code: 'track-locked', message: 'Track is locked.' }] }),
    });
    expect(deleteSelectedClips()).toEqual({ ok: false, message: 'Track is locked.' });

    useTimelineStore.setState({ deleteClipSelection: () => { throw new Error('boom'); } });
    expect(deleteSelectedClips()).toEqual({ ok: false, message: 'Delete failed: boom' });
  });

  it('duplicates right after the clip, shifts the following clip and selects the copy', () => {
    useTimelineStore.setState({ selectedClipIds: new Set(['a']), primarySelectedClipId: 'a', playheadPosition: 4 });

    const result = duplicateSelectedClips();

    expect(result).toEqual({ ok: true });
    const state = useTimelineStore.getState();
    const copy = state.clips.find((clip) => !['a', 'b', 'c'].includes(clip.id));
    expect(copy).toMatchObject({ startTime: 2, duration: 2, trackId: 'video-1' });
    expect(starts().map(([id, start]) => [id === copy?.id ? 'copy' : id, start])).toEqual([
      ['a', 0], ['copy', 2], ['b', 4], ['c', 7],
    ]);
    expect([...state.selectedClipIds]).toEqual([copy?.id]);
    expect(state.clipboardData).toBeNull();
    expect(state.playheadPosition).toBe(4);
  });

  it('trims an edge with one trim-clip operation, clamped to the neighbour', () => {
    const state = useTimelineStore.getState();
    const clipB = state.clips.find((clip) => clip.id === 'b')!;
    const timing = computePhoneTrimTiming(clipB, 'start', -5, state.clips);
    expect(timing.newStartTime).toBe(2);

    const shorter = computePhoneTrimTiming(clipB, 'end', -1, state.clips);
    expect(commitPhoneClipTrim('b', shorter)).toEqual({ ok: true });
    const trimmed = useTimelineStore.getState().clips.find((clip) => clip.id === 'b')!;
    expect(trimmed.duration).toBeCloseTo(2);
    expect(trimmed.outPoint).toBeCloseTo(2);
  });

  it('reorders the main track with one move-clips operation', () => {
    const apply = vi.fn(originalState.applyTimelineEditOperation);
    useTimelineStore.setState({ applyTimelineEditOperation: apply });

    expect(commitPhoneClipDrop({ clipId: 'a', dropStart: 4.8, targetTrackId: 'video-1', mainTrackId: 'video-1' })).toEqual({ ok: true });

    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply.mock.calls[0][0]).toMatchObject({ type: 'move-clips', includeLinked: true });
    expect(starts()).toEqual([['b', 0, 'video-1'], ['c', 3, 'video-1'], ['a', 4, 'video-1']]);
  });

  it('moves a clip to a free spot on another lane', () => {
    expect(commitPhoneClipDrop({ clipId: 'c', dropStart: 1, targetTrackId: 'video-2', mainTrackId: 'video-1' })).toEqual({ ok: true });
    expect(starts()).toContainEqual(['c', 1, 'video-2']);
  });
});
