import type { TimelineAudioDisplayMode } from '../../../stores/timeline/types';
import type { TimelinePaintSourceClip } from '../../../timeline';
import {
  buildWaveformLod,
  normalizeWaveformColumnsForDisplay,
  resolveWaveformDisplayReferencePeak,
  smoothWaveformColumns,
  type TimelineWaveformPyramid,
  type WaveformColumn,
} from './waveformLod';
import {
  buildCanvasSignedEnvelopePath,
  buildCanvasSmoothEnvelopePath,
} from './timelineClipCanvasWaveformEnvelopePath';
import { resolveTimelineClipCanvasWaveformChannelIndexes } from './timelineClipCanvasWaveformResource';
import { drawTransientPeakSpikes } from './timelineClipCanvasWaveformSpikes';

function drawCanvasWaveformCenterLine(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  alpha = 0.16,
): void {
  const midY = height / 2;
  ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, midY);
  ctx.lineTo(width, midY);
  ctx.stroke();
}

function drawDetailedCanvasWaveform(
  ctx: CanvasRenderingContext2D,
  columns: WaveformColumn[],
  width: number,
  height: number,
  resolveStyle = false,
): void {
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, resolveStyle ? 'rgba(246, 242, 224, 0.28)' : 'rgba(216, 230, 240, 0.10)');
  gradient.addColorStop(0.5, resolveStyle ? 'rgba(250, 247, 232, 0.72)' : 'rgba(224, 238, 248, 0.22)');
  gradient.addColorStop(1, resolveStyle ? 'rgba(246, 242, 224, 0.28)' : 'rgba(216, 230, 240, 0.10)');
  buildCanvasSignedEnvelopePath(ctx, columns, width, height, 0.01, 0.82);
  ctx.fillStyle = gradient;
  ctx.fill();

  const rmsGradient = ctx.createLinearGradient(0, 0, 0, height);
  rmsGradient.addColorStop(0, resolveStyle ? 'rgba(238, 244, 224, 0.34)' : 'rgba(92, 203, 255, 0.18)');
  rmsGradient.addColorStop(0.5, resolveStyle ? 'rgba(250, 248, 235, 0.88)' : 'rgba(178, 230, 255, 0.44)');
  rmsGradient.addColorStop(1, resolveStyle ? 'rgba(238, 244, 224, 0.34)' : 'rgba(92, 203, 255, 0.18)');
  buildCanvasSmoothEnvelopePath(ctx, columns, width, height, (column) => Math.min(column.rms * 0.84, column.peak * 0.72));
  ctx.fillStyle = rmsGradient;
  ctx.fill();

  drawCanvasWaveformCenterLine(ctx, width, height);
  drawTransientPeakSpikes(ctx, columns.length, (index) => columns[index], width, height);
}

function drawCompactCanvasWaveform(
  ctx: CanvasRenderingContext2D,
  columns: WaveformColumn[],
  width: number,
  height: number,
  resolveStyle = false,
): void {
  buildCanvasSignedEnvelopePath(ctx, columns, width, height, 0.08);
  ctx.fillStyle = resolveStyle ? 'rgba(250, 248, 235, 0.82)' : 'rgba(235, 241, 248, 0.62)';
  ctx.fill();
  drawCanvasWaveformCenterLine(ctx, width, height, 0.12);
}

