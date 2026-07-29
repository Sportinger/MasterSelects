import { act, renderHook } from '@testing-library/react';
import type { DragEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useExternalDropTrackDragEnter } from '../../src/components/timeline/hooks/useExternalDropTrackDragEnter';
import { createMockTrack } from '../helpers/mockData';

function dragEvent(types: string[]): DragEvent {
  return {
    clientX: 100,
    clientY: 200,
    dataTransfer: {
      dropEffect: 'copy',
      types,
    },
    preventDefault: vi.fn(),
  } as unknown as DragEvent;
}

function renderDragEnter(params: {
  preview: {
    duration?: number;
    hasAudio?: boolean;
    isAudio: boolean;
    isVideo: boolean;
  };
  locked?: boolean;
  trackType: 'video' | 'audio';
}) {
  const setExternalDrag = vi.fn();
  const buildTrackPreviewState = vi.fn();
  const dragCounterRef = { current: 0 };
  const { result } = renderHook(() => useExternalDropTrackDragEnter({
    tracks: [createMockTrack({ id: 'target', type: params.trackType, locked: params.locked })],
    dragCounterRef,
    rejectDropDuringExport: () => false,
    getDesiredStartTime: () => 4,
    resolveImmediateDragPreview: () => params.preview,
    buildTrackPreviewState,
    setExternalDrag,
  }));

  return {
    buildTrackPreviewState,
    dragCounterRef,
    handler: result.current,
    setExternalDrag,
  };
}

describe('useExternalDropTrackDragEnter', () => {
  it('clears the ghost for audio dragged over a video lane', () => {
    const subject = renderDragEnter({
      preview: { isAudio: true, isVideo: false, hasAudio: true },
      trackType: 'video',
    });
    const event = dragEvent(['application/x-media-file-id']);

    act(() => subject.handler(event, 'target'));

    expect(event.dataTransfer.dropEffect).toBe('none');
    expect(subject.setExternalDrag).toHaveBeenCalledWith(null);
    expect(subject.buildTrackPreviewState).not.toHaveBeenCalled();
  });

  it('keeps audio drops enabled on audio lanes', () => {
    const subject = renderDragEnter({
      preview: { isAudio: true, isVideo: false, hasAudio: true },
      trackType: 'audio',
    });
    const event = dragEvent(['application/x-media-file-id', 'application/x-media-is-audio']);

    act(() => subject.handler(event, 'target'));

    expect(event.dataTransfer.dropEffect).toBe('copy');
    expect(subject.buildTrackPreviewState).toHaveBeenCalledWith(expect.objectContaining({
      trackId: 'target',
      isAudio: true,
      isVideo: false,
    }));
  });

  it('clears the ghost for video dragged over an audio lane', () => {
    const subject = renderDragEnter({
      preview: { isAudio: false, isVideo: true, hasAudio: true },
      trackType: 'audio',
    });
    const event = dragEvent(['application/x-media-file-id']);

    act(() => subject.handler(event, 'target'));

    expect(event.dataTransfer.dropEffect).toBe('none');
    expect(subject.setExternalDrag).toHaveBeenCalledWith(null);
    expect(subject.buildTrackPreviewState).not.toHaveBeenCalled();
  });

  it('also rejects video with unknown audio metadata on an audio lane', () => {
    const subject = renderDragEnter({
      preview: { isAudio: false, isVideo: true, hasAudio: undefined },
      trackType: 'audio',
    });
    const event = dragEvent(['application/x-media-file-id']);

    act(() => subject.handler(event, 'target'));

    expect(event.dataTransfer.dropEffect).toBe('none');
    expect(subject.setExternalDrag).toHaveBeenCalledWith(null);
    expect(subject.buildTrackPreviewState).not.toHaveBeenCalled();
  });

  it('clears the ghost on a locked destination lane', () => {
    const subject = renderDragEnter({
      preview: { isAudio: false, isVideo: true, hasAudio: true },
      trackType: 'video',
      locked: true,
    });
    const event = dragEvent(['application/x-media-file-id']);

    act(() => subject.handler(event, 'target'));

    expect(event.dataTransfer.dropEffect).toBe('none');
    expect(subject.setExternalDrag).toHaveBeenCalledWith(null);
    expect(subject.buildTrackPreviewState).not.toHaveBeenCalled();
  });

  it('clears a stale ghost when the drag type is unsupported', () => {
    const subject = renderDragEnter({
      preview: { isAudio: false, isVideo: true, hasAudio: true },
      trackType: 'video',
    });
    const event = dragEvent(['text/plain']);

    act(() => subject.handler(event, 'target'));

    expect(subject.setExternalDrag).toHaveBeenCalledWith(null);
    expect(subject.buildTrackPreviewState).not.toHaveBeenCalled();
  });
});
