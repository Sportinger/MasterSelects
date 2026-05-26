// Render waveform for audio clips using canvas for better performance
// Supports trimming: only displays the portion of waveform between inPoint and outPoint

import { memo, useRef, useEffect } from 'react';
import type { TimelineAudioDisplayMode } from '../../../stores/timeline/types';
import {
  buildWaveformLod,
  normalizeWaveformColumnsForDisplay,
  smoothWaveformColumns,
  type TimelineWaveformPyramid,
  type WaveformColumn,
} from '../utils/waveformLod';

const MAX_RENDERED_WAVEFORM_CHANNELS = 8;

function drawCenterLine(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const midY = height / 2;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, midY);
  ctx.lineTo(width, midY);
  ctx.stroke();
}

function drawChannelSeparator(ctx: CanvasRenderingContext2D, width: number, y: number): void {
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, y);
  ctx.lineTo(width, y);
  ctx.stroke();
}

function getChannelLabel(channelIndex: number, channelCount: number): string {
  if (channelCount === 1) return '';
  if (channelCount === 2) return channelIndex === 0 ? 'L' : 'R';
  return `Ch ${channelIndex + 1}`;
}

function drawChannelLabel(
  ctx: CanvasRenderingContext2D,
  label: string,
  laneTop: number,
  laneHeight: number,
): void {
  if (!label || laneHeight < 20) return;

  ctx.font = '9px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  ctx.fillStyle = 'rgba(222, 232, 240, 0.62)';
  ctx.fillText(label, 5, laneTop + 11);
}

function buildSmoothEnvelopePath(
  ctx: CanvasRenderingContext2D,
  columns: WaveformColumn[],
  width: number,
  height: number,
  valueForColumn: (column: WaveformColumn) => number,
): void {
  const midY = height / 2;
  const halfHeight = Math.max(1, (height - 6) / 2);
  const count = columns.length;

  const xAt = (index: number) => {
    if (count <= 1) return width / 2;
    return (index / (count - 1)) * width;
  };
  const topYAt = (index: number) => midY - valueForColumn(columns[index]) * halfHeight;
  const bottomYAt = (index: number) => midY + valueForColumn(columns[index]) * halfHeight;

  ctx.beginPath();
  ctx.moveTo(0, topYAt(0));

  for (let index = 0; index < count - 1; index += 1) {
    const previousX = xAt(index);
    const currentX = xAt(index + 1);
    const previousY = topYAt(index);
    const currentY = topYAt(index + 1);
    ctx.quadraticCurveTo(previousX, previousY, (previousX + currentX) / 2, (previousY + currentY) / 2);
  }
  ctx.quadraticCurveTo(width, topYAt(count - 1), width, topYAt(count - 1));

  ctx.lineTo(width, bottomYAt(count - 1));

  for (let index = count - 1; index > 0; index -= 1) {
    const nextX = xAt(index);
    const currentX = xAt(index - 1);
    const nextY = bottomYAt(index);
    const currentY = bottomYAt(index - 1);
    ctx.quadraticCurveTo(nextX, nextY, (nextX + currentX) / 2, (nextY + currentY) / 2);
  }
  ctx.quadraticCurveTo(0, bottomYAt(0), 0, bottomYAt(0));

  ctx.closePath();
}

function buildSignedEnvelopePath(
  ctx: CanvasRenderingContext2D,
  columns: WaveformColumn[],
  width: number,
  height: number,
  minFloor = 0,
): void {
  const midY = height / 2;
  const halfHeight = Math.max(1, (height - 6) / 2);
  const count = columns.length;

  const xAt = (index: number) => {
    if (count <= 1) return width / 2;
    return (index / (count - 1)) * width;
  };
  const topYAt = (index: number) => {
    const column = columns[index];
    return midY - Math.max(column.max, column.peak * minFloor, 0) * halfHeight;
  };
  const bottomYAt = (index: number) => {
    const column = columns[index];
    return midY + Math.max(-column.min, column.peak * minFloor, 0) * halfHeight;
  };

  ctx.beginPath();
  ctx.moveTo(0, topYAt(0));

  for (let index = 0; index < count - 1; index += 1) {
    const previousX = xAt(index);
    const currentX = xAt(index + 1);
    const previousY = topYAt(index);
    const currentY = topYAt(index + 1);
    ctx.quadraticCurveTo(previousX, previousY, (previousX + currentX) / 2, (previousY + currentY) / 2);
  }
  ctx.quadraticCurveTo(width, topYAt(count - 1), width, topYAt(count - 1));

  ctx.lineTo(width, bottomYAt(count - 1));

  for (let index = count - 1; index > 0; index -= 1) {
    const nextX = xAt(index);
    const currentX = xAt(index - 1);
    const nextY = bottomYAt(index);
    const currentY = bottomYAt(index - 1);
    ctx.quadraticCurveTo(nextX, nextY, (nextX + currentX) / 2, (nextY + currentY) / 2);
  }
  ctx.quadraticCurveTo(0, bottomYAt(0), 0, bottomYAt(0));

  ctx.closePath();
}

