// TimelineClipCanvas - issue #228 canvas clip renderer.
//
// Draws a track's visible clip bodies onto a viewport-sized <canvas> instead of
// mounting one heavy DOM component per clip. This makes large comps render in
// O(visible clips) draw calls with a Level-of-Detail scheme.

import { memo, useMemo, useReducer, useRef } from 'react';
import type { TimelineAudioDisplayMode, TimelineClipDragPreview } from '../../stores/timeline/types';
import { useMediaStore } from '../../stores/mediaStore';
import {
  TIMELINE_CLIP_CANVAS_LOD_BAR_PX,
  TIMELINE_CLIP_CANVAS_LOD_LABEL_PX,
} from './timelineRenderConstants';
import type { ClipDragState, ClipTrimState } from './types';
import type { TimelinePaintSourceClip } from '../../timeline';
import { useTimelineClipCanvasAudioWarmups } from './hooks/useTimelineClipCanvasAudioWarmups';
import { useTimelineClipCanvasMainThreadDraw } from './hooks/useTimelineClipCanvasMainThreadDraw';
import { useTimelineClipCanvasThumbnailWarmups } from './hooks/useTimelineClipCanvasThumbnailWarmups';
import { useTimelineClipCanvasViewport } from './hooks/useTimelineClipCanvasViewport';
import { useTimelineClipCanvasWorkerRuntime } from './hooks/useTimelineClipCanvasWorkerRuntime';
import {
  createWorkerDrawableClips,
  resolveClipGeometry,
} from './utils/timelineClipCanvasClipGeometry';
import {
  alignTimelineGridPixel,
  getTimelineDevicePixelRatio,
} from './utils/timelineGrid';
import {
  buildSourceWaveformPyramidIdMap,
  enrichClipsWithSourceWaveformRef,
} from './utils/timelineClipCanvasSourceWaveformRef';
import type { TimelineClipCanvasSpectrogramTileSetMap } from './utils/timelineClipCanvasSpectrogramResource';
import type { TimelineClipCanvasWaveformPyramidMap } from './utils/timelineClipCanvasWaveformResource';
import {
  hasTimelineClipCanvasPassiveDecorations,
  type TimelineClipCanvasMediaStatus,
} from './utils/timelineClipCanvasPassiveDecorations';
import {
  collectTimelineClipCanvasWorkerThumbnailPreparation,
} from './utils/timelineClipCanvasThumbnailPreparation';
import {
  collectTimelineClipCanvasVisibleAudioArtifactClipIds,
} from './utils/timelineClipCanvasVisibleArtifactCollection';
import {
  createTimelineClipCanvasWorkerPreparedResourcesByClipId,
} from './utils/timelineClipCanvasPreparedResources';
import {
  createTimelineClipCanvasWorkerPaintClipInput,
  getTimelineClipCanvasWorkerEligibility,
} from './utils/timelineClipCanvasWorkerModel';
import {
  createTimelineClipCanvasChromeOverlays,
  getTimelineClipCanvasMediaStatus,
} from './utils/timelineClipCanvasChromeOverlays';

// Viewport-bounded canvas sizing (the Linux/Mesa blank-canvas guard) lives in
// useTimelineClipCanvasViewport; see docs/Features/Linux-Mesa-GPU.md.
export const MAX_CANVAS_WIDTH_PX = 16000;

const LOD_BAR_PX = TIMELINE_CLIP_CANVAS_LOD_BAR_PX;
const LOD_LABEL_PX = TIMELINE_CLIP_CANVAS_LOD_LABEL_PX;
const LOD_THUMB_PX = LOD_BAR_PX;
const CANVAS_THUMB_SLOT_PX = 71;
const MAX_THUMB_SLOTS = 48;

const THUMBNAIL_VIEWPORT_OVERSCAN_PX = 600;
const CANVAS_RENDER_OVERSCAN_PX = 1200;

