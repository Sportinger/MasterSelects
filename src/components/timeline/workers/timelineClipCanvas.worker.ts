// OffscreenCanvas worker for the timeline clip layer (issue #228, Phase 4).
//
// Draws clip bodies (rounded rects + Level-of-Detail + labels) entirely off the
// main thread, so even heavy React reconciliation of the timeline chrome cannot
// stutter the clip render. The main thread resolves geometry before posting so
// timeline state, transforms, and cache ownership never cross the worker boundary.
//
// Thumbnail source caches remain main-thread owned. The worker only receives
// fresh per-draw strip ImageBitmaps, plus waveform/spectrogram numeric data.

import type {
  TimelineClipCanvasWorkerAnalysisOverlayResource as WorkerAnalysisOverlayResource,
  TimelineClipCanvasWorkerClip as WorkerPlainClip,
  TimelineClipCanvasWorkerDrawMessage as DrawMessage,
  TimelineClipCanvasWorkerDrawnMessage as DrawnMessage,
  TimelineClipCanvasWorkerIncomingMessage as IncomingMessage,
  TimelineClipCanvasWorkerOutgoingMessage as OutgoingMessage,
  TimelineClipCanvasWorkerPassiveBadge as WorkerPassiveBadge,
  TimelineClipCanvasWorkerProgressBar as WorkerProgressBar,
  TimelineClipCanvasWorkerSourceExtensionGhostResource as WorkerSourceExtensionGhost,
  TimelineClipCanvasWorkerWaveformResource as WorkerWaveformResource,
} from '../utils/timelineClipCanvasWorkerContract';
import {
  TIMELINE_CLIP_CANVAS_LOD_BAR_PX,
  TIMELINE_CLIP_CANVAS_LOD_LABEL_PX,
} from '../timelineRenderConstants';
import { writeTimelineSpectralColor } from '../utils/spectralColor';

const LOD_BAR_PX = TIMELINE_CLIP_CANVAS_LOD_BAR_PX;
const LOD_LABEL_PX = TIMELINE_CLIP_CANVAS_LOD_LABEL_PX;

let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;

