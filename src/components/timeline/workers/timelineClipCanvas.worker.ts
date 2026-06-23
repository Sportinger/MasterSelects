// OffscreenCanvas worker for the timeline clip layer (issue #228, Phase 4).
//
// Draws clip bodies and passive visual payloads entirely off the
// main thread, so even heavy React reconciliation of the timeline chrome cannot
// stutter the clip render. The main thread resolves geometry before posting so
// timeline state, transforms, and cache ownership never cross the worker boundary.
//
// Thumbnail source caches remain main-thread owned. The worker only receives
// fresh per-draw strip ImageBitmaps, plus waveform/spectrogram numeric data.

import type {
  TimelineClipCanvasWorkerClip as WorkerPlainClip,
  TimelineClipCanvasWorkerDrawMessage as DrawMessage,
  TimelineClipCanvasWorkerDrawnMessage as DrawnMessage,
  TimelineClipCanvasWorkerIncomingMessage as IncomingMessage,
  TimelineClipCanvasWorkerMidiPreviewResource as WorkerMidiPreviewResource,
  TimelineClipCanvasWorkerOutgoingMessage as OutgoingMessage,
  TimelineClipCanvasWorkerPaintPayloadTable as WorkerPaintPayloadTable,
  TimelineClipCanvasWorkerSourceExtensionGhostResource as WorkerSourceExtensionGhost,
  TimelineClipCanvasWorkerWaveformResource as WorkerWaveformResource,
} from '../utils/timelineClipCanvasWorkerContract';
import type { TimelinePaintFacetKind, TimelinePaintResourceRef } from '../../../timeline';
import {
  TIMELINE_CLIP_CANVAS_LOD_BAR_PX,
} from '../timelineRenderConstants';
import { writeTimelineSpectralColor } from '../utils/spectralColor';
import { drawWorkerPassiveDecorations } from './timelineClipCanvasWorkerPassivePainter';
import { estimateWorkerPayloadResourceBytes } from './timelineClipCanvasWorkerPayloadMetrics';
import {
  drawWorkerWaveformCenterLine,
  drawWorkerWaveformResource,
} from './timelineClipCanvasWorkerWaveformPainter';

const LOD_BAR_PX = TIMELINE_CLIP_CANVAS_LOD_BAR_PX;

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

type WorkerPaintResourceById = ReadonlyMap<string, TimelinePaintResourceRef>;
type WorkerThumbnailPayloadByResourceId = ReadonlyMap<string, WorkerPaintPayloadTable['thumbnailStrips'][number]['resource']>;
type WorkerWaveformPayloadByResourceId = ReadonlyMap<string, WorkerPaintPayloadTable['waveforms'][number]['resource']>;
type WorkerSpectrogramPayloadByResourceId = ReadonlyMap<string, WorkerPaintPayloadTable['spectrograms'][number]['resource']>;
type WorkerMidiPreviewPayloadByResourceId = ReadonlyMap<string, WorkerPaintPayloadTable['midiPreviews'][number]['resource']>;
type WorkerFadeVisualsPayloadByResourceId = ReadonlyMap<string, WorkerPaintPayloadTable['fadeVisuals'][number]['resource']>;
type WorkerTrimVisualsPayloadByFacetId = ReadonlyMap<string, WorkerPaintPayloadTable['trimVisuals'][number]['resource']>;
type WorkerCompositionVisualsPayloadByFacetId = ReadonlyMap<
  string,
  WorkerPaintPayloadTable['compositionVisuals'][number]['resource']
>;

function workerClipPaintFacet(clip: WorkerPlainClip, kind: TimelinePaintFacetKind) {
  return clip.paintPacket.facets.find((facet) => facet.kind === kind);
}

function workerClipHasPaintResource(
  clip: WorkerPlainClip,
  kind: TimelinePaintFacetKind,
  resourceById: WorkerPaintResourceById,
  resourceKind: TimelinePaintResourceRef['kind'],
): boolean {
  const facet = workerClipPaintFacet(clip, kind);
  if (!facet) return false;
  if (facet.resourceRefIds.length === 0) return true;
  return facet.resourceRefIds.some((resourceId) => resourceById.get(resourceId)?.kind === resourceKind);
}

function workerClipPaintResourceId(
  clip: WorkerPlainClip,
  kind: TimelinePaintFacetKind,
  resourceById: WorkerPaintResourceById,
  resourceKind: TimelinePaintResourceRef['kind'],
): string | undefined {
  const facet = workerClipPaintFacet(clip, kind);
  return facet?.resourceRefIds.find((resourceId) => resourceById.get(resourceId)?.kind === resourceKind);
}

