import type {
  AudioAnalysisArtifact,
  AudioAnalysisArtifactKind,
  AudioChannelLayout,
} from './audioArtifactTypes';

export const AUDIO_ANALYSIS_CACHE_KEY_VERSION = 1 as const;
export const AUDIO_ANALYSIS_REF_MANIFEST_VERSION = 1 as const;

export const AUDIO_ANALYSIS_REF_KINDS = [
  'waveform-pyramid',
  'processed-waveform-pyramid',
  'spectrogram-tiles',
  'loudness-envelope',
] as const satisfies readonly AudioAnalysisArtifactKind[];

export type AudioAnalysisRefKind = typeof AUDIO_ANALYSIS_REF_KINDS[number];

export interface AudioAnalysisCacheKeyInput {
  mediaFileId: string;
  sourceFingerprint: string;
  kind: AudioAnalysisArtifactKind;
  analyzerVersion: string;
  channelLayout: AudioChannelLayout;
  sampleRate: number;
  duration: number;
  clipAudioStateHash?: string;
}

export interface AudioAnalysisManifestRefInput extends AudioAnalysisCacheKeyInput {
  kind: AudioAnalysisRefKind;
  artifactId: string;
}

export interface AudioAnalysisManifestRef {
  schemaVersion: typeof AUDIO_ANALYSIS_REF_MANIFEST_VERSION;
  artifactId: string;
  kind: AudioAnalysisRefKind;
  cacheKey: string;
}

export interface AudioAnalysisRefsManifest {
  schemaVersion: typeof AUDIO_ANALYSIS_REF_MANIFEST_VERSION;
  waveformPyramid?: AudioAnalysisManifestRef;
  processedWaveformPyramid?: AudioAnalysisManifestRef;
  spectrogramTileSets?: AudioAnalysisManifestRef[];
  loudnessEnvelope?: AudioAnalysisManifestRef;
}

export interface LegacyAudioAnalysisRefs {
  waveformPyramidId?: string;
  processedWaveformPyramidId?: string;
  spectrogramTileSetIds?: string[];
  loudnessEnvelopeId?: string;
}

export type AudioAnalysisRefsLike = AudioAnalysisRefsManifest | LegacyAudioAnalysisRefs | null | undefined;

export type AudioAnalysisRefFreshnessReason =
  | 'fresh'
  | 'missing-ref'
  | 'missing-stale-key'
  | 'stale-key-mismatch'
  | 'unsupported-kind'
  | 'unsupported-schema-version'
  | 'kind-mismatch';

export interface AudioAnalysisRefFreshness {
  stale: boolean;
  reason: AudioAnalysisRefFreshnessReason;
  expectedCacheKey: string;
  artifactId?: string;
  actualCacheKey?: string;
  ref?: AudioAnalysisManifestRef;
}

type RefFieldName = keyof Pick<
  AudioAnalysisRefsManifest,
  'waveformPyramid' | 'processedWaveformPyramid' | 'spectrogramTileSets' | 'loudnessEnvelope'
>;

type LegacyRefFieldName = keyof LegacyAudioAnalysisRefs;

const KIND_TO_REF_FIELD: Record<AudioAnalysisRefKind, RefFieldName> = {
  'waveform-pyramid': 'waveformPyramid',
  'processed-waveform-pyramid': 'processedWaveformPyramid',
  'spectrogram-tiles': 'spectrogramTileSets',
  'loudness-envelope': 'loudnessEnvelope',
};

const KIND_TO_LEGACY_REF_FIELD: Record<AudioAnalysisRefKind, LegacyRefFieldName> = {
  'waveform-pyramid': 'waveformPyramidId',
  'processed-waveform-pyramid': 'processedWaveformPyramidId',
  'spectrogram-tiles': 'spectrogramTileSetIds',
  'loudness-envelope': 'loudnessEnvelopeId',
};

export function isAudioAnalysisRefKind(value: unknown): value is AudioAnalysisRefKind {
  return typeof value === 'string'
    && AUDIO_ANALYSIS_REF_KINDS.includes(value as AudioAnalysisRefKind);
}

function assertNonEmptyString(value: string, label: string): void {
  if (!value) {
    throw new Error(`${label} must be a non-empty string.`);
  }
}

function assertPositiveFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive finite number.`);
  }
}

function assertNonNegativeFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative finite number.`);
  }
}

function normalizeFiniteNumber(value: number): string {
  const normalized = Object.is(value, -0) ? 0 : value;
  if (Number.isInteger(normalized)) {
    return String(normalized);
  }

  return normalized.toFixed(9).replace(/\.?0+$/, '');
}