export function drawTimelineClipCanvasAudioWaveform(
  ctx: CanvasRenderingContext2D,
  clip: TimelinePaintSourceClip,
  pyramid: TimelineWaveformPyramid | null,
  x: number,
  top: number,
  w: number,
  h: number,
  mode: TimelineAudioDisplayMode,
  pixelsPerSecond: number,
  resolveStyle = false,
): void {
  const channels = clip.waveformChannels?.filter(channel => channel.length > 0);
  const fallback = clip.waveform && clip.waveform.length > 0 ? [clip.waveform] : [];
  const drawableChannels = channels && channels.length > 0 ? channels : fallback;
  const hasDrawableWaveform = Boolean(pyramid || drawableChannels.length > 0);

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, top, w, h, Math.min(4, h / 4));
  ctx.clip();
  ctx.fillStyle = mode === 'spectral'
    ? 'rgba(8, 14, 24, 0.44)'
    : resolveStyle
      ? 'rgba(0, 0, 0, 0.07)'
      : 'rgba(4, 10, 18, 0.22)';
  ctx.fillRect(x, top, w, h);

  if (!hasDrawableWaveform || w < 2) {
    ctx.save();
    ctx.translate(x, top);
    drawCanvasWaveformCenterLine(ctx, w, h, clip.waveformGenerating ? 0.34 : 0.18);
    if (clip.waveformGenerating) {
      const progress = Math.max(0.04, Math.min(1, (clip.waveformProgress ?? 30) / 100));
      const progressGradient = ctx.createLinearGradient(0, 0, w, 0);
      progressGradient.addColorStop(0, 'rgba(92, 203, 255, 0.52)');
      progressGradient.addColorStop(1, 'rgba(178, 230, 255, 0.12)');
      ctx.fillStyle = progressGradient;
      ctx.fillRect(0, h - 3, w * progress, 2);
    }
    ctx.restore();
    ctx.restore();
    return;
  }

  const renderChannels = resolveTimelineClipCanvasWaveformChannelIndexes(pyramid, clip.waveformChannels, h);
  const laneGap = renderChannels.length > 1 ? 2 : 0;
  const laneHeight = Math.max(8, (h - laneGap * (renderChannels.length - 1)) / renderChannels.length);
  const naturalDuration = Math.max(0.001, pyramid?.duration ?? clip.source?.naturalDuration ?? clip.outPoint ?? clip.duration);
  const inPoint = Math.max(0, Math.min(naturalDuration, clip.inPoint ?? 0));
  const outPoint = Math.max(inPoint + 0.001, Math.min(naturalDuration, clip.outPoint ?? inPoint + clip.duration));

  ctx.save();
  ctx.translate(x, top);
  renderChannels.forEach((channelIndex, laneIndex) => {
    const laneTop = laneIndex * (laneHeight + laneGap);
    if (laneIndex > 0) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.beginPath();
      ctx.moveTo(0, laneTop - laneGap / 2);
      ctx.lineTo(w, laneTop - laneGap / 2);
      ctx.stroke();
    }

    const lod = buildWaveformLod({
      waveform: clip.waveform ?? [],
      waveformChannels: clip.waveformChannels,
      pyramid,
      width: w,
      inPoint,
      outPoint,
      naturalDuration,
      pixelsPerSecond,
      channelIndex,
    });
    if (!lod || lod.columns.length === 0) {
      ctx.save();
      ctx.translate(0, laneTop);
      drawCanvasWaveformCenterLine(ctx, w, laneHeight, 0.18);
      ctx.restore();
      return;
    }

    const smoothed = smoothWaveformColumns(lod.columns, lod.source === 'pyramid' ? 1 : 2, 0.45);
    const normalized = normalizeWaveformColumnsForDisplay(smoothed, {
      targetPeak: mode === 'compact' ? 0.52 : 0.66,
      minReferencePeak: mode === 'spectral' ? 0.025 : 0.032,
      maxGain: mode === 'spectral' ? 20 : 16,
      referencePeak: resolveWaveformDisplayReferencePeak(smoothed, { minReferencePeak: mode === 'spectral' ? 0.025 : 0.032 }),
      perceptualScale: mode !== 'compact',
      noiseFloorDb: mode === 'spectral' ? -42 : -30,
    });

    ctx.save();
    ctx.translate(0, laneTop);
    if (mode === 'compact') {
      drawCompactCanvasWaveform(ctx, normalized, w, laneHeight, resolveStyle);
    } else {
      drawDetailedCanvasWaveform(ctx, normalized, w, laneHeight, resolveStyle);
    }
    ctx.restore();
  });
  ctx.restore();
  ctx.restore();
}
