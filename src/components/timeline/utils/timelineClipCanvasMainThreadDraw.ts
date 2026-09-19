import type { TimelineCanvasDrawDiagnostics } from '../../../services/timeline/timelineCanvasDiagnostics';
import type { TimelineAudioDisplayMode } from '../../../stores/timeline/types';
import type { TimelinePaintSourceClip } from '../../../timeline';
import { drawTimelineSpectrogram, resolveTimelineSpectrogramSourceRange } from './spectrogramCanvas';
import { isTimelineClipCanvasAudioClip } from './timelineClipCanvasAudio';
import { drawTimelineClipCanvasCompositionDecorations } from './timelineClipCanvasCompositionPainter';
import { drawTimelineClipCanvasEdgeBrackets } from './timelineClipCanvasEdgeBrackets';
import { drawTimelineClipCanvasFadeCurve } from './timelineClipCanvasFadeCurvePainter';
import { drawTimelineClipCanvasMidiPreviewResource } from './timelineClipCanvasMidiPreviewPainter';
import { createTimelineClipCanvasWorkerMidiPreviewResource } from './timelineClipCanvasMidiResource';
import {
  createTimelineClipCanvasSceneCutMarkers,
  getTimelineClipCanvasPassiveDecorationBadges,
  getTimelineClipCanvasPassiveDecorationProgressBars,
  type TimelineClipCanvasMediaStatus,
} from './timelineClipCanvasPassiveDecorations';
import { drawTimelineClipCanvasPassiveDecorations } from './timelineClipCanvasPassiveDecorationsPainter';
import { drawTimelineClipCanvasSceneCutMarkers } from './timelineClipCanvasSceneCutPainter';
import { getTimelineClipCanvasSpectrogramTileSetForClip, type TimelineClipCanvasSpectrogramTileSetMap } from './timelineClipCanvasSpectrogramResource';
import { drawTimelineClipCanvasSourceExtensionGhosts } from './timelineClipCanvasSourceExtensionGhostPainter';
import { drawTimelineClipCanvasThumbnails, paintTimelineClipCanvasThumbnailGradient } from './timelineClipCanvasThumbnailPainter';
import { getTimelineClipCanvasThumbnailSourceId } from './timelineClipCanvasThumbnailSource';
import type { TimelineClipCanvasTrimGeometry } from './timelineClipCanvasTrimResource';
import { drawTimelineClipCanvasAudioWaveform } from './timelineClipCanvasWaveformPainter';
import { paintTimelineClipCanvasBody } from './timelineClipCanvasBodyPainter';
import { paintTimelineClipCanvasMissingMediaBorder } from './timelineClipCanvasMissingMediaPainter';
import { getResolveTimelineClipFooterHeight, paintResolveTimelineClipFooterForBody, paintResolveTimelineClipPreviewBackground, RESOLVE_TIMELINE_CLIP_PREVIEW_INSET_PX } from './resolveTimelineClipCanvas';
import { getTimelineClipCanvasVisualPreviewHeight } from './timelineClipCanvasVisualLayout';
import { withTimelineClipCanvasAlpha } from './timelineClipCanvasColor';
import {
  getTimelineClipCanvasWaveformPyramidForClip,
  type TimelineClipCanvasWaveformPyramidMap,
} from './timelineClipCanvasWaveformResource';
export interface TimelineClipCanvasMainThreadDrawInput {
  ctx: CanvasRenderingContext2D;
  clips: readonly TimelinePaintSourceClip[];
  height: number;
  dpr?: number;
  timeToPixel: (time: number) => number;
  selectedClipIds: ReadonlySet<string>;
  hoveredClipId?: string | null;
  trackColor: string;
  selectionBorderColor?: string;
  scrollX: number;
  viewportWidth: number;
  thumbnailsEnabled?: boolean;
  waveformsEnabled?: boolean;
  audioDisplayMode?: TimelineAudioDisplayMode;
  showFaceRanges?: boolean;
  waveformPyramids?: TimelineClipCanvasWaveformPyramidMap;
  spectrogramTileSets?: TimelineClipCanvasSpectrogramTileSetMap;
  mediaThumbnailUrlsById?: ReadonlyMap<string, string | undefined>;
  cssWidth: number;
  canvasOffsetX: number;
  renderOverscanPx: number;
  thumbnailViewportOverscanPx: number;
  lodBarPx: number;
  lodThumbnailPx: number;
  maxThumbnailSlots: number;
  thumbnailSlotPx: number;
  resolveGeometry: (clip: TimelinePaintSourceClip) => TimelineClipCanvasTrimGeometry;
  getMediaStatus: (clip: TimelinePaintSourceClip) => TimelineClipCanvasMediaStatus | undefined;
  requestRedraw: () => void;
}

