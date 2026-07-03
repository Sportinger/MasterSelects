import { describe, expect, it, vi } from 'vitest';
import { drawTimelineClipCanvasMainThread } from '../../src/components/timeline/utils/timelineClipCanvasMainThreadDraw';
import { resolveTimelineClipCanvasPaintVisuals } from '../../src/components/timeline/utils/timelineClipCanvasPaintVisualContributors';
import { getTimelineClipCanvasThumbnailMediaFileId } from '../../src/components/timeline/utils/timelineClipCanvasThumbnailPreparation';
import { createTimelineClipCanvasWorkerPaintClipInput } from '../../src/components/timeline/utils/timelineClipCanvasWorkerPaintClip';
import type { TimelinePaintSourceClip } from '../../src/timeline';

function createContext(): CanvasRenderingContext2D {
  return {
    clearRect: vi.fn(),
    roundRect: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
}

function createClip(): TimelinePaintSourceClip {
  return {
    duration: 5,
    id: 'clip-1',
    inPoint: 0,
    name: 'Clip 1',
    outPoint: 5,
    source: { naturalDuration: 5, type: 'video' },
    startTime: 0,
    trackId: 'track-1',
  };
}

describe('timeline clip canvas main-thread draw', () => {
  it('treats image clips as thumbnail-backed timeline previews', () => {
    const clip: TimelinePaintSourceClip = {
      ...createClip(),
      mediaFileId: 'image-1',
      source: { mediaFileId: 'image-1', naturalDuration: 5, type: 'image' },
    };

    expect(getTimelineClipCanvasThumbnailMediaFileId(clip)).toBe('image-1');
    expect(resolveTimelineClipCanvasPaintVisuals(clip).thumbnail).toBe(true);
  });

  it('passes solid colors to the canvas worker body fill', () => {
    const clip = {
      ...createClip(),
      solidColor: '#e2d0b0',
      source: { naturalDuration: 5, type: 'solid' },
    } as TimelinePaintSourceClip & { solidColor: string };

    expect(createTimelineClipCanvasWorkerPaintClipInput(clip).bodyFill).toBe('#e2d0b0');
  });

  it('skips drawing when a comp switch briefly gives the track no drawable height', () => {
    const ctx = createContext();
    const diagnostics = drawTimelineClipCanvasMainThread({
      audioDisplayMode: 'detailed',
      canvasOffsetX: 0,
      clips: [createClip()],
      cssWidth: 100,
      ctx,
      getMediaStatus: () => undefined,
      height: 0,
      hoveredClipId: null,
      lodBarPx: 2,
      lodThumbnailPx: 24,
      maxThumbnailSlots: 1,
      renderOverscanPx: 0,
      requestRedraw: vi.fn(),
      resolveGeometry: (clip) => ({
        duration: clip.duration,
        inPoint: clip.inPoint ?? 0,
        outPoint: clip.outPoint ?? clip.duration,
        startTime: clip.startTime,
        visible: true,
      }),
      scrollX: 0,
      selectedClipIds: new Set(),
      thumbnailSlotPx: 24,
      thumbnailViewportOverscanPx: 0,
      timeToPixel: (time) => time * 10,
      trackColor: '#4c9aff',
      viewportWidth: 100,
      waveformsEnabled: false,
    });

    expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 100, 0);
    expect(ctx.roundRect).not.toHaveBeenCalled();
    expect(diagnostics.drawnClipCount).toBe(0);
  });
});
