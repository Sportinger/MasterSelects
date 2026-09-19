import { fireEvent, render, renderHook } from '@testing-library/react';
import { useClipTrim } from '../../src/components/timeline/hooks/useClipTrim';
import type { TimelineClip, TimelineTrack } from '../../src/types/timeline';
import { describe, expect, it, vi } from 'vitest';

const clip: TimelineClip = {
  id: 'clip-touch-trim',
  trackId: 'video-1',
  name: 'Touch trim clip',
  startTime: 0,
  duration: 10,
  inPoint: 0,
  outPoint: 10,
  source: { type: 'video', mediaFileId: 'media-1', naturalDuration: 20 },
  effects: [],
} as TimelineClip;

const track: TimelineTrack = {
  id: 'video-1',
  name: 'Video 1',
  type: 'video',
  locked: false,
  visible: true,
  muted: false,
  solo: false,
} as TimelineTrack;

describe('useClipTrim touch input', () => {
  it('keeps the trim-start callback stable across playhead-only renders', () => {
    const stableProps = {
      clipMap: new Map([[clip.id, clip]]),
      tracks: [track],
      isExporting: false,
      activeTimelineToolId: 'select' as const,
      selectedClipIds: new Set([clip.id]),
      snappingEnabled: false,
      frameRate: 30,
      selectClip: vi.fn(),
      applyTimelineEditOperation: vi.fn(() => ({ success: true, warnings: [] })),
      setTimelineToolPreview: vi.fn(),
      pixelToTime: (pixel: number) => pixel / 10,
    };
    const { result, rerender } = renderHook(
      ({ playheadPosition }) => useClipTrim({ ...stableProps, playheadPosition }),
      { initialProps: { playheadPosition: 0 } },
    );
    const initialHandleTrimStart = result.current.handleTrimStart;

    rerender({ playheadPosition: 4 });

    expect(result.current.handleTrimStart).toBe(initialHandleTrimStart);
  });

  it('commits a right-edge trim from a touch pointer stream', () => {
    const applyTimelineEditOperation = vi.fn(() => ({ success: true, warnings: [] }));

    function Harness() {
      const { handleTrimStart } = useClipTrim({
        clipMap: new Map([[clip.id, clip]]),
        tracks: [track],
        isExporting: false,
        activeTimelineToolId: 'select',
        selectedClipIds: new Set([clip.id]),
        snappingEnabled: false,
        playheadPosition: 0,
        frameRate: 30,
        selectClip: vi.fn(),
        applyTimelineEditOperation,
        setTimelineToolPreview: vi.fn(),
        pixelToTime: (pixel) => pixel / 10,
      });
      return (
        <div
          data-testid="trim-handle"
          onPointerDown={(event) => handleTrimStart(event, clip.id, 'right')}
        />
      );
    }

    const { getByTestId } = render(<Harness />);
    fireEvent.pointerDown(getByTestId('trim-handle'), {
      button: 0,
      clientX: 100,
      pointerId: 9,
      pointerType: 'touch',
    });
    fireEvent.pointerMove(document, {
      clientX: 120,
      pointerId: 9,
      pointerType: 'touch',
    });
    fireEvent.pointerUp(document, {
      clientX: 120,
      pointerId: 9,
      pointerType: 'touch',
    });

    expect(applyTimelineEditOperation).toHaveBeenCalledTimes(1);
    expect(applyTimelineEditOperation.mock.calls[0][0]).toMatchObject({
      type: 'trim-clip',
      clipId: clip.id,
      inPoint: 0,
      outPoint: 12,
    });
  });
});
