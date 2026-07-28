import type { AgentTimelineBenchmarkGatePolicy, AgentTimelineBenchmarkMeasurement } from './benchmarkGate';
import type { AgentTimelineProfile, AgentTimelineProvenance, NormalizedBox } from './manifest';

export const AGENT_TIMELINE_OCR_SCHEMA_VERSION = 'agent-timeline-ocr/v1' as const;
export const AGENT_TIMELINE_OCR_ANALYZER_VERSION = 'agent-timeline-ocr/v1' as const;

/** A half-open source-time shot; frame pixels never belong in this durable input. */
export interface OcrShotCandidateSource {
  shotId: string;
  start: number;
  end: number;
  keyframeSourceTime?: number;
}

/** A cheap hash/region change found by an earlier visual pass. */
export interface OcrVisualChange {
  sourceTime: number;
  imageHash?: string;
  textRegionHash?: string;
}

export type OcrCandidateReason = 'shot-keyframe' | 'visual-change';

/** Metadata only: consumers must fetch/decode pixels transiently for this candidate. */
export interface OcrFrameCandidate {
  shotId: string;
  sourceTime: number;
  visibilityEnd: number;
  reason: OcrCandidateReason;
  imageHash?: string;
  textRegionHash?: string;
}

export interface OcrCandidateSelectionOptions {
  maxChangeCandidatesPerShot?: number;
}

export interface OcrRecognizedRegion {
  text: string;
  confidence: number;
  box?: NormalizedBox;
  language?: string;
}

export interface OcrRecognition {
  candidate: OcrFrameCandidate;
  regions: readonly OcrRecognizedRegion[];
  provenance: readonly AgentTimelineProvenance[];
}

export interface OcrLanguagePack {
  id: string;
  language: string;
  version: string;
  bytes: number;
  /** Packages are bundled or downloaded to local offline cache only. */
  state: 'available-local' | 'download-required' | 'unavailable';
  source: 'local-bundled' | 'local-download';
}

export interface OcrEngineAvailability {
  engineId: string;
  engineVersion: string;
  state: 'ready' | 'unavailable';
  detail?: string;
  coreBytes?: number;
  languagePacks: readonly OcrLanguagePack[];
}

export interface OcrDecisionPolicy {
  maximumRequiredDownloadBytes: number;
  /** Required for every enabled non-Quick profile. Its channel must be `text`. */
  benchmarkPolicy?: AgentTimelineBenchmarkGatePolicy;
}

export type OcrDecisionStatus =
  | 'enabled'
  | 'disabled'
  | 'unavailable'
  | 'requires-local-download'
  | 'blocked';

export type OcrDecisionReason =
  | 'quick-profile-disabled'
  | 'engine-unavailable'
  | 'language-pack-unavailable'
  | 'language-pack-download-required'
  | 'download-budget-exceeded'
  | 'benchmark-evidence-required'
  | 'benchmark-gate-failed';

export interface OcrDecision {
  status: OcrDecisionStatus;
  profile: AgentTimelineProfile;
  requiredLanguages: readonly string[];
  requiredDownloadBytes: number;
  reasons: readonly OcrDecisionReason[];
  benchmarkMeasurementIds: readonly string[];
}

export interface OcrGateInput {
  profile: AgentTimelineProfile;
  languages: readonly string[];
  availability: OcrEngineAvailability;
  policy: OcrDecisionPolicy;
  measurements?: readonly AgentTimelineBenchmarkMeasurement[];
}

export interface OcrPipelineRequest {
  sourceIdentityHash: string;
  profile: AgentTimelineProfile;
  analyzerId: string;
  analyzerVersion: string;
  modelId: string;
  modelVersion: string;
  languages: readonly string[];
  candidates: readonly OcrFrameCandidate[];
  policy: OcrDecisionPolicy;
  measurements?: readonly AgentTimelineBenchmarkMeasurement[];
}

export interface OcrPipelineResult {
  schemaVersion: typeof AGENT_TIMELINE_OCR_SCHEMA_VERSION;
  status: 'completed' | 'cancelled' | 'disabled' | 'unavailable' | 'blocked';
  decision: OcrDecision;
  cacheKey: string;
  analyzerId: string;
  analyzerVersion: string;
  modelId: string;
  modelVersion: string;
  events: readonly import('./manifest').AgentTimelineEvent[];
  processedCandidateCount: number;
}
