import type {
  AgentTimelineEvent,
  AgentTimelineRange,
  AgentTimelineTimeDomain,
} from './manifest';

export const AUDIO_CLASSIFICATION_SCHEMA_VERSION =
  'agent-timeline-audio-classification/v1' as const;
export const AUDIO_CLASSIFICATION_HEURISTIC_ID = 'persisted-audio-heuristic' as const;
export const AUDIO_CLASSIFICATION_HEURISTIC_VERSION = '1.0.0' as const;
export const AUDIO_CLASSIFICATION_CLASS_MAPPING_VERSION = '1.0.0' as const;

export type AudioClassificationLabel =
  | 'speech'
  | 'music'
  | 'noise'
  | 'ambience'
  | 'applause'
  | 'unknown';

/** Only compact, already-persisted audio and transcript summaries belong here. */
export interface AudioClassificationFeatureWindow extends AgentTimelineRange {
  loudnessDb?: number;
  peakDb?: number;
  spectralCentroidHz?: number;
  spectralFlatness?: number;
  lowFrequencyRatio?: number;
  highFrequencyRatio?: number;
  onsetRateHz?: number;
}

export interface AudioClassificationTranscriptRange extends AgentTimelineRange {
  confidence?: number;
}

export interface AudioClassificationInputProvenance {
  analyzerId: string;
  analyzerVersion: string;
  artifactRefs?: readonly string[];
}

export interface AudioClassificationInput {
  sourceId: string;
  timeDomain: AgentTimelineTimeDomain;
  stateHash?: string;
  range: AgentTimelineRange;
  features: readonly AudioClassificationFeatureWindow[];
  transcript?: readonly AudioClassificationTranscriptRange[];
  provenance: AudioClassificationInputProvenance;
}

export interface AudioClassificationSpan extends AgentTimelineRange {
  label: AudioClassificationLabel;
  /** A bounded, classifier-declared confidence; it must never imply certainty. */
  confidence: number;
}

export interface AudioClassificationClassifierMetadata {
  id: string;
  version: string;
  classMappingVersion: string;
  kind: 'heuristic' | 'model';
  modelId?: string;
  modelVersion?: string;
}

/** Dependency-injected on purpose: this package neither loads nor downloads models. */
export interface AudioClassificationClassifier {
  readonly metadata: AudioClassificationClassifierMetadata;
  classify(input: AudioClassificationInput): readonly AudioClassificationSpan[];
}

export interface AudioClassificationDerivationOptions {
  classifier?: AudioClassificationClassifier;
  /** Adjacent windows only by default; gaps are never silently classified. */
  mergeGapSeconds?: number;
}

export interface AudioClassificationDerivationResult {
  schemaVersion: typeof AUDIO_CLASSIFICATION_SCHEMA_VERSION;
  sourceId: string;
  timeDomain: AgentTimelineTimeDomain;
  stateHash?: string;
  range: AgentTimelineRange;
  classifier: AudioClassificationClassifierMetadata;
  spans: readonly AudioClassificationSpan[];
  events: readonly Extract<AgentTimelineEvent, { type: 'audio-activity' }>[];
}

export interface AudioClassificationReferenceCase {
  id: string;
  input: AudioClassificationInput;
  expected: readonly AudioClassificationSpan[];
}

export interface AudioClassificationMetric {
  accuracy: number;
  macroF1: number;
  perLabel: Readonly<Record<AudioClassificationLabel, {
    precision: number;
    recall: number;
    f1: number;
    expectedSeconds: number;
    predictedSeconds: number;
  }>>;
}

export interface AudioClassificationCandidateEvaluation {
  classifier: AudioClassificationClassifierMetadata;
  referenceCaseIds: readonly string[];
  metric: AudioClassificationMetric;
}

export interface AudioClassificationCandidateComparison {
  baseline: AudioClassificationCandidateEvaluation;
  candidate: AudioClassificationCandidateEvaluation;
  accuracyGain: number;
  macroF1Gain: number;
}

export interface AudioClassificationRuntimeEvidence {
  id: string;
  classifierId: string;
  classifierVersion: string;
  platform: string;
  scenarioId: string;
  realMedia: boolean;
  cacheState: 'cold' | 'warm';
  sourceDurationSeconds: number;
  wallTimeSeconds: number;
  baselineWallTimeSeconds: number;
  peakMemoryBytes: number;
  artifactBytes: number;
  /** Actual transfer or an observed no-download run; never an estimate. */
  downloadBytes: number;
  downloadEvidence: 'measured-download' | 'no-download-observed';
  /** Warm evidence must prove that cached source ranges were not decoded again. */
  redundantDecodedSeconds: number;
}

export interface AudioClassificationPromotionPolicy {
  minimumAccuracyGain: number;
  minimumMacroF1Gain: number;
  maximumRuntimeRatio: number;
  maximumPeakMemoryBytes: number;
  maximumArtifactBytesPerMediaMinute: number;
  maximumDownloadBytes: number;
  requiredPlatforms: readonly string[];
  requiredScenarios: readonly string[];
}

export type AudioClassificationPromotionFailure =
  | 'insufficient-quality-benefit'
  | 'missing-real-runtime-evidence'
  | 'invalid-runtime-evidence'
  | 'runtime-budget-exceeded'
  | 'memory-budget-exceeded'
  | 'artifact-budget-exceeded'
  | 'download-budget-exceeded'
  | 'warm-cache-redecoded';

export interface AudioClassificationPromotionResult {
  passed: boolean;
  failures: readonly {
    code: AudioClassificationPromotionFailure;
    evidenceId?: string;
    platform?: string;
    scenarioId?: string;
    cacheState?: 'cold' | 'warm';
    detail: string;
  }[];
}
