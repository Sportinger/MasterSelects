type TimelineSceneCutCanvasContext =
  | CanvasRenderingContext2D
  | OffscreenCanvasRenderingContext2D;

export function drawTimelineClipCanvasSceneCutMarkers(
  context: TimelineSceneCutCanvasContext,
  markers: Float32Array | undefined,
  x: number,
  top: number,
  width: number,
  height: number,
): void {
  if (!markers?.length || width < 8) return;
  const averageMarkerSpacing = width / markers.length;
  const markerWidth = Math.max(0.65, Math.min(1.5, averageMarkerSpacing * 0.12));
  const dashLength = Math.max(2, Math.min(4, markerWidth * 2.5));
  const dashGap = Math.max(1.5, Math.min(3, markerWidth * 2));
  context.save();
  context.beginPath();
  context.roundRect(x, top, width, height, Math.min(4, height / 4));
  context.clip();
  context.beginPath();
  context.strokeStyle = '#050505';
  context.lineWidth = markerWidth;
  context.setLineDash([dashLength, dashGap]);
  context.lineCap = 'butt';
  for (const ratio of markers) {
    const clampedRatio = Math.max(0, Math.min(1, ratio));
    const markerX = x + clampedRatio * width;
    context.moveTo(markerX, top);
    context.lineTo(markerX, top + height);
  }
  context.stroke();
  context.restore();
}
