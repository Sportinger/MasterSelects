import type {
  TimelineAudioCacheRefSet,
  TimelineCacheCoalescingKey,
  TimelineCacheCoalescingScope,
  TimelineCacheInvalidationAction,
  TimelineCacheInvalidationInput,
  TimelineCacheInvalidationPlan,
  TimelineCacheLaneDescriptor,
  TimelineCacheSchedulerLane,
} from './cacheSchedulerTypes';

export const TIMELINE_CACHE_LANE_DESCRIPTORS = [
  {
    lane: 'thumbnail-db-load',
    group: 'thumbnail',
    operation: 'load',
    label: 'Thumbnail DB load',
    priority: 'visible',
    mediaElementPolicy: 'forbidden',
    coalescingScopes: ['media-source-id', 'file-hash'],
    coalescingFields: ['mediaFileId', 'fileHash'],
  },
  {
    lane: 'thumbnail-generation',
    group: 'thumbnail',
    operation: 'generate',
    label: 'Thumbnail generation',
    priority: 'background',
    mediaElementPolicy: 'detached-background-only',
    coalescingScopes: ['media-source-id', 'file-hash'],
    coalescingFields: ['mediaFileId', 'fileHash'],
  },
  {
    lane: 'thumbnail-bitmap-decode',
    group: 'thumbnail',
    operation: 'decode',
    label: 'Thumbnail bitmap decode',
    priority: 'visible',
    mediaElementPolicy: 'forbidden',
    coalescingScopes: ['thumbnail-url'],
    coalescingFields: ['thumbnailUrl'],
  },
  {
    lane: 'waveform-artifact-load',
    group: 'waveform',
    operation: 'load',
    label: 'Waveform artifact load',
    priority: 'visible',
    mediaElementPolicy: 'forbidden',
    coalescingScopes: ['audio-artifact-ref-id'],
    coalescingFields: ['artifactRefId'],
  },
  {
    lane: 'source-waveform-generation',
    group: 'waveform',
    operation: 'generate',
    label: 'Source waveform generation',
    priority: 'background',
    mediaElementPolicy: 'forbidden',
    coalescingScopes: ['media-source-id', 'audio-source-fingerprint'],
    coalescingFields: ['mediaFileId', 'sourceFingerprint'],
  },
  {
    lane: 'processed-waveform-derivation',
    group: 'waveform',
    operation: 'derive',
    label: 'Processed waveform derivation',
    priority: 'background',
    mediaElementPolicy: 'forbidden',
    coalescingScopes: ['audio-artifact-ref-id', 'clip-audio-state-hash'],
    coalescingFields: ['artifactRefId', 'clipAudioStateHash'],
  },
  {
    lane: 'spectrogram-tile-artifact-load',
    group: 'spectrogram',
    operation: 'load',
    label: 'Spectrogram tile artifact load',
    priority: 'near-visible',
    mediaElementPolicy: 'forbidden',
    coalescingScopes: ['audio-artifact-ref-id', 'audio-ref-group'],
    coalescingFields: ['artifactRefId'],
  },
  {
    lane: 'spectrogram-tile-generation',
    group: 'spectrogram',
    operation: 'generate',
    label: 'Spectrogram tile generation',
    priority: 'background',
    mediaElementPolicy: 'forbidden',
    coalescingScopes: ['media-source-id', 'clip-audio-state-hash'],
    coalescingFields: ['mediaFileId', 'clipAudioStateHash'],
  },
  {
    lane: 'loudness-envelope-artifact-load',
    group: 'loudness',
    operation: 'load',
    label: 'Loudness envelope artifact load',
    priority: 'near-visible',
    mediaElementPolicy: 'forbidden',
    coalescingScopes: ['audio-artifact-ref-id'],
    coalescingFields: ['artifactRefId'],
  },
  {
    lane: 'loudness-envelope-generation',
    group: 'loudness',
    operation: 'generate',
    label: 'Loudness envelope generation',
    priority: 'background',
    mediaElementPolicy: 'forbidden',
    coalescingScopes: ['media-source-id', 'clip-audio-state-hash'],
    coalescingFields: ['mediaFileId', 'clipAudioStateHash'],
  },
  {
    lane: 'beat-onset-artifact-load',
    group: 'beat-onset',
    operation: 'load',
    label: 'Beat/onset artifact load',
    priority: 'near-visible',
    mediaElementPolicy: 'forbidden',
    coalescingScopes: ['audio-artifact-ref-id', 'audio-ref-group'],
    coalescingFields: ['artifactRefId'],
  },
  {
    lane: 'beat-onset-generation',
    group: 'beat-onset',
    operation: 'generate',
    label: 'Beat/onset generation',
    priority: 'background',
    mediaElementPolicy: 'forbidden',
    coalescingScopes: ['media-source-id', 'clip-audio-state-hash'],
    coalescingFields: ['mediaFileId', 'clipAudioStateHash'],
  },
  {
    lane: 'frequency-phase-artifact-load',
    group: 'frequency-phase',
    operation: 'load',
    label: 'Frequency/phase artifact load',
    priority: 'near-visible',
    mediaElementPolicy: 'forbidden',
    coalescingScopes: ['audio-artifact-ref-id', 'audio-ref-group'],
    coalescingFields: ['artifactRefId'],
  },
  {
    lane: 'frequency-phase-generation',
    group: 'frequency-phase',
    operation: 'generate',
    label: 'Frequency/phase generation',
    priority: 'background',
    mediaElementPolicy: 'forbidden',
    coalescingScopes: ['media-source-id', 'clip-audio-state-hash'],
    coalescingFields: ['mediaFileId', 'clipAudioStateHash'],
  },
] as const satisfies readonly TimelineCacheLaneDescriptor[];

