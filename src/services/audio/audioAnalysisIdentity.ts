import type {
  AudioEffectInstance,
  ClipAudioStemLayer,
  ClipAudioStemState,
  ClipAudioEditOperation,
  ClipAudioState,
  SpectralImageLayer,
} from '../../types/audio';
import { getAudioEqAudibleStateForIdentity } from '../../engine/audio/eq/AudioEqIdentity';
import {
  getAudioAnalysisRefFreshness,
  type AudioAnalysisCacheKeyInput,
  type AudioAnalysisRefFreshness,
  type AudioAnalysisRefsLike,
} from './audioAnalysisManifestKeys';

export const AUDIO_ANALYSIS_IDENTITY_VERSION = 1 as const;

type JsonPrimitive = string | number | boolean | null;
type CanonicalJsonValue = JsonPrimitive | CanonicalJsonValue[] | { [key: string]: CanonicalJsonValue };

export interface ClipAudioAnalysisIdentityInput {
  audioState?: Pick<
    ClipAudioState,
    'sourceAudioRevisionId' | 'editStack' | 'effectStack' | 'spectralLayers' | 'stemSeparation' | 'muted' | 'soloSafe'
  > | null;
  automationKeyframes?: readonly {
    property: string;
    time: number;
    value: number;
    easing?: string | null;
  }[];
  inPoint?: number;
  outPoint?: number;
  duration?: number;
  speed?: number;
  reversed?: boolean;
  preservesPitch?: boolean;
  trackGraphIdentity?: string | null;
  masterGraphIdentity?: string | null;
}

export type ProcessedWaveformAnalysisInput = Omit<AudioAnalysisCacheKeyInput, 'kind' | 'clipAudioStateHash'> & {
  clipAudioStateHash: string;
};

export type ProcessedWaveformAudioAnalysisCacheKeyInput = Omit<
  AudioAnalysisCacheKeyInput,
  'kind' | 'clipAudioStateHash'
> & {
  kind: 'processed-waveform-pyramid';
  clipAudioStateHash: string;
};

const PAYLOAD_FIELD_PATTERN = /(?:payload|buffer|file|blob|waveform|bytes|arrayBuffer|audioBuffer|dataUrl|objectUrl|element)$/i;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeFiniteNumber(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  const normalized = Object.is(value, -0) ? 0 : value;
  return Number(normalized.toFixed(9));
}

function normalizeJsonValue(value: unknown): CanonicalJsonValue | undefined {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
    return undefined;
  }

  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value as JsonPrimitive;
  }

  if (typeof value === 'number') {
    return normalizeFiniteNumber(value);
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeJsonValue(item))
      .filter((item): item is CanonicalJsonValue => item !== undefined);
  }

  if (!isPlainObject(value)) {
    return undefined;
  }

  const entries = Object.keys(value)
    .filter((key) => !PAYLOAD_FIELD_PATTERN.test(key))
    .sort()
    .map((key): [string, CanonicalJsonValue] | undefined => {
      const normalized = normalizeJsonValue(value[key]);
      return normalized === undefined ? undefined : [key, normalized];
    })
    .filter((entry): entry is [string, CanonicalJsonValue] => Boolean(entry));

  return entries.reduce<Record<string, CanonicalJsonValue>>((object, [key, normalized]) => {
    object[key] = normalized;
    return object;
  }, {});
}

