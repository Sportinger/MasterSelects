import { getThumbnailBitmap } from '../../../services/timeline/thumbnailBitmapCache';
import type { TimelineClipCanvasWorkerPreparedClipResources } from './timelineClipCanvasWorkerModel';

export const TIMELINE_CLIP_CANVAS_COMPOSITION_SEGMENT_MAX_COUNT = 128;
export const TIMELINE_CLIP_CANVAS_COMPOSITION_BOUNDARY_MAX_COUNT = 512;

export interface TimelineClipCanvasCompositionSegmentInput {
  startNorm: number;
  endNorm: number;
  thumbnails?: readonly string[];
}

export function getTimelineClipCanvasCompositionThumbnailSlotUrls(
  thumbnails: readonly string[],
  segmentWidth: number,
  thumbnailSlotPx: number,
  maxThumbnailSlots: number,
): readonly string[] {
  if (thumbnails.length === 0) return [];
  const count = Math.max(1, Math.min(maxThumbnailSlots, Math.ceil(segmentWidth / thumbnailSlotPx)));
  return Array.from({ length: count }, (_, index) => thumbnails[Math.min(
    thumbnails.length - 1,
    Math.floor((index / count) * thumbnails.length),
  )]);
}

export interface TimelineClipCanvasCompositionResourceClipInput {
  isComposition?: boolean;
  compositionId?: string;
  source?: {
    type?: string | null;
  } | null;
  nestedClipBoundaries?: readonly number[];
  clipSegments?: readonly TimelineClipCanvasCompositionSegmentInput[];
  mixdownWaveform?: readonly number[];
  mixdownGenerating?: boolean;
  hasMixdownAudio?: boolean;
  waveform?: readonly number[];
}

type WorkerPreparedCompositionVisualsResource = NonNullable<
  TimelineClipCanvasWorkerPreparedClipResources['compositionVisuals']
>;
type WorkerPreparedCompositionSegmentThumbnailStripResource = NonNullable<
  WorkerPreparedCompositionVisualsResource['segmentThumbnailStrip']
>;

function hasTimelineClipCanvasCompositionAudioMixdown(
  clip: TimelineClipCanvasCompositionResourceClipInput,
): boolean {
  if (clip.source?.type !== 'audio') return false;
  return Boolean(
    clip.mixdownGenerating ||
      (clip.mixdownWaveform && clip.mixdownWaveform.length > 0) ||
      (clip.hasMixdownAudio && clip.waveform && clip.waveform.length > 0)
  );
}

export function hasTimelineClipCanvasCompositionDecorations(
  clip: TimelineClipCanvasCompositionResourceClipInput,
): boolean {
  return Boolean(
    clip.isComposition ||
    clip.compositionId ||
    hasTimelineClipCanvasCompositionAudioMixdown(clip) ||
    (clip.nestedClipBoundaries && clip.nestedClipBoundaries.length > 0) ||
    (clip.clipSegments && clip.clipSegments.length > 0)
  );
}

function createTimelineClipCanvasWorkerCompositionSegmentRects(
  clip: TimelineClipCanvasCompositionResourceClipInput,
): Float32Array | undefined {
  const segments = clip.clipSegments;
  if (!segments || segments.length === 0) return undefined;
  const values: number[] = [];
  for (const segment of segments.slice(0, TIMELINE_CLIP_CANVAS_COMPOSITION_SEGMENT_MAX_COUNT)) {
    const startNorm = Math.max(0, Math.min(1, segment.startNorm));
    const endNorm = Math.max(startNorm, Math.min(1, segment.endNorm));
    if (endNorm - startNorm <= 0.0001) continue;
    values.push(startNorm, endNorm);
  }
  return values.length > 0 ? Float32Array.from(values) : undefined;
}

function createTimelineClipCanvasWorkerCompositionNestedBoundaries(
  clip: TimelineClipCanvasCompositionResourceClipInput,
): Float32Array | undefined {
  const boundaries = clip.nestedClipBoundaries;
  if (!boundaries || boundaries.length === 0) return undefined;
  const values = boundaries
    .filter((boundary) => Number.isFinite(boundary) && boundary > 0 && boundary < 1)
    .slice(0, TIMELINE_CLIP_CANVAS_COMPOSITION_BOUNDARY_MAX_COUNT);
  return values.length > 0 ? Float32Array.from(values) : undefined;
}

function drawCover(
  ctx: OffscreenCanvasRenderingContext2D,
  bmp: ImageBitmap,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
): void {
  const scale = Math.max(dw / bmp.width, dh / bmp.height);
  const sw = dw / scale;
  const sh = dh / scale;
  const sx = (bmp.width - sw) / 2;
  const sy = (bmp.height - sh) / 2;
  ctx.drawImage(bmp, sx, sy, sw, sh, dx, dy, dw, dh);
}

