import type { TimelineCanvasDrawDiagnostics } from '../../../services/timeline/timelineCanvasDiagnostics';
import type { TimelineAudioDisplayMode } from '../../../stores/timeline/types';
import type { TimelinePaintSourceClip } from '../../../timeline';
import { drawTimelineSpectrogram, resolveTimelineSpectrogramSourceRange } from './spectrogramCanvas';
import { isTimelineClipCanvasAudioClip } from './timelineClipCanvasAudio';
import { drawTimelineClipCanvasCompositionDecorations } from './timelineClipCanvasCompositionPainter';
import { drawTimelineClipCanvasFadeCurve } from './timelineClipCanvasFadeCurvePainter';
import { drawTimelineClipCanvasMidiPreviewResource } from './timelineClipCanvasMidiPreviewPainter';
import { createTimelineClipCanvasWorkerMidiPreviewResource } from './timelineClipCanvasMidiResource';
import {
  getTimelineClipCanvasPassiveDecorationBadgeReserve,
  getTimelineClipCanvasPassiveDecorationBadges,
  getTimelineClipCanvasPassiveDecorationProgressBars,
  type TimelineClipCanvasMediaStatus,
} from './timelineClipCanvasPassiveDecorations';
import { drawTimelineClipCanvasPassiveDecorations } from './timelineClipCanvasPassiveDecorationsPainter';
import { getTimelineClipCanvasSpectrogramTileSetForClip, type TimelineClipCanvasSpectrogramTileSetMap } from './timelineClipCanvasSpectrogramResource';
import { drawTimelineClipCanvasSourceExtensionGhosts } from './timelineClipCanvasSourceExtensionGhostPainter';
import { drawTimelineClipCanvasThumbnails } from './timelineClipCanvasThumbnailPainter';
import { getTimelineClipCanvasThumbnailMediaFileId } from './timelineClipCanvasThumbnailPreparation';
import type { TimelineClipCanvasTrimGeometry } from './timelineClipCanvasTrimResource';
import { drawTimelineClipCanvasAudioWaveform } from './timelineClipCanvasWaveformPainter';
import {
  getTimelineClipCanvasWaveformPyramidForClip,
  type TimelineClipCanvasWaveformPyramidMap,
} from './timelineClipCanvasWaveformResource';

export interface TimelineClipCanvasMainThreadDrawInput {
  ctx: CanvasRenderingContext2D;
  clips: readonly TimelinePaintSourceClip[];
  height: number;
  timeToPixel: (time: number) => number;
  selectedClipIds: ReadonlySet<string>;
  hoveredClipId?: string | null;
  trackColor: string;
  scrollX: number;
  viewportWidth: number;
  waveformsEnabled?: boolean;
  audioDisplayMode?: TimelineAudioDisplayMode;
  waveformPyramids?: TimelineClipCanvasWaveformPyramidMap;
  spectrogramTileSets?: TimelineClipCanvasSpectrogramTileSetMap;
  cssWidth: number;
  canvasOffsetX: number;
  renderOverscanPx: number;
  thumbnailViewportOverscanPx: number;
  lodBarPx: number;
  lodLabelPx: number;
  lodThumbnailPx: number;
  maxThumbnailSlots: number;
  thumbnailSlotPx: number;
  resolveGeometry: (clip: TimelinePaintSourceClip) => TimelineClipCanvasTrimGeometry;
  getMediaStatus: (clip: TimelinePaintSourceClip) => TimelineClipCanvasMediaStatus | undefined;
  requestRedraw: () => void;
}

