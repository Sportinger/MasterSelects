import type {
  TimelineClipCanvasWorkerClip,
  TimelineClipCanvasWorkerCompositionVisualsResource,
  TimelineClipCanvasWorkerDrawMessage,
  TimelineClipCanvasWorkerFadeVisualsResource,
  TimelineClipCanvasWorkerMidiPreviewResource,
  TimelineClipCanvasWorkerPassiveDecorationsResource,
  TimelineClipCanvasWorkerPaintPayloadTable,
  TimelineClipCanvasWorkerSpectrogramResource,
  TimelineClipCanvasWorkerThumbnailStripResource,
  TimelineClipCanvasWorkerTrimVisualsResource,
  TimelineClipCanvasWorkerWaveformResource,
} from './timelineClipCanvasWorkerContract';
import type {
  TimelineClipCanvasWorkerPaintClipInput,
} from './timelineClipCanvasWorkerPaintClip';
import {
  clonePassiveDecorationsResource,
  clonePreparedCompositionVisualsResource,
  clonePreparedFadeVisualsResource,
  clonePreparedMidiPreviewResource,
  clonePreparedSpectrogramResource,
  clonePreparedWaveformResource,
  cloneTrimVisualsResource,
  getPreparedThumbnailStripResource,
  type TimelineClipCanvasWorkerPreparedClipResources,
} from './timelineClipCanvasWorkerPreparedResources';
import {
  buildTimelinePaintPacket,
  buildTimelinePaintResourceTable,
  createTimelineRect,
  type BuildTimelinePaintPacketFacetInput,
  type TimelinePaintResourceKind,
  type TimelinePaintResourceRef,
} from '../../../timeline';

export type {
  TimelineClipCanvasWorkerPaintClipInput,
} from './timelineClipCanvasWorkerPaintClip';

export {
  createTimelineClipCanvasWorkerPaintClipInput,
} from './timelineClipCanvasWorkerPaintClip';

export type {
  TimelineClipCanvasWorkerPreparedClipResources,
  TimelineClipCanvasWorkerPreparedCompositionVisualsResource,
  TimelineClipCanvasWorkerPreparedFadeVisualsResource,
  TimelineClipCanvasWorkerPreparedSpectrogramResource,
  TimelineClipCanvasWorkerPreparedThumbnailStripResource,
  TimelineClipCanvasWorkerPreparedWaveformResource,
} from './timelineClipCanvasWorkerPreparedResources';

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