export const TIMELINE_CACHE_SCHEDULER_LANES = TIMELINE_CACHE_LANE_DESCRIPTORS
  .map((descriptor) => descriptor.lane) as readonly TimelineCacheSchedulerLane[];

const ALL_AUDIO_LANES = [
  'waveform-artifact-load',
  'source-waveform-generation',
  'processed-waveform-derivation',
  'spectrogram-tile-artifact-load',
  'spectrogram-tile-generation',
  'loudness-envelope-artifact-load',
  'loudness-envelope-generation',
  'beat-onset-artifact-load',
  'beat-onset-generation',
  'frequency-phase-artifact-load',
  'frequency-phase-generation',
] as const satisfies readonly TimelineCacheSchedulerLane[];

export function getTimelineCacheLaneDescriptor(
  lane: TimelineCacheSchedulerLane,
): TimelineCacheLaneDescriptor {
  const descriptor = TIMELINE_CACHE_LANE_DESCRIPTORS.find((candidate) => candidate.lane === lane);
  if (!descriptor) {
    throw new Error(`Unknown timeline cache scheduler lane: ${lane}`);
  }
  return descriptor;
}

export function createTimelineCacheCoalescingKey(input: TimelineCacheCoalescingKey): TimelineCacheCoalescingKey {
  return input.variant
    ? {
        lane: input.lane,
        scope: input.scope,
        id: input.id,
        variant: input.variant,
      }
    : {
        lane: input.lane,
        scope: input.scope,
        id: input.id,
      };
}

export function formatTimelineCacheCoalescingKey(key: TimelineCacheCoalescingKey): string {
  const variant = key.variant ? `:${encodeURIComponent(key.variant)}` : '';
  return `${key.lane}:${key.scope}:${encodeURIComponent(key.id)}${variant}`;
}

export function createSourceCoalescingKey(
  lane: TimelineCacheSchedulerLane,
  mediaFileId: string,
  variant?: string,
): TimelineCacheCoalescingKey {
  return createTimelineCacheCoalescingKey({
    lane,
    scope: 'media-source-id',
    id: mediaFileId,
    variant,
  });
}

export function createThumbnailDbLoadCoalescingKey(
  mediaFileId: string,
  fileHash?: string,
): TimelineCacheCoalescingKey {
  return createSourceCoalescingKey('thumbnail-db-load', mediaFileId, fileHash);
}

export function createThumbnailGenerationCoalescingKey(
  mediaFileId: string,
  fileHash?: string,
): TimelineCacheCoalescingKey {
  return createSourceCoalescingKey('thumbnail-generation', mediaFileId, fileHash);
}

export function createArtifactRefCoalescingKey(
  lane: TimelineCacheSchedulerLane,
  refId: string,
  variant?: string,
): TimelineCacheCoalescingKey {
  return createTimelineCacheCoalescingKey({
    lane,
    scope: 'audio-artifact-ref-id',
    id: refId,
    variant,
  });
}

export function createThumbnailUrlCoalescingKey(
  thumbnailUrl: string,
): TimelineCacheCoalescingKey {
  return createTimelineCacheCoalescingKey({
    lane: 'thumbnail-bitmap-decode',
    scope: 'thumbnail-url',
    id: thumbnailUrl,
  });
}

export function isTimelineCacheCoalescingScopeAllowed(
  lane: TimelineCacheSchedulerLane,
  scope: TimelineCacheCoalescingScope,
): boolean {
  return getTimelineCacheLaneDescriptor(lane).coalescingScopes.includes(scope);
}