function normalizeChannelLayout(layout: AudioChannelLayout): AudioChannelLayout {
  if (!layout || typeof layout !== 'object') {
    throw new Error('channelLayout must be an object.');
  }

  if (!Number.isInteger(layout.channelCount) || layout.channelCount < 1) {
    throw new Error('channelLayout.channelCount must be at least 1.');
  }

  return {
    kind: layout.kind,
    channelCount: layout.channelCount,
    ...(layout.labels ? { labels: [...layout.labels] } : {}),
  };
}

function encodeKeyPart(value: string): string {
  return encodeURIComponent(value);
}

function normalizedCacheKeyParts(input: AudioAnalysisCacheKeyInput): string[] {
  assertNonEmptyString(input.mediaFileId, 'mediaFileId');
  assertNonEmptyString(input.sourceFingerprint, 'sourceFingerprint');
  assertNonEmptyString(input.kind, 'kind');
  assertNonEmptyString(input.analyzerVersion, 'analyzerVersion');
  assertPositiveFinite(input.sampleRate, 'sampleRate');
  assertNonNegativeFinite(input.duration, 'duration');

  const channelLayout = normalizeChannelLayout(input.channelLayout);

  return [
    'audio-analysis',
    `v${AUDIO_ANALYSIS_CACHE_KEY_VERSION}`,
    input.kind,
    `media=${encodeKeyPart(input.mediaFileId)}`,
    `source=${encodeKeyPart(input.sourceFingerprint)}`,
    `analyzer=${encodeKeyPart(input.analyzerVersion)}`,
    `channels=${encodeKeyPart(JSON.stringify(channelLayout))}`,
    `sampleRate=${normalizeFiniteNumber(input.sampleRate)}`,
    `duration=${normalizeFiniteNumber(input.duration)}`,
    `clip=${input.clipAudioStateHash ? encodeKeyPart(input.clipAudioStateHash) : 'source'}`,
  ];
}

export function createAudioAnalysisCacheKey(input: AudioAnalysisCacheKeyInput): string {
  return normalizedCacheKeyParts(input).join(':');
}

export function createAudioAnalysisStaleKey(input: AudioAnalysisCacheKeyInput): string {
  return createAudioAnalysisCacheKey(input);
}

export function createAudioAnalysisCacheKeyFromArtifact(
  artifact: Pick<
    AudioAnalysisArtifact,
    | 'mediaFileId'
    | 'sourceFingerprint'
    | 'kind'
    | 'analyzerVersion'
    | 'channelLayout'
    | 'sampleRate'
    | 'duration'
    | 'clipAudioStateHash'
  >,
): string {
  return createAudioAnalysisCacheKey(artifact);
}

export function isAudioAnalysisArtifactStaleForInput(
  artifact: Pick<
    AudioAnalysisArtifact,
    | 'stale'
    | 'mediaFileId'
    | 'sourceFingerprint'
    | 'kind'
    | 'analyzerVersion'
    | 'channelLayout'
    | 'sampleRate'
    | 'duration'
    | 'clipAudioStateHash'
  >,
  input: AudioAnalysisCacheKeyInput,
): boolean {
  return artifact.stale || createAudioAnalysisCacheKeyFromArtifact(artifact) !== createAudioAnalysisCacheKey(input);
}

export function createAudioAnalysisManifestRef(
  input: AudioAnalysisManifestRefInput,
): AudioAnalysisManifestRef {
  return {
    schemaVersion: AUDIO_ANALYSIS_REF_MANIFEST_VERSION,
    artifactId: input.artifactId,
    kind: input.kind,
    cacheKey: createAudioAnalysisCacheKey(input),
  };
}

export function createAudioAnalysisManifestRefFromArtifact(
  artifact: AudioAnalysisArtifact,
): AudioAnalysisManifestRef {
  if (!isAudioAnalysisRefKind(artifact.kind)) {
    throw new Error(`Audio analysis kind cannot be stored in media analysis refs: ${artifact.kind}`);
  }

  return createAudioAnalysisManifestRef({
    artifactId: artifact.id,
    mediaFileId: artifact.mediaFileId,
    sourceFingerprint: artifact.sourceFingerprint,
    kind: artifact.kind,
    analyzerVersion: artifact.analyzerVersion,
    channelLayout: artifact.channelLayout,
    sampleRate: artifact.sampleRate,
    duration: artifact.duration,
    clipAudioStateHash: artifact.clipAudioStateHash,
  });
}

