import type {
  TimelineClipCanvasWorkerCompositionVisualsResource,
  TimelineClipCanvasWorkerFadeVisualsResource,
  TimelineClipCanvasWorkerMidiPreviewResource,
  TimelineClipCanvasWorkerPassiveDecorationsResource,
  TimelineClipCanvasWorkerSpectrogramResource,
  TimelineClipCanvasWorkerThumbnailStripResource,
  TimelineClipCanvasWorkerTrimVisualsResource,
  TimelineClipCanvasWorkerWaveformResource,
} from './timelineClipCanvasWorkerContract';

export interface TimelineClipCanvasWorkerPreparedThumbnailStripResource {
  kind: 'thumbnail-strip';
  bitmap: ImageBitmap;
  x: number;
  width: number;
  height: number;
  drawCount: number;
}

export interface TimelineClipCanvasWorkerPreparedCompositionVisualsResource {
  kind: 'composition-visuals';
  outline: boolean;
  nestedBoundaries?: readonly number[] | Float32Array;
  segmentRects?: readonly number[] | Float32Array;
  segmentThumbnailStrip?: TimelineClipCanvasWorkerPreparedThumbnailStripResource;
  mixdownWaveform?: TimelineClipCanvasWorkerPreparedWaveformResource;
  mixdownGenerating?: boolean;
}

export interface TimelineClipCanvasWorkerPreparedWaveformResource {
  kind: 'waveform';
  columns: readonly number[] | Float32Array;
  columnCount: number;
  channelCount?: number;
  mode: 'compact' | 'detailed';
}

export interface TimelineClipCanvasWorkerPreparedSpectrogramResource {
  kind: 'spectrogram';
  values: readonly number[] | Float32Array;
  rasterWidth: number;
  rasterHeight: number;
}

export interface TimelineClipCanvasWorkerPreparedFadeVisualsResource {
  kind: 'fade-visuals';
  startX: number;
  startY: number;
  curves: readonly number[] | Float32Array;
  curveCount: number;
  points: readonly number[] | Float32Array;
  pointCount: number;
  isAudioClip: boolean;
}

export interface TimelineClipCanvasWorkerPreparedClipResources {
  thumbnailStrip?: TimelineClipCanvasWorkerPreparedThumbnailStripResource;
  passiveDecorations?: TimelineClipCanvasWorkerPassiveDecorationsResource;
  waveform?: TimelineClipCanvasWorkerPreparedWaveformResource;
  spectrogram?: TimelineClipCanvasWorkerPreparedSpectrogramResource;
  midiPreview?: TimelineClipCanvasWorkerMidiPreviewResource;
  compositionVisuals?: TimelineClipCanvasWorkerPreparedCompositionVisualsResource;
  trimVisuals?: TimelineClipCanvasWorkerTrimVisualsResource;
  fadeVisuals?: TimelineClipCanvasWorkerPreparedFadeVisualsResource;
}

export function clonePreparedWaveformResource(
  waveform: TimelineClipCanvasWorkerPreparedWaveformResource,
): TimelineClipCanvasWorkerWaveformResource {
  return {
    kind: 'waveform',
    columns: waveform.columns instanceof Float32Array
      ? new Float32Array(waveform.columns)
      : Float32Array.from(waveform.columns),
    columnCount: waveform.columnCount,
    channelCount: waveform.channelCount,
    mode: waveform.mode,
  };
}

export function clonePreparedSpectrogramResource(
  spectrogram: TimelineClipCanvasWorkerPreparedSpectrogramResource,
): TimelineClipCanvasWorkerSpectrogramResource {
  return {
    kind: 'spectrogram',
    values: spectrogram.values instanceof Float32Array
      ? new Float32Array(spectrogram.values)
      : Float32Array.from(spectrogram.values),
    rasterWidth: spectrogram.rasterWidth,
    rasterHeight: spectrogram.rasterHeight,
  };
}

