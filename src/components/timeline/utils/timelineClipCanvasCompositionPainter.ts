import type { TimelinePaintSourceClip } from '../../../timeline';
import { hasTimelineClipCanvasCompositionDecorations } from './timelineClipCanvasCompositionResource';
import type { TimelineClipCanvasTrimGeometry } from './timelineClipCanvasTrimResource';
import { drawTimelineClipCanvasAudioWaveform } from './timelineClipCanvasWaveformPainter';
import { drawTimelineClipCanvasCompositionSegmentThumbnails } from './timelineClipCanvasCompositionSegmentsPainter';

interface DrawTimelineClipCanvasCompositionDecorationsProps {
  maxThumbSlots: number;
  minThumbnailWidth: number;
  thumbSlotPx: number;
}

function drawCanvasCompositionOutline(
  ctx: CanvasRenderingContext2D,
  x: number,
  top: number,
  w: number,
  h: number,
): void {
  if (w < 2 || h < 2) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(251, 146, 60, 0.9)';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.roundRect(x + 1, top + 1, Math.max(0, w - 2), Math.max(0, h - 2), Math.min(4, h / 4));
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

function drawCanvasNestedBoundaries(
  ctx: CanvasRenderingContext2D,
  boundaries: readonly number[] | undefined,
  x: number,
  top: number,
  w: number,
  h: number,
): void {
  if (!boundaries || boundaries.length === 0 || w < 4) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(248, 113, 113, 0.86)';
  ctx.lineWidth = 1;
  for (const boundary of boundaries) {
    if (!Number.isFinite(boundary) || boundary <= 0 || boundary >= 1) continue;
    const lineX = x + boundary * w;
    ctx.beginPath();
    ctx.moveTo(lineX + 0.5, top + 2);
    ctx.lineTo(lineX + 0.5, top + h - 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawCanvasMixdownWaveform(
  ctx: CanvasRenderingContext2D,
  clip: TimelinePaintSourceClip,
  geometry: TimelineClipCanvasTrimGeometry,
  x: number,
  top: number,
  w: number,
  h: number,
): void {
  if (clip.source?.type !== 'audio') return;

  const waveform = (clip.mixdownWaveform && clip.mixdownWaveform.length > 0)
    ? clip.mixdownWaveform
    : clip.hasMixdownAudio && clip.waveform && clip.waveform.length > 0
      ? clip.waveform
      : null;
  if (!waveform || w < 8 || h < 18) return;

  const waveformHeight = Math.min(42, Math.max(16, h / 3));
  const waveformTop = top + Math.max(3, Math.floor((h - waveformHeight) / 2));
  drawTimelineClipCanvasAudioWaveform(
    ctx,
    {
      ...clip,
      waveform,
      waveformChannels: undefined,
      inPoint: geometry.inPoint,
      outPoint: geometry.outPoint,
      source: {
        ...(clip.source ?? {}),
        naturalDuration: Math.max(0.001, geometry.duration),
        type: 'audio',
      },
    },
    null,
    x,
    waveformTop,
    w,
    waveformHeight,
    'compact',
    1,
  );
}

export function drawTimelineClipCanvasCompositionDecorations(
  ctx: CanvasRenderingContext2D,
  clip: TimelinePaintSourceClip,
  geometry: TimelineClipCanvasTrimGeometry,
  x: number,
  top: number,
  w: number,
  h: number,
  requestRedraw: () => void,
  props: DrawTimelineClipCanvasCompositionDecorationsProps,
): number {
  if (!hasTimelineClipCanvasCompositionDecorations(clip)) return 0;

  let thumbnailDrawCount = 0;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, top, w, h, Math.min(4, h / 4));
  ctx.clip();
  thumbnailDrawCount += drawTimelineClipCanvasCompositionSegmentThumbnails(ctx, clip, x, top, w, h, requestRedraw, props);
  drawCanvasMixdownWaveform(ctx, clip, geometry, x, top, w, h);
  if (clip.source?.type === 'audio' && clip.mixdownGenerating && w >= 72) {
    ctx.fillStyle = 'rgba(15, 23, 42, 0.78)';
    ctx.fillRect(x + 6, top + Math.max(4, h - 20), Math.min(118, w - 12), 15);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.86)';
    ctx.font = '10px ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText('Generating audio', x + 11, top + Math.max(11, h - 12));
  }
  drawCanvasNestedBoundaries(ctx, clip.nestedClipBoundaries, x, top, w, h);
  ctx.restore();

  if (clip.isComposition || clip.compositionId) {
    drawCanvasCompositionOutline(ctx, x, top, w, h);
  }

  return thumbnailDrawCount;
}
