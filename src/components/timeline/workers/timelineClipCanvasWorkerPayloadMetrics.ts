import type {
  TimelineClipCanvasWorkerPaintPayloadTable as WorkerPaintPayloadTable,
} from '../utils/timelineClipCanvasWorkerContract';

export function estimateWorkerPayloadResourceBytes(payloads: WorkerPaintPayloadTable): number {
  return payloads.thumbnailStrips.reduce(
    (total, payload) => total + payload.resource.bitmap.width * payload.resource.bitmap.height * 4,
    0,
  ) + payloads.waveforms.reduce(
    (total, payload) => total + payload.resource.columns.byteLength,
    0,
  ) + payloads.spectrograms.reduce(
    (total, payload) => total + payload.resource.values.byteLength,
    0,
  ) + payloads.midiPreviews.reduce(
    (total, payload) => total + payload.resource.bars.byteLength,
    0,
  ) + payloads.fadeVisuals.reduce(
    (total, payload) => total + payload.resource.curves.byteLength + payload.resource.points.byteLength,
    0,
  ) + payloads.passiveDecorations.reduce(
    (total, payload) => total +
      (payload.resource.sceneCutMarkers?.byteLength ?? 0) +
      (payload.resource.transcriptMarkers?.byteLength ?? 0) +
      (payload.resource.analysisOverlay?.points.byteLength ?? 0),
    0,
  ) + payloads.compositionVisuals.reduce(
    (total, payload) => total +
      (payload.resource.segmentThumbnailStrip
        ? payload.resource.segmentThumbnailStrip.bitmap.width * payload.resource.segmentThumbnailStrip.bitmap.height * 4
        : 0) +
      (payload.resource.nestedBoundaries?.byteLength ?? 0) +
      (payload.resource.segmentRects?.byteLength ?? 0) +
      (payload.resource.mixdownWaveform?.columns.byteLength ?? 0),
    0,
  );
}