function strokeSmoothPeakLine(
  ctx: CanvasRenderingContext2D,
  columns: WaveformColumn[],
  width: number,
  height: number,
): void {
  const midY = height / 2;
  const halfHeight = Math.max(1, (height - 6) / 2);
  const count = columns.length;
  const xAt = (index: number) => count <= 1 ? width / 2 : (index / (count - 1)) * width;

  const drawLine = (direction: -1 | 1) => {
    ctx.beginPath();
    ctx.moveTo(0, midY + direction * columns[0].peak * halfHeight);
    for (let index = 0; index < count - 1; index += 1) {
      const previousX = xAt(index);
      const currentX = xAt(index + 1);
      const previousY = midY + direction * columns[index].peak * halfHeight;
      const currentY = midY + direction * columns[index + 1].peak * halfHeight;
      ctx.quadraticCurveTo(previousX, previousY, (previousX + currentX) / 2, (previousY + currentY) / 2);
    }
    ctx.quadraticCurveTo(width, midY + direction * columns[count - 1].peak * halfHeight, width, midY + direction * columns[count - 1].peak * halfHeight);
    ctx.stroke();
  };

  drawLine(-1);
  drawLine(1);
}

function drawPeakDetailStems(
  ctx: CanvasRenderingContext2D,
  columns: WaveformColumn[],
  width: number,
  height: number,
): void {
  const midY = height / 2;
  const halfHeight = Math.max(1, (height - 6) / 2);
  const count = columns.length;
  const step = Math.max(1, Math.floor(count / 1800));

  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
  ctx.lineWidth = 0.75;
  ctx.beginPath();

  for (let index = 0; index < count; index += step) {
    const column = columns[index];
    const x = count <= 1 ? width / 2 : (index / (count - 1)) * width;
    const top = midY - Math.max(column.max, column.peak * 0.18, 0) * halfHeight;
    const bottom = midY + Math.max(-column.min, column.peak * 0.18, 0) * halfHeight;
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
  }

  ctx.stroke();
  ctx.restore();
}

function drawCompactWaveform(ctx: CanvasRenderingContext2D, columns: WaveformColumn[], width: number, height: number): void {
  buildSignedEnvelopePath(ctx, columns, width, height, 0.08);
  ctx.fillStyle = 'rgba(235, 241, 248, 0.62)';
  ctx.fill();
}

function drawDetailedWaveform(ctx: CanvasRenderingContext2D, columns: WaveformColumn[], width: number, height: number): void {
  drawCenterLine(ctx, width, height);

  buildSmoothEnvelopePath(ctx, columns, width, height, (column) => Math.max(column.rms, 0.04));
  ctx.fillStyle = 'rgba(82, 190, 255, 0.24)';
  ctx.fill();

  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, 'rgba(232, 246, 255, 0.48)');
  gradient.addColorStop(0.5, 'rgba(232, 246, 255, 0.78)');
  gradient.addColorStop(1, 'rgba(232, 246, 255, 0.48)');
  buildSignedEnvelopePath(ctx, columns, width, height, 0.03);
  ctx.fillStyle = gradient;
  ctx.fill();

  drawPeakDetailStems(ctx, columns, width, height);

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.54)';
  ctx.lineWidth = 0.8;
  strokeSmoothPeakLine(ctx, columns, width, height);
}

function drawSpectralWaveform(ctx: CanvasRenderingContext2D, columns: WaveformColumn[], width: number, height: number): void {
  const bandHeight = height / 3;
  const barWidth = Math.max(1, width / columns.length);

  columns.forEach((column, index) => {
    const x = index * barWidth;
    const transient = Math.max(0, column.max - column.min);
    const lowAlpha = 0.08 + column.rms * 0.32;
    const midAlpha = 0.08 + column.peak * 0.34;
    const highAlpha = 0.06 + transient * 0.42;

    ctx.fillStyle = `rgba(92, 203, 255, ${lowAlpha})`;
    ctx.fillRect(x, bandHeight * 2, Math.max(1, barWidth), bandHeight);
    ctx.fillStyle = `rgba(254, 211, 106, ${midAlpha})`;
    ctx.fillRect(x, bandHeight, Math.max(1, barWidth), bandHeight);
    ctx.fillStyle = `rgba(255, 111, 145, ${highAlpha})`;
    ctx.fillRect(x, 0, Math.max(1, barWidth), bandHeight);
  });

  drawDetailedWaveform(ctx, columns, width, height);
}

