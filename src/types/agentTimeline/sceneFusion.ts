import type {
  AgentTimelineEvent,
  AgentTimelineEventBase,
  AgentTimelineIntervalTime,
  AgentTimelineProvenance,
  AgentTimelineRange,
  SceneBlockEventData,
} from './manifest';

export const SCENE_FUSION_POLICY_VERSION = 'agent-timeline-scene-fusion/v1' as const;
export const SCENE_FUSION_ANALYZER_VERSION = '1.0.0' as const;

export type SceneBoundaryReason =
  | 'range-start'
  | 'shot-gap'
  | 'strong-cut'
  | 'transition-cut'
  | 'setup-reset'
  | 'topic-shift'
  | 'long-silence'
  | 'speaker-change';

export interface SceneBoundaryEvidence {
  reason: SceneBoundaryReason;
  confidence: number;
  sourceEventIds: readonly string[];
  cutScore?: number;
  transition?: string;
  previousSetupId?: string;
  nextSetupId?: string;
  transcriptSimilarity?: number;
  silenceDuration?: number;
  previousSpeakerId?: string;
  nextSpeakerId?: string;
}

export interface RuleBasedSceneBlockData extends SceneBlockEventData {
  boundaryReasons: readonly SceneBoundaryEvidence[];
  boundaryConfidence: number;
  /** One value per shot; `unknown` is explicit rather than inferred. */
  setupSequence: readonly string[];
  sourceEventIds: readonly string[];
}

export type RuleBasedSceneBlockEvent = AgentTimelineEventBase<
  'scene-block',
  RuleBasedSceneBlockData
> & {
  time: AgentTimelineIntervalTime;
};

export type SceneFusionUnknownCode =
  | 'shots-missing'
  | 'shot-coverage-partial'
  | 'setup-evidence-incomplete'
  | 'transcript-evidence-unavailable'
  | 'speaker-evidence-unavailable'
  | 'silence-evidence-unavailable';

export interface SceneFusionUnknown {
  code: SceneFusionUnknownCode;
  range: AgentTimelineRange;
  detail: string;
}

export interface SceneFusionPolicy {
  policyVersion: typeof SCENE_FUSION_POLICY_VERSION;
  cutBoundaryTolerance: number;
  strongCutMinimumScore: number;
  strongCutMinimumConfidence: number;
  minimumBoundaryConfidence: number;
  minimumSceneDuration: number;
  minimumSameSetupShotsBeforeReset: number;
  topicWindowSeconds: number;
  minimumTopicTokens: number;
  topicMaximumSimilarity: number;
  minimumSilenceDuration: number;
  takeMinimumTranscriptSimilarity: number;
  takeMinimumDurationSimilarity: number;
  takeMaximumSourceDistance: number;
}

export interface SceneFusionInput {
  sourceId: string;
  range: AgentTimelineRange;
  events: readonly AgentTimelineEvent[];
  policy?: Partial<Omit<SceneFusionPolicy, 'policyVersion'>>;
}

export interface SceneFusionCoverage {
  status: 'complete' | 'partial' | 'missing';
  covered: readonly AgentTimelineRange[];
  missing: readonly AgentTimelineRange[];
}

export type SceneCandidateKind = 'take-candidate' | 'redundancy-candidate';

export interface SceneCandidateEvidence {
  sameSetupSequence: true;
  setupSequence: readonly string[];
  transcriptSimilarity: number;
  exactNormalizedTranscript: boolean;
  durationSimilarity: number;
  sameSpeakerSequence: true;
  speakerSequence: readonly string[];
  sourceDistance: number;
}

export interface SceneCandidateMemberReview {
  sceneEventId: string;
  qualityIssueCount: number;
  criticalQualityIssueCount: number;
  qualityEventIds: readonly string[];
}

/**
 * Review-only candidate. It is deliberately not a `duplicate-group` event:
 * confirming duplicates/takes remains an explicit annotation operation.
 */
export interface SceneCandidateGroup {
  id: string;
  kind: SceneCandidateKind;
  disposition: 'review-required';
  sourceId: string;
  memberSceneEventIds: readonly string[];
  confidence: number;
  evidence: readonly SceneCandidateEvidence[];
  memberReview: readonly SceneCandidateMemberReview[];
  provenance: readonly AgentTimelineProvenance[];
}

export interface SceneFusionResult {
  policy: SceneFusionPolicy;
  range: AgentTimelineRange;
  coverage: SceneFusionCoverage;
  sceneEvents: readonly RuleBasedSceneBlockEvent[];
  candidateGroups: readonly SceneCandidateGroup[];
  unknowns: readonly SceneFusionUnknown[];
}
