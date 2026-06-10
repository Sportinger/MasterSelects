import type { TimelineClipCanvasWorkerWaveformResource } from '../utils/timelineClipCanvasWorkerContract';
import { drawTransientPeakSpikes } from '../utils/timelineClipCanvasWaveformSpikes';

type WorkerWaveformChannel = {
  columns: Float32Array;
  columnCount: number;
};

export function drawWorkerWaveformCenterLine(
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

export function drawWorkerWaveformColumns(
  context: OffscreenCanvasRenderingContext2D,
  waveform: TimelineClipCanvasWorkerWaveformResource,
  width: number,
  height: number,
  modeOverride?: TimelineClipCanvasWorkerWaveformResource['mode'],
): void {
  const channels = waveform.channels && waveform.channels.length > 0
    ? waveform.channels
    : [{ columns: waveform.columns, columnCount: waveform.columnCount }];
  const laneGap = channels.length > 1 ? 2 : 0;
  const laneHeight = Math.max(8, (height - laneGap * (channels.length - 1)) / channels.length);
  const mode = modeOverride ?? waveform.mode;

  channels.forEach((channel, laneIndex) => {
    const laneTop = laneIndex * (laneHeight + laneGap);
    if (laneIndex > 0) {
      context.strokeStyle = 'rgba(255, 255, 255, 0.12)';
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(0, laneTop - laneGap / 2);
      context.lineTo(width, laneTop - laneGap / 2);
      context.stroke();
    }

    context.save();
    context.translate(0, laneTop);
    drawWorkerWaveformLane(context, channel, width, laneHeight, mode);
    context.restore();
  });
}

function drawWorkerWaveformLane(
  context: OffscreenCanvasRenderingContext2D,
  channel: WorkerWaveformChannel,
  width: number,
  height: number,
  mode: TimelineClipCanvasWorkerWaveformResource['mode'],
): void {
  const { columns, columnCount } = channel;
  if (columnCount <= 0 || columns.length < columnCount * 4) {
    drawWorkerWaveformCenterLine(context, width, height, 0.18);
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

  drawWorkerWaveformCenterLine(context, width, height, mode === 'compact' ? 0.12 : 0.16);
  if (mode === 'detailed') {
    drawTransientPeakSpikes(context, columnCount, columnAt, width, height);
  }
}
