import type {
  TimelineClipCanvasWorkerAnalysisOverlayResource as WorkerAnalysisOverlayResource,
  TimelineClipCanvasWorkerClip as WorkerPlainClip,
  TimelineClipCanvasWorkerPaintPayloadTable as WorkerPaintPayloadTable,
  TimelineClipCanvasWorkerPassiveBadge as WorkerPassiveBadge,
  TimelineClipCanvasWorkerProgressBar as WorkerProgressBar,
} from '../utils/timelineClipCanvasWorkerContract';

type WorkerPassiveDecorationsPayloadByFacetId = ReadonlyMap<
  string,
  WorkerPaintPayloadTable['passiveDecorations'][number]['resource']
>;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function workerClipPaintX(clip: WorkerPlainClip): number {
  return clip.paintPacket.bodyRect.x;
}

function workerClipPaintWidth(clip: WorkerPlainClip): number {
  return clip.paintPacket.bodyRect.width;
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

export function drawWorkerPassiveDecorations(
  context: OffscreenCanvasRenderingContext2D,
  clip: WorkerPlainClip,
  top: number,
  height: number,
  passiveDecorationsPayloadByFacetId: WorkerPassiveDecorationsPayloadByFacetId,
  drawBadges = true,
): void {
  const facet = clip.paintPacket.facets.find((candidate) => candidate.kind === 'passive-decorations');
  if (!facet) return;
  const decorations = passiveDecorationsPayloadByFacetId.get(facet.id);
  if (!decorations) return;
  const x = workerClipPaintX(clip);
  const width = workerClipPaintWidth(clip);
  context.save();
  context.beginPath();
  context.roundRect(x, top, width, height - 2, Math.min(4, (height - 2) / 4));
  context.clip();
  drawWorkerAnalysisOverlay(context, decorations.analysisOverlay, x, top, width, height - 2);
  drawWorkerTranscriptMarkers(context, decorations.transcriptMarkers, x, top, width, height - 2);
  drawWorkerClipProgressBars(context, decorations.progressBars, x, top, width);
  if (drawBadges) {
    drawWorkerClipBadges(context, decorations.badges, x, top, width);
  }
  context.restore();
}