export function createAudioAnalysisRefsManifest(
  refs: AudioAnalysisManifestRef[] = [],
): AudioAnalysisRefsManifest {
  return refs.reduce<AudioAnalysisRefsManifest>(
    (manifest, ref) => addAudioAnalysisManifestRef(manifest, ref),
    { schemaVersion: AUDIO_ANALYSIS_REF_MANIFEST_VERSION },
  );
}

export function addAudioAnalysisManifestRef(
  manifest: AudioAnalysisRefsManifest,
  ref: AudioAnalysisManifestRef,
): AudioAnalysisRefsManifest {
  if (ref.schemaVersion !== AUDIO_ANALYSIS_REF_MANIFEST_VERSION) {
    throw new Error(`Unsupported audio analysis ref schema version: ${ref.schemaVersion}`);
  }

  switch (ref.kind) {
    case 'waveform-pyramid':
      return { ...manifest, waveformPyramid: ref };
    case 'processed-waveform-pyramid':
      return { ...manifest, processedWaveformPyramid: ref };
    case 'spectrogram-tiles': {
      const existing = manifest.spectrogramTileSets ?? [];
      return {
        ...manifest,
        spectrogramTileSets: [
          ...existing.filter((item) => item.artifactId !== ref.artifactId),
          ref,
        ],
      };
    }
    case 'loudness-envelope':
      return { ...manifest, loudnessEnvelope: ref };
  }
}

function getVersionedRefsForKind(
  refs: AudioAnalysisRefsManifest,
  kind: AudioAnalysisRefKind,
): AudioAnalysisManifestRef[] {
  const field = KIND_TO_REF_FIELD[kind];
  const value = refs[field];
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function getLegacyArtifactId(
  refs: LegacyAudioAnalysisRefs,
  kind: AudioAnalysisRefKind,
): string | undefined {
  const value = refs[KIND_TO_LEGACY_REF_FIELD[kind]];
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function hasVersionedRefSchema(refs: AudioAnalysisRefsLike): refs is AudioAnalysisRefsManifest {
  if (!refs || typeof refs !== 'object') {
    return false;
  }

  return 'schemaVersion' in refs && typeof refs.schemaVersion !== 'undefined';
}

export function getAudioAnalysisRefFreshness(
  refs: AudioAnalysisRefsLike,
  input: AudioAnalysisCacheKeyInput,
): AudioAnalysisRefFreshness {
  const expectedCacheKey = createAudioAnalysisCacheKey(input);
  if (!isAudioAnalysisRefKind(input.kind)) {
    return {
      stale: true,
      reason: 'unsupported-kind',
      expectedCacheKey,
    };
  }

  if (!refs) {
    return {
      stale: true,
      reason: 'missing-ref',
      expectedCacheKey,
    };
  }

  if (hasVersionedRefSchema(refs)) {
    if (refs.schemaVersion !== AUDIO_ANALYSIS_REF_MANIFEST_VERSION) {
      return {
        stale: true,
        reason: 'unsupported-schema-version',
        expectedCacheKey,
      };
    }

    const candidates = getVersionedRefsForKind(refs, input.kind);
    const ref = candidates.find((candidate) => candidate.cacheKey === expectedCacheKey)
      ?? candidates[0];

    if (!ref) {
      return {
        stale: true,
        reason: 'missing-ref',
        expectedCacheKey,
      };
    }

    if (ref.schemaVersion !== AUDIO_ANALYSIS_REF_MANIFEST_VERSION) {
      return {
        stale: true,
        reason: 'unsupported-schema-version',
        expectedCacheKey,
        artifactId: ref.artifactId,
        actualCacheKey: ref.cacheKey,
        ref,
      };
    }

    if (ref.kind !== input.kind) {
      return {
        stale: true,
        reason: 'kind-mismatch',
        expectedCacheKey,
        artifactId: ref.artifactId,
        actualCacheKey: ref.cacheKey,
        ref,
      };
    }

    if (ref.cacheKey !== expectedCacheKey) {
      return {
        stale: true,
        reason: 'stale-key-mismatch',
        expectedCacheKey,
        artifactId: ref.artifactId,
        actualCacheKey: ref.cacheKey,
        ref,
      };
    }

    return {
      stale: false,
      reason: 'fresh',
      expectedCacheKey,
      artifactId: ref.artifactId,
      actualCacheKey: ref.cacheKey,
      ref,
    };
  }

  const artifactId = getLegacyArtifactId(refs, input.kind);
  if (artifactId) {
    return {
      stale: true,
      reason: 'missing-stale-key',
      expectedCacheKey,
      artifactId,
    };
  }

  return {
    stale: true,
    reason: 'missing-ref',
    expectedCacheKey,
  };
}
