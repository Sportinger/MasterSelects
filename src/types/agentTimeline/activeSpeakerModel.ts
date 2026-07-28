import type { SpeakerPersonFusionEvent } from './speakerFusion';

export const ACTIVE_SPEAKER_MODEL_SCHEMA_VERSION =
  'agent-timeline-active-speaker-model/v1' as const;

export interface ActiveSpeakerAvSyncRequirements {
  maxAudioVideoSkewMilliseconds: number;
  minCandidateRateHz: number;
  maxCandidateRateHz: number;
}

/** A small plan only; it deliberately never contains frames, crops, embeddings, or audio samples. */
export interface ActiveSpeakerRoiCandidate {
  id: string;
  fusionEventId: string;
  turnId: string;
  speakerId: string;
  start: number;
  end: number;
  sourcePersonIds: readonly string[];
  sourceTrackIds: readonly string[];
  candidateRateHz: number;
  measuredAudioVideoSkewMilliseconds: number;
}

export type ActiveSpeakerCandidateSkipReason =
  | 'not-ambiguous-multi-person-speech'
  | 'av-sync-not-measured'
  | 'av-sync-out-of-budget'
  | 'candidate-rate-out-of-budget';

export interface ActiveSpeakerCandidatePlan {
  schemaVersion: typeof ACTIVE_SPEAKER_MODEL_SCHEMA_VERSION;
  candidates: readonly ActiveSpeakerRoiCandidate[];
  skipped: readonly { fusionEventId: string; reason: ActiveSpeakerCandidateSkipReason }[];
}

export interface ActiveSpeakerCandidatePlanningInput {
  heuristicEvents: readonly SpeakerPersonFusionEvent[];
  candidateRateHz: number;
  measuredAudioVideoSkewMilliseconds?: number;
  requirements: ActiveSpeakerAvSyncRequirements;
}

export interface ActiveSpeakerModelCapabilities {
  format: 'onnx';
  webgpu: boolean;
  wasm: boolean;
  cpuFallback: boolean;
  license: string;
  modelBytes: number;
}

export interface ActiveSpeakerLocalRoiModelMetadata {
  id: string;
  version: string;
  capabilities: ActiveSpeakerModelCapabilities;
}

export interface ActiveSpeakerModelPrediction {
  candidateId: string;
  status: 'onscreen' | 'unknown';
  sourcePersonId?: string;
  confidence: number;
}

/**
 * The frame provider is ephemeral and local to the inference call. Durable
 * artifacts must retain predictions/provenance only, never the supplied ROIs.
 */
export interface ActiveSpeakerEphemeralRoiProvider {
  readonly persistence: 'ephemeral-memory';
  sampleCount(candidate: ActiveSpeakerRoiCandidate, sourcePersonId: string): number;
}

/** Dependency-injected local inference contract; this package loads no model and makes no network call. */
export interface ActiveSpeakerLocalRoiModel {
  readonly metadata: ActiveSpeakerLocalRoiModelMetadata;
  infer(
    candidate: ActiveSpeakerRoiCandidate,
    rois: ActiveSpeakerEphemeralRoiProvider,
  ): Promise<readonly ActiveSpeakerModelPrediction[]>;
}

export interface ActiveSpeakerReferenceOutcome {
  status: 'onscreen' | 'unknown';
  sourcePersonId?: string;
}

export interface ActiveSpeakerLabelledReferenceCase {
  id: string;
  candidate: ActiveSpeakerRoiCandidate;
  expected: ActiveSpeakerReferenceOutcome;
  heuristic: ActiveSpeakerModelPrediction;
  model: ActiveSpeakerModelPrediction;
}

export interface ActiveSpeakerEvaluationMetric {
  accuracy: number;
  correct: number;
  total: number;
}

export interface ActiveSpeakerModelComparison {
  modelId: string;
  modelVersion: string;
  heuristic: ActiveSpeakerEvaluationMetric;
  model: ActiveSpeakerEvaluationMetric;
  accuracyGain: number;
  evaluatedCaseIds: readonly string[];
}

export interface ActiveSpeakerModelRuntimeEvidence {
  id: string;
  modelId: string;
  modelVersion: string;
  platform: string;
  scenarioId: string;
  cacheState: 'cold' | 'warm';
  realMedia: boolean;
  candidateOnly: boolean;
  sourceDurationSeconds: number;
  candidateDurationSeconds: number;
  wallTimeSeconds: number;
  baselineWallTimeSeconds: number;
  peakMemoryBytes: number;
  artifactBytes: number;
  downloadBytes: number;
  downloadEvidence: 'measured-download' | 'no-download-observed';
  redundantDecodedSeconds: number;
}

export interface ActiveSpeakerModelPromotionPolicy {
  minimumAccuracyGain: number;
  maximumRuntimeRatio: number;
  maximumPeakMemoryBytes: number;
  maximumArtifactBytesPerMediaMinute: number;
  maximumDownloadBytes: number;
  requiredPlatforms: readonly string[];
  requiredScenarios: readonly string[];
  requireWebGpu: boolean;
  requireWasm: boolean;
  requireCpuFallback: boolean;
}

export type ActiveSpeakerModelPromotionFailure =
  | 'insufficient-accuracy-benefit'
  | 'invalid-capability-metadata'
  | 'model-comparison-mismatch'
  | 'missing-required-capability'
  | 'invalid-runtime-evidence'
  | 'missing-real-runtime-evidence'
  | 'continuous-full-video-run'
  | 'runtime-budget-exceeded'
  | 'memory-budget-exceeded'
  | 'artifact-budget-exceeded'
  | 'download-budget-exceeded'
  | 'warm-cache-redecoded';

export interface ActiveSpeakerModelPromotionResult {
  passed: boolean;
  failures: readonly {
    code: ActiveSpeakerModelPromotionFailure;
    evidenceId?: string;
    platform?: string;
    scenarioId?: string;
    cacheState?: 'cold' | 'warm';
    detail: string;
  }[];
}
