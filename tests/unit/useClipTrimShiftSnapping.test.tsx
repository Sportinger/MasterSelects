import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useClipTrim } from '../../src/components/timeline/hooks/useClipTrim';
import { resolveClipGeometry } from '../../src/components/timeline/utils/timelineClipCanvasClipGeometry';
import type { TimelineClip, TimelineTrack } from '../../src/types/timeline';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('Shift snapping during linked trim', () => {
  it.each(['left', 'right'] as const)('keeps both %s edges together when Shift is pressed and released', (edge) => {
    let nextFrame: FrameRequestCallback | undefined;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { nextFrame = callback; return 1; });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    const video = {
      id: 'video', trackId: 'v1', name: 'Video', startTime: 0, duration: 10,
      inPoint: 0, outPoint: 10, linkedClipId: 'audio', effects: [],
      source: { type: 'video', mediaFileId: 'source', naturalDuration: 20 },
    } as TimelineClip;
    const audio = { ...video, id: 'audio', trackId: 'a1', linkedClipId: 'video', source: { ...video.source, type: 'audio' } } as TimelineClip;
    const commit = vi.fn(() => ({ success: true, warnings: [] }));
    let latest: ReturnType<typeof useClipTrim>;
    function Harness() {
      latest = useClipTrim({
        clipMap: new Map([[video.id, video], [audio.id, audio]]),
        tracks: [{ id: 'v1', type: 'video' }, { id: 'a1', type: 'audio' }] as TimelineTrack[],
        isExporting: false, activeTimelineToolId: 'select', selectedClipIds: new Set(['video', 'audio']),
        snappingEnabled: false, playheadPosition: edge === 'left' ? 2 : 8, frameRate: 30,
        selectClip: vi.fn(), applyTimelineEditOperation: commit, setTimelineToolPreview: vi.fn(),
        pixelToTime: (pixel) => pixel / 100,
      });
      return <div data-testid="handle" onMouseDown={(event) => latest.handleTrimStart(event, video.id, edge)} />;
    }
    const { getByTestId } = render(<Harness />);
    const clientX = edge === 'left' ? 193 : -193;
    const move = (shiftKey: boolean) => {
      fireEvent.mouseMove(document, { clientX, shiftKey });
      act(() => nextFrame?.(0));
      const trim = latest!.clipTrim!;
      expect(trim.includeLinked).toBe(true);
      const v = resolveClipGeometry(video, { trackId: 'v1', clipTrim: trim });
      const a = resolveClipGeometry(audio, { trackId: 'a1', clipTrim: trim });
      expect(a).toEqual(v);
      expect(a.duration).toBeLessThan(10);
      expect(trim.isSnapping).toBe(shiftKey);
      if (shiftKey) expect(a.duration).toBe(8);
    };
    fireEvent.mouseDown(getByTestId('handle'), { clientX: 0 });
    move(false);
    move(true);
    move(false);
    fireEvent.mouseUp(document, { clientX, shiftKey: true });
    expect(commit.mock.calls[0][0]).toMatchObject({
      type: 'trim-clip', includeLinked: true,
      inPoint: edge === 'left' ? 2 : 0, outPoint: edge === 'left' ? 10 : 8,
      extraClips: [expect.objectContaining({ clipId: 'audio' })],
    });
  });
});
