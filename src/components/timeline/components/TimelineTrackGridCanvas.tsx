import { memo, useLayoutEffect, useRef, useState } from 'react';
import { useMediaStore } from '../../../stores/mediaStore';
import { useTimelineStore } from '../../../stores/timeline';
import { selectTempoMap } from '../../../stores/timeline/selectors';
import {
  alignTimelineGridPixel,
  createBarsGridPlan,
  createTimelineGridPlan,
  getTimelineDevicePixelRatio,
} from '../utils/timelineGrid';

interface TimelineTrackGridCanvasProps {
  height: number;
  scrollX: number;
  trackType: string;
  viewportWidth: number;
  zoom: number;
}

const FALLBACK_GRID_COLOR = 'rgba(148, 163, 184, 0.16)';

function resolveGridColor(canvas: HTMLCanvasElement, trackType: string): string {
  const variableName = trackType === 'audio' ? '--timeline-grid-audio' : '--timeline-grid-video';
  const value = getComputedStyle(canvas).getPropertyValue(variableName).trim();
  return value || FALLBACK_GRID_COLOR;
}

function paintGridLines(
  context: CanvasRenderingContext2D,
  color: string,
  opacity: number,
  intervalPixels: number,
  scrollX: number,
  widthDevicePx: number,
  heightDevicePx: number,
  devicePixelRatio: number,
): void {
  if (opacity <= 0 || intervalPixels <= 1) return;

  context.globalAlpha = opacity;
  context.fillStyle = color;

  const firstIndex = Math.max(1, Math.floor(scrollX / intervalPixels));
  const lastIndex = Math.ceil((scrollX + widthDevicePx / devicePixelRatio) / intervalPixels);
  for (let index = firstIndex; index <= lastIndex; index += 1) {
    const deviceX = Math.round((index * intervalPixels - scrollX) * devicePixelRatio);
    if (deviceX < 0 || deviceX >= widthDevicePx) continue;
    context.fillRect(deviceX, 0, 1, heightDevicePx);
  }
}

// Tempo lines are non-uniform, so the bars grid paints explicit times rather
// than an interval. Same dpr-snapping and viewport clipping as paintGridLines.
function paintGridLinesAt(
  context: CanvasRenderingContext2D,
  color: string,
  opacity: number,
  times: readonly number[],
  zoom: number,
  scrollX: number,
  widthDevicePx: number,
  heightDevicePx: number,
  devicePixelRatio: number,
): void {
  if (opacity <= 0 || times.length === 0) return;

  context.globalAlpha = opacity;
  context.fillStyle = color;

  for (const time of times) {
    const deviceX = Math.round((time * zoom - scrollX) * devicePixelRatio);
    if (deviceX < 0 || deviceX >= widthDevicePx) continue;
    context.fillRect(deviceX, 0, 1, heightDevicePx);
  }
}

// CSS repeating gradients cannot snap individual repetitions to device pixels,
// so fractional frame/time intervals smear into uneven or missing lines. This
// canvas paints every grid line separately, snapped, viewport-sized only.
export const TimelineTrackGridCanvas = memo(function TimelineTrackGridCanvas({
  height,
  scrollX,
  trackType,
  viewportWidth,
  zoom,
}: TimelineTrackGridCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRate = useMediaStore((state) => state.getActiveComposition()?.frameRate ?? 30);
  // §3.5: an ENABLED Bars+Beats ruler wins the grid — no separate active-lane
  // selection, so the lines behind the clips always match the ruler above them.
  const barsLaneEnabled = useTimelineStore(
    (state) => state.rulerLanes.some((lane) => lane.format === 'bars'),
  );
  const tempoMap = useTimelineStore(selectTempoMap);
  const gridSubdivision = useTimelineStore((state) => state.timelineGridSubdivision);
  const devicePixelRatio = getTimelineDevicePixelRatio();
  const alignedScrollX = alignTimelineGridPixel(scrollX, devicePixelRatio);
  // The viewportWidth prop is the row width, which matches the content width
  // on wide timelines; the canvas must only ever span the visible viewport.
  const [measuredViewportWidth, setMeasuredViewportWidth] = useState(0);

  useLayoutEffect(() => {
    const viewport = canvasRef.current?.closest('.timeline-section-viewport');
    if (!viewport) return;
    const update = () => {
      setMeasuredViewportWidth((previous) => (
        previous === viewport.clientWidth ? previous : viewport.clientWidth
      ));
    };
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  const canvasWidth = Math.min(viewportWidth, measuredViewportWidth || 0);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || canvasWidth <= 0 || height <= 0) return;

    const widthDevicePx = Math.max(1, Math.round(canvasWidth * devicePixelRatio));
    const heightDevicePx = Math.max(1, Math.round(height * devicePixelRatio));
    if (canvas.width !== widthDevicePx) canvas.width = widthDevicePx;
    if (canvas.height !== heightDevicePx) canvas.height = heightDevicePx;

    const context = canvas.getContext('2d');
    if (!context) return;

    context.clearRect(0, 0, widthDevicePx, heightDevicePx);

    const color = resolveGridColor(canvas, trackType);

    if (barsLaneEnabled) {
      const barsPlan = createBarsGridPlan({
        tempoMap,
        zoom,
        startTime: alignedScrollX / zoom,
        endTime: (alignedScrollX + canvasWidth) / zoom,
        subdivision: gridSubdivision,
      });
      // Bars read strongest, then beats, then sub-beat lines — the musical
      // hierarchy has to be visible at a glance, unlike the flat time grid.
      const layers: Array<[readonly number[], number]> = [
        [barsPlan.subdivisionTimes, 0.35],
        [barsPlan.beatTimes, 0.6],
        [barsPlan.barTimes, 1],
      ];
      for (const [times, opacity] of layers) {
        paintGridLinesAt(
          context, color, opacity, times, zoom, alignedScrollX,
          widthDevicePx, heightDevicePx, devicePixelRatio,
        );
      }
      context.globalAlpha = 1;
      return;
    }

    const plan = createTimelineGridPlan({ zoom, frameRate });
    paintGridLines(
      context,
      color,
      plan.timeGridOpacity,
      plan.timeIntervalPixels,
      alignedScrollX,
      widthDevicePx,
      heightDevicePx,
      devicePixelRatio,
    );
    paintGridLines(
      context,
      color,
      plan.frameGridOpacity,
      plan.frameIntervalPixels,
      alignedScrollX,
      widthDevicePx,
      heightDevicePx,
      devicePixelRatio,
    );
    context.globalAlpha = 1;
  }, [alignedScrollX, barsLaneEnabled, canvasWidth, devicePixelRatio, frameRate, gridSubdivision, height, tempoMap, trackType, zoom]);

  return (
    <canvas
      ref={canvasRef}
      className="timeline-track-grid-canvas"
      style={{
        position: 'absolute',
        left: alignedScrollX,
        top: 0,
        width: Math.max(1, canvasWidth),
        height,
        pointerEvents: 'none',
      }}
      aria-hidden="true"
    />
  );
});