function applyDisplayGain(
  columns: readonly WaveformColumn[],
  gain: number | undefined,
): WaveformColumn[] {
  if (!Number.isFinite(gain) || Math.abs((gain ?? 1) - 1) < 0.001) {
    return columns.map(column => ({ ...column }));
  }

  const clampedGain = Math.max(0, Math.min(8, gain ?? 1));
  return columns.map(column => {
    const min = Math.max(-1, Math.min(1, column.min * clampedGain));
    const max = Math.max(-1, Math.min(1, column.max * clampedGain));
    const rms = Math.max(0, Math.min(1, column.rms * clampedGain));
    const peak = Math.max(
      Math.max(0, Math.min(1, column.peak * clampedGain)),
      Math.abs(min),
      Math.abs(max),
    );
    return { min, max, rms, peak };
  });
}

function getLegacySmoothingRadius(
  pixelsPerSecond: number,
  sourceSamplesPerSecond: number | undefined,
): number {
  if (!sourceSamplesPerSecond || sourceSamplesPerSecond <= 0) return 2;
  const pixelsPerLegacySample = pixelsPerSecond / sourceSamplesPerSecond;
  return Math.max(1, Math.min(14, Math.round(pixelsPerLegacySample * 0.55)));
}

function resolveWaveformChannelIndexes(
  pyramid: TimelineWaveformPyramid | null | undefined,
  waveformChannels: readonly (readonly number[])[] | undefined,
  height: number,
): number[] {
  const sourceChannels = pyramid?.levels.find(level => level.channels.length > 0)?.channels ?? [];
  const channelIndexes = sourceChannels.length > 0
    ? [...new Set(sourceChannels
        .map(channel => channel.channelIndex)
        .filter(channelIndex => Number.isInteger(channelIndex) && channelIndex >= 0))]
        .toSorted((a, b) => a - b)
    : (waveformChannels ?? [])
        .map((channel, channelIndex) => (channel?.length ? channelIndex : -1))
        .filter(channelIndex => channelIndex >= 0);

  if (channelIndexes.length === 0) return [0];

  const maxByHeight = height < 42 ? 2 : MAX_RENDERED_WAVEFORM_CHANNELS;
  return channelIndexes.slice(0, Math.max(1, Math.min(MAX_RENDERED_WAVEFORM_CHANNELS, maxByHeight)));
}

function drawWaveformColumns(
  ctx: CanvasRenderingContext2D,
  columns: WaveformColumn[],
  width: number,
  height: number,
  displayMode: TimelineAudioDisplayMode,
): void {
  if (displayMode === 'compact') {
    drawCompactWaveform(ctx, columns, width, height);
  } else if (displayMode === 'spectral') {
    drawSpectralWaveform(ctx, columns, width, height);
  } else {
    drawDetailedWaveform(ctx, columns, width, height);
  }
}

