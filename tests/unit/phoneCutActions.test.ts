import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { selectPhoneClip, splitSelectedAtPlayhead } from '../../src/components/mobileSkin/actions/phoneCutActions';
import { useTimelineStore } from '../../src/stores/timeline';
import type { TimelineEditOperationActions } from '../../src/stores/timeline/types';
import { createMockClip } from '../helpers/mockData';

type ApplyOperation = TimelineEditOperationActions['applyTimelineEditOperation'];

const originalApply = useTimelineStore.getState().applyTimelineEditOperation;

describe('phone cut actions', () => {
  let applyTimelineEditOperation: ReturnType<typeof vi.fn<ApplyOperation>>;

  beforeEach(() => {
    applyTimelineEditOperation = vi.fn<ApplyOperation>(() => ({
      success: true,
      operationId: 'operation',
      changedClipIds: [],
      warnings: [],
    }));
    useTimelineStore.setState({
      clips: [
        createMockClip({ id: 'clip-a', trackId: 'video-1', startTime: 0, duration: 4 }),
        createMockClip({ id: 'clip-b', trackId: 'video-2', startTime: 0, duration: 4 }),
        createMockClip({ id: 'clip-c', trackId: 'video-1', startTime: 4, duration: 4 }),
      ],
      selectedClipIds: new Set(),
      primarySelectedClipId: null,
      playheadPosition: 2,
      isPlaying: false,
      isExporting: false,
      applyTimelineEditOperation,
    });
  });

  afterEach(() => {
    useTimelineStore.setState({ applyTimelineEditOperation: originalApply, clips: [], selectedClipIds: new Set() });
  });

  it('splits exactly the selected clip under the playhead with explicit ids', () => {
    useTimelineStore.setState({ selectedClipIds: new Set(['clip-a']) });

    const result = splitSelectedAtPlayhead();

    expect(result).toEqual({ ok: true });
    expect(applyTimelineEditOperation).toHaveBeenCalledTimes(1);
    const [operation, options] = applyTimelineEditOperation.mock.calls[0];
    expect(operation).toMatchObject({ type: 'split-at-time', clipIds: ['clip-a'], time: 2, includeLinked: true });
    expect(operation.id).toEqual(expect.any(String));
    expect(options).toEqual({ source: 'ui', historyLabel: 'Split clip' });
  });

  it('does not fall back to other clips when the playhead is outside the selection', () => {
    useTimelineStore.setState({ selectedClipIds: new Set(['clip-c']) });

    const result = splitSelectedAtPlayhead();

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.message).toMatch(/inside the selected clip/);
    expect(applyTimelineEditOperation).not.toHaveBeenCalled();
  });

  it('asks for a selection instead of splitting every clip under the playhead', () => {
    const result = splitSelectedAtPlayhead();

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.message).toMatch(/Select a clip/);
    expect(applyTimelineEditOperation).not.toHaveBeenCalled();
  });

  it('surfaces the operation warning when the split is rejected', () => {
    useTimelineStore.setState({ selectedClipIds: new Set(['clip-a']) });
    applyTimelineEditOperation.mockReturnValueOnce({
      success: false,
      operationId: 'operation',
      changedClipIds: [],
      warnings: [{ code: 'track-locked', message: 'Track is locked.', trackId: 'video-1' }],
    });

    expect(splitSelectedAtPlayhead()).toEqual({ ok: false, message: 'Track is locked.' });
  });

  it('reports a thrown operation as a failure message', () => {
    useTimelineStore.setState({ selectedClipIds: new Set(['clip-a']) });
    applyTimelineEditOperation.mockImplementationOnce(() => { throw new Error('boom'); });

    expect(splitSelectedAtPlayhead()).toEqual({ ok: false, message: 'Split failed: boom' });
  });

  it('refuses to split during export', () => {
    useTimelineStore.setState({ selectedClipIds: new Set(['clip-a']), isExporting: true });

    expect(splitSelectedAtPlayhead().ok).toBe(false);
    expect(applyTimelineEditOperation).not.toHaveBeenCalled();
  });

  it('selects and clears clips through the store selection action', () => {
    selectPhoneClip('clip-b');
    expect([...useTimelineStore.getState().selectedClipIds]).toEqual(['clip-b']);
    expect(useTimelineStore.getState().primarySelectedClipId).toBe('clip-b');

    selectPhoneClip(null);
    expect(useTimelineStore.getState().selectedClipIds.size).toBe(0);
  });

  it('clears the selection when asked to select a clip that no longer exists', () => {
    useTimelineStore.setState({ selectedClipIds: new Set(['clip-a']), primarySelectedClipId: 'clip-a' });

    selectPhoneClip('missing');

    expect(useTimelineStore.getState().selectedClipIds.size).toBe(0);
  });
});
