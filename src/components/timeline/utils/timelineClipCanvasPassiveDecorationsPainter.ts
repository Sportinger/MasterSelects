import type { TimelinePaintSourceClip } from '../../../timeline';
import {
  drawTimelineClipCanvasPassiveBadges,
  drawTimelineClipCanvasPassiveProgressBars,
} from './timelineClipCanvasPassiveBadgePainter';
import { drawTimelineClipCanvasPassiveAnalysisOverlay } from './timelineClipCanvasPassiveAnalysisPainter';
import {
  collectTimelineFaceIdentityRanges,
  getTimelineFaceIdentityColor,
  getTimelineFaceIdentityRangeRatios,
} from './timelineFaceRangeOverlay';
import type { TimelineClipCanvasTrimGeometry } from './timelineClipCanvasTrimResource';
import type {
  TimelineClipCanvasWorkerPassiveBadge,
  TimelineClipCanvasWorkerProgressBar,
} from './timelineClipCanvasWorkerContract';

function drawTimelineClipCanvasTranscriptMarkers(
  ctx: CanvasRenderingContext2D,
  clip: TimelinePaintSourceClip,
  geometry: TimelineClipCanvasTrimGeometry,
  x: number,
  top: number,
  w: number,
  h: number,
): void {
  const transcript = clip.transcript;
  if (!transcript || transcript.length === 0 || w < 18) return;

  const sourceSpan = Math.max(0.001, geometry.outPoint - geometry.inPoint);
  const markerTop = top + Math.max(4, h - 7);
  const markerHeight = 2;

  ctx.save();
  ctx.fillStyle = 'rgba(129, 140, 248, 0.82)';
  for (const word of transcript) {
    const wordStart = Math.max(geometry.inPoint, Math.min(geometry.outPoint, word.start));
    const wordEnd = Math.max(geometry.inPoint, Math.min(geometry.outPoint, word.end));
    if (wordEnd <= geometry.inPoint || wordStart >= geometry.outPoint || wordEnd <= wordStart) continue;

    const startRatio = clip.reversed
      ? (geometry.outPoint - wordEnd) / sourceSpan
      : (wordStart - geometry.inPoint) / sourceSpan;
    const endRatio = clip.reversed
      ? (geometry.outPoint - wordStart) / sourceSpan
      : (wordEnd - geometry.inPoint) / sourceSpan;
    const left = x + Math.max(0, Math.min(1, startRatio)) * w;
    const right = x + Math.max(0, Math.min(1, endRatio)) * w;
    const markerW = Math.max(1, right - left);
    ctx.fillRect(left, markerTop, markerW, markerHeight);
  }
  ctx.restore();
}

function drawTimelineClipCanvasFaceRanges(
  ctx: CanvasRenderingContext2D,
  clip: TimelinePaintSourceClip,
  geometry: TimelineClipCanvasTrimGeometry,
  x: number,
  top: number,
  w: number,
  h: number,
): void {
  if (w < 12) return;
  const ratios = getTimelineFaceIdentityRangeRatios(
    collectTimelineFaceIdentityRanges(clip),
    geometry.inPoint,
    geometry.outPoint,
    clip.reversed,
  );
  if (ratios.length === 0) return;

  const bandHeight = Math.max(2, Math.min(4, h * 0.12));
  for (const range of ratios) {
    const [red, green, blue] = getTimelineFaceIdentityColor(range.personId).rgb;
    const left = x + range.start * w;
    const width = Math.max(1, (range.end - range.start) * w);
    ctx.fillStyle = `rgba(${red}, ${green}, ${blue}, 0.16)`;
    ctx.fillRect(left, top, width, h);
    ctx.fillStyle = `rgba(${red}, ${green}, ${blue}, 0.78)`;
    ctx.fillRect(left, top + h - bandHeight, width, bandHeight);
  }
}

export function drawTimelineClipCanvasPassiveDecorations(
  ctx: CanvasRenderingContext2D,
  clip: TimelinePaintSourceClip,
  geometry: TimelineClipCanvasTrimGeometry,
  badges: readonly TimelineClipCanvasWorkerPassiveBadge[],
  progressBars: readonly TimelineClipCanvasWorkerProgressBar[],
  x: number,
  top: number,
  w: number,
  h: number,
  drawBadges = true,
  showFaceRanges = false,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, top, w, h, Math.min(4, h / 4));
  ctx.clip();
  if (showFaceRanges) {
    drawTimelineClipCanvasFaceRanges(ctx, clip, geometry, x, top, w, h);
  }
  drawTimelineClipCanvasPassiveAnalysisOverlay(ctx, clip, geometry, x, top, w, h);
  drawTimelineClipCanvasTranscriptMarkers(ctx, clip, geometry, x, top, w, h);
  drawTimelineClipCanvasPassiveProgressBars(ctx, progressBars, x, top, w);
  if (drawBadges) {
    drawTimelineClipCanvasPassiveBadges(ctx, badges, x, top, w);
  }
  ctx.restore();
}
