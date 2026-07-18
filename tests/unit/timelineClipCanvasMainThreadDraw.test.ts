import { describe, expect, it, vi } from 'vitest';
import { drawTimelineClipCanvasMainThread } from '../../src/components/timeline/utils/timelineClipCanvasMainThreadDraw';
import { resolveTimelineClipCanvasPaintVisuals } from '../../src/components/timeline/utils/timelineClipCanvasPaintVisualContributors';
import { getTimelineClipCanvasThumbnailMediaFileId } from '../../src/components/timeline/utils/timelineClipCanvasThumbnailPreparation';
import { createTimelineClipCanvasWorkerPaintClipInput } from '../../src/components/timeline/utils/timelineClipCanvasWorkerPaintClip';
import { createTimelineClipCanvasChromeOverlays } from '../../src/components/timeline/utils/timelineClipCanvasChromeOverlays';
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

  it('keeps a type pictogram model for clips without thumbnails', () => {
    const clips = [
      { ...createClip(), id: 'camera', source: { type: 'camera' } },
      { ...createClip(), id: 'light', source: { type: 'light' } },
      { ...createClip(), id: 'splat', source: { type: 'gaussian-splat' } },
      { ...createClip(), id: 'midi', source: { type: 'midi' } },
      { ...createClip(), id: 'transition', source: { type: 'transition-overlay' } },
      { ...createClip(), id: 'null', source: { type: 'motion-null' } },
      { ...createClip(), id: 'adjustment', source: { type: 'motion-adjustment' } },
      { ...createClip(), id: 'unknown', source: null, trackType: 'audio' as const },
    ];
    const overlays = createTimelineClipCanvasChromeOverlays({
      chromeScrollX: 0,
      chromeViewportWidth: 100,
      clips,
      geometryProps: { trackId: 'track-1' },
      mediaFileStatusById: new Map(),
      minLabelWidthPx: 1,
      timeToPixel: (time) => time * 10,
    });

    expect(overlays.map((overlay) => overlay.iconType)).toEqual([
      'camera',
      'light',
      'gaussian-splat',
      'midi',
      'transition-overlay',
      'motion-null',
      'motion-adjustment',
      'audio',
    ]);
    // Invariant: clip types that canvas-draw their own body preview (midi note
    // bars / audio waveform) must NOT also show a type-icon overlay on top of
    // the previsualization. All other types keep their pictogram.
    const iconByType = new Map(overlays.map((overlay) => [overlay.iconType, overlay.showIcon]));
    expect(iconByType.get('midi')).toBe(false);
    expect(iconByType.get('audio')).toBe(false);
    expect(
      overlays
        .filter((overlay) => overlay.iconType !== 'midi' && overlay.iconType !== 'audio')
        .every((overlay) => overlay.showIcon),
    ).toBe(true);

    const [thumbnailOverlay] = createTimelineClipCanvasChromeOverlays({
      chromeScrollX: 0,
      chromeViewportWidth: 100,
      clips: [clips[0]],
      geometryProps: { trackId: 'track-1' },
      mediaFileStatusById: new Map(),
      minLabelWidthPx: 1,
      thumbnailVisibleClipIds: new Set(['camera']),
      timeToPixel: (time) => time * 10,
    });
    expect(thumbnailOverlay.showIcon).toBe(false);
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
