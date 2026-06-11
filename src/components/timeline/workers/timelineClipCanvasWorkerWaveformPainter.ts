import type { TimelineClipCanvasWorkerWaveformResource } from '../utils/timelineClipCanvasWorkerContract';
import { drawTransientPeakSpikes } from '../utils/timelineClipCanvasWaveformSpikes';

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
  columns: Float32Array,
  columnCount: number,
  width: number,
  height: number,
  mode: TimelineClipCanvasWorkerWaveformResource['mode'],
): void {
  if (columnCount <= 0 || columns.length < columnCount * 4) {
    drawWorkerWaveformCenterLine(context, width, height, 0.18);
    return;
  }

  const midY = height / 2;
  const halfHeight = Math.max(1, (height - 6) / 2);
  const envelopeMinFloor = mode === 'compact' ? 0.08 : 0.01;
  const envelopeScale = mode === 'compact' ? 1 : 0.82;
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
  const valueYAt = (index: number, valueForColumn: (column: ReturnType<typeof columnAt>) => number) => (
    midY - valueForColumn(columnAt(index)) * halfHeight
  );
  const mirroredValueYAt = (index: number, valueForColumn: (column: ReturnType<typeof columnAt>) => number) => (
    midY + valueForColumn(columnAt(index)) * halfHeight
  );

  context.beginPath();
  for (let index = 0; index < columnCount; index += 1) {
    const column = columnAt(index);
    const x = xAt(index);
    const y = midY - Math.max(column.max, column.peak * envelopeMinFloor, 0) * envelopeScale * halfHeight;
    if (index === 0) {
      context.moveTo(x, y);
    } else {
      const previousX = xAt(index - 1);
      const previousY = midY - Math.max(
        columnAt(index - 1).max,
        columnAt(index - 1).peak * envelopeMinFloor,
        0,
      ) * envelopeScale * halfHeight;
      context.quadraticCurveTo(previousX, previousY, (previousX + x) / 2, (previousY + y) / 2);
    }
  }
  context.lineTo(
    width,
    midY + Math.max(
      -columnAt(columnCount - 1).min,
      columnAt(columnCount - 1).peak * envelopeMinFloor,
      0,
    ) * envelopeScale * halfHeight,
  );
  for (let index = columnCount - 1; index >= 0; index -= 1) {
    const column = columnAt(index);
    const x = xAt(index);
    const y = midY + Math.max(-column.min, column.peak * envelopeMinFloor, 0) * envelopeScale * halfHeight;
    if (index === columnCount - 1) {
      context.lineTo(x, y);
    } else {
      const nextX = xAt(index + 1);
      const nextY = midY + Math.max(
        -columnAt(index + 1).min,
        columnAt(index + 1).peak * envelopeMinFloor,
        0,
      ) * envelopeScale * halfHeight;
      context.quadraticCurveTo(nextX, nextY, (nextX + x) / 2, (nextY + y) / 2);
    }
  }
  context.closePath();
  if (mode === 'compact') {
    context.fillStyle = 'rgba(235, 241, 248, 0.62)';
  } else {
    const envelopeGradient = context.createLinearGradient(0, 0, 0, height);
    envelopeGradient.addColorStop(0, 'rgba(216, 230, 240, 0.10)');
    envelopeGradient.addColorStop(0.5, 'rgba(224, 238, 248, 0.22)');
    envelopeGradient.addColorStop(1, 'rgba(216, 230, 240, 0.10)');
    context.fillStyle = envelopeGradient;
  }
  context.fill();

  if (mode === 'detailed') {
    context.beginPath();
    const rmsValueForColumn = (column: ReturnType<typeof columnAt>) => Math.min(column.rms * 0.84, column.peak * 0.72);
    for (let index = 0; index < columnCount; index += 1) {
      const x = xAt(index);
      const y = valueYAt(index, rmsValueForColumn);
      if (index === 0) {
        context.moveTo(x, y);
      } else {
        const previousX = xAt(index - 1);
        const previousY = valueYAt(index - 1, rmsValueForColumn);
        context.quadraticCurveTo(previousX, previousY, (previousX + x) / 2, (previousY + y) / 2);
      }
    }
    for (let index = columnCount - 1; index >= 0; index -= 1) {
      const x = xAt(index);
      const y = mirroredValueYAt(index, rmsValueForColumn);
      if (index === columnCount - 1) {
        context.lineTo(x, y);
      } else {
        const nextX = xAt(index + 1);
        const nextY = mirroredValueYAt(index + 1, rmsValueForColumn);
        context.quadraticCurveTo(nextX, nextY, (nextX + x) / 2, (nextY + y) / 2);
      }
    }
    context.closePath();
    const rmsGradient = context.createLinearGradient(0, 0, 0, height);
    rmsGradient.addColorStop(0, 'rgba(92, 203, 255, 0.18)');
    rmsGradient.addColorStop(0.5, 'rgba(178, 230, 255, 0.44)');
    rmsGradient.addColorStop(1, 'rgba(92, 203, 255, 0.18)');
    context.fillStyle = rmsGradient;
    context.fill();
  }

  drawWorkerWaveformCenterLine(context, width, height, mode === 'compact' ? 0.12 : 0.16);
  if (mode === 'detailed') {
    drawTransientPeakSpikes(context, columnCount, columnAt, width, height);
  }
}

export function drawWorkerWaveformResource(
  context: OffscreenCanvasRenderingContext2D,
  waveform: TimelineClipCanvasWorkerWaveformResource,
  width: number,
  height: number,
): void {
  const valuesPerChannel = waveform.columnCount * 4;
  const availableChannelCount = valuesPerChannel > 0
    ? Math.floor(waveform.columns.length / valuesPerChannel)
    : 0;
  const channelCount = Math.max(1, Math.min(
    Math.floor(waveform.channelCount ?? 1),
    availableChannelCount || 1,
  ));

  if (channelCount <= 1) {
    drawWorkerWaveformColumns(context, waveform.columns, waveform.columnCount, width, height, waveform.mode);
    return;
  }

  const laneGap = 2;
  const laneHeight = Math.max(8, (height - laneGap * (channelCount - 1)) / channelCount);
  for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
    const laneTop = channelIndex * (laneHeight + laneGap);
    if (channelIndex > 0) {
      context.strokeStyle = 'rgba(255, 255, 255, 0.12)';
      context.beginPath();
      context.moveTo(0, laneTop - laneGap / 2);
      context.lineTo(width, laneTop - laneGap / 2);
      context.stroke();
    }

    context.save();
    context.translate(0, laneTop);
    const offset = channelIndex * valuesPerChannel;
    drawWorkerWaveformColumns(
      context,
      waveform.columns.subarray(offset, offset + valuesPerChannel),
      waveform.columnCount,
      width,
      laneHeight,
      waveform.mode,
    );
    context.restore();
  }
}
