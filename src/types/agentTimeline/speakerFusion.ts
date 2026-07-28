import type {
  ActiveSpeakerEventData,
  AgentTimelineEventBase,
} from './manifest';
import type { SourceIdentity } from './sourceIdentity';

export const SPEAKER_PERSON_FUSION_POLICY_VERSION = 'speaker-person-fusion/v1' as const;
export const SPEAKER_PERSON_ANNOTATION_SCHEMA_VERSION = 'speaker-person-annotations/v1' as const;

export interface SpeakerTurnInput {
  id: string;
  speakerId: string;
  start: number;
  end: number;
  confidence: number;
}

export interface FacePresenceInput {
  id: string;
  sourcePersonId: string;
  sourceTrackId: string;
  start: number;
  end: number;
  confidence: number;
  verified: boolean;
}

export interface MouthMotionCandidateInput {
  turnId: string;
  sourcePersonId: string;
  score: number;
  analyzerId: string;
  analyzerVersion: string;
}

export interface SpeakerFusionPolicy {
  policyVersion: typeof SPEAKER_PERSON_FUSION_POLICY_VERSION;
  mouthMotionMinimumScore: number;
  mouthMotionMinimumMargin: number;
}

export interface ManualSpeakerPersonAnnotation {
  id: string;
  createdAt: string;
  speakerId: string;
  start: number;
  end: number;
  status: 'onscreen' | 'offscreen' | 'unknown';
  sourcePersonId?: string;
}

export interface SpeakerPersonAnnotationLayer {
  schemaVersion: typeof SPEAKER_PERSON_ANNOTATION_SCHEMA_VERSION;
  sourceIdentity: SourceIdentity;
  annotations: ManualSpeakerPersonAnnotation[];
}

export interface OrphanedSpeakerPersonAnnotation {
  annotation: ManualSpeakerPersonAnnotation;
  reason: 'source-identity-mismatch';
}

export type SpeakerFusionReason =
  | 'no-visible-person'
  | 'single-verified-person'
  | 'single-unverified-person'
  | 'multiple-visible-no-scores'
  | 'mouth-score-below-threshold'
  | 'mouth-score-margin-ambiguous'
  | 'mouth-motion-clear-winner'
  | 'manual-correction';

export interface SpeakerPersonFusionEventData extends ActiveSpeakerEventData {
  reason: SpeakerFusionReason;
  sourceTrackIds: string[];
  visiblePersonIds: string[];
}

export type SpeakerPersonFusionEvent = AgentTimelineEventBase<
  'active-speaker',
  SpeakerPersonFusionEventData
>;

export interface SpeakerPersonFusionResult {
  policy: SpeakerFusionPolicy;
  events: SpeakerPersonFusionEvent[];
  orphanedAnnotations: OrphanedSpeakerPersonAnnotation[];
}
