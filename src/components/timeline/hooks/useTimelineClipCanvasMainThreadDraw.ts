import { useEffect, useRef, type RefObject } from 'react';
import { flags } from '../../../engine/featureFlags';
import {
  reportTimelineCanvasDrawDiagnostics,
  unregisterTimelineCanvasDrawDiagnostics,
} from '../../../services/timeline/timelineCanvasDiagnostics';
import type { TimelineAudioDisplayMode } from '../../../stores/timeline/types';
import type { TimelinePaintSourceClip } from '../../../timeline';
import type { TimelineClipCanvasMediaStatus } from '../utils/timelineClipCanvasPassiveDecorations';
import { drawTimelineClipCanvasMainThread } from '../utils/timelineClipCanvasMainThreadDraw';
import { prepareTimelineClipCanvasMainThreadSurface } from '../utils/timelineClipCanvasMainThreadSurface';
import type { TimelineClipCanvasSpectrogramTileSetMap } from '../utils/timelineClipCanvasSpectrogramResource';
import type { TimelineClipCanvasTrimGeometry } from '../utils/timelineClipCanvasTrimResource';
import type { TimelineClipCanvasWaveformPyramidMap } from '../utils/timelineClipCanvasWaveformResource';
import type { TimelineClipCanvasWorkerEligibility } from '../utils/timelineClipCanvasWorkerModel';

interface TimelineClipCanvasMainThreadDrawInput {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  workerMode: boolean;
  workerCanvasGeneration: number;
  workerRuntimeFallbackReason: string | null;
  workerEligibility: TimelineClipCanvasWorkerEligibility;
  markMainThreadCanvasContextInitialized: () => void;
  clips: readonly TimelinePaintSourceClip[];
  trackId: string;
  height: number;
  cssWidth: number;
  canvasOffsetX: number;
  timeToPixel: (time: number) => number;
  selectedClipIds: ReadonlySet<string>;
  hoveredClipId?: string | null;
  trackColor: string;
  scrollX: number;
  scrollBucket: number;
  viewportWidth: number;
  waveformsEnabled?: boolean;
  audioDisplayMode?: TimelineAudioDisplayMode;
  showFaceRanges: boolean;
  clipDrag?: unknown;
  clipDragPreview?: unknown;
  clipTrim?: unknown;
  waveformPyramids?: TimelineClipCanvasWaveformPyramidMap;
  spectrogramTileSets?: TimelineClipCanvasSpectrogramTileSetMap;
  mediaFileStatusById: ReadonlyMap<string, TimelineClipCanvasMediaStatus>;
  mediaThumbnailUrlsById?: ReadonlyMap<string, string | undefined>;
  redrawNonce: number;
  resolveGeometry: (clip: TimelinePaintSourceClip) => TimelineClipCanvasTrimGeometry;
  getMediaStatus: (clip: TimelinePaintSourceClip) => TimelineClipCanvasMediaStatus | undefined;
  requestRedraw: () => void;
  renderOverscanPx: number;
  thumbnailViewportOverscanPx: number;
  lodBarPx: number;
  lodThumbnailPx: number;
  maxThumbnailSlots: number;
  thumbnailSlotPx: number;
}

export function useTimelineClipCanvasMainThreadDraw(input: TimelineClipCanvasMainThreadDrawInput): void {
  const {
    canvasRef,
    workerMode,
    workerCanvasGeneration,
    workerRuntimeFallbackReason,
    workerEligibility,
    markMainThreadCanvasContextInitialized,
    clips,
    trackId,
    height,
    cssWidth,
    canvasOffsetX,
    timeToPixel,
    selectedClipIds,
    hoveredClipId,
    trackColor,
    scrollX,
    scrollBucket,
    viewportWidth,
    waveformsEnabled,
    audioDisplayMode,
    showFaceRanges,
    clipDrag,
    clipDragPreview,
    clipTrim,
    waveformPyramids,
    spectrogramTileSets,
    mediaFileStatusById,
    mediaThumbnailUrlsById,
    redrawNonce,
    resolveGeometry,
    getMediaStatus,
    requestRedraw,
    renderOverscanPx,
    thumbnailViewportOverscanPx,
    lodBarPx,
    lodThumbnailPx,
    maxThumbnailSlots,
    thumbnailSlotPx,
  } = input;
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      unregisterTimelineCanvasDrawDiagnostics(trackId);
    };
  }, [trackId]);

  useEffect(() => {
    if (workerMode) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const surface = prepareTimelineClipCanvasMainThreadSurface(canvas, cssWidth, height, canvasOffsetX);
    if (!surface) return;
    const { ctx, dpr, resizedBackingStore } = surface;
    markMainThreadCanvasContextInitialized();

    // Assigning canvas.width/height resets the bitmap to transparent. Deferring
    // the repaint to rAF lets the browser composite that cleared canvas first,
    // showing as clips blinking while dragging a track's height (most visible on
    // Linux's software raster) — so a resize must repaint synchronously below.
    const paint = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const diagnostics = drawTimelineClipCanvasMainThread({
        ctx,
        clips,
        height,
        dpr,
        timeToPixel,
        selectedClipIds,
        hoveredClipId,
        trackColor,
        scrollX,
        viewportWidth,
        waveformsEnabled,
        audioDisplayMode,
        showFaceRanges,
        waveformPyramids,
        spectrogramTileSets,
        mediaThumbnailUrlsById,
        cssWidth,
        canvasOffsetX,
        renderOverscanPx,
        thumbnailViewportOverscanPx,
        lodBarPx,
        lodThumbnailPx,
        maxThumbnailSlots,
        thumbnailSlotPx,
        resolveGeometry,
        getMediaStatus,
        requestRedraw,
      });
      reportTimelineCanvasDrawDiagnostics(trackId, {
        ...diagnostics,
        workerMode,
        workerEligible: flags.timelineCanvasWorker && workerEligibility.eligible,
        workerError: workerRuntimeFallbackReason ?? undefined,
        workerFallbackReasons: flags.timelineCanvasWorker
          ? workerRuntimeFallbackReason
            ? [workerRuntimeFallbackReason]
            : workerEligibility.eligible
              ? undefined
              : workerEligibility.reasons
          : undefined,
      });
    };

    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (resizedBackingStore) {
      // Repaint synchronously so the just-cleared backing store is never
      // composited blank (the track-resize blink). Throttle everything else
      // (scroll, data updates) through rAF as before.
      paint();
    } else {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        paint();
      });
    }

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
    // scrollX intentionally excluded; scrollBucket drives viewport-thumbnail redraws.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workerMode, clips, trackId, height, cssWidth, canvasOffsetX, timeToPixel, selectedClipIds, hoveredClipId, trackColor, scrollBucket, viewportWidth, waveformsEnabled, audioDisplayMode, showFaceRanges, clipDrag, clipDragPreview, clipTrim, waveformPyramids, spectrogramTileSets, mediaFileStatusById, mediaThumbnailUrlsById, redrawNonce, workerEligibility, workerRuntimeFallbackReason, workerCanvasGeneration, markMainThreadCanvasContextInitialized]);
}
