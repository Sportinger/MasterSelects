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

export interface TimelineClipCanvasWorkerWaveformResource {
  kind: 'waveform';
  columns: Float32Array;
  columnCount: number;
  mode: 'compact' | 'detailed';
}

export interface TimelineClipCanvasWorkerSpectrogramResource {
  kind: 'spectrogram';
  values: Float32Array;
  rasterWidth: number;
  rasterHeight: number;
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
  name: string;
  x: number;
  width: number;
  selected: boolean;
  hovered: boolean;
  isAudio?: boolean;
  waveformEnabled?: boolean;
  thumbnailStrip?: TimelineClipCanvasWorkerThumbnailStripResource;
  compositionVisuals?: TimelineClipCanvasWorkerCompositionVisualsResource;
  trimVisuals?: TimelineClipCanvasWorkerTrimVisualsResource;
  fadeVisuals?: TimelineClipCanvasWorkerFadeVisualsResource;
  passiveDecorations?: TimelineClipCanvasWorkerPassiveDecorationsResource;
  waveform?: TimelineClipCanvasWorkerWaveformResource;
  spectrogram?: TimelineClipCanvasWorkerSpectrogramResource;
}

export interface TimelineClipCanvasWorkerInitMessage {
  type: 'init';
  canvas: OffscreenCanvas;
}

export interface TimelineClipCanvasWorkerDrawMessage {
  type: 'draw';
  requestId: number;
  clips: TimelineClipCanvasWorkerClip[];
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