export const ClipWaveform = memo(function ClipWaveform({
  waveform,
  waveformChannels,
  width,
  height,
  inPoint,
  outPoint,
  naturalDuration,
  displayMode = 'detailed',
  pixelsPerSecond,
  pyramid,
  waveformVariant = 'legacy',
  displayGain = 1,
  renderStartPx = 0,
  renderWidth,
}: {
  waveform: number[];
  waveformChannels?: number[][];
  width: number;
  height: number;
  inPoint: number;
  outPoint: number;
  naturalDuration: number;
  displayMode?: TimelineAudioDisplayMode;
  pixelsPerSecond?: number;
  pyramid?: TimelineWaveformPyramid | null;
  waveformVariant?: 'legacy' | 'source' | 'processed';
  displayGain?: number;
  renderStartPx?: number;
  renderWidth?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderChannelIndexes = resolveWaveformChannelIndexes(pyramid, waveformChannels, height);
  const renderChannelCount = renderChannelIndexes.length;

  useEffect(() => {
    let cancelled = false;
    const schedule = typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function'
      ? window.requestAnimationFrame.bind(window)
      : (callback: FrameRequestCallback) => {
          callback(0);
          return 0;
        };
    const cancel = typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function'
      ? window.cancelAnimationFrame.bind(window)
      : () => {};

    const frameId = schedule(() => {
      if (cancelled) return;

      const canvas = canvasRef.current;
      const hasLegacyWaveform = Boolean(waveform?.length || waveformChannels?.some(channel => channel.length > 0));
      if (!canvas || (!pyramid && !hasLegacyWaveform) || width <= 0 || naturalDuration <= 0) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const clipWidth = Math.max(1, width);
      const startPx = Math.max(0, Math.min(clipWidth, renderStartPx));
      const targetWidth = Math.max(1, Math.min(
        clipWidth - startPx,
        renderWidth ?? clipWidth,
      ));
      const MAX_CANVAS_WIDTH = 16384;
      const canvasWidth = Math.min(targetWidth, MAX_CANVAS_WIDTH);
      const sourceSpan = Math.max(0, outPoint - inPoint);
      const visibleInPoint = inPoint + sourceSpan * (startPx / clipWidth);
      const visibleOutPoint = inPoint + sourceSpan * ((startPx + canvasWidth) / clipWidth);

      // Set canvas size (account for device pixel ratio for sharpness)
      const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
      // Also limit by dpr to avoid exceeding canvas limits.
      const effectiveDpr = Math.min(dpr, MAX_CANVAS_WIDTH / canvasWidth);

      canvas.width = Math.max(1, Math.floor(canvasWidth * effectiveDpr));
      canvas.height = Math.max(1, Math.floor(height * effectiveDpr));
      ctx.setTransform(effectiveDpr, 0, 0, effectiveDpr, 0, 0);

      ctx.clearRect(0, 0, canvasWidth, height);
      ctx.fillStyle = displayMode === 'spectral'
        ? 'rgba(6, 10, 18, 0.24)'
        : 'rgba(6, 10, 18, 0.12)';
      ctx.fillRect(0, 0, canvasWidth, height);

      const channelIndexes = resolveWaveformChannelIndexes(pyramid, waveformChannels, height);
      const laneGap = channelIndexes.length > 1 ? 2 : 0;
      const laneHeight = Math.max(8, (height - laneGap * (channelIndexes.length - 1)) / channelIndexes.length);

      for (let laneIndex = 0; laneIndex < channelIndexes.length; laneIndex += 1) {
        const channelIndex = channelIndexes[laneIndex];
        const laneTop = laneIndex * (laneHeight + laneGap);
        if (laneIndex > 0) {
          drawChannelSeparator(ctx, canvasWidth, laneTop - laneGap / 2);
        }

        const lod = buildWaveformLod({
          waveform: waveform ?? [],
          waveformChannels,
          pyramid,
          width: canvasWidth,
          inPoint: visibleInPoint,
          outPoint: visibleOutPoint,
          naturalDuration,
          pixelsPerSecond,
          channelIndex,
        });
        if (!lod || lod.columns.length === 0) continue;

        const smoothedColumns = lod.source === 'pyramid'
          ? smoothWaveformColumns(lod.columns, channelIndexes.length > 1 ? 0 : 1, 0.35)
          : smoothWaveformColumns(
              lod.columns,
              getLegacySmoothingRadius(lod.pixelsPerSecond, lod.sourceSamplesPerSecond),
              0.78,
            );
        const columns = applyDisplayGain(normalizeWaveformColumnsForDisplay(smoothedColumns, {
          targetPeak: displayMode === 'compact' ? 0.52 : 0.66,
          minReferencePeak: displayMode === 'spectral' ? 0.025 : 0.032,
          maxGain: displayMode === 'spectral' ? 20 : 16,
        }), displayGain);

        ctx.save();
        ctx.translate(0, laneTop);
        drawWaveformColumns(ctx, columns, canvasWidth, laneHeight, displayMode);
        ctx.restore();
        drawChannelLabel(ctx, getChannelLabel(channelIndex, channelIndexes.length), laneTop, laneHeight);
      }
    });

    return () => {
      cancelled = true;
      cancel(frameId);
    };
  }, [waveform, waveformChannels, width, height, inPoint, outPoint, naturalDuration, displayMode, pixelsPerSecond, pyramid, waveformVariant, displayGain, renderStartPx, renderWidth]);

  if ((!pyramid && (!waveform?.length && !waveformChannels?.some(channel => channel.length > 0))) || width <= 0 || renderWidth === 0) return null;

  const clipWidth = Math.max(1, width);
  const canvasLeft = Math.max(0, Math.min(clipWidth, renderStartPx));
  const canvasWidth = Math.max(1, Math.min(
    clipWidth - canvasLeft,
    renderWidth ?? clipWidth,
  ));

  return (
    <canvas
      ref={canvasRef}
      className={`waveform-canvas waveform-canvas-${displayMode} waveform-canvas-${waveformVariant} ${renderChannelCount > 1 ? 'waveform-canvas-multichannel' : ''}`}
      data-waveform-variant={waveformVariant}
      data-waveform-channels={renderChannelCount}
      style={{ left: canvasLeft, width: canvasWidth, height }}
    />
  );
});
