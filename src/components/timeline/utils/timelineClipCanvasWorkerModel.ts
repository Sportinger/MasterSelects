import type {
  TimelineClipCanvasWorkerClip,
  TimelineClipCanvasWorkerCompositionVisualsResource,
  TimelineClipCanvasWorkerDrawMessage,
  TimelineClipCanvasWorkerFadeVisualsResource,
  TimelineClipCanvasWorkerMidiPreviewResource,
  TimelineClipCanvasWorkerPassiveDecorationsResource,
  TimelineClipCanvasWorkerSpectrogramResource,
  TimelineClipCanvasWorkerThumbnailStripResource,
  TimelineClipCanvasWorkerTrimVisualsResource,
  TimelineClipCanvasWorkerWaveformResource,
} from './timelineClipCanvasWorkerContract';
import {
  hasTimelineClipCanvasAudioAnalysisRef,
  isTimelineClipCanvasAudioClip,
  type TimelineClipCanvasAudioClipInput,
} from './timelineClipCanvasAudio';

export type {
  TimelineClipCanvasWorkerAnalysisOverlayResource,
  TimelineClipCanvasWorkerClip,
  TimelineClipCanvasWorkerCompositionVisualsResource,
  TimelineClipCanvasWorkerDrawMessage,
  TimelineClipCanvasWorkerErrorMessage,
  TimelineClipCanvasWorkerFadeVisualsResource,
  TimelineClipCanvasWorkerIncomingMessage,
  TimelineClipCanvasWorkerInitMessage,
  TimelineClipCanvasWorkerMidiPreviewResource,
  TimelineClipCanvasWorkerOutgoingMessage,
  TimelineClipCanvasWorkerPassiveBadge,
  TimelineClipCanvasWorkerPassiveDecorationsResource,
  TimelineClipCanvasWorkerProgressBar,
  TimelineClipCanvasWorkerReadyMessage,
  TimelineClipCanvasWorkerSourceExtensionGhostResource,
  TimelineClipCanvasWorkerSpectrogramResource,
  TimelineClipCanvasWorkerThumbnailStripResource,
  TimelineClipCanvasWorkerTrimVisualsResource,
  TimelineClipCanvasWorkerWaveformResource,
} from './timelineClipCanvasWorkerContract';

export interface TimelineClipCanvasWorkerSourceClip {
  id: string;
  name: string;
  startTime: number;
  duration: number;
  inPoint?: number;
  outPoint?: number;
  reversed?: boolean;
  mediaFileId?: string;
  thumbnails?: readonly string[];
  trackType?: 'video' | 'audio' | 'midi';
  isComposition?: boolean;
  compositionId?: string;
  nestedClipBoundaries?: readonly number[];
  clipSegments?: readonly {
    startNorm: number;
    endNorm: number;
    thumbnails?: readonly string[];
  }[];
  mixdownWaveform?: readonly number[];
  mixdownGenerating?: boolean;
  hasMixdownAudio?: boolean;
  waveform?: readonly number[];
  waveformChannels?: readonly (readonly number[])[];
  waveformGenerating?: boolean;
  waveformProgress?: number;
  audioState?: TimelineClipCanvasAudioClipInput['audioState'];
  midiData?: {
    notes?: readonly {
      pitch: number;
      start: number;
      duration: number;
      velocity?: number;
    }[];
  };
  fade?: {
    keyframes?: readonly unknown[];
  } | null;
  source?: {
    type?: string | null;
    mediaFileId?: string;
    naturalDuration?: number;
  } | null;
}

export interface TimelineClipCanvasWorkerEligibilityInput {
  clips: readonly TimelineClipCanvasWorkerSourceClip[];
  waveformsEnabled?: boolean;
  audioDisplayMode?: 'compact' | 'detailed' | 'spectral';
  preparedResourcesByClipId?: ReadonlyMap<string, TimelineClipCanvasWorkerPreparedClipResources>;
  preparedThumbnailClipIds?: ReadonlySet<string>;
  passiveDecorationClipIds?: ReadonlySet<string>;
  activeTrimClipId?: string | null;
  hasPassiveDecorations?: boolean;
  hasClipTrim?: boolean;
}

export interface TimelineClipCanvasWorkerEligibility {
  eligible: boolean;
  reasons: string[];
}

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

export interface TimelineClipCanvasWorkerBuildInput extends TimelineClipCanvasWorkerEligibilityInput {
  height: number;
  cssWidth: number;
  canvasOffsetX: number;
  dpr: number;
  timeToPixel: (time: number) => number;
  selectedClipIds: ReadonlySet<string>;
  hoveredClipId?: string | null;
  trackColor: string;
  requestId?: number;
}