function drawClipThumbnailStrip(
  context: OffscreenCanvasRenderingContext2D,
  clip: WorkerPlainClip,
  top: number,
  resourceById: WorkerPaintResourceById,
  thumbnailPayloadByResourceId: WorkerThumbnailPayloadByResourceId,
): number {
  const resourceId = workerClipPaintResourceId(clip, 'thumbnail-strip', resourceById, 'thumbnail-bitmap');
  if (!resourceId) return 0;
  const strip = thumbnailPayloadByResourceId.get(resourceId);
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
  resourceById: WorkerPaintResourceById,
  spectrogramPayloadByResourceId: WorkerSpectrogramPayloadByResourceId,
): void {
  const resourceId = workerClipPaintResourceId(clip, 'spectrogram', resourceById, 'spectrogram-raster');
  if (!resourceId) return;
  const spectrogram = spectrogramPayloadByResourceId.get(resourceId);
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

  const x = workerClipPaintX(clip);
  const w = workerClipPaintWidth(clip);
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
  resourceById: WorkerPaintResourceById,
  waveformPayloadByResourceId: WorkerWaveformPayloadByResourceId,
): void {
  if (!workerClipHasPaintResource(clip, 'waveform', resourceById, 'waveform-columns')) return;
  const waveformResourceId = workerClipPaintResourceId(clip, 'waveform', resourceById, 'waveform-columns');
  const waveform = waveformResourceId ? waveformPayloadByResourceId.get(waveformResourceId) : undefined;
  const x = workerClipPaintX(clip);
  const w = workerClipPaintWidth(clip);
  const h = height - 2;
  context.save();
  context.beginPath();
  context.roundRect(x, top, w, h, Math.min(4, h / 4));
  context.clip();
  context.fillStyle = 'rgba(4, 10, 18, 0.24)';
  context.fillRect(x, top, w, h);
  context.translate(x, top);
  if (waveform) {
    drawWorkerWaveformResource(context, waveform, w, h);
  } else {
    drawWorkerWaveformCenterLine(context, w, h, 0.18);
  }
  context.restore();
}