function withAlpha(color: string, alpha: number): string {
  if (color.startsWith('#') && (color.length === 7 || color.length === 4)) {
    let r: number, g: number, b: number;
    if (color.length === 4) {
      r = parseInt(color[1] + color[1], 16);
      g = parseInt(color[2] + color[2], 16);
      b = parseInt(color[3] + color[3], 16);
    } else {
      r = parseInt(color.slice(1, 3), 16);
      g = parseInt(color.slice(3, 5), 16);
      b = parseInt(color.slice(5, 7), 16);
    }
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return color;
}

export function drawTimelineClipCanvasMainThread(
  input: TimelineClipCanvasMainThreadDrawInput,
): TimelineCanvasDrawDiagnostics {
  const {
    ctx,
    clips,
    height,
    timeToPixel,
    selectedClipIds,
    hoveredClipId,
    trackColor,
    scrollX,
    viewportWidth,
    waveformsEnabled,
    audioDisplayMode = 'detailed',
    waveformPyramids,
    spectrogramTileSets,
    cssWidth,
    canvasOffsetX,
    renderOverscanPx,
    thumbnailViewportOverscanPx,
    lodBarPx,
    lodLabelPx,
    lodThumbnailPx,
    maxThumbnailSlots,
    thumbnailSlotPx,
    resolveGeometry,
    getMediaStatus,
    requestRedraw,
  } = input;
  ctx.clearRect(0, 0, cssWidth, height);
  const diagnostics: TimelineCanvasDrawDiagnostics = {
    inputClipCount: clips.length,
    visibleClipCount: 0,
    drawnClipCount: 0,
    thumbnailClipCount: 0,
    thumbnailDrawCount: 0,
    waveformClipCount: 0,
    workerMode: false,
  };

  const thumbVisibleLeft = scrollX - thumbnailViewportOverscanPx;
  const thumbVisibleRight = scrollX + viewportWidth + thumbnailViewportOverscanPx;
  const renderVisibleLeft = scrollX - renderOverscanPx;
  const renderVisibleRight = scrollX + viewportWidth + renderOverscanPx;

  const radius = Math.min(4, height / 4);
  const fill = withAlpha(trackColor, 0.55);
  const fillSelected = withAlpha(trackColor, 0.85);
  const border = withAlpha(trackColor, 0.9);
  const selectedBorder = '#ffffff';

  ctx.font = '11px ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif';
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
      ctx.fillStyle = selectedClipIds.has(clip.id) ? fillSelected : fill;
      ctx.fillRect(x, 1, Math.max(1, w), height - 2);
      continue;
    }

    const selected = selectedClipIds.has(clip.id);
    const hovered = hoveredClipId === clip.id;
    const mediaStatus = getMediaStatus(clip);
    const badges = getTimelineClipCanvasPassiveDecorationBadges(clip, mediaStatus);
    const progressBars = getTimelineClipCanvasPassiveDecorationProgressBars(clip, mediaStatus);
    const top = 1;
    const h = height - 2;
    const visibleStartRatio = Math.max(0, Math.min(1, (visibleAbsLeft - absoluteX) / Math.max(1, absoluteW)));
    const visibleEndRatio = Math.max(visibleStartRatio, Math.min(1, (visibleAbsRight - absoluteX) / Math.max(1, absoluteW)));

    ctx.beginPath();
    ctx.roundRect(x, top, w, h, radius);
    ctx.fillStyle = selected ? fillSelected : fill;
    ctx.fill();

    drawTimelineClipCanvasMidiPreviewResource(
      ctx,
      createTimelineClipCanvasWorkerMidiPreviewResource(clip, w, h, visibleStartRatio, visibleEndRatio),
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
          h,
          audioDisplayMode,
          timeToPixel(1),
        );
      }
    }

    const hasCompositionSegments = Boolean(clip.isComposition && clip.clipSegments?.length);
    if (hasCompositionSegments) {
      diagnostics.thumbnailClipCount += 1;
    }

    const inThumbWindow = absoluteRight > thumbVisibleLeft && absoluteX < thumbVisibleRight;
    const mediaFileId = (visibleW >= lodThumbnailPx && inThumbWindow && !hasCompositionSegments)
      ? getTimelineClipCanvasThumbnailMediaFileId(clip)
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
      ctx.rect(visibleX, top, visibleW, h);
      ctx.clip();
      diagnostics.thumbnailDrawCount += drawTimelineClipCanvasThumbnails(
        ctx,
        visibleClip,
        mediaFileId,
        visibleX,
        top,
        visibleW,
        h,
        requestRedraw,
        maxThumbnailSlots,
        thumbnailSlotPx,
      );
      const grad = ctx.createLinearGradient(0, top + h - 16, 0, top + h);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, 'rgba(0,0,0,0.55)');
      ctx.fillStyle = grad;
      ctx.fillRect(visibleX, top + h - 16, visibleW, 16);
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
      },
    );
    if (compositionThumbnailDrawCount > 0) {
      diagnostics.thumbnailDrawCount += compositionThumbnailDrawCount;
    }

    drawTimelineClipCanvasSourceExtensionGhosts(ctx, geometry, top, h, renderVisibleLeft, renderVisibleRight, canvasOffsetX, timeToPixel);
    drawTimelineClipCanvasFadeCurve(ctx, clip.fade, x, top, w, h);
    drawTimelineClipCanvasPassiveDecorations(ctx, clip, geometry, badges, progressBars, x, top, w, h);

    ctx.beginPath();
    ctx.roundRect(x, top, w, h, radius);
    ctx.lineWidth = selected ? 2 : hovered ? 1.5 : 1;
    ctx.strokeStyle = selected ? selectedBorder : hovered ? 'rgba(255,255,255,0.58)' : border;
    ctx.stroke();

    if (visibleW >= lodLabelPx && clip.name) {
      const labelLeft = Math.max(x + 5, visibleX + 5);
      const badgeReserve = Math.min(w * 0.45, getTimelineClipCanvasPassiveDecorationBadgeReserve(badges));
      const labelRight = Math.min(x + w - 5 - badgeReserve, visibleX + visibleW - 5);
      const labelW = labelRight - labelLeft;
      if (labelW <= 4) continue;

      ctx.save();
      ctx.beginPath();
      ctx.rect(labelLeft, top, labelW, h);
      ctx.clip();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
      // MIDI clips show their name top-left (the lane body is the piano-roll
      // preview); media clips put it at the bottom over the thumbnail/waveform,
      // everything else centers it.
      const labelY = clip.trackType === 'midi' ? top + 9 : mediaFileId ? top + h - 8 : top + h / 2;
      ctx.fillText(clip.name, labelLeft + 1, labelY);
      ctx.restore();
    }
  }

  return diagnostics;
}