function postWorkerMessage(message: OutgoingMessage): void {
  self.postMessage(message);
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

function drawWaveformCenterLine(
  context: OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
  alpha = 0.16,
): void {
  const midY = height / 2;
  context.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(0, midY);
  context.lineTo(width, midY);
  context.stroke();
}

function drawWaveformColumns(
  context: OffscreenCanvasRenderingContext2D,
  columns: Float32Array,
  columnCount: number,
  width: number,
  height: number,
  mode: WorkerWaveformResource['mode'],
): void {
  if (columnCount <= 0 || columns.length < columnCount * 4) {
    drawWaveformCenterLine(context, width, height, 0.18);
    return;
  }

  const midY = height / 2;
  const halfHeight = Math.max(1, (height - 6) / 2);
  const xAt = (index: number) => {
    if (columnCount <= 1) return width / 2;
    return (index / (columnCount - 1)) * width;
  };
  const columnAt = (index: number) => {
    const offset = index * 4;
    return {
      min: columns[offset] ?? 0,
      max: columns[offset + 1] ?? 0,
      rms: columns[offset + 2] ?? 0,
      peak: columns[offset + 3] ?? 0,
    };
  };

  context.beginPath();
  for (let index = 0; index < columnCount; index += 1) {
    const column = columnAt(index);
    const x = xAt(index);
    const y = midY - Math.max(column.max, column.peak * 0.04, 0) * halfHeight;
    if (index === 0) {
      context.moveTo(x, y);
    } else {
      const previousX = xAt(index - 1);
      const previousY = midY - Math.max(columnAt(index - 1).max, columnAt(index - 1).peak * 0.04, 0) * halfHeight;
      context.quadraticCurveTo(previousX, previousY, (previousX + x) / 2, (previousY + y) / 2);
    }
  }
  context.lineTo(width, midY + Math.max(-columnAt(columnCount - 1).min, columnAt(columnCount - 1).peak * 0.04, 0) * halfHeight);
  for (let index = columnCount - 1; index >= 0; index -= 1) {
    const column = columnAt(index);
    const x = xAt(index);
    const y = midY + Math.max(-column.min, column.peak * 0.04, 0) * halfHeight;
    if (index === columnCount - 1) {
      context.lineTo(x, y);
    } else {
      const nextX = xAt(index + 1);
      const nextY = midY + Math.max(-columnAt(index + 1).min, columnAt(index + 1).peak * 0.04, 0) * halfHeight;
      context.quadraticCurveTo(nextX, nextY, (nextX + x) / 2, (nextY + y) / 2);
    }
  }
  context.closePath();
  context.fillStyle = mode === 'compact'
    ? 'rgba(235, 241, 248, 0.62)'
    : 'rgba(178, 230, 255, 0.36)';
  context.fill();

  if (mode === 'detailed') {
    context.beginPath();
    for (let index = 0; index < columnCount; index += 1) {
      const column = columnAt(index);
      const x = xAt(index);
      const y = midY - Math.min(column.rms * 0.84, column.peak * 0.72) * halfHeight;
      if (index === 0) {
        context.moveTo(x, y);
      } else {
        context.lineTo(x, y);
      }
    }
    context.strokeStyle = 'rgba(216, 240, 255, 0.42)';
    context.lineWidth = 1;
    context.stroke();
  }

  drawWaveformCenterLine(context, width, height, mode === 'compact' ? 0.12 : 0.16);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function drawClipThumbnailStrip(
  context: OffscreenCanvasRenderingContext2D,
  clip: WorkerPlainClip,
  top: number,
): number {
  const strip = clip.thumbnailStrip;
  if (!strip || strip.width <= 0 || strip.height <= 0) return 0;

  context.save();
  try {
    context.beginPath();
    context.roundRect(strip.x, top, strip.width, strip.height, Math.min(4, strip.height / 4));
    context.clip();
    context.drawImage(strip.bitmap, strip.x, top, strip.width, strip.height);

    const gradient = context.createLinearGradient(0, top + strip.height - 16, 0, top + strip.height);
    gradient.addColorStop(0, 'rgba(0,0,0,0)');
    gradient.addColorStop(1, 'rgba(0,0,0,0.55)');
    context.fillStyle = gradient;
    context.fillRect(strip.x, top + strip.height - 16, strip.width, 16);
    return strip.drawCount;
  } finally {
    context.restore();
    strip.bitmap.close();
  }
}

function drawClipSpectrogram(
  context: OffscreenCanvasRenderingContext2D,
  clip: WorkerPlainClip,
  top: number,
  height: number,
): void {
  const spectrogram = clip.spectrogram;
  if (!spectrogram || spectrogram.rasterWidth <= 0 || spectrogram.rasterHeight <= 0) return;

  const expectedLength = spectrogram.rasterWidth * spectrogram.rasterHeight;
  if (spectrogram.values.length < expectedLength) return;

  const image = context.createImageData(spectrogram.rasterWidth, spectrogram.rasterHeight);
  const pixels = image.data;
  for (let index = 0; index < expectedLength; index += 1) {
    writeTimelineSpectralColor(pixels, index * 4, spectrogram.values[index] ?? 0);
  }

  const bitmapCanvas = new OffscreenCanvas(spectrogram.rasterWidth, spectrogram.rasterHeight);
  const bitmapCtx = bitmapCanvas.getContext('2d');
  if (!bitmapCtx) return;
  bitmapCtx.putImageData(image, 0, 0);

  const x = clip.x;
  const w = clip.width;
  const h = height - 2;
  context.save();
  context.beginPath();
  context.roundRect(x, top, w, h, Math.min(4, h / 4));
  context.clip();
  context.drawImage(bitmapCanvas, x, top, w, h);
  context.restore();
}

function drawClipWaveform(
  context: OffscreenCanvasRenderingContext2D,
  clip: WorkerPlainClip,
  top: number,
  height: number,
): void {
  if (!clip.waveformEnabled) return;
  const x = clip.x;
  const w = clip.width;
  const h = height - 2;
  context.save();
  context.beginPath();
  context.roundRect(x, top, w, h, Math.min(4, h / 4));
  context.clip();
  context.fillStyle = 'rgba(4, 10, 18, 0.24)';
  context.fillRect(x, top, w, h);
  context.translate(x, top);
  if (clip.waveform) {
    drawWaveformColumns(context, clip.waveform.columns, clip.waveform.columnCount, w, h, clip.waveform.mode);
  } else {
    drawWaveformCenterLine(context, w, h, 0.18);
  }
  context.restore();
}

function drawWorkerCompositionSegmentRects(
  context: OffscreenCanvasRenderingContext2D,
  rects: Float32Array | undefined,
  x: number,
  top: number,
  width: number,
  height: number,
): void {
  if (!rects || rects.length < 2) return;
  for (let index = 0; index + 1 < rects.length; index += 2) {
    const startNorm = clamp01(rects[index] ?? 0);
    const endNorm = Math.max(startNorm, clamp01(rects[index + 1] ?? startNorm));
    const segmentX = x + startNorm * width;
    const segmentW = Math.max(1, (endNorm - startNorm) * width);
    if (segmentW <= 0) continue;

    context.fillStyle = 'rgba(15, 23, 42, 0.62)';
    context.fillRect(segmentX, top, segmentW, height);
    context.fillStyle = 'rgba(251, 146, 60, 0.18)';
    context.fillRect(segmentX, top, segmentW, height);
    context.strokeStyle = 'rgba(251, 146, 60, 0.45)';
    context.lineWidth = 1;
    context.strokeRect(segmentX + 0.5, top + 0.5, Math.max(0, segmentW - 1), Math.max(0, height - 1));
  }
}

function drawWorkerCompositionNestedBoundaries(
  context: OffscreenCanvasRenderingContext2D,
  boundaries: Float32Array | undefined,
  x: number,
  top: number,
  width: number,
  height: number,
): void {
  if (!boundaries || boundaries.length === 0 || width < 4) return;
  context.strokeStyle = 'rgba(248, 113, 113, 0.86)';
  context.lineWidth = 1;
  for (let index = 0; index < boundaries.length; index += 1) {
    const boundary = boundaries[index];
    if (!Number.isFinite(boundary) || boundary <= 0 || boundary >= 1) continue;
    const lineX = x + boundary * width;
    context.beginPath();
    context.moveTo(lineX + 0.5, top + 2);
    context.lineTo(lineX + 0.5, top + height - 2);
    context.stroke();
  }
}

function drawWorkerCompositionMixdownWaveform(
  context: OffscreenCanvasRenderingContext2D,
  waveform: WorkerWaveformResource | undefined,
  x: number,
  top: number,
  width: number,
  height: number,
): void {
  if (!waveform || width < 8 || height < 18) return;
  const waveformHeight = Math.min(42, Math.max(16, height / 3));
  const waveformTop = top + Math.max(3, Math.floor((height - waveformHeight) / 2));
  context.save();
  context.beginPath();
  context.rect(x, waveformTop, width, waveformHeight);
  context.clip();
  context.translate(x, waveformTop);
  drawWaveformColumns(context, waveform.columns, waveform.columnCount, width, waveformHeight, 'compact');
  context.restore();
}

function drawWorkerCompositionOutline(
  context: OffscreenCanvasRenderingContext2D,
  x: number,
  top: number,
  width: number,
  height: number,
): void {
  if (width < 2 || height < 2) return;
  context.save();
  context.strokeStyle = 'rgba(251, 146, 60, 0.9)';
  context.lineWidth = 2;
  context.setLineDash([6, 4]);
  context.beginPath();
  context.roundRect(x + 1, top + 1, Math.max(0, width - 2), Math.max(0, height - 2), Math.min(4, height / 4));
  context.stroke();
  context.setLineDash([]);
  context.restore();
}

function drawWorkerCompositionDecorations(
  context: OffscreenCanvasRenderingContext2D,
  clip: WorkerPlainClip,
  top: number,
  height: number,
): number {
  const composition = clip.compositionVisuals;
  if (!composition) return 0;
  const x = clip.x;
  const width = clip.width;
  const bodyHeight = height - 2;
  let thumbnailDrawCount = 0;

  context.save();
  context.beginPath();
  context.roundRect(x, top, width, bodyHeight, Math.min(4, bodyHeight / 4));
  context.clip();
  if (composition.segmentThumbnailStrip) {
    try {
      context.drawImage(composition.segmentThumbnailStrip.bitmap, x, top, width, bodyHeight);
      thumbnailDrawCount += composition.segmentThumbnailStrip.drawCount;
    } finally {
      composition.segmentThumbnailStrip.bitmap.close();
    }
  } else {
    drawWorkerCompositionSegmentRects(context, composition.segmentRects, x, top, width, bodyHeight);
  }
  drawWorkerCompositionMixdownWaveform(context, composition.mixdownWaveform, x, top, width, bodyHeight);
  if (composition.mixdownGenerating && width >= 72) {
    context.fillStyle = 'rgba(15, 23, 42, 0.78)';
    context.fillRect(x + 6, top + Math.max(4, bodyHeight - 20), Math.min(118, width - 12), 15);
    context.fillStyle = 'rgba(255, 255, 255, 0.86)';
    context.font = '10px ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif';
    context.textBaseline = 'middle';
    context.fillText('Generating audio', x + 11, top + Math.max(11, bodyHeight - 12));
  }
  drawWorkerCompositionNestedBoundaries(context, composition.nestedBoundaries, x, top, width, bodyHeight);
  context.restore();

  if (composition.outline) {
    drawWorkerCompositionOutline(context, x, top, width, bodyHeight);
  }
  return thumbnailDrawCount;
}

function drawWorkerClipProgressBars(
  context: OffscreenCanvasRenderingContext2D,
  bars: readonly WorkerProgressBar[] | undefined,
  x: number,
  top: number,
  width: number,
): void {
  if (!bars || bars.length === 0 || width < 10) return;

  bars.slice(0, 3).forEach((bar, index) => {
    const y = top + 3 + index * 3;
    const progress = Math.max(0.02, Math.min(1, bar.progress / 100));
    context.fillStyle = 'rgba(15, 23, 42, 0.5)';
    context.fillRect(x + 4, y, Math.max(0, width - 8), 2);
    context.fillStyle = bar.color;
    context.fillRect(x + 4, y, Math.max(1, (width - 8) * progress), 2);
  });
}

function drawWorkerClipBadges(
  context: OffscreenCanvasRenderingContext2D,
  badges: readonly WorkerPassiveBadge[] | undefined,
  x: number,
  top: number,
  width: number,
): void {
  if (!badges || badges.length === 0 || width < 28) return;

  context.save();
  context.font = '9px ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';

  let right = x + width - 5;
  for (let index = badges.length - 1; index >= 0; index -= 1) {
    const badge = badges[index];
    const badgeW = Math.max(14, badge.label.length * 6 + 8);
    const left = right - badgeW;
    if (left < x + 4) break;

    context.beginPath();
    context.roundRect(left, top + 4, badgeW, 14, 3);
    context.fillStyle = badge.fill;
    context.fill();
    if (badge.stroke) {
      context.strokeStyle = badge.stroke;
      context.lineWidth = 1;
      context.stroke();
    }
    context.fillStyle = 'rgba(255, 255, 255, 0.96)';
    context.fillText(badge.label, left + badgeW / 2, top + 11);
    right = left - 3;
  }

  context.restore();
}

function drawWorkerTranscriptMarkers(
  context: OffscreenCanvasRenderingContext2D,
  markers: Float32Array | undefined,
  x: number,
  top: number,
  width: number,
  height: number,
): void {
  if (!markers || markers.length < 2 || width < 18) return;
  const markerTop = top + Math.max(4, height - 7);
  context.fillStyle = 'rgba(129, 140, 248, 0.82)';
  for (let index = 0; index + 1 < markers.length; index += 2) {
    const startRatio = Math.max(0, Math.min(1, markers[index] ?? 0));
    const endRatio = Math.max(startRatio, Math.min(1, markers[index + 1] ?? startRatio));
    const left = x + startRatio * width;
    const right = x + endRatio * width;
    context.fillRect(left, markerTop, Math.max(1, right - left), 2);
  }
}

function drawWorkerAnalysisSeries(
  context: OffscreenCanvasRenderingContext2D,
  points: Float32Array,
  pointCount: number,
  valueOffset: number,
  x: number,
  width: number,
  graphTop: number,
  graphHeight: number,
  stroke: string,
  fill: string,
): void {
  const yForPoint = (index: number) => {
    const value = clamp01(points[index * 4 + valueOffset] ?? 0);
    return graphTop + graphHeight - value * graphHeight * 0.82;
  };
  const xForPoint = (index: number) => {
    const ratio = clamp01(points[index * 4] ?? 0);
    return x + ratio * width;
  };

  context.beginPath();
  context.moveTo(xForPoint(0), graphTop + graphHeight);
  for (let index = 0; index < pointCount; index += 1) {
    context.lineTo(xForPoint(index), yForPoint(index));
  }
  context.lineTo(xForPoint(pointCount - 1), graphTop + graphHeight);
  context.closePath();
  context.fillStyle = fill;
  context.fill();

  context.beginPath();
  for (let index = 0; index < pointCount; index += 1) {
    const px = xForPoint(index);
    const py = yForPoint(index);
    if (index === 0) {
      context.moveTo(px, py);
    } else {
      context.lineTo(px, py);
    }
  }
  context.strokeStyle = stroke;
  context.lineWidth = 1.2;
  context.stroke();
}

function drawWorkerAnalysisOverlay(
  context: OffscreenCanvasRenderingContext2D,
  overlay: WorkerAnalysisOverlayResource | undefined,
  x: number,
  top: number,
  width: number,
  height: number,
): void {
  if (!overlay || width < 24) return;
  const pointCount = Math.min(overlay.pointCount, Math.floor(overlay.points.length / 4));
  if (pointCount < 2) return;

  const graphTop = top + Math.max(12, height * 0.28);
  const graphHeight = Math.max(8, height - (graphTop - top) - 8);
  context.save();
  context.lineCap = 'round';
  context.lineJoin = 'round';
  drawWorkerAnalysisSeries(
    context,
    overlay.points,
    pointCount,
    1,
    x,
    width,
    graphTop,
    graphHeight,
    'rgba(34, 197, 94, 0.82)',
    'rgba(34, 197, 94, 0.12)',
  );
  drawWorkerAnalysisSeries(
    context,
    overlay.points,
    pointCount,
    2,
    x,
    width,
    graphTop,
    graphHeight,
    'rgba(59, 130, 246, 0.72)',
    'rgba(59, 130, 246, 0.10)',
  );

  context.fillStyle = 'rgba(250, 204, 21, 0.82)';
  for (let index = 0; index < pointCount; index += 1) {
    if ((overlay.points[index * 4 + 3] ?? 0) <= 0) continue;
    const px = x + clamp01(overlay.points[index * 4] ?? 0) * width;
    context.beginPath();
    context.arc(px, top + 7, 2, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
}

function drawWorkerPassiveDecorations(
  context: OffscreenCanvasRenderingContext2D,
  clip: WorkerPlainClip,
  top: number,
  height: number,
): void {
  const decorations = clip.passiveDecorations;
  if (!decorations) return;
  context.save();
  context.beginPath();
  context.roundRect(clip.x, top, clip.width, height - 2, Math.min(4, (height - 2) / 4));
  context.clip();
  drawWorkerAnalysisOverlay(context, decorations.analysisOverlay, clip.x, top, clip.width, height - 2);
  drawWorkerTranscriptMarkers(context, decorations.transcriptMarkers, clip.x, top, clip.width, height - 2);
  drawWorkerClipProgressBars(context, decorations.progressBars, clip.x, top, clip.width);
  drawWorkerClipBadges(context, decorations.badges, clip.x, top, clip.width);
  context.restore();
}

function drawWorkerSourceExtensionGhost(
  context: OffscreenCanvasRenderingContext2D,
  ghost: WorkerSourceExtensionGhost,
  top: number,
  height: number,
): void {
  if (ghost.width <= 0 || height <= 0) return;

  context.save();
  context.beginPath();
  context.rect(ghost.x, top, ghost.width, height);
  context.clip();

  const fill = context.createLinearGradient(0, top, 0, top + height);
  fill.addColorStop(0, 'rgba(251, 191, 36, 0.24)');
  fill.addColorStop(1, 'rgba(251, 191, 36, 0.08)');
  context.fillStyle = fill;
  context.fillRect(ghost.x, top, ghost.width, height);

  context.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  context.lineWidth = 1;
  for (let offset = -height; offset < ghost.width + height; offset += 10) {
    context.beginPath();
    context.moveTo(ghost.x + offset, top + height);
    context.lineTo(ghost.x + offset + height, top);
    context.stroke();
  }

  context.setLineDash([4, 3]);
  context.strokeStyle = 'rgba(255, 255, 255, 0.46)';
  context.strokeRect(ghost.x + 0.5, top + 0.5, Math.max(0, ghost.width - 1), Math.max(0, height - 1));
  context.setLineDash([]);

  context.strokeStyle = 'rgba(251, 191, 36, 0.92)';
  context.lineWidth = 2;
  context.beginPath();
  if (ghost.edge === 'left') {
    context.moveTo(ghost.x + ghost.width - 1, top);
    context.lineTo(ghost.x + ghost.width - 1, top + height);
  } else {
    context.moveTo(ghost.x + 1, top);
    context.lineTo(ghost.x + 1, top + height);
  }
  context.stroke();

  context.restore();
}

function drawWorkerTrimVisuals(
  context: OffscreenCanvasRenderingContext2D,
  clip: WorkerPlainClip,
  top: number,
  height: number,
): void {
  const ghosts = clip.trimVisuals?.sourceExtensionGhosts;
  if (!ghosts || ghosts.length === 0) return;
  ghosts.forEach((ghost) => drawWorkerSourceExtensionGhost(context, ghost, top, height - 2));
}

function drawWorkerFadeVisuals(
  context: OffscreenCanvasRenderingContext2D,
  clip: WorkerPlainClip,
  top: number,
  height: number,
): void {
  const fade = clip.fadeVisuals;
  if (!fade || fade.curveCount <= 0 || fade.curves.length < fade.curveCount * 6) return;
  const bodyHeight = height - 2;

  context.save();
  context.translate(clip.x, top);
  context.lineCap = 'round';
  context.lineJoin = 'round';

  context.beginPath();
  context.moveTo(fade.startX, fade.startY);
  for (let index = 0; index < fade.curveCount; index += 1) {
    const offset = index * 6;
    context.bezierCurveTo(
      fade.curves[offset] ?? 0,
      fade.curves[offset + 1] ?? 0,
      fade.curves[offset + 2] ?? 0,
      fade.curves[offset + 3] ?? 0,
      fade.curves[offset + 4] ?? 0,
      fade.curves[offset + 5] ?? 0,
    );
  }
  const lastOffset = (fade.curveCount - 1) * 6;
  const lastX = fade.curves[lastOffset + 4] ?? fade.startX;
  context.lineTo(lastX, bodyHeight);
  context.lineTo(fade.startX, bodyHeight);
  context.closePath();
  context.fillStyle = fade.isAudioClip ? 'rgba(51, 197, 255, 0.13)' : 'rgba(0, 0, 0, 0.4)';
  context.fill();

  context.beginPath();
  context.moveTo(fade.startX, fade.startY);
  for (let index = 0; index < fade.curveCount; index += 1) {
    const offset = index * 6;
    context.bezierCurveTo(
      fade.curves[offset] ?? 0,
      fade.curves[offset + 1] ?? 0,
      fade.curves[offset + 2] ?? 0,
      fade.curves[offset + 3] ?? 0,
      fade.curves[offset + 4] ?? 0,
      fade.curves[offset + 5] ?? 0,
    );
  }
  context.strokeStyle = fade.isAudioClip ? 'rgba(96, 217, 255, 0.86)' : 'rgba(140, 180, 220, 0.8)';
  context.lineWidth = fade.isAudioClip ? 1.6 : 2;
  context.stroke();

  context.fillStyle = fade.isAudioClip ? 'rgba(96, 217, 255, 0.95)' : 'rgba(140, 180, 220, 1)';
  const markerCount = Math.min(fade.pointCount, Math.floor(fade.points.length / 2));
  for (let index = 0; index < markerCount; index += 1) {
    const offset = index * 2;
    context.beginPath();
    context.arc(fade.points[offset] ?? 0, fade.points[offset + 1] ?? 0, 3, 0, Math.PI * 2);
    context.fill();
  }

  context.restore();
}

function estimateWorkerClipResourceBytes(clip: WorkerPlainClip): number {
  const thumbnailBytes = clip.thumbnailStrip
    ? clip.thumbnailStrip.bitmap.width * clip.thumbnailStrip.bitmap.height * 4
    : 0;
  const compositionThumbnailBytes = clip.compositionVisuals?.segmentThumbnailStrip
    ? clip.compositionVisuals.segmentThumbnailStrip.bitmap.width * clip.compositionVisuals.segmentThumbnailStrip.bitmap.height * 4
    : 0;
  return thumbnailBytes +
    compositionThumbnailBytes +
    (clip.compositionVisuals?.nestedBoundaries?.byteLength ?? 0) +
    (clip.compositionVisuals?.segmentRects?.byteLength ?? 0) +
    (clip.compositionVisuals?.mixdownWaveform?.columns.byteLength ?? 0) +
    (clip.passiveDecorations?.transcriptMarkers?.byteLength ?? 0) +
    (clip.passiveDecorations?.analysisOverlay?.points.byteLength ?? 0) +
    (clip.fadeVisuals?.curves.byteLength ?? 0) +
    (clip.fadeVisuals?.points.byteLength ?? 0) +
    (clip.waveform?.columns.byteLength ?? 0) +
    (clip.spectrogram?.values.byteLength ?? 0);
}

function draw(msg: DrawMessage): DrawnMessage {
  if (!canvas || !ctx) {
    throw new Error('worker canvas is not initialized');
  }
  const { clips, height, cssWidth, dpr, trackColor } = msg;
  const startedAt = performance.now();

  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, height);

  const radius = Math.min(4, height / 4);
  const fill = withAlpha(trackColor, 0.55);
  const fillSelected = withAlpha(trackColor, 0.85);
  const border = withAlpha(trackColor, 0.9);

  ctx.font = '11px ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif';
  ctx.textBaseline = 'middle';

  const transferredResourceBytes = clips.reduce((total, clip) => total + estimateWorkerClipResourceBytes(clip), 0);
  let thumbnailClipCount = 0;
  let thumbnailDrawCount = 0;
  for (const clip of clips) {
    const x = clip.x;
    const w = clip.width;
    const isSel = clip.selected;
    if (w < LOD_BAR_PX) {
      ctx.fillStyle = isSel ? fillSelected : fill;
      ctx.fillRect(x, 1, Math.max(1, w), height - 2);
      continue;
    }
    const top = 1;
    const h = height - 2;
    ctx.beginPath();
    ctx.roundRect(x, top, w, h, radius);
    ctx.fillStyle = isSel ? fillSelected : fill;
    ctx.fill();
    if (clip.thumbnailStrip) {
      thumbnailClipCount += 1;
      thumbnailDrawCount += drawClipThumbnailStrip(ctx, clip, top);
    }
    drawClipSpectrogram(ctx, clip, top, height);
    drawClipWaveform(ctx, clip, top, height);
    const compositionThumbnailDraws = drawWorkerCompositionDecorations(ctx, clip, top, height);
    if (compositionThumbnailDraws > 0) {
      thumbnailClipCount += 1;
      thumbnailDrawCount += compositionThumbnailDraws;
    }
    drawWorkerTrimVisuals(ctx, clip, top, height);
    drawWorkerFadeVisuals(ctx, clip, top, height);
    drawWorkerPassiveDecorations(ctx, clip, top, height);
    ctx.beginPath();
    ctx.roundRect(x, top, w, h, radius);
    ctx.lineWidth = isSel ? 2 : 1;
    ctx.strokeStyle = isSel ? '#ffffff' : clip.hovered ? '#9dc8ff' : border;
    ctx.stroke();
    if (w >= LOD_LABEL_PX && clip.name) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x + 5, top, w - 10, h);
      ctx.clip();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
      ctx.fillText(clip.name, x + 6, top + h / 2);
      ctx.restore();
    }
  }

  return {
    type: 'drawn',
    requestId: msg.requestId,
    drawnClipCount: clips.length,
    thumbnailClipCount,
    thumbnailDrawCount,
    drawMs: Math.round((performance.now() - startedAt) * 100) / 100,
    resourceBytes: canvas.width * canvas.height * 4 + transferredResourceBytes,
  };
}

self.onmessage = (event: MessageEvent<IncomingMessage>) => {
  const msg = event.data;
  try {
    if (msg.type === 'init') {
      canvas = msg.canvas;
      ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('could not create worker 2D context');
      }
      postWorkerMessage({ type: 'ready' });
    } else if (msg.type === 'draw') {
      postWorkerMessage(draw(msg));
    }
  } catch (error) {
    postWorkerMessage({
      type: 'error',
      requestId: msg.type === 'draw' ? msg.requestId : undefined,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