function createTimelineClipCanvasWorkerCompositionSegmentThumbnailStripResource(input: {
  clip: TimelineClipCanvasCompositionResourceClipInput;
  clipWidth: number;
  height: number;
  minThumbnailWidth: number;
  thumbnailSlotPx: number;
  maxThumbnailSlots: number;
  maxBitmapWidth: number;
  maxBitmapHeight: number;
}): WorkerPreparedCompositionSegmentThumbnailStripResource | undefined {
  const { clip, clipWidth, height } = input;
  const segments = clip.clipSegments;
  if (!segments || segments.length === 0 || clipWidth < input.minThumbnailWidth || typeof OffscreenCanvas === 'undefined') {
    return undefined;
  }
  const bitmapWidth = Math.max(1, Math.min(input.maxBitmapWidth, Math.round(clipWidth)));
  const bitmapHeight = Math.max(1, Math.min(input.maxBitmapHeight, Math.round(Math.max(1, height - 2))));
  const canvas = new OffscreenCanvas(bitmapWidth, bitmapHeight);
  const ctx = canvas.getContext('2d');
  if (!ctx) return undefined;

  let drawCount = 0;
  for (const segment of segments.slice(0, TIMELINE_CLIP_CANVAS_COMPOSITION_SEGMENT_MAX_COUNT)) {
    const startNorm = Math.max(0, Math.min(1, segment.startNorm));
    const endNorm = Math.max(startNorm, Math.min(1, segment.endNorm));
    const segmentX = startNorm * bitmapWidth;
    const segmentW = Math.max(1, (endNorm - startNorm) * bitmapWidth);
    if (segmentW <= 0) continue;

    ctx.save();
    ctx.beginPath();
    ctx.rect(segmentX, 0, segmentW, bitmapHeight);
    ctx.clip();
    ctx.fillStyle = 'rgba(15, 23, 42, 0.62)';
    ctx.fillRect(segmentX, 0, segmentW, bitmapHeight);

    const thumbnails = segment.thumbnails ?? [];
    if (thumbnails.length > 0) {
      const urls = getTimelineClipCanvasCompositionThumbnailSlotUrls(
        thumbnails,
        segmentW / bitmapWidth * clipWidth,
        input.thumbnailSlotPx,
        input.maxThumbnailSlots,
      );
      const count = urls.length;
      const slotW = segmentW / count;
      for (let index = 0; index < count; index += 1) {
        const bitmap = getThumbnailBitmap(urls[index]);
        if (!bitmap) continue;
        drawCover(ctx, bitmap, segmentX + index * slotW, 0, slotW, bitmapHeight);
        drawCount += 1;
      }
    }

    ctx.fillStyle = 'rgba(251, 146, 60, 0.18)';
    ctx.fillRect(segmentX, 0, segmentW, bitmapHeight);
    ctx.strokeStyle = 'rgba(251, 146, 60, 0.45)';
    ctx.lineWidth = 1;
    ctx.strokeRect(segmentX + 0.5, 0.5, Math.max(0, segmentW - 1), Math.max(0, bitmapHeight - 1));
    ctx.restore();
  }

  return {
    kind: 'thumbnail-strip',
    bitmap: canvas.transferToImageBitmap(),
    x: 0,
    width: clipWidth,
    height: Math.max(1, height - 2),
    drawCount,
  };
}

export function createTimelineClipCanvasWorkerCompositionVisualsResource(input: {
  clip: TimelineClipCanvasCompositionResourceClipInput;
  clipWidth: number;
  height: number;
  mixdownWaveform?: WorkerPreparedCompositionVisualsResource['mixdownWaveform'];
  minThumbnailWidth: number;
  thumbnailSlotPx: number;
  maxThumbnailSlots: number;
  maxBitmapWidth: number;
  maxBitmapHeight: number;
}): TimelineClipCanvasWorkerPreparedClipResources['compositionVisuals'] | undefined {
  const { clip } = input;
  if (!hasTimelineClipCanvasCompositionDecorations(clip)) return undefined;
  return {
    kind: 'composition-visuals',
    outline: Boolean(clip.isComposition || clip.compositionId),
    nestedBoundaries: createTimelineClipCanvasWorkerCompositionNestedBoundaries(clip),
    segmentRects: createTimelineClipCanvasWorkerCompositionSegmentRects(clip),
    segmentThumbnailStrip: createTimelineClipCanvasWorkerCompositionSegmentThumbnailStripResource(input),
    mixdownWaveform: input.mixdownWaveform,
    mixdownGenerating: clip.mixdownGenerating,
  };
}
