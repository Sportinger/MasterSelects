import type { AudioArtifactRef, AudioChannelLayout } from './audioArtifactTypes';

export const PROSODY_CONTOUR_MANIFEST_VERSION = 1 as const;

// Convention: an f0 value of 0 means "unvoiced"; the voicing curve (0..1)
// is the authoritative gate for whether a pitch value is meaningful.
export const PROSODY_METRICS = [
  'f0-hz',
  'voicing',
  'energy-rms-db',
  'speech-rate-sps',
] as const;

export type ProsodyMetric = typeof PROSODY_METRICS[number];

export interface ProsodyCurveRef {
  metric: ProsodyMetric;
  windowDuration: number;
  hopDuration: number;
  pointCount: number;
  payloadRef: AudioArtifactRef;
}

export interface ProsodySummary {
  medianF0Hz?: number;
  f0RangeSemitones?: number;
  meanSpeechRateSps?: number;
}

export interface ProsodyWordEmphasis {
  wordId: string;
  emphasis: number;
  f0MeanHz?: number;
}

export interface ProsodyContourManifest {
  schemaVersion: typeof PROSODY_CONTOUR_MANIFEST_VERSION;
  mediaFileId: string;
  sourceFingerprint: string;
  clipAudioStateHash?: string;
  sampleRate: number;
  analysisSampleRate: number;
  channelLayout: AudioChannelLayout;
  duration: number;
  curves: ProsodyCurveRef[];
  sourceVoiceActivityArtifactId?: string;
  summary?: ProsodySummary;
  wordEmphasis?: readonly ProsodyWordEmphasis[];
}

export interface CreateProsodyContourManifestInput extends Omit<ProsodyContourManifest, 'schemaVersion'> {
  schemaVersion?: typeof PROSODY_CONTOUR_MANIFEST_VERSION;
}

export function isProsodyMetric(value: unknown): value is ProsodyMetric {
  return typeof value === 'string' && PROSODY_METRICS.includes(value as ProsodyMetric);
}

export function createProsodyContourManifest(
  input: CreateProsodyContourManifestInput,
): ProsodyContourManifest {
  if (!Number.isFinite(input.sampleRate) || input.sampleRate <= 0) {
    throw new Error('sampleRate must be a positive finite number.');
  }
  if (!Number.isFinite(input.analysisSampleRate) || input.analysisSampleRate <= 0) {
    throw new Error('analysisSampleRate must be a positive finite number.');
  }
  if (!Number.isFinite(input.duration) || input.duration < 0) {
    throw new Error('duration must be a non-negative finite number.');
  }
  if (input.curves.length === 0) {
    throw new Error('Prosody contour manifests require at least one curve.');
  }

  const curves = input.curves
    .toSorted((a, b) => a.metric.localeCompare(b.metric))
    .map((curve) => {
      if (!isProsodyMetric(curve.metric)) {
        throw new Error(`Unsupported prosody metric: ${String(curve.metric)}`);
      }
      if (!Number.isFinite(curve.windowDuration) || curve.windowDuration <= 0) {
        throw new Error('curve.windowDuration must be a positive finite number.');
      }
      if (!Number.isFinite(curve.hopDuration) || curve.hopDuration <= 0) {
        throw new Error('curve.hopDuration must be a positive finite number.');
      }
      if (!Number.isInteger(curve.pointCount) || curve.pointCount < 1) {
        throw new Error('curve.pointCount must be a positive integer.');
      }
      return curve;
    });
  const wordEmphasis = input.wordEmphasis?.map((entry) => {
    if (!entry.wordId.trim()) {
      throw new Error('wordEmphasis.wordId must be a non-empty string.');
    }
    if (!Number.isFinite(entry.emphasis) || entry.emphasis < 0 || entry.emphasis > 1) {
      throw new Error('wordEmphasis.emphasis must be within [0, 1].');
    }
    return { ...entry };
  });

  return {
    schemaVersion: PROSODY_CONTOUR_MANIFEST_VERSION,
    mediaFileId: input.mediaFileId,
    sourceFingerprint: input.sourceFingerprint,
    clipAudioStateHash: input.clipAudioStateHash,
    sampleRate: input.sampleRate,
    analysisSampleRate: input.analysisSampleRate,
    channelLayout: input.channelLayout,
    duration: input.duration,
    curves,
    sourceVoiceActivityArtifactId: input.sourceVoiceActivityArtifactId,
    summary: input.summary ? { ...input.summary } : undefined,
    wordEmphasis,
  };
}
