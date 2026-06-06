import type {
  AudioAnalysisArtifactKind,
  MediaFileAudioAnalysisRefs,
} from '../../types/audio';

export type TimelineCacheSchedulerLane =
  | 'thumbnail-db-load'
  | 'thumbnail-generation'
  | 'thumbnail-bitmap-decode'
  | 'waveform-artifact-load'
  | 'source-waveform-generation'
  | 'processed-waveform-derivation'
  | 'spectrogram-tile-artifact-load'
  | 'spectrogram-tile-generation'
  | 'loudness-envelope-artifact-load'
  | 'loudness-envelope-generation'
  | 'beat-onset-artifact-load'
  | 'beat-onset-generation'
  | 'frequency-phase-artifact-load'
  | 'frequency-phase-generation';

export type TimelineCacheLaneGroup =
  | 'thumbnail'
  | 'waveform'
  | 'spectrogram'
  | 'loudness'
  | 'beat-onset'
  | 'frequency-phase';

export type TimelineCacheLaneOperation =
  | 'load'
  | 'generate'
  | 'decode'
  | 'derive';

export type TimelineCacheLanePriority =
  | 'visible'
  | 'near-visible'
  | 'background';

export type TimelineCacheMediaElementPolicy =
  | 'forbidden'
  | 'detached-background-only';

export type TimelineCacheCoalescingScope =
  | 'media-source-id'
  | 'file-hash'
  | 'thumbnail-url'
  | 'audio-artifact-ref-id'
  | 'audio-source-fingerprint'
  | 'clip-audio-state-hash'
  | 'audio-ref-group'
  | 'clip-id';

export type TimelineCacheCoalescingField =
  | 'mediaFileId'
  | 'fileHash'
  | 'thumbnailUrl'
  | 'artifactRefId'
  | 'sourceFingerprint'
  | 'clipAudioStateHash'
  | 'clipId';

export interface TimelineCacheLaneDescriptor {
  lane: TimelineCacheSchedulerLane;
  group: TimelineCacheLaneGroup;
  operation: TimelineCacheLaneOperation;
  label: string;
  priority: TimelineCacheLanePriority;
  mediaElementPolicy: TimelineCacheMediaElementPolicy;
  coalescingScopes: readonly TimelineCacheCoalescingScope[];
  coalescingFields: readonly TimelineCacheCoalescingField[];
}

export interface TimelineCacheCoalescingKey {
  lane: TimelineCacheSchedulerLane;
  scope: TimelineCacheCoalescingScope;
  id: string;
  variant?: string;
}

export type TimelineCacheInvalidationReason =
  | 'media-delete'
  | 'source-replace'
  | 'project-close';

export type TimelineCacheInvalidationService =
  | 'thumbnailCacheService'
  | 'thumbnailBitmapCache'
  | 'timelineWaveformPyramidCache'
  | 'timelineSpectrogramCache'
  | 'timelineLoudnessEnvelopeCache'
  | 'timelineBeatOnsetCache'
  | 'timelineFrequencyPhaseCache'
  | 'clipAudioAnalysisJobService'
  | 'audioArtifactStore';

export type TimelineCacheInvalidationActionType =
  | 'abort-queued-work'
  | 'clear-source-thumbnails'
  | 'evict-memory'
  | 'close-decoded-resources'
  | 'cancel-analysis-jobs'
  | 'preserve-shared-artifacts';

export type TimelineCacheInvalidationPersistence =
  | 'memory-only'
  | 'memory-and-persistent'
  | 'preserve-when-shared';

export type TimelineAudioCacheArtifactKind = Extract<
  AudioAnalysisArtifactKind,
  | 'waveform-pyramid'
  | 'processed-waveform-pyramid'
  | 'spectrogram-tiles'
  | 'loudness-envelope'
  | 'beat-grid'
  | 'onset-map'
  | 'phase-correlation'
  | 'frequency-summary'
>;

export interface TimelineAudioCacheRefSet {
  waveformPyramidIds?: readonly string[];
  processedWaveformPyramidIds?: readonly string[];
  spectrogramTileSetIds?: readonly string[];
  loudnessEnvelopeIds?: readonly string[];
  beatGridIds?: readonly string[];
  onsetMapIds?: readonly string[];
  phaseCorrelationIds?: readonly string[];
  frequencySummaryIds?: readonly string[];
}

export interface TimelineCacheInvalidationInput {
  reason: TimelineCacheInvalidationReason;
  mediaFileId: string;
  fileHash?: string;
  replacementMediaFileId?: string;
  clipIds?: readonly string[];
  sourceAudioAnalysisRefs?: MediaFileAudioAnalysisRefs;
  processedAudioAnalysisRefs?: MediaFileAudioAnalysisRefs;
  explicitAudioRefs?: TimelineAudioCacheRefSet;
  sharedArtifactRefIds?: readonly string[];
  preserveSharedFileHashArtifacts?: boolean;
}

export interface TimelineCacheInvalidationTarget {
  mediaFileId?: string;
  fileHash?: string;
  replacementMediaFileId?: string;
  clipIds?: readonly string[];
  refIds?: readonly string[];
  artifactKinds?: readonly TimelineAudioCacheArtifactKind[];
}

export interface TimelineCacheInvalidationAction {
  type: TimelineCacheInvalidationActionType;
  service: TimelineCacheInvalidationService;
  lanes: readonly TimelineCacheSchedulerLane[];
  target: TimelineCacheInvalidationTarget;
  persistence: TimelineCacheInvalidationPersistence;
  requiredApi?: string;
  note?: string;
}

export interface TimelineCacheInvalidationPlan {
  reason: TimelineCacheInvalidationReason;
  mediaFileId: string;
  replacementMediaFileId?: string;
  actions: readonly TimelineCacheInvalidationAction[];
}
