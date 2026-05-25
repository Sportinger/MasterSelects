import type { AudioArtifactRef, AudioChannelLayout } from './audioArtifactTypes';

export const LOUDNESS_ENVELOPE_MANIFEST_VERSION = 1 as const;

export type LoudnessEnvelopeMetric =
  | 'momentary-lufs'
  | 'short-term-lufs'
  | 'integrated-lufs'
  | 'true-peak-dbtp'
  | 'sample-peak-dbfs'
  | 'rms-dbfs';

export interface LoudnessCurvePayloadRef {
  metric: LoudnessEnvelopeMetric;
  channelIndex?: number;
  windowDuration: number;
  hopDuration: number;
  pointCount: number;
  payloadRef: AudioArtifactRef;
}

export interface LoudnessEnvelopeSummary {
  integratedLufs?: number;
  truePeakDbtp?: number;
  samplePeakDbfs?: number;
  rmsDbfs?: number;
}

export interface LoudnessEnvelopeManifest {
  schemaVersion: typeof LOUDNESS_ENVELOPE_MANIFEST_VERSION;
  mediaFileId: string;
  sourceFingerprint: string;
  clipAudioStateHash?: string;
  sampleRate: number;
  channelLayout: AudioChannelLayout;
  duration: number;
  curves: LoudnessCurvePayloadRef[];
  summary?: LoudnessEnvelopeSummary;
}

export interface CreateLoudnessEnvelopeManifestInput extends Omit<
  LoudnessEnvelopeManifest,
  'schemaVersion'
> {
  schemaVersion?: typeof LOUDNESS_ENVELOPE_MANIFEST_VERSION;
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

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
}

export function createLoudnessEnvelopeManifest(
  input: CreateLoudnessEnvelopeManifestInput,
): LoudnessEnvelopeManifest {
  assertPositiveFinite(input.sampleRate, 'sampleRate');
  assertNonNegativeFinite(input.duration, 'duration');
  assertPositiveInteger(input.channelLayout.channelCount, 'channelLayout.channelCount');

  if (input.curves.length === 0) {
    throw new Error('Loudness envelope manifests require at least one curve.');
  }

  const curves = input.curves
    .toSorted((a, b) => {
      const metricOrder = a.metric.localeCompare(b.metric);
      if (metricOrder !== 0) return metricOrder;
      return (a.channelIndex ?? -1) - (b.channelIndex ?? -1);
    })
    .map((curve) => {
      assertPositiveFinite(curve.windowDuration, 'windowDuration');
      assertPositiveFinite(curve.hopDuration, 'hopDuration');
      assertPositiveInteger(curve.pointCount, 'pointCount');

      if (
        typeof curve.channelIndex === 'number'
        && (!Number.isInteger(curve.channelIndex)
          || curve.channelIndex < 0
          || curve.channelIndex >= input.channelLayout.channelCount)
      ) {
        throw new Error('curve.channelIndex must be within channelLayout.channelCount.');
      }

      return curve;
    });

  return {
    schemaVersion: LOUDNESS_ENVELOPE_MANIFEST_VERSION,
    mediaFileId: input.mediaFileId,
    sourceFingerprint: input.sourceFingerprint,
    clipAudioStateHash: input.clipAudioStateHash,
    sampleRate: input.sampleRate,
    channelLayout: input.channelLayout,
    duration: input.duration,
    curves,
    summary: input.summary,
  };
}