function drawWorkerMidiPreview(
  context: OffscreenCanvasRenderingContext2D,
  clip: WorkerPlainClip,
  midiPreview: WorkerMidiPreviewResource | undefined,
  x: number,
  top: number,
  width: number,
  height: number,
  resourceById: WorkerPaintResourceById,
  midiPayloadByResourceId: WorkerMidiPreviewPayloadByResourceId,
): void {
  const resourceId = workerClipPaintResourceId(clip, 'midi-preview', resourceById, 'midi-bars');
  if (!resourceId) return;
  midiPreview = midiPayloadByResourceId.get(resourceId);
  if (!midiPreview || midiPreview.barCount <= 0 || midiPreview.bars.length < midiPreview.barCount * 5) {
    return;
  }

  const bodyHeight = Math.max(1, height - 2);
  context.save();
  context.beginPath();
  context.roundRect(x, top, width, bodyHeight, Math.min(4, bodyHeight / 4));
  context.clip();
  context.fillStyle = midiPreview.mode === 'density'
    ? 'rgba(198, 218, 255, 1)'
    : 'rgba(210, 226, 255, 1)';

  for (let index = 0; index < midiPreview.barCount; index += 1) {
    const offset = index * 5;
    const barX = midiPreview.bars[offset] ?? 0;
    const barY = midiPreview.bars[offset + 1] ?? 0;
    const barW = midiPreview.bars[offset + 2] ?? 0;
    const barH = midiPreview.bars[offset + 3] ?? 0;
    if (barW <= 0 || barH <= 0) continue;
    context.globalAlpha = Math.max(0.08, Math.min(1, midiPreview.bars[offset + 4] ?? 0.7));
    context.fillRect(x + barX, top + barY, barW, barH);
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
  drawWorkerWaveformResource(context, waveform, width, waveformHeight);
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
  compositionVisualsPayloadByFacetId: WorkerCompositionVisualsPayloadByFacetId,
): number {
  const facet = workerClipPaintFacet(clip, 'composition-visuals');
  if (!facet) return 0;
  const composition = compositionVisualsPayloadByFacetId.get(facet.id);
  if (!composition) return 0;
  const x = workerClipPaintX(clip);
  const width = workerClipPaintWidth(clip);
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
  trimPayloadByFacetId: WorkerTrimVisualsPayloadByFacetId,
): void {
  const facet = workerClipPaintFacet(clip, 'trim-visuals');
  if (!facet) return;
  const ghosts = trimPayloadByFacetId.get(facet.id)?.sourceExtensionGhosts;
  if (!ghosts || ghosts.length === 0) return;
  ghosts.forEach((ghost) => drawWorkerSourceExtensionGhost(context, ghost, top, height - 2));
}

function drawWorkerFadeVisuals(
  context: OffscreenCanvasRenderingContext2D,
  clip: WorkerPlainClip,
  top: number,
  height: number,
  resourceById: WorkerPaintResourceById,
  fadePayloadByResourceId: WorkerFadeVisualsPayloadByResourceId,
): void {
  const resourceId = workerClipPaintResourceId(clip, 'fade-visuals', resourceById, 'fade-curve-points');
  if (!resourceId) return;
  const fade = fadePayloadByResourceId.get(resourceId);
  if (!fade || fade.curveCount <= 0 || fade.curves.length < fade.curveCount * 6) return;
  const bodyHeight = height - 2;

  context.save();
  context.translate(workerClipPaintX(clip), top);
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
  // Clip body color comes from `trackColor` (resolved by getTimelineTrackColor),
  // NOT from `.timeline-clip.*` CSS. Per-type clip colors (e.g. MIDI's identity
  // blue) live in getTimelineTrackColor — do not reintroduce them as CSS, it will
  // not apply here. See docs/Features/Timeline.md "Track and Clip Colors".
  const fill = withAlpha(trackColor, 0.55);
  const fillSelected = withAlpha(trackColor, 0.85);
  const border = withAlpha(trackColor, 0.9);

  ctx.textBaseline = 'middle';

  const paintResourceById = new Map(msg.paintResources.resources.map((resource) => [resource.id, resource]));
  const thumbnailPayloadByResourceId = new Map(
    msg.paintPayloads.thumbnailStrips.map((payload) => [payload.resourceId, payload.resource]),
  );
  const waveformPayloadByResourceId = new Map(
    msg.paintPayloads.waveforms.map((payload) => [payload.resourceId, payload.resource]),
  );
  const spectrogramPayloadByResourceId = new Map(
    msg.paintPayloads.spectrograms.map((payload) => [payload.resourceId, payload.resource]),
  );
  const midiPayloadByResourceId = new Map(
    msg.paintPayloads.midiPreviews.map((payload) => [payload.resourceId, payload.resource]),
  );
  const fadePayloadByResourceId = new Map(
    msg.paintPayloads.fadeVisuals.map((payload) => [payload.resourceId, payload.resource]),
  );
  const trimPayloadByFacetId = new Map(
    msg.paintPayloads.trimVisuals.map((payload) => [payload.facetId, payload.resource]),
  );
  const passiveDecorationsPayloadByFacetId = new Map(
    msg.paintPayloads.passiveDecorations.map((payload) => [payload.facetId, payload.resource]),
  );
  const compositionVisualsPayloadByFacetId = new Map(
    msg.paintPayloads.compositionVisuals.map((payload) => [payload.facetId, payload.resource]),
  );
  const transferredResourceBytes = estimateWorkerPayloadResourceBytes(msg.paintPayloads);
  let thumbnailClipCount = 0;
  let thumbnailDrawCount = 0;
  for (const clip of clips) {
    const x = workerClipPaintX(clip);
    const w = workerClipPaintWidth(clip);
    const isSel = clip.paintPacket.state.selected;
    const isHovered = clip.paintPacket.state.hovered;
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
    if (workerClipPaintResourceId(clip, 'thumbnail-strip', paintResourceById, 'thumbnail-bitmap')) {
      thumbnailClipCount += 1;
      thumbnailDrawCount += drawClipThumbnailStrip(ctx, clip, top, paintResourceById, thumbnailPayloadByResourceId);
    }
    drawWorkerMidiPreview(ctx, clip, undefined, x, top, w, height, paintResourceById, midiPayloadByResourceId);
    drawClipSpectrogram(ctx, clip, top, height, paintResourceById, spectrogramPayloadByResourceId);
    drawClipWaveform(ctx, clip, top, height, paintResourceById, waveformPayloadByResourceId);
    const compositionThumbnailDraws = drawWorkerCompositionDecorations(
      ctx,
      clip,
      top,
      height,
      compositionVisualsPayloadByFacetId,
    );
    if (compositionThumbnailDraws > 0) {
      thumbnailClipCount += 1;
      thumbnailDrawCount += compositionThumbnailDraws;
    }
    drawWorkerTrimVisuals(ctx, clip, top, height, trimPayloadByFacetId);
    drawWorkerFadeVisuals(ctx, clip, top, height, paintResourceById, fadePayloadByResourceId);
    drawWorkerPassiveDecorations(ctx, clip, top, height, passiveDecorationsPayloadByFacetId, false);
    ctx.beginPath();
    ctx.roundRect(x, top, w, h, radius);
    ctx.lineWidth = isSel ? 2 : 1;
    ctx.strokeStyle = isSel ? '#ffffff' : isHovered ? '#9dc8ff' : border;
    ctx.stroke();
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
