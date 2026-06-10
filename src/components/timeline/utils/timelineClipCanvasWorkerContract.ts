import type { TimelinePaintPacket, TimelinePaintResourceTable } from '../../../timeline';

export interface TimelineClipCanvasWorkerThumbnailStripResource {
  kind: 'thumbnail-strip';
  bitmap: ImageBitmap;
  x: number;
  width: number;
  height: number;
  drawCount: number;
}

export interface TimelineClipCanvasWorkerCompositionVisualsResource {
  kind: 'composition-visuals';
  outline: boolean;
  nestedBoundaries?: Float32Array;
  segmentRects?: Float32Array;
  segmentThumbnailStrip?: TimelineClipCanvasWorkerThumbnailStripResource;
  mixdownWaveform?: TimelineClipCanvasWorkerWaveformResource;
  mixdownGenerating?: boolean;
}

export interface TimelineClipCanvasWorkerPassiveBadge {
  label: string;
  fill: string;
  stroke?: string;
}

export interface TimelineClipCanvasWorkerProgressBar {
  progress: number;
  color: string;
}

export interface TimelineClipCanvasWorkerPassiveDecorationsResource {
  kind: 'passive-decorations';
  badges?: readonly TimelineClipCanvasWorkerPassiveBadge[];
  progressBars?: readonly TimelineClipCanvasWorkerProgressBar[];
  transcriptMarkers?: Float32Array;
  analysisOverlay?: TimelineClipCanvasWorkerAnalysisOverlayResource;
}

export interface TimelineClipCanvasWorkerAnalysisOverlayResource {
  kind: 'analysis-overlay';
  points: Float32Array;
  pointCount: number;
}

export interface TimelineClipCanvasWorkerWaveformChannelResource {
  columns: Float32Array;
  columnCount: number;
}

export interface TimelineClipCanvasWorkerWaveformResource {
  kind: 'waveform';
  columns: Float32Array;
  columnCount: number;
  channels?: readonly TimelineClipCanvasWorkerWaveformChannelResource[];
  mode: 'compact' | 'detailed';
}

export interface TimelineClipCanvasWorkerSpectrogramResource {
  kind: 'spectrogram';
  values: Float32Array;
  rasterWidth: number;
  rasterHeight: number;
}

export interface TimelineClipCanvasWorkerMidiPreviewResource {
  kind: 'midi-preview';
  bars: Float32Array;
  barCount: number;
  mode: 'notes' | 'density';
}

export interface TimelineClipCanvasWorkerSourceExtensionGhostResource {
  edge: 'left' | 'right';
  x: number;
  width: number;
}

export interface TimelineClipCanvasWorkerTrimVisualsResource {
  kind: 'trim-visuals';
  body: {
    x: number;
    width: number;
  };
  sourceExtensionGhosts?: readonly TimelineClipCanvasWorkerSourceExtensionGhostResource[];
}

export interface TimelineClipCanvasWorkerFadeVisualsResource {
  kind: 'fade-visuals';
  startX: number;
  startY: number;
  curves: Float32Array;
  curveCount: number;
  points: Float32Array;
  pointCount: number;
  isAudioClip: boolean;
}

export interface TimelineClipCanvasWorkerClip {
  id: string;
  paintPacket: TimelinePaintPacket;
}

export interface TimelineClipCanvasWorkerThumbnailStripPayload {
  resourceId: string;
  resource: TimelineClipCanvasWorkerThumbnailStripResource;
}

export interface TimelineClipCanvasWorkerWaveformPayload {
  resourceId: string;
  resource: TimelineClipCanvasWorkerWaveformResource;
}

export interface TimelineClipCanvasWorkerSpectrogramPayload {
  resourceId: string;
  resource: TimelineClipCanvasWorkerSpectrogramResource;
}

export interface TimelineClipCanvasWorkerMidiPreviewPayload {
  resourceId: string;
  resource: TimelineClipCanvasWorkerMidiPreviewResource;
}

export interface TimelineClipCanvasWorkerFadeVisualsPayload {
  resourceId: string;
  resource: TimelineClipCanvasWorkerFadeVisualsResource;
}

export interface TimelineClipCanvasWorkerTrimVisualsPayload {
  facetId: string;
  resource: TimelineClipCanvasWorkerTrimVisualsResource;
}

export interface TimelineClipCanvasWorkerPassiveDecorationsPayload {
  facetId: string;
  resource: TimelineClipCanvasWorkerPassiveDecorationsResource;
}

export interface TimelineClipCanvasWorkerCompositionVisualsPayload {
  facetId: string;
  resource: TimelineClipCanvasWorkerCompositionVisualsResource;
}

export interface TimelineClipCanvasWorkerPaintPayloadTable {
  thumbnailStrips: readonly TimelineClipCanvasWorkerThumbnailStripPayload[];
  waveforms: readonly TimelineClipCanvasWorkerWaveformPayload[];
  spectrograms: readonly TimelineClipCanvasWorkerSpectrogramPayload[];
  midiPreviews: readonly TimelineClipCanvasWorkerMidiPreviewPayload[];
  fadeVisuals: readonly TimelineClipCanvasWorkerFadeVisualsPayload[];
  trimVisuals: readonly TimelineClipCanvasWorkerTrimVisualsPayload[];
  passiveDecorations: readonly TimelineClipCanvasWorkerPassiveDecorationsPayload[];
  compositionVisuals: readonly TimelineClipCanvasWorkerCompositionVisualsPayload[];
}

export interface TimelineClipCanvasWorkerInitMessage {
  type: 'init';
  canvas: OffscreenCanvas;
}

export interface TimelineClipCanvasWorkerDrawMessage {
  type: 'draw';
  requestId: number;
  clips: TimelineClipCanvasWorkerClip[];
  paintResources: TimelinePaintResourceTable;
  paintPayloads: TimelineClipCanvasWorkerPaintPayloadTable;
  height: number;
  cssWidth: number;
  dpr: number;
  trackColor: string;
}

export type TimelineClipCanvasWorkerIncomingMessage =
  | TimelineClipCanvasWorkerInitMessage
  | TimelineClipCanvasWorkerDrawMessage;

export interface TimelineClipCanvasWorkerReadyMessage {
  type: 'ready';
}

export interface TimelineClipCanvasWorkerDrawnMessage {
  type: 'drawn';
  requestId: number;
  drawnClipCount: number;
  thumbnailClipCount: number;
  thumbnailDrawCount: number;
  drawMs: number;
  resourceBytes: number;
}

export interface TimelineClipCanvasWorkerErrorMessage {
  type: 'error';
  requestId?: number;
  message: string;
}

export type TimelineClipCanvasWorkerOutgoingMessage =
  | TimelineClipCanvasWorkerReadyMessage
  | TimelineClipCanvasWorkerDrawnMessage
  | TimelineClipCanvasWorkerErrorMessage;
