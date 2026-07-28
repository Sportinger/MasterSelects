import type {
  AgentTimelineEvent,
  AgentTimelineRange,
  AgentTimelineTimeDomain,
} from './manifest';

export const QUALITY_AUDIO_DERIVATION_SCHEMA_VERSION =
  'agent-timeline-quality-audio-derivation/v1' as const;
export const QUALITY_AUDIO_DERIVATION_ANALYZER_VERSION = '1.0.0' as const;

export type QualityAudioDerivationKind =
  | 'black'
  | 'exposure'
  | 'focus'
  | 'freeze'
  | 'loudness'
  | 'peak'
  | 'clipping'
  | 'quiet'
  | 'silence'
  | 'transient';

export type DerivationCoverageStatus = 'complete' | 'partial' | 'missing' | 'unknown';

export interface QualityAudioDerivationCoverage {
  kind: QualityAudioDerivationKind;
  status: DerivationCoverageStatus;
  covered: readonly AgentTimelineRange[];
  missing: readonly AgentTimelineRange[];
  reason?: string;
}

export interface QualityMeasurementSample {
  /** Source or rendered time in seconds. */
  time: number;
  focus?: number;
  brightness?: number;
  /** Stable persisted frame signature; decoded pixels are intentionally absent. */
  frameHash?: string;
  /** Persisted normalized difference to the previous sample. */
  frameDifference?: number;
  confidence?: number;
}

export interface AudioMeasurementWindow {
  start: number;
  end: number;
  loudnessDb?: number;
  peakDb?: number;
  activity?: 'speech' | 'music' | 'noise' | 'ambience' | 'applause' | 'unknown';
  confidence?: number;
}

export interface PersistedSilenceRange {
  start: number;
  end: number;
  rmsDb: number;
  confidence?: number;
}

export interface PersistedTransientRange {
  start: number;
  end: number;
  peakDb: number;
  rmsDb?: number;
  crestDb?: number;
  strength?: number;
  confidence?: number;
}

export interface DerivationInputProvenance {
  analyzerId: string;
  analyzerVersion: string;
  artifactRefs?: readonly string[];
}

export interface QualityMeasurementInput {
  samples: readonly QualityMeasurementSample[];
  coverage?: readonly AgentTimelineRange[];
  provenance: DerivationInputProvenance;
}

export interface AudioMeasurementInput {
  measurements?: readonly AudioMeasurementWindow[];
  /** `undefined` means not evaluated; `[]` means evaluated and none found. */
  silenceRanges?: readonly PersistedSilenceRange[];
  /** `undefined` means not evaluated; `[]` means evaluated and none found. */
  transientRanges?: readonly PersistedTransientRange[];
  coverage?: readonly AgentTimelineRange[];
  provenance: DerivationInputProvenance;
}

export interface QualityAudioDerivationThresholds {
  blackBrightnessMax: number;
  underexposedBrightnessMax: number;
  overexposedBrightnessMin: number;
  focusMin: number;
  frameDifferenceMax: number;
  freezeMinDuration: number;
  qualitySampleDuration: number;
  qualityMergeGap: number;
  qualityMinIssueDuration: number;
  clippingPeakDb: number;
  quietLoudnessDb: number;
  quietMinDuration: number;
  unexpectedSilenceMinDuration: number;
  audioMergeGap: number;
}

export interface QualityAudioDerivationInput {
  sourceId: string;
  timeDomain: AgentTimelineTimeDomain;
  stateHash?: string;
  range: AgentTimelineRange;
  quality?: QualityMeasurementInput;
  audio?: AudioMeasurementInput;
  thresholds?: Partial<QualityAudioDerivationThresholds>;
}

export interface QualityAudioDerivationResult {
  schemaVersion: typeof QUALITY_AUDIO_DERIVATION_SCHEMA_VERSION;
  sourceId: string;
  timeDomain: AgentTimelineTimeDomain;
  stateHash?: string;
  range: AgentTimelineRange;
  thresholds: QualityAudioDerivationThresholds;
  events: readonly AgentTimelineEvent[];
  coverage: Readonly<Record<QualityAudioDerivationKind, QualityAudioDerivationCoverage>>;
}