export function normalizeTimelineAudioCacheRefs(
  input: Pick<
    TimelineCacheInvalidationInput,
    'sourceAudioAnalysisRefs' | 'processedAudioAnalysisRefs' | 'explicitAudioRefs'
  >,
): Required<TimelineAudioCacheRefSet> {
  return {
    waveformPyramidIds: unique([
      input.sourceAudioAnalysisRefs?.waveformPyramidId,
      ...(input.explicitAudioRefs?.waveformPyramidIds ?? []),
    ]),
    processedWaveformPyramidIds: unique([
      input.processedAudioAnalysisRefs?.processedWaveformPyramidId,
      input.sourceAudioAnalysisRefs?.processedWaveformPyramidId,
      ...(input.explicitAudioRefs?.processedWaveformPyramidIds ?? []),
    ]),
    spectrogramTileSetIds: unique([
      ...(input.sourceAudioAnalysisRefs?.spectrogramTileSetIds ?? []),
      ...(input.processedAudioAnalysisRefs?.spectrogramTileSetIds ?? []),
      ...(input.explicitAudioRefs?.spectrogramTileSetIds ?? []),
    ]),
    loudnessEnvelopeIds: unique([
      input.sourceAudioAnalysisRefs?.loudnessEnvelopeId,
      input.processedAudioAnalysisRefs?.loudnessEnvelopeId,
      ...(input.explicitAudioRefs?.loudnessEnvelopeIds ?? []),
    ]),
    beatGridIds: unique([
      input.sourceAudioAnalysisRefs?.beatGridId,
      input.processedAudioAnalysisRefs?.beatGridId,
      ...(input.explicitAudioRefs?.beatGridIds ?? []),
    ]),
    onsetMapIds: unique([
      input.sourceAudioAnalysisRefs?.onsetMapId,
      input.processedAudioAnalysisRefs?.onsetMapId,
      ...(input.explicitAudioRefs?.onsetMapIds ?? []),
    ]),
    phaseCorrelationIds: unique([
      input.sourceAudioAnalysisRefs?.phaseCorrelationId,
      input.processedAudioAnalysisRefs?.phaseCorrelationId,
      ...(input.explicitAudioRefs?.phaseCorrelationIds ?? []),
    ]),
    frequencySummaryIds: unique([
      input.sourceAudioAnalysisRefs?.frequencySummaryId,
      input.processedAudioAnalysisRefs?.frequencySummaryId,
      ...(input.explicitAudioRefs?.frequencySummaryIds ?? []),
    ]),
  };
}