export interface TimelineClipCanvasWorkerBuildResult {
  eligibility: TimelineClipCanvasWorkerEligibility;
  message: TimelineClipCanvasWorkerDrawMessage | null;
  transferables: Transferable[];
  inputClipCount: number;
  visibleClipCount: number;
}

const SOURCE_TIMING_EPSILON = 0.001;

function addReason(reasons: Set<string>, reason: string): void {
  reasons.add(reason);
}

function hasThumbnailVisuals(clip: TimelineClipCanvasWorkerSourceClip): boolean {
  if ((clip.thumbnails?.length ?? 0) > 0) return true;
  if (clip.source?.type !== 'video') return false;
  return Boolean(clip.source.mediaFileId ?? clip.mediaFileId);
}

function hasSourceTimingVisuals(clip: TimelineClipCanvasWorkerSourceClip): boolean {
  if (clip.reversed) return true;
  const inPoint = clip.inPoint ?? 0;
  if (Math.abs(inPoint) > SOURCE_TIMING_EPSILON) return true;
  if (typeof clip.outPoint !== 'number') return false;
  return Math.abs((clip.outPoint - inPoint) - clip.duration) > SOURCE_TIMING_EPSILON;
}

function hasSourceTimingFallbackVisuals(
  clip: TimelineClipCanvasWorkerSourceClip,
  input: TimelineClipCanvasWorkerEligibilityInput,
  preparedResources: TimelineClipCanvasWorkerPreparedClipResources | undefined,
): boolean {
  if (!hasSourceTimingVisuals(clip)) return false;
  if (clip.reversed && hasThumbnailVisuals(clip)) {
    return !hasPreparedThumbnailVisuals(clip, input, preparedResources);
  }
  if (clip.reversed) return false;
  if (hasThumbnailVisuals(clip)) {
    return !hasPreparedThumbnailVisuals(clip, input, preparedResources);
  }
  return false;
}

function hasCompositionVisuals(clip: TimelineClipCanvasWorkerSourceClip): boolean {
  return Boolean(
    clip.isComposition ||
      clip.compositionId ||
      (clip.clipSegments?.length ?? 0) > 0 ||
      (clip.nestedClipBoundaries?.length ?? 0) > 0 ||
      (clip.mixdownWaveform?.length ?? 0) > 0 ||
      clip.mixdownGenerating ||
      clip.hasMixdownAudio,
  );
}

function isWorkerAudioClip(clip: TimelineClipCanvasWorkerSourceClip): boolean {
  return isTimelineClipCanvasAudioClip(clip);
}

function hasMidiPreviewVisuals(clip: TimelineClipCanvasWorkerSourceClip): boolean {
  return (clip.source?.type === 'midi' || clip.trackType === 'midi') &&
    (clip.midiData?.notes?.length ?? 0) > 0;
}

function hasPreparedThumbnailVisuals(
  clip: TimelineClipCanvasWorkerSourceClip,
  input: TimelineClipCanvasWorkerEligibilityInput,
  preparedResources: TimelineClipCanvasWorkerPreparedClipResources | undefined,
): boolean {
  return Boolean(
    preparedResources?.thumbnailStrip ||
      input.preparedThumbnailClipIds?.has(clip.id),
  );
}

function hasAudioResourceVisuals(
  clip: TimelineClipCanvasWorkerSourceClip,
  input: TimelineClipCanvasWorkerEligibilityInput,
  preparedResources: TimelineClipCanvasWorkerPreparedClipResources | undefined,
): boolean {
  const hasPreparedWaveform = Boolean(preparedResources?.waveform);
  const hasPreparedSpectrogram = Boolean(preparedResources?.spectrogram);
  const needsSpectrogram = input.waveformsEnabled && input.audioDisplayMode === 'spectral' && isWorkerAudioClip(clip);
  const hasAudioAnalysisRef = hasTimelineClipCanvasAudioAnalysisRef(clip);
  return Boolean(
    ((clip.waveform?.length ?? 0) > 0 && !hasPreparedWaveform && !needsSpectrogram) ||
      ((clip.waveformChannels?.length ?? 0) > 0 && !hasPreparedWaveform && !needsSpectrogram) ||
      clip.waveformGenerating ||
      clip.waveformProgress !== undefined ||
      (hasAudioAnalysisRef && !hasPreparedSpectrogram && !hasPreparedWaveform),
  );
}