export function clonePreparedMidiPreviewResource(
  midiPreview: TimelineClipCanvasWorkerMidiPreviewResource,
): TimelineClipCanvasWorkerMidiPreviewResource {
  return {
    kind: 'midi-preview',
    bars: new Float32Array(midiPreview.bars),
    barCount: midiPreview.barCount,
    mode: midiPreview.mode,
  };
}

export function getPreparedThumbnailStripResource(
  thumbnailStrip: TimelineClipCanvasWorkerPreparedThumbnailStripResource,
): TimelineClipCanvasWorkerThumbnailStripResource {
  return thumbnailStrip;
}

export function clonePreparedCompositionVisualsResource(
  compositionVisuals: TimelineClipCanvasWorkerPreparedCompositionVisualsResource,
): TimelineClipCanvasWorkerCompositionVisualsResource {
  return {
    kind: 'composition-visuals',
    outline: compositionVisuals.outline,
    nestedBoundaries: compositionVisuals.nestedBoundaries
      ? compositionVisuals.nestedBoundaries instanceof Float32Array
        ? new Float32Array(compositionVisuals.nestedBoundaries)
        : Float32Array.from(compositionVisuals.nestedBoundaries)
      : undefined,
    segmentRects: compositionVisuals.segmentRects
      ? compositionVisuals.segmentRects instanceof Float32Array
        ? new Float32Array(compositionVisuals.segmentRects)
        : Float32Array.from(compositionVisuals.segmentRects)
      : undefined,
    segmentThumbnailStrip: compositionVisuals.segmentThumbnailStrip
      ? getPreparedThumbnailStripResource(compositionVisuals.segmentThumbnailStrip)
      : undefined,
    mixdownWaveform: compositionVisuals.mixdownWaveform
      ? clonePreparedWaveformResource(compositionVisuals.mixdownWaveform)
      : undefined,
    mixdownGenerating: compositionVisuals.mixdownGenerating,
  };
}

export function clonePassiveDecorationsResource(
  passiveDecorations: TimelineClipCanvasWorkerPassiveDecorationsResource,
): TimelineClipCanvasWorkerPassiveDecorationsResource {
  return {
    kind: 'passive-decorations',
    badges: passiveDecorations.badges,
    progressBars: passiveDecorations.progressBars,
    transcriptMarkers: passiveDecorations.transcriptMarkers
      ? new Float32Array(passiveDecorations.transcriptMarkers)
      : undefined,
    analysisOverlay: passiveDecorations.analysisOverlay
      ? {
        kind: 'analysis-overlay',
        points: new Float32Array(passiveDecorations.analysisOverlay.points),
        pointCount: passiveDecorations.analysisOverlay.pointCount,
      }
      : undefined,
  };
}

export function cloneTrimVisualsResource(
  trimVisuals: TimelineClipCanvasWorkerTrimVisualsResource,
): TimelineClipCanvasWorkerTrimVisualsResource {
  return {
    kind: 'trim-visuals',
    body: {
      x: trimVisuals.body.x,
      width: trimVisuals.body.width,
    },
    sourceExtensionGhosts: trimVisuals.sourceExtensionGhosts?.map((ghost) => ({
      edge: ghost.edge,
      x: ghost.x,
      width: ghost.width,
    })),
  };
}

export function clonePreparedFadeVisualsResource(
  fadeVisuals: TimelineClipCanvasWorkerPreparedFadeVisualsResource,
): TimelineClipCanvasWorkerFadeVisualsResource {
  return {
    kind: 'fade-visuals',
    startX: fadeVisuals.startX,
    startY: fadeVisuals.startY,
    curves: fadeVisuals.curves instanceof Float32Array
      ? new Float32Array(fadeVisuals.curves)
      : Float32Array.from(fadeVisuals.curves),
    curveCount: fadeVisuals.curveCount,
    points: fadeVisuals.points instanceof Float32Array
      ? new Float32Array(fadeVisuals.points)
      : Float32Array.from(fadeVisuals.points),
    pointCount: fadeVisuals.pointCount,
    isAudioClip: fadeVisuals.isAudioClip,
  };
}