export interface TimelineClipCanvasWorkerEligibilityInput {
  clips: readonly TimelineClipCanvasWorkerPaintClipInput[];
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

export interface TimelineClipCanvasWorkerBuildInput extends TimelineClipCanvasWorkerEligibilityInput {
  trackId?: string;
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

function addReason(reasons: Set<string>, reason: string): void {
  reasons.add(reason);
}

function hasSourceTimingFallbackVisuals(
  clip: TimelineClipCanvasWorkerPaintClipInput,
  input: TimelineClipCanvasWorkerEligibilityInput,
  preparedResources: TimelineClipCanvasWorkerPreparedClipResources | undefined,
): boolean {
  if (!clip.visuals.sourceTimingNeedsThumbnail) return false;
  return !hasPreparedThumbnailVisuals(clip, input, preparedResources);
}

function hasPreparedThumbnailVisuals(
  clip: TimelineClipCanvasWorkerPaintClipInput,
  input: TimelineClipCanvasWorkerEligibilityInput,
  preparedResources: TimelineClipCanvasWorkerPreparedClipResources | undefined,
): boolean {
  return Boolean(
    preparedResources?.thumbnailStrip ||
      input.preparedThumbnailClipIds?.has(clip.id),
  );
}

function hasAudioResourceVisuals(
  clip: TimelineClipCanvasWorkerPaintClipInput,
  input: TimelineClipCanvasWorkerEligibilityInput,
  preparedResources: TimelineClipCanvasWorkerPreparedClipResources | undefined,
): boolean {
  const hasPreparedWaveform = Boolean(preparedResources?.waveform);
  const hasPreparedSpectrogram = Boolean(preparedResources?.spectrogram);
  const needsSpectrogram = input.waveformsEnabled && input.audioDisplayMode === 'spectral' && clip.isAudio;
  return Boolean(
    (clip.visuals.audioResource.waveformLike && !hasPreparedWaveform && !needsSpectrogram) ||
      (clip.visuals.audioResource.analysisRef && !hasPreparedSpectrogram && !hasPreparedWaveform),
  );
}

function createTimelinePaintResourceRef(
  clipId: string,
  kind: TimelinePaintResourceKind,
  transferMode: TimelinePaintResourceRef['transferMode'],
  options: {
    idSuffix?: string;
    byteEstimate?: number;
  } = {},
): TimelinePaintResourceRef {
  return {
    id: `${clipId}:${options.idSuffix ?? kind}`,
    kind,
    ownerClipId: clipId,
    byteEstimate: options.byteEstimate,
    transferMode,
  };
}

interface WorkerClipPaintPacketResult {
  paintPacket: TimelineClipCanvasWorkerClip['paintPacket'];
  resources: TimelinePaintResourceRef[];
}

function createWorkerClipPaintPacket(input: {
  clip: TimelineClipCanvasWorkerPaintClipInput;
  trackId: string;
  geometryEpoch: string;
  x: number;
  width: number;
  height: number;
  selected: boolean;
  hovered: boolean;
  isAudio: boolean;
  waveformsEnabled?: boolean;
  thumbnailStrip?: TimelineClipCanvasWorkerThumbnailStripResource;
  compositionVisuals?: TimelineClipCanvasWorkerCompositionVisualsResource;
  trimVisuals?: TimelineClipCanvasWorkerTrimVisualsResource;
  fadeVisuals?: TimelineClipCanvasWorkerFadeVisualsResource;
  passiveDecorations?: TimelineClipCanvasWorkerPassiveDecorationsResource;
  waveform?: TimelineClipCanvasWorkerWaveformResource;
  spectrogram?: TimelineClipCanvasWorkerSpectrogramResource;
  midiPreview?: TimelineClipCanvasWorkerMidiPreviewResource;
}): WorkerClipPaintPacketResult {
  const resources: TimelinePaintResourceRef[] = [];
  const facets: BuildTimelinePaintPacketFacetInput[] = [
    { kind: 'body' },
    { kind: 'label' },
  ];
  const addResource = (
    kind: TimelinePaintResourceKind,
    transferMode: TimelinePaintResourceRef['transferMode'],
    options?: {
      idSuffix?: string;
      byteEstimate?: number;
    },
  ) => {
    const resource = createTimelinePaintResourceRef(input.clip.id, kind, transferMode, options);
    resources.push(resource);
    return resource.id;
  };
  const addFacet = (
    kind: BuildTimelinePaintPacketFacetInput['kind'],
    resourceRefIds: readonly string[] = [],
  ) => facets.push({ kind, resourceRefIds });

  if (input.thumbnailStrip) {
    addFacet('thumbnail-strip', [
      addResource('thumbnail-bitmap', 'transfer', {
        byteEstimate: input.thumbnailStrip.bitmap.width * input.thumbnailStrip.bitmap.height * 4,
      }),
    ]);
  }
  if (input.waveformsEnabled && input.isAudio) {
    addFacet('waveform', input.waveform
      ? [addResource('waveform-columns', 'transfer', { byteEstimate: input.waveform.columns.byteLength })]
      : []);
  }
  if (input.spectrogram) {
    addFacet('spectrogram', [
      addResource('spectrogram-raster', 'transfer', { byteEstimate: input.spectrogram.values.byteLength }),
    ]);
  }
  if (input.midiPreview) {
    addFacet('midi-preview', [
      addResource('midi-bars', 'transfer', { byteEstimate: input.midiPreview.bars.byteLength }),
    ]);
  }
  if (input.compositionVisuals) {
    const refs = [
      input.compositionVisuals.nestedBoundaries || input.compositionVisuals.segmentRects
        ? addResource('composition-segments', 'transfer', {
          byteEstimate: (input.compositionVisuals.nestedBoundaries?.byteLength ?? 0) +
            (input.compositionVisuals.segmentRects?.byteLength ?? 0),
        })
        : null,
      input.compositionVisuals.segmentThumbnailStrip
        ? addResource('thumbnail-bitmap', 'transfer', {
          idSuffix: 'composition-thumbnail-bitmap',
          byteEstimate: input.compositionVisuals.segmentThumbnailStrip.bitmap.width *
            input.compositionVisuals.segmentThumbnailStrip.bitmap.height *
            4,
        })
        : null,
      input.compositionVisuals.mixdownWaveform
        ? addResource('waveform-columns', 'transfer', {
          idSuffix: 'composition-mixdown-waveform-columns',
          byteEstimate: input.compositionVisuals.mixdownWaveform.columns.byteLength,
        })
        : null,
    ].filter((ref): ref is string => Boolean(ref));
    addFacet('composition-visuals', refs);
  }
  if (input.passiveDecorations) {
    const refs = [
      input.passiveDecorations.transcriptMarkers
        ? addResource('transcript-markers', 'transfer', {
          byteEstimate: input.passiveDecorations.transcriptMarkers.byteLength,
        })
        : null,
      input.passiveDecorations.analysisOverlay
        ? addResource('analysis-overlay', 'transfer', {
          byteEstimate: input.passiveDecorations.analysisOverlay.points.byteLength,
        })
        : null,
    ].filter((ref): ref is string => Boolean(ref));
    addFacet('passive-decorations', refs);
  }
  if (input.trimVisuals) {
    addFacet('trim-visuals', input.trimVisuals.sourceExtensionGhosts ? [addResource('trim-ghosts', 'copy')] : []);
  }
  if (input.fadeVisuals) {
    addFacet('fade-visuals', [
      addResource('fade-curve-points', 'transfer', {
        byteEstimate: input.fadeVisuals.curves.byteLength + input.fadeVisuals.points.byteLength,
      }),
    ]);
  }

  return {
    paintPacket: buildTimelinePaintPacket({
      clipId: input.clip.id,
      trackId: input.trackId,
      geometryEpoch: input.geometryEpoch,
      bodyRect: createTimelineRect(input.x, 0, input.width, input.height),
      label: input.clip.label,
      state: {
        selected: input.selected,
        hovered: input.hovered,
        muted: false,
        disabled: false,
        pending: false,
      },
      facets,
      resources,
    }),
    resources,
  };
}

function createEmptyWorkerPaintPayloadTable(): {
  thumbnailStrips: TimelineClipCanvasWorkerPaintPayloadTable['thumbnailStrips'][number][];
  waveforms: TimelineClipCanvasWorkerPaintPayloadTable['waveforms'][number][];
  spectrograms: TimelineClipCanvasWorkerPaintPayloadTable['spectrograms'][number][];
  midiPreviews: TimelineClipCanvasWorkerPaintPayloadTable['midiPreviews'][number][];
  fadeVisuals: TimelineClipCanvasWorkerPaintPayloadTable['fadeVisuals'][number][];
  trimVisuals: TimelineClipCanvasWorkerPaintPayloadTable['trimVisuals'][number][];
  passiveDecorations: TimelineClipCanvasWorkerPaintPayloadTable['passiveDecorations'][number][];
  compositionVisuals: TimelineClipCanvasWorkerPaintPayloadTable['compositionVisuals'][number][];
} {
  return {
    thumbnailStrips: [],
    waveforms: [],
    spectrograms: [],
    midiPreviews: [],
    fadeVisuals: [],
    trimVisuals: [],
    passiveDecorations: [],
    compositionVisuals: [],
  };
}

function findPaintResourceId(
  resources: readonly TimelinePaintResourceRef[],
  kind: TimelinePaintResourceKind,
  idSuffix: string,
): string | undefined {
  return resources.find((resource) => resource.kind === kind && resource.id.endsWith(`:${idSuffix}`))?.id;
}

function findPaintFacetId(
  paintPacket: TimelineClipCanvasWorkerClip['paintPacket'],
  kind: BuildTimelinePaintPacketFacetInput['kind'],
): string | undefined {
  return paintPacket.facets.find((facet) => facet.kind === kind)?.id;
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
    if (clip.visuals.thumbnail && !hasPreparedThumbnailVisuals(clip, input, preparedResources)) {
      addReason(reasons, 'thumbnail-visuals');
    }
    if (hasSourceTimingFallbackVisuals(clip, input, preparedResources)) addReason(reasons, 'source-timing-visuals');
    if (clip.visuals.composition && !preparedResources?.compositionVisuals) addReason(reasons, 'composition-visuals');
    if (hasAudioResourceVisuals(clip, input, preparedResources)) addReason(reasons, 'audio-resource-visuals');
    if (input.waveformsEnabled && input.audioDisplayMode === 'spectral' && clip.isAudio && !preparedResources?.spectrogram) {
      addReason(reasons, 'spectrogram-resource-missing');
    }
    if (clip.visuals.midiPreview && !preparedResources?.midiPreview) {
      addReason(reasons, 'midi-preview');
    }
    if (clip.visuals.fade && !preparedResources?.fadeVisuals) {
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
  const paintResources: TimelinePaintResourceRef[] = [];
  const paintPayloads = createEmptyWorkerPaintPayloadTable();
  const transferables: Transferable[] = [];
  const geometryEpoch = `worker-draw:${input.requestId ?? 0}:${input.canvasOffsetX}:${input.cssWidth}:${input.height}`;
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
    const paint = createWorkerClipPaintPacket({
      clip,
      trackId: clip.trackId ?? input.trackId ?? 'unknown-track',
      geometryEpoch,
      x,
      width,
      height: input.height,
      selected: input.selectedClipIds.has(clip.id),
      hovered: input.hoveredClipId === clip.id,
      isAudio: clip.isAudio,
      waveformsEnabled: input.waveformsEnabled,
      thumbnailStrip,
      compositionVisuals,
      trimVisuals,
      fadeVisuals,
      passiveDecorations,
      waveform,
      spectrogram,
      midiPreview,
    });
    paintResources.push(...paint.resources);
    const thumbnailResourceId = thumbnailStrip
      ? findPaintResourceId(paint.resources, 'thumbnail-bitmap', 'thumbnail-bitmap')
      : undefined;
    if (thumbnailStrip && thumbnailResourceId) {
      paintPayloads.thumbnailStrips.push({ resourceId: thumbnailResourceId, resource: thumbnailStrip });
    }
    const waveformResourceId = waveform
      ? findPaintResourceId(paint.resources, 'waveform-columns', 'waveform-columns')
      : undefined;
    if (waveform && waveformResourceId) {
      paintPayloads.waveforms.push({ resourceId: waveformResourceId, resource: waveform });
    }
    const spectrogramResourceId = spectrogram
      ? findPaintResourceId(paint.resources, 'spectrogram-raster', 'spectrogram-raster')
      : undefined;
    if (spectrogram && spectrogramResourceId) {
      paintPayloads.spectrograms.push({ resourceId: spectrogramResourceId, resource: spectrogram });
    }
    const midiPreviewResourceId = midiPreview
      ? findPaintResourceId(paint.resources, 'midi-bars', 'midi-bars')
      : undefined;
    if (midiPreview && midiPreviewResourceId) {
      paintPayloads.midiPreviews.push({ resourceId: midiPreviewResourceId, resource: midiPreview });
    }
    const fadeVisualsResourceId = fadeVisuals
      ? findPaintResourceId(paint.resources, 'fade-curve-points', 'fade-curve-points')
      : undefined;
    if (fadeVisuals && fadeVisualsResourceId) {
      paintPayloads.fadeVisuals.push({ resourceId: fadeVisualsResourceId, resource: fadeVisuals });
    }
    const trimFacetId = trimVisuals ? findPaintFacetId(paint.paintPacket, 'trim-visuals') : undefined;
    if (trimVisuals && trimFacetId) {
      paintPayloads.trimVisuals.push({ facetId: trimFacetId, resource: trimVisuals });
    }
    const passiveDecorationsFacetId = passiveDecorations
      ? findPaintFacetId(paint.paintPacket, 'passive-decorations')
      : undefined;
    if (passiveDecorations && passiveDecorationsFacetId) {
      paintPayloads.passiveDecorations.push({ facetId: passiveDecorationsFacetId, resource: passiveDecorations });
    }
    const compositionVisualsFacetId = compositionVisuals
      ? findPaintFacetId(paint.paintPacket, 'composition-visuals')
      : undefined;
    if (compositionVisuals && compositionVisualsFacetId) {
      paintPayloads.compositionVisuals.push({ facetId: compositionVisualsFacetId, resource: compositionVisuals });
    }
    const workerClip: TimelineClipCanvasWorkerClip = {
      id: clip.id,
      paintPacket: paint.paintPacket,
      bodyFill: clip.bodyFill,
    };
    workerClips.push(workerClip);
  }

  return {
    eligibility,
    message: {
      type: 'draw',
      requestId: input.requestId ?? 0,
      clips: workerClips,
      paintResources: buildTimelinePaintResourceTable(paintResources),
      paintPayloads,
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