function clonePreparedWaveformResource(
  waveform: TimelineClipCanvasWorkerPreparedWaveformResource,
): TimelineClipCanvasWorkerWaveformResource {
  return {
    kind: 'waveform',
    columns: waveform.columns instanceof Float32Array
      ? new Float32Array(waveform.columns)
      : Float32Array.from(waveform.columns),
    columnCount: waveform.columnCount,
    mode: waveform.mode,
  };
}

function clonePreparedSpectrogramResource(
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

function clonePreparedMidiPreviewResource(
  midiPreview: TimelineClipCanvasWorkerMidiPreviewResource,
): TimelineClipCanvasWorkerMidiPreviewResource {
  return {
    kind: 'midi-preview',
    bars: new Float32Array(midiPreview.bars),
    barCount: midiPreview.barCount,
    mode: midiPreview.mode,
  };
}

function clonePreparedCompositionVisualsResource(
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

function clonePassiveDecorationsResource(
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

function getPreparedThumbnailStripResource(
  thumbnailStrip: TimelineClipCanvasWorkerPreparedThumbnailStripResource,
): TimelineClipCanvasWorkerThumbnailStripResource {
  return thumbnailStrip;
}

function cloneTrimVisualsResource(
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

function clonePreparedFadeVisualsResource(
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

export function getTimelineClipCanvasWorkerEligibility(
  input: TimelineClipCanvasWorkerEligibilityInput,
): TimelineClipCanvasWorkerEligibility {
  const reasons = new Set<string>();

  if (input.hasClipTrim) {
    if (!input.activeTrimClipId) {
      addReason(reasons, 'clip-trim-active');
    } else {
      const activeTrimClip = input.clips.find((clip) => clip.id === input.activeTrimClipId);
      const preparedTrimVisuals = activeTrimClip
        ? input.preparedResourcesByClipId?.get(activeTrimClip.id)?.trimVisuals
        : undefined;
      if (activeTrimClip && !preparedTrimVisuals) {
        addReason(reasons, 'clip-trim-active');
      }
    }
  }

  for (const clip of input.clips) {
    const preparedResources = input.preparedResourcesByClipId?.get(clip.id);
    const hasPassiveDecorationsForClip = input.passiveDecorationClipIds
      ? input.passiveDecorationClipIds.has(clip.id)
      : Boolean(input.hasPassiveDecorations);
    if (hasPassiveDecorationsForClip && !preparedResources?.passiveDecorations) {
      addReason(reasons, 'passive-decorations');
    }
    if (hasThumbnailVisuals(clip) && !hasPreparedThumbnailVisuals(clip, input, preparedResources)) {
      addReason(reasons, 'thumbnail-visuals');
    }
    if (hasSourceTimingFallbackVisuals(clip, input, preparedResources)) addReason(reasons, 'source-timing-visuals');
    if (hasCompositionVisuals(clip) && !preparedResources?.compositionVisuals) addReason(reasons, 'composition-visuals');
    if (hasAudioResourceVisuals(clip, input, preparedResources)) addReason(reasons, 'audio-resource-visuals');
    if (input.waveformsEnabled && input.audioDisplayMode === 'spectral' && isWorkerAudioClip(clip) && !preparedResources?.spectrogram) {
      addReason(reasons, 'spectrogram-resource-missing');
    }
    if (hasMidiPreviewVisuals(clip) && !preparedResources?.midiPreview) {
      addReason(reasons, 'midi-preview');
    }
    if ((clip.fade?.keyframes?.length ?? 0) >= 2 && !preparedResources?.fadeVisuals) {
      addReason(reasons, 'fade-visuals');
    }
  }

  return {
    eligible: reasons.size === 0,
    reasons: Array.from(reasons).sort(),
  };
}

export function buildTimelineClipCanvasWorkerDrawMessage(
  input: TimelineClipCanvasWorkerBuildInput,
): TimelineClipCanvasWorkerBuildResult {
  const eligibility = getTimelineClipCanvasWorkerEligibility(input);
  if (!eligibility.eligible) {
    return {
      eligibility,
      message: null,
      transferables: [],
      inputClipCount: input.clips.length,
      visibleClipCount: 0,
    };
  }

  const workerClips: TimelineClipCanvasWorkerClip[] = [];
  const transferables: Transferable[] = [];
  for (const clip of input.clips) {
    const preparedResources = input.preparedResourcesByClipId?.get(clip.id);
    const trimVisuals = preparedResources?.trimVisuals
      ? cloneTrimVisualsResource(preparedResources.trimVisuals)
      : undefined;
    const fadeVisuals = preparedResources?.fadeVisuals
      ? clonePreparedFadeVisualsResource(preparedResources.fadeVisuals)
      : undefined;
    const compositionVisuals = preparedResources?.compositionVisuals
      ? clonePreparedCompositionVisualsResource(preparedResources.compositionVisuals)
      : undefined;
    const absoluteX = input.timeToPixel(clip.startTime);
    const absoluteRight = input.timeToPixel(clip.startTime + clip.duration);
    const rawWidth = Math.max(0, absoluteRight - absoluteX);
    const rawX = absoluteX - input.canvasOffsetX;
    const width = Math.max(0, trimVisuals?.body.width ?? rawWidth);
    const x = trimVisuals?.body.x ?? rawX;
    const cullLeft = Math.min(
      x,
      ...(trimVisuals?.sourceExtensionGhosts?.map((ghost) => ghost.x) ?? []),
    );
    const cullRight = Math.max(
      x + width,
      ...(trimVisuals?.sourceExtensionGhosts?.map((ghost) => ghost.x + ghost.width) ?? []),
    );
    if (width <= 0 || cullRight < 0 || cullLeft > input.cssWidth) continue;
    const thumbnailStrip = preparedResources?.thumbnailStrip
      ? getPreparedThumbnailStripResource(preparedResources.thumbnailStrip)
      : undefined;
    const waveform = preparedResources?.waveform
      ? clonePreparedWaveformResource(preparedResources.waveform)
      : undefined;
    const spectrogram = preparedResources?.spectrogram
      ? clonePreparedSpectrogramResource(preparedResources.spectrogram)
      : undefined;
    const midiPreview = preparedResources?.midiPreview
      ? clonePreparedMidiPreviewResource(preparedResources.midiPreview)
      : undefined;
    if (waveform) {
      transferables.push(waveform.columns.buffer);
    }
    if (spectrogram) {
      transferables.push(spectrogram.values.buffer);
    }
    if (midiPreview) {
      transferables.push(midiPreview.bars.buffer);
    }
    if (compositionVisuals?.nestedBoundaries) {
      transferables.push(compositionVisuals.nestedBoundaries.buffer);
    }
    if (compositionVisuals?.segmentRects) {
      transferables.push(compositionVisuals.segmentRects.buffer);
    }
    if (compositionVisuals?.segmentThumbnailStrip) {
      transferables.push(compositionVisuals.segmentThumbnailStrip.bitmap);
    }
    if (compositionVisuals?.mixdownWaveform) {
      transferables.push(compositionVisuals.mixdownWaveform.columns.buffer);
    }
    const passiveDecorations = preparedResources?.passiveDecorations
      ? clonePassiveDecorationsResource(preparedResources.passiveDecorations)
      : undefined;
    if (passiveDecorations?.transcriptMarkers) {
      transferables.push(passiveDecorations.transcriptMarkers.buffer);
    }
    if (passiveDecorations?.analysisOverlay) {
      transferables.push(passiveDecorations.analysisOverlay.points.buffer);
    }
    if (fadeVisuals) {
      transferables.push(fadeVisuals.curves.buffer, fadeVisuals.points.buffer);
    }
    if (thumbnailStrip) {
      transferables.push(thumbnailStrip.bitmap);
    }
    const isAudio = isWorkerAudioClip(clip);
    const workerClip: TimelineClipCanvasWorkerClip = {
      id: clip.id,
      name: clip.name,
      x,
      width,
      selected: input.selectedClipIds.has(clip.id),
      hovered: input.hoveredClipId === clip.id,
    };
    if (isAudio) workerClip.isAudio = true;
    if (input.waveformsEnabled && isAudio) workerClip.waveformEnabled = true;
    if (thumbnailStrip) workerClip.thumbnailStrip = thumbnailStrip;
    if (compositionVisuals) workerClip.compositionVisuals = compositionVisuals;
    if (trimVisuals) workerClip.trimVisuals = trimVisuals;
    if (fadeVisuals) workerClip.fadeVisuals = fadeVisuals;
    if (passiveDecorations) workerClip.passiveDecorations = passiveDecorations;
    if (waveform) workerClip.waveform = waveform;
    if (spectrogram) workerClip.spectrogram = spectrogram;
    if (midiPreview) workerClip.midiPreview = midiPreview;
    workerClips.push(workerClip);
  }

  return {
    eligibility,
    message: {
      type: 'draw',
      requestId: input.requestId ?? 0,
      clips: workerClips,
      height: input.height,
      cssWidth: input.cssWidth,
      dpr: input.dpr,
      trackColor: input.trackColor,
    },
    transferables,
    inputClipCount: input.clips.length,
    visibleClipCount: workerClips.length,
  };
}