export function drawTimelineClipCanvasMainThread(
  input: TimelineClipCanvasMainThreadDrawInput,
): TimelineCanvasDrawDiagnostics {
  const {
    ctx,
    clips,
    height,
    dpr = 1,
    timeToPixel,
    selectedClipIds,
    hoveredClipId,
    trackColor,
    selectionBorderColor = '#ffffff',
    scrollX,
    viewportWidth,
    thumbnailsEnabled = true,
    waveformsEnabled,
    audioDisplayMode = 'detailed',
    showFaceRanges = false,
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
  } = input;
  ctx.clearRect(0, 0, Math.max(0, cssWidth), Math.max(0, height));
  const diagnostics: TimelineCanvasDrawDiagnostics = {
    inputClipCount: clips.length,
    visibleClipCount: 0,
    drawnClipCount: 0,
    thumbnailClipCount: 0,
    thumbnailDrawCount: 0,
    waveformClipCount: 0,
    workerMode: false,
  };
  if (height <= 2 || cssWidth <= 0) return diagnostics;

  const thumbVisibleLeft = scrollX - thumbnailViewportOverscanPx;
  const thumbVisibleRight = scrollX + viewportWidth + thumbnailViewportOverscanPx;
  const renderVisibleLeft = scrollX - renderOverscanPx;
  const renderVisibleRight = scrollX + viewportWidth + renderOverscanPx;

  const resolveStyle = selectionBorderColor !== '#ffffff';
  const radius = resolveStyle ? 1 : Math.min(4, height / 4);
  const fill = withTimelineClipCanvasAlpha(trackColor, 0.55);
  const fillSelected = withTimelineClipCanvasAlpha(trackColor, 0.85);
  const border = withTimelineClipCanvasAlpha(trackColor, 0.9);
  const selectedBorder = selectionBorderColor;

  ctx.textBaseline = 'middle';

  for (const clip of clips) {
    const geometry = resolveGeometry(clip);
    if (!geometry.visible) continue;
    diagnostics.visibleClipCount += 1;
    const absoluteX = timeToPixel(geometry.startTime);
    const absoluteW = timeToPixel(geometry.duration);
    const absoluteRight = absoluteX + absoluteW;
    const visibleAbsLeft = Math.max(absoluteX, canvasOffsetX, renderVisibleLeft);
    const visibleAbsRight = Math.min(absoluteRight, canvasOffsetX + cssWidth, renderVisibleRight);
    const visibleW = visibleAbsRight - visibleAbsLeft;
    if (visibleW <= 0) continue;
    diagnostics.drawnClipCount += 1;

    const x = absoluteX - canvasOffsetX;
    const visibleX = visibleAbsLeft - canvasOffsetX;
    const w = absoluteW;
    if (w < lodBarPx) {
      paintTimelineClipCanvasBody({ ctx, clip, x, width: w, height, dpr, fill: selectedClipIds.has(clip.id) ? fillSelected : fill });
      continue;
    }

    const selected = selectedClipIds.has(clip.id);
    const hovered = hoveredClipId === clip.id;
    const mediaStatus = getMediaStatus(clip);
    const badges = getTimelineClipCanvasPassiveDecorationBadges(clip, mediaStatus);
    const progressBars = getTimelineClipCanvasPassiveDecorationProgressBars(clip, mediaStatus);
    const sceneCutMarkers = createTimelineClipCanvasSceneCutMarkers({
      clip,
      mediaStatus,
      inPoint: geometry.inPoint,
      outPoint: geometry.outPoint,
    });
    const top = 1;
    const h = height - 2;
    const footerHeight = resolveStyle ? getResolveTimelineClipFooterHeight(h) : 0;
    const previewHeight = Math.max(1, h - footerHeight);
    const visualPreviewHeight = Math.min(previewHeight, getTimelineClipCanvasVisualPreviewHeight(h));
    const visibleStartRatio = Math.max(0, Math.min(1, (visibleAbsLeft - absoluteX) / Math.max(1, absoluteW)));
    const visibleEndRatio = Math.max(visibleStartRatio, Math.min(1, (visibleAbsRight - absoluteX) / Math.max(1, absoluteW)));

    paintTimelineClipCanvasBody({ ctx, clip, x, width: w, height, dpr, fill: selected ? fillSelected : fill, radius });

    // Build the MIDI preview from the geometry-adjusted clip (live trim/drag
    // start/duration/in/out), not the raw stored clip. The preview's bar x =
    // ((sourceTime - sourceIn) / sourceSpan) * clipWidth, so passing the trimmed
    // pixel width `w` while keeping the raw source span would stretch every note
    // during a resize and only snap back on commit. The worker path already
    // folds geometry into its resourceClip; mirror that here.
    const midiPreviewClip = (clip.trackType === 'midi' || clip.source?.type === 'midi')
      ? {
        ...clip,
        startTime: geometry.startTime,
        duration: geometry.duration,
        inPoint: geometry.inPoint,
        outPoint: geometry.outPoint,
      }
      : clip;
    drawTimelineClipCanvasMidiPreviewResource(
      ctx,
      createTimelineClipCanvasWorkerMidiPreviewResource(midiPreviewClip, w, h, visibleStartRatio, visibleEndRatio),
      x,
      top,
      w,
      h,
    );

    if (waveformsEnabled && isTimelineClipCanvasAudioClip(clip)) {
      diagnostics.waveformClipCount += 1;
      const waveformPyramid = getTimelineClipCanvasWaveformPyramidForClip(clip, waveformPyramids);
      const sourceSpan = Math.max(0.001, geometry.outPoint - geometry.inPoint);
      const visibleAudioClip = {
        ...clip,
        inPoint: geometry.inPoint + sourceSpan * visibleStartRatio,
        outPoint: geometry.inPoint + sourceSpan * visibleEndRatio,
      };
      let drewSpectrogram = false;
      if (audioDisplayMode === 'spectral') {
        const { refId, tileSet, variant } = getTimelineClipCanvasSpectrogramTileSetForClip(clip, spectrogramTileSets);
        const spectrogramDuration = Math.max(0.001, tileSet?.duration ?? clip.source?.naturalDuration ?? geometry.outPoint);
        const spectrogramRange = resolveTimelineSpectrogramSourceRange({
          variant,
          visibleSourceInPoint: visibleAudioClip.inPoint,
          visibleSourceOutPoint: visibleAudioClip.outPoint,
          tileDuration: spectrogramDuration,
          visibleStartRatio,
          visibleEndRatio,
        });
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(x, top, w, h, radius);
        ctx.clip();
        const result = drawTimelineSpectrogram(ctx, {
          tileSet,
          cacheKey: refId,
          x: visibleX,
          y: top,
          clipWidth: visibleW,
          height: h,
          inPoint: spectrogramRange.inPoint,
          outPoint: spectrogramRange.outPoint,
          naturalDuration: spectrogramRange.naturalDuration,
          renderStartPx: 0,
          renderWidth: visibleW,
        });
        drewSpectrogram = result.drawn;
        ctx.restore();
      }

      if (!drewSpectrogram) {
        drawTimelineClipCanvasAudioWaveform(
          ctx,
          visibleAudioClip,
          waveformPyramid,
          visibleX,
          top,
          visibleW,
          previewHeight,
          audioDisplayMode,
          timeToPixel(1),
          resolveStyle,
        );
      }
    }

    const hasCompositionSegments = Boolean(clip.trackType !== 'audio' && clip.source?.type !== 'audio' && clip.isComposition && clip.clipSegments?.length);
    if (thumbnailsEnabled && hasCompositionSegments) {
      diagnostics.thumbnailClipCount += 1;
    }

    const inThumbWindow = absoluteRight > thumbVisibleLeft && absoluteX < thumbVisibleRight;
    const mediaFileId = (thumbnailsEnabled && visibleW >= lodThumbnailPx && inThumbWindow && !hasCompositionSegments)
      ? getTimelineClipCanvasThumbnailSourceId(clip)
      : null;
    if (mediaFileId) {
      diagnostics.thumbnailClipCount += 1;
      const sourceSpan = Math.max(0.001, geometry.outPoint - geometry.inPoint);
      const visibleClip = {
        ...clip,
        inPoint: geometry.inPoint + sourceSpan * visibleStartRatio,
        outPoint: geometry.inPoint + sourceSpan * visibleEndRatio,
      };
      ctx.save();
      ctx.beginPath();
      ctx.rect(visibleX, top, visibleW, visualPreviewHeight);
      ctx.clip();
      const previewInset = resolveStyle ? RESOLVE_TIMELINE_CLIP_PREVIEW_INSET_PX : 0;
      const leftInset = visibleAbsLeft <= absoluteX ? previewInset : 0;
      const rightInset = visibleAbsRight >= absoluteRight ? previewInset : 0;
      const thumbnailX = visibleX + leftInset;
      const thumbnailWidth = Math.max(1, visibleW - leftInset - rightInset);
      const thumbnailTop = top + previewInset;
      const thumbnailHeight = Math.max(1, visualPreviewHeight - previewInset * 2);
      if (resolveStyle) paintResolveTimelineClipPreviewBackground(ctx, x, top, w, visualPreviewHeight);
      diagnostics.thumbnailDrawCount += drawTimelineClipCanvasThumbnails(
        ctx,
        visibleClip,
        mediaFileId,
        thumbnailX,
        thumbnailTop,
        thumbnailWidth,
        thumbnailHeight,
        requestRedraw,
        maxThumbnailSlots,
        thumbnailSlotPx,
        clip.source?.type === 'image' ? mediaThumbnailUrlsById?.get(mediaFileId) : undefined,
      );
      paintTimelineClipCanvasThumbnailGradient(ctx, thumbnailX, thumbnailTop, thumbnailWidth, thumbnailHeight);
      ctx.restore();
    }

    const compositionThumbnailDrawCount = drawTimelineClipCanvasCompositionDecorations(
      ctx,
      clip,
      geometry,
      x,
      top,
      w,
      h,
      requestRedraw,
      {
        maxThumbSlots: maxThumbnailSlots,
        minThumbnailWidth: lodThumbnailPx,
        thumbSlotPx: thumbnailSlotPx,
        thumbnailHeight: visualPreviewHeight,
        thumbnailsEnabled,
      },
    );
    if (compositionThumbnailDrawCount > 0) {
      diagnostics.thumbnailDrawCount += compositionThumbnailDrawCount;
    }

    drawTimelineClipCanvasSourceExtensionGhosts(ctx, geometry, top, h, renderVisibleLeft, renderVisibleRight, canvasOffsetX, timeToPixel);
    drawTimelineClipCanvasFadeCurve(ctx, clip.fade, x, top, w, h);
    drawTimelineClipCanvasPassiveDecorations(ctx, clip, geometry, badges, progressBars, x, top, w, h, false, showFaceRanges);
    drawTimelineClipCanvasSceneCutMarkers(ctx, sceneCutMarkers, x, top, w, h);

    paintResolveTimelineClipFooterForBody(ctx, x, top, w, h, footerHeight, selected ? fillSelected : fill);

    paintTimelineClipCanvasMissingMediaBorder({
      ctx,
      needsReload: clip.needsReload === true,
      selected,
      hovered,
      x,
      top,
      width: w,
      height: h,
      radius,
      border,
      selectedBorder,
    });

    if (!selected) drawTimelineClipCanvasEdgeBrackets(ctx, x, top, w, h);
  }

  return diagnostics;
}