export function createMediaCacheInvalidationPlan(
  input: TimelineCacheInvalidationInput,
): TimelineCacheInvalidationPlan {
  const actions: TimelineCacheInvalidationAction[] = [];
  const deletesPersistentSourceData = input.reason !== 'project-close';
  const baseTarget = {
    mediaFileId: input.mediaFileId,
    ...(input.fileHash ? { fileHash: input.fileHash } : {}),
    ...(input.replacementMediaFileId ? { replacementMediaFileId: input.replacementMediaFileId } : {}),
  };

  actions.push({
    type: 'abort-queued-work',
    service: 'thumbnailCacheService',
    lanes: ['thumbnail-generation'],
    target: baseTarget,
    persistence: 'memory-only',
    requiredApi: 'thumbnailCacheService.abort(mediaFileId)',
  });

  actions.push({
    type: deletesPersistentSourceData ? 'clear-source-thumbnails' : 'evict-memory',
    service: 'thumbnailCacheService',
    lanes: ['thumbnail-db-load', 'thumbnail-generation'],
    target: baseTarget,
    persistence: deletesPersistentSourceData ? 'memory-and-persistent' : 'memory-only',
    requiredApi: deletesPersistentSourceData
      ? 'thumbnailCacheService.clearSource(mediaFileId)'
      : 'thumbnailCacheService.evictFromMemory(mediaFileId)',
    ...(deletesPersistentSourceData
      ? {
          note: 'Guard persistent deletion so file-hash thumbnails are preserved when another media item still references them.',
        }
      : {}),
  });

  actions.push({
    type: 'close-decoded-resources',
    service: 'thumbnailBitmapCache',
    lanes: ['thumbnail-bitmap-decode'],
    target: baseTarget,
    persistence: 'memory-only',
    requiredApi: 'thumbnailBitmapCache.closeSource(mediaFileId) or thumbnailCacheService.evictFromMemory(mediaFileId)',
    note: 'Decoded ImageBitmap resources must be closed before thumbnail blob URLs are revoked.',
  });

  const audioRefs = normalizeTimelineAudioCacheRefs(input);
  addAudioInvalidationAction(actions, {
    service: 'timelineWaveformPyramidCache',
    lanes: ['waveform-artifact-load', 'source-waveform-generation', 'processed-waveform-derivation'],
    artifactKinds: ['waveform-pyramid', 'processed-waveform-pyramid'],
    refIds: [
      ...audioRefs.waveformPyramidIds,
      ...audioRefs.processedWaveformPyramidIds,
    ],
    requiredApi: 'timelineWaveformPyramidCache.evictRefs(refIds)',
  });
  addAudioInvalidationAction(actions, {
    service: 'timelineSpectrogramCache',
    lanes: ['spectrogram-tile-artifact-load', 'spectrogram-tile-generation'],
    artifactKinds: ['spectrogram-tiles'],
    refIds: audioRefs.spectrogramTileSetIds,
    requiredApi: 'timelineSpectrogramCache.evictRefs(refIds)',
  });
  addAudioInvalidationAction(actions, {
    service: 'timelineLoudnessEnvelopeCache',
    lanes: ['loudness-envelope-artifact-load', 'loudness-envelope-generation'],
    artifactKinds: ['loudness-envelope'],
    refIds: audioRefs.loudnessEnvelopeIds,
    requiredApi: 'timelineLoudnessEnvelopeCache.evictRefs(refIds)',
  });
  addAudioInvalidationAction(actions, {
    service: 'timelineBeatOnsetCache',
    lanes: ['beat-onset-artifact-load', 'beat-onset-generation'],
    artifactKinds: ['beat-grid', 'onset-map'],
    refIds: [
      ...audioRefs.beatGridIds,
      ...audioRefs.onsetMapIds,
    ],
    requiredApi: 'timelineBeatOnsetCache.evictRefs(refIds)',
  });
  addAudioInvalidationAction(actions, {
    service: 'timelineFrequencyPhaseCache',
    lanes: ['frequency-phase-artifact-load', 'frequency-phase-generation'],
    artifactKinds: ['frequency-summary', 'phase-correlation'],
    refIds: [
      ...audioRefs.frequencySummaryIds,
      ...audioRefs.phaseCorrelationIds,
    ],
    requiredApi: 'timelineFrequencyPhaseCache.evictRefs(refIds)',
  });

  if (input.clipIds && input.clipIds.length > 0) {
    actions.push({
      type: 'cancel-analysis-jobs',
      service: 'clipAudioAnalysisJobService',
      lanes: ALL_AUDIO_LANES,
      target: {
        ...baseTarget,
        clipIds: [...input.clipIds],
      },
      persistence: 'memory-only',
      requiredApi: 'clipAudioAnalysisJobService.cancelClip(clipId)',
    });
  }

  if (
    input.preserveSharedFileHashArtifacts
    || (input.sharedArtifactRefIds && input.sharedArtifactRefIds.length > 0)
  ) {
    actions.push({
      type: 'preserve-shared-artifacts',
      service: 'audioArtifactStore',
      lanes: ALL_AUDIO_LANES,
      target: {
        ...baseTarget,
        refIds: unique(input.sharedArtifactRefIds ?? []),
      },
      persistence: 'preserve-when-shared',
      requiredApi: 'audioArtifactStore.deleteOnlyUnreferencedArtifacts(refIds, fileHash)',
      note: 'Persistent audio artifacts and file-hash/project-path thumbnail artifacts must survive while another media item still references them.',
    });
  }

  return {
    reason: input.reason,
    mediaFileId: input.mediaFileId,
    ...(input.replacementMediaFileId ? { replacementMediaFileId: input.replacementMediaFileId } : {}),
    actions,
  };
}

function addAudioInvalidationAction(
  actions: TimelineCacheInvalidationAction[],
  action: Pick<
    TimelineCacheInvalidationAction,
    'service' | 'lanes' | 'requiredApi'
  > & {
    artifactKinds: NonNullable<TimelineCacheInvalidationAction['target']['artifactKinds']>;
    refIds: readonly string[];
  },
): void {
  const refIds = unique(action.refIds);
  if (refIds.length === 0) {
    return;
  }

  actions.push({
    type: 'evict-memory',
    service: action.service,
    lanes: action.lanes,
    target: {
      refIds,
      artifactKinds: action.artifactKinds,
    },
    persistence: 'memory-only',
    requiredApi: action.requiredApi,
  });
}

function unique(values: readonly (string | undefined)[]): string[] {
  const seen = new Set<string>();
  for (const value of values) {
    if (value) {
      seen.add(value);
    }
  }
  return [...seen];
}