function canonicalizeJson(value: CanonicalJsonValue): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizeJson(item)).join(',')}]`;
  }

  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalizeJson(value[key])}`)
    .join(',')}}`;
}

function hashString(value: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = (hash * prime) & mask;
  }

  return hash.toString(16).padStart(16, '0');
}

function enabledOperations<T extends { enabled?: boolean }>(items: T[] | undefined): T[] | undefined {
  const enabled = (items ?? []).filter((item) => item.enabled !== false);
  return enabled.length > 0 ? enabled : undefined;
}

function normalizeEditOperation(operation: ClipAudioEditOperation): CanonicalJsonValue {
  return normalizeJsonValue({
    id: operation.id,
    type: operation.type,
    params: operation.params,
    timeRange: operation.timeRange,
    channelMask: operation.channelMask,
  }) ?? {};
}

function normalizeEffectInstance(effect: AudioEffectInstance): CanonicalJsonValue {
  const params = effect.descriptorId === 'audio-eq'
    ? getAudioEqAudibleStateForIdentity(effect.params)
    : effect.params;

  return normalizeJsonValue({
    id: effect.id,
    descriptorId: effect.descriptorId,
    params,
    automationMode: effect.automationMode,
  }) ?? {};
}

function normalizeSpectralLayer(layer: SpectralImageLayer & { enabled?: boolean }): CanonicalJsonValue {
  return normalizeJsonValue({
    id: layer.id,
    imageMediaFileId: layer.imageMediaFileId,
    timeStart: layer.timeStart,
    duration: layer.duration,
    frequencyMin: layer.frequencyMin,
    frequencyMax: layer.frequencyMax,
    opacity: layer.opacity,
    blendMode: layer.blendMode,
    gainDb: layer.gainDb,
    featherTime: layer.featherTime,
    featherFrequency: layer.featherFrequency,
    keyframes: layer.keyframes,
  }) ?? {};
}

function normalizeStemLayer(layer: ClipAudioStemLayer): CanonicalJsonValue {
  return normalizeJsonValue({
    id: layer.id,
    kind: layer.kind,
    analysisArtifactId: layer.analysisArtifactId,
    manifestArtifactId: layer.manifestArtifactId,
    payloadArtifactId: layer.payloadRef.artifactId,
    payloadHash: layer.payloadRef.hash,
    payloadSize: layer.payloadRef.size,
    payloadMimeType: layer.payloadRef.mimeType,
    payloadEncoding: layer.payloadRef.encoding,
    enabled: layer.enabled !== false,
    gainDb: layer.gainDb,
    phaseAligned: layer.phaseAligned === true,
    modelId: layer.modelId,
    sourceFingerprint: layer.sourceFingerprint,
  }) ?? {};
}

function normalizeStemSeparation(stemSeparation: ClipAudioStemState): CanonicalJsonValue {
  if (stemSeparation.mixMode === 'original') {
    return normalizeJsonValue({
      mixMode: 'original',
      soloStemId: stemSeparation.soloStemId,
      sourceGainDb: stemSeparation.sourceGainDb,
    }) ?? {};
  }

  const stems = stemSeparation.stems
    .map(normalizeStemLayer)
    .toSorted((first, second) => canonicalizeJson(first).localeCompare(canonicalizeJson(second)));

  return normalizeJsonValue({
    activeSetId: stemSeparation.activeSetId,
    modelId: stemSeparation.modelId,
    modelVersion: stemSeparation.modelVersion,
    sourceFingerprint: stemSeparation.sourceFingerprint,
    range: stemSeparation.range,
    sampleRate: stemSeparation.sampleRate,
    channelCount: stemSeparation.channelCount,
    soloStemId: stemSeparation.soloStemId,
    sourceGainDb: stemSeparation.sourceGainDb,
    mixMode: stemSeparation.mixMode,
    stems,
  }) ?? {};
}

export function createClipAudioStateIdentityPayload(
  input: ClipAudioAnalysisIdentityInput,
): CanonicalJsonValue {
  const audioState = input.audioState ?? undefined;
  const editStack = enabledOperations(audioState?.editStack)?.map(normalizeEditOperation);
  const effectStack = enabledOperations(audioState?.effectStack)?.map(normalizeEffectInstance);
  const spectralLayers = enabledOperations(
    audioState?.spectralLayers as (SpectralImageLayer & { enabled?: boolean })[] | undefined,
  )?.map(normalizeSpectralLayer);
  const stemSeparation = audioState?.stemSeparation
    ? normalizeStemSeparation(audioState.stemSeparation)
    : undefined;

  return normalizeJsonValue({
    version: AUDIO_ANALYSIS_IDENTITY_VERSION,
    sourceAudioRevisionId: audioState?.sourceAudioRevisionId,
    muted: audioState?.muted === true,
    soloSafe: audioState?.soloSafe === true,
    clip: {
      inPoint: input.inPoint,
      outPoint: input.outPoint,
      duration: input.duration,
      speed: input.speed ?? 1,
      reversed: input.reversed === true,
      preservesPitch: input.preservesPitch !== false,
    },
    editStack,
    effectStack,
    spectralLayers,
    stemSeparation,
    automationKeyframes: input.automationKeyframes,
    trackGraphIdentity: input.trackGraphIdentity || undefined,
    masterGraphIdentity: input.masterGraphIdentity || undefined,
  }) ?? {};
}

export function canonicalizeAudioAnalysisIdentity(input: ClipAudioAnalysisIdentityInput): string {
  return canonicalizeJson(createClipAudioStateIdentityPayload(input));
}

export function createClipAudioStateHash(input: ClipAudioAnalysisIdentityInput): string {
  const canonical = canonicalizeAudioAnalysisIdentity(input);
  return [
    'audio-state',
    `v${AUDIO_ANALYSIS_IDENTITY_VERSION}`,
    hashString(canonical),
    String(canonical.length),
  ].join(':');
}

export function createProcessedWaveformAnalysisInput(
  input: Omit<ProcessedWaveformAnalysisInput, 'clipAudioStateHash'> & {
    clipAudioState: ClipAudioAnalysisIdentityInput;
  },
): ProcessedWaveformAudioAnalysisCacheKeyInput {
  const { clipAudioState, ...analysisInput } = input;

  return {
    ...analysisInput,
    kind: 'processed-waveform-pyramid',
    clipAudioStateHash: createClipAudioStateHash(clipAudioState),
  };
}

export function getProcessedWaveformRefFreshnessForAudioState(
  refs: AudioAnalysisRefsLike,
  input: Omit<ProcessedWaveformAnalysisInput, 'clipAudioStateHash'> & {
    clipAudioState: ClipAudioAnalysisIdentityInput;
  },
): AudioAnalysisRefFreshness {
  return getAudioAnalysisRefFreshness(refs, createProcessedWaveformAnalysisInput(input));
}

export function isProcessedWaveformRefStaleForAudioState(
  refs: AudioAnalysisRefsLike,
  input: Omit<ProcessedWaveformAnalysisInput, 'clipAudioStateHash'> & {
    clipAudioState: ClipAudioAnalysisIdentityInput;
  },
): boolean {
  return getProcessedWaveformRefFreshnessForAudioState(refs, input).stale;
}