interface TimelineClipCanvasProps {
  clips: readonly TimelinePaintSourceClip[];
  trackId: string;
  height: number;
  contentWidth: number;
  timeToPixel: (time: number) => number;
  selectedClipIds: ReadonlySet<string>;
  hoveredClipId?: string | null;
  trackColor: string;
  scrollX: number;
  viewportWidth: number;
  waveformsEnabled?: boolean;
  audioDisplayMode?: TimelineAudioDisplayMode;
  clipDrag?: ClipDragState | null;
  clipDragPreview?: TimelineClipDragPreview | null;
  clipTrim?: ClipTrimState | null;
  waveformPyramids?: TimelineClipCanvasWaveformPyramidMap;
  spectrogramTileSets?: TimelineClipCanvasSpectrogramTileSetMap;
}

function TimelineClipCanvasComponent(props: TimelineClipCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [redrawNonce, bumpRedraw] = useReducer((n: number) => n + 1, 0);
  const {
    clips: rawClips,
    trackId,
    height,
    timeToPixel,
    selectedClipIds,
    hoveredClipId,
    trackColor,
    scrollX,
    viewportWidth,
    waveformsEnabled,
    audioDisplayMode,
    clipDrag,
    clipDragPreview,
    clipTrim,
  } = props;
  const mediaFilesState = useMediaStore((state) => state.files);
  const mediaFiles = useMemo(
    () => (Array.isArray(mediaFilesState) ? mediaFilesState : []),
    [mediaFilesState],
  );
  const mediaThumbnailUrlsById = useMemo(() => {
    const map = new Map<string, string | undefined>();
    for (const file of mediaFiles) {
      map.set(file.id, file.thumbnailUrl);
    }
    return map;
  }, [mediaFiles]);
  const sourceWaveformPyramidIds = useMemo(
    () => buildSourceWaveformPyramidIdMap(mediaFiles),
    [mediaFiles],
  );
  const clips = useMemo(
    () => enrichClipsWithSourceWaveformRef(rawClips, sourceWaveformPyramidIds),
    [rawClips, sourceWaveformPyramidIds],
  );
  const geometryProps = useMemo(() => ({
    trackId,
    clipDrag,
    clipDragPreview,
    clipTrim,
  }), [clipDrag, clipDragPreview, clipTrim, trackId]);
  const {
    cssWidth,
    canvasOffsetX,
    scrollBucket,
    visibleViewportWidth,
  } = useTimelineClipCanvasViewport({
    canvasRef,
    scrollX,
    viewportWidth,
    overscanPx: CANVAS_RENDER_OVERSCAN_PX,
    maxCanvasWidthPx: MAX_CANVAS_WIDTH_PX,
  });
  const chromeViewportWidth = Math.max(1, Math.min(viewportWidth, visibleViewportWidth));
  const chromeScrollX = alignTimelineGridPixel(scrollX, getTimelineDevicePixelRatio());
  const visibleAudioArtifactClipIds = useMemo(
    () => collectTimelineClipCanvasVisibleAudioArtifactClipIds({
      clips,
      scrollX,
      viewportWidth,
      timeToPixel,
      resolveGeometry: (clip) => resolveClipGeometry(clip, geometryProps),
      thumbnailViewportOverscanPx: THUMBNAIL_VIEWPORT_OVERSCAN_PX,
    }),
    [clips, geometryProps, scrollX, timeToPixel, viewportWidth],
  );
  const { waveformPyramids, spectrogramTileSets } = useTimelineClipCanvasAudioWarmups({
    clips,
    scrollX,
    viewportWidth,
    cssWidth,
    timeToPixel,
    waveformsEnabled,
    audioDisplayMode,
    isInteractionPreviewActive: Boolean(clipDrag || clipDragPreview),
    renderOverscanPx: CANVAS_RENDER_OVERSCAN_PX,
    visibleAudioArtifactClipIds,
    requestRedraw: bumpRedraw,
  });

  const mediaFileStatusById = useMemo(() => {
    const map = new Map<string, TimelineClipCanvasMediaStatus>();
    for (const file of mediaFiles) {
      map.set(file.id, {
        proxyStatus: file.proxyStatus,
        proxyProgress: file.proxyProgress,
        audioProxyStatus: file.audioProxyStatus,
        audioProxyProgress: file.audioProxyProgress,
        hasProxyAudio: file.hasProxyAudio,
      });
    }
    return map;
  }, [mediaFiles]);
  const workerThumbnailPreparation = useMemo(
    () => {
      void redrawNonce;
      return collectTimelineClipCanvasWorkerThumbnailPreparation({
        clips,
        height,
        cssWidth,
        canvasOffsetX,
        scrollX,
        viewportWidth,
        timeToPixel,
        resolveGeometry: (clip) => resolveClipGeometry(clip, geometryProps),
        renderOverscanPx: CANVAS_RENDER_OVERSCAN_PX,
        thumbnailViewportOverscanPx: THUMBNAIL_VIEWPORT_OVERSCAN_PX,
        minThumbnailWidth: LOD_THUMB_PX,
        thumbnailSlotPx: CANVAS_THUMB_SLOT_PX,
        maxThumbnailSlots: MAX_THUMB_SLOTS,
        mediaThumbnailUrlsById,
      });
    },
    [canvasOffsetX, clips, cssWidth, geometryProps, height, mediaThumbnailUrlsById, redrawNonce, scrollX, timeToPixel, viewportWidth],
  );
  useTimelineClipCanvasThumbnailWarmups({
    clips,
    mediaFiles,
    scrollX,
    viewportWidth,
    timeToPixel,
    resolveGeometry: (clip) => resolveClipGeometry(clip, geometryProps),
    thumbnailViewportOverscanPx: THUMBNAIL_VIEWPORT_OVERSCAN_PX,
    missingBitmapRefs: workerThumbnailPreparation.missingBitmapRefs,
    requestRedraw: bumpRedraw,
  });
  const workerPreparedResourcesByClipId = useMemo(
    () => {
      const preparedResources = createTimelineClipCanvasWorkerPreparedResourcesByClipId({
      clips,
      waveformPyramids,
      spectrogramTileSets,
      waveformsEnabled,
      audioDisplayMode,
      height,
      cssWidth,
      canvasOffsetX,
      scrollX,
      viewportWidth,
      timeToPixel,
      activeTrimClipId: clipTrim?.clipId ?? null,
      activeTrimIncludeLinked: clipTrim?.singleClip === true ? false : clipTrim?.includeLinked === true,
      renderOverscanPx: CANVAS_RENDER_OVERSCAN_PX,
      minThumbnailWidth: LOD_THUMB_PX,
      thumbnailSlotPx: CANVAS_THUMB_SLOT_PX,
      maxThumbnailSlots: MAX_THUMB_SLOTS,
      resolveGeometry: (clip) => resolveClipGeometry(clip as TimelinePaintSourceClip, geometryProps),
      getMediaStatus: (clip) => getTimelineClipCanvasMediaStatus(clip as TimelinePaintSourceClip, mediaFileStatusById),
    });
      void redrawNonce;
      return preparedResources;
    },
    [audioDisplayMode, canvasOffsetX, clipTrim, clips, cssWidth, geometryProps, height, mediaFileStatusById, redrawNonce, scrollX, spectrogramTileSets, timeToPixel, viewportWidth, waveformPyramids, waveformsEnabled],
  );
  const workerDrawableClips = useMemo(
    () => createWorkerDrawableClips(clips, geometryProps),
    [clips, geometryProps],
  );
  const workerPaintClips = useMemo(
    () => workerDrawableClips.map(createTimelineClipCanvasWorkerPaintClipInput),
    [workerDrawableClips],
  );
  const passiveDecorationClipIds = useMemo(() => {
    const ids = new Set<string>();
    workerDrawableClips.forEach((clip) => {
      if (hasTimelineClipCanvasPassiveDecorations(clip, getTimelineClipCanvasMediaStatus(clip, mediaFileStatusById))) {
        ids.add(clip.id);
      }
    });
    return ids;
  }, [mediaFileStatusById, workerDrawableClips]);
  const hasPassiveDecorations = passiveDecorationClipIds.size > 0;
  const chromeOverlays = useMemo(() => {
    return createTimelineClipCanvasChromeOverlays({
      chromeScrollX,
      chromeViewportWidth,
      clips,
      geometryProps,
      mediaFileStatusById,
      minLabelWidthPx: LOD_LABEL_PX,
      timeToPixel,
    });
  }, [chromeScrollX, chromeViewportWidth, clips, geometryProps, mediaFileStatusById, timeToPixel]);
  const workerEligibility = useMemo(() => getTimelineClipCanvasWorkerEligibility({
    clips: workerPaintClips,
    waveformsEnabled,
    audioDisplayMode,
    preparedResourcesByClipId: workerPreparedResourcesByClipId,
    preparedThumbnailClipIds: workerThumbnailPreparation.handledClipIds,
    passiveDecorationClipIds,
    hasPassiveDecorations,
    hasClipTrim: Boolean(clipTrim),
    activeTrimClipId: clipTrim?.clipId ?? null,
  }), [audioDisplayMode, clipTrim, hasPassiveDecorations, passiveDecorationClipIds, waveformsEnabled, workerPaintClips, workerPreparedResourcesByClipId, workerThumbnailPreparation.handledClipIds]);
  const {
    workerMode,
    workerCanvasGeneration,
    workerRuntimeFallbackReason,
    markMainThreadCanvasContextInitialized,
  } = useTimelineClipCanvasWorkerRuntime({
    canvasRef,
    trackId,
    height,
    cssWidth,
    canvasOffsetX,
    timeToPixel,
    selectedClipIds,
    hoveredClipId,
    trackColor,
    waveformsEnabled,
    audioDisplayMode,
    workerEligibility,
    workerPaintClips,
    workerPreparedResourcesByClipId,
    workerThumbnailPreparation,
    passiveDecorationClipIds,
    hasPassiveDecorations,
    hasClipTrim: Boolean(clipTrim),
    activeTrimClipId: clipTrim?.clipId ?? null,
  });

  useTimelineClipCanvasMainThreadDraw({
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
    clipDrag,
    clipDragPreview,
    clipTrim,
    waveformPyramids,
    spectrogramTileSets,
    mediaFileStatusById,
    mediaThumbnailUrlsById,
    redrawNonce,
    resolveGeometry: (clip) => resolveClipGeometry(clip, geometryProps),
    getMediaStatus: (clip) => getTimelineClipCanvasMediaStatus(clip, mediaFileStatusById),
    requestRedraw: bumpRedraw,
    renderOverscanPx: CANVAS_RENDER_OVERSCAN_PX,
    thumbnailViewportOverscanPx: THUMBNAIL_VIEWPORT_OVERSCAN_PX,
    lodBarPx: LOD_BAR_PX,
    lodThumbnailPx: LOD_THUMB_PX,
    maxThumbnailSlots: MAX_THUMB_SLOTS,
    thumbnailSlotPx: CANVAS_THUMB_SLOT_PX,
  });

  return (
    <>
      <canvas
        key={`${trackId}:${workerCanvasGeneration}`}
        ref={canvasRef}
        className="timeline-clip-canvas"
        style={{ position: 'absolute', left: canvasOffsetX, top: 0, pointerEvents: 'none' }}
        aria-hidden="true"
      />
      <div
        className="timeline-clip-chrome-layer"
        style={{
          transform: `translateX(${chromeScrollX}px)`,
          width: chromeViewportWidth,
        }}
        aria-hidden="true"
      >
        {chromeOverlays.map((overlay) => (
          <div
            key={overlay.id}
            className="timeline-clip-chrome"
            style={{
              left: overlay.left,
              top: 1,
              width: overlay.width,
              height: Math.max(1, height - 2),
            }}
          >
            {overlay.label && (
              <span
                className="timeline-clip-chrome-title"
                style={{ right: Math.max(6, overlay.badgeReserve + 8) }}
              >
                {overlay.label}
              </span>
            )}
            {overlay.badges.map((badge, index) => (
              <span
                key={`${badge.label}:${index}`}
                className="timeline-clip-chrome-badge"
                style={{
                  right: badge.right,
                  width: badge.width,
                  backgroundColor: badge.fill,
                  borderColor: badge.stroke ?? 'transparent',
                }}
              >
                {badge.label}
              </span>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}

export const TimelineClipCanvas = memo(TimelineClipCanvasComponent);
