export const STORYBOARD_SCHEMA_VERSION = 1 as const;

export type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

export type ChatIntent = 'plan' | 'execute';
export type DecisionPolicy = 'automatic' | 'milestones' | 'every-decision';

export type StoryboardSceneStatus =
  | 'draft'
  | 'ready'
  | 'gathering'
  | 'generating'
  | 'review'
  | 'accepted'
  | 'filled'
  | 'blocked';

/**
 * Frozen clip-local projection from plan section 4.1. WP1 may re-export this
 * contract from the timeline type surface without redefining it.
 */
export interface StoryboardClipProperties {
  schemaVersion: 1;
  planId: string;
  sceneId: string;
  title: string;
  description: string;
  intent?: string;
  visualDirection?: string;
  audioDirection?: string;
  transitionIntent?: string;
  sceneKind?: string;
  beatId?: string;
  color?: string;
  targetDurationSeconds: number;
  status: StoryboardSceneStatus;
  generationBriefId?: string;
  selectedCandidateId?: string;
  filledClipIds?: string[];
  evidenceRefIds?: string[];
  variantSetIds?: string[];
  notes?: string;
}

export interface StoryboardPlan {
  schemaVersion: 1;
  id: string;
  title: string;
  description?: string;
  sceneIds: string[];
  templateId?: string;
  targetDurationSeconds?: number;
  aspectRatio?: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * Canonical scene content. Timeline clips later carry a small projection of
 * this record and retain the stable sceneId when clip identities change.
 */
export interface StoryboardScene {
  schemaVersion: 1;
  id: string;
  planId: string;
  title: string;
  description: string;
  intent?: string;
  visualDirection?: string;
  audioDirection?: string;
  transitionIntent?: string;
  sceneKind?: string;
  beatId?: string;
  color?: string;
  targetDurationSeconds: number;
  status: StoryboardSceneStatus;
  generationBriefId?: string;
  selectedCandidateId?: string;
  filledClipIds: string[];
  evidenceRefIds: string[];
  variantSetIds: string[];
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export interface StoryboardCapabilityPolicy {
  mediaType: 'image' | 'video' | 'audio';
  needsImageToVideo?: boolean;
  needsStartEndFrames?: boolean;
  needsNativeAudio?: boolean;
  preferredQuality?: 'draft' | 'balanced' | 'final';
}

export interface StoryboardGenerationBrief {
  schemaVersion: 1;
  id: string;
  sceneId: string;
  revision: number;
  prompt: string;
  negativePrompt?: string;
  visualContinuity?: string;
  camera?: string;
  motion?: string;
  lighting?: string;
  audioIntent?: string;
  durationSeconds: number;
  aspectRatio: string;
  referenceMediaFileIds: string[];
  startFrameMediaFileId?: string;
  endFrameMediaFileId?: string;
  capabilityPolicy: StoryboardCapabilityPolicy;
  createdAt: number;
}

export type StoryboardCandidateKind =
  | 'source-cut'
  | 'generated-image'
  | 'generated-video'
  | 'generated-audio'
  | 'hybrid';

export type StoryboardCandidateState =
  | 'proposed'
  | 'awaiting-approval'
  | 'queued'
  | 'processing'
  | 'ready'
  | 'rejected'
  | 'accepted'
  | 'failed'
  | 'canceled';

export interface StoryboardCandidate {
  schemaVersion: 1;
  id: string;
  sceneId: string;
  kind: StoryboardCandidateKind;
  state: StoryboardCandidateState;
  generationBriefRevision?: number;
  generationRequestKey?: string;
  generationRecordId?: string;
  outputId?: string;
  mediaFileId?: string;
  sourceMomentHandles: string[];
  variantSetId?: string;
  variantOptionId?: string;
  durationSeconds?: number;
  estimatedCredits?: number;
  actualCredits?: number;
  rationale?: string;
  createdAt: number;
}

interface StoryboardEvidenceBase {
  schemaVersion: 1;
  id: string;
  sceneId: string;
  createdAt: number;
}

export type StoryboardEvidenceRef =
  | StoryboardEvidenceBase & {
      kind: 'transcript-moment';
      handle: string;
      indexVersion: string;
    }
  | StoryboardEvidenceBase & {
      kind: 'source-range';
      mediaFileId: string;
      start: number;
      end: number;
    }
  | StoryboardEvidenceBase & {
      kind: 'generated-candidate';
      candidateId: string;
    }
  | StoryboardEvidenceBase & {
      kind: 'reference-image';
      mediaFileId: string;
    };

export interface StoryboardFingerprint {
  schemaVersion: 1;
  algorithm: 'sha-256';
  value: string;
}

export interface StoryboardCoverage {
  schemaVersion: 1;
  sceneId: string;
  level: 'red' | 'yellow' | 'green';
  sourceScore: number;
  generationReadinessScore: number;
  reasons: string[];
  evaluatedAgainstFingerprint: StoryboardFingerprint;
  evaluatedAt: number;
}

export type StoryboardDecisionKind =
  | 'story'
  | 'evidence'
  | 'generation'
  | 'cut'
  | 'variant'
  | 'duration';

export type StoryboardDecisionState =
  | 'pending'
  | 'resolved'
  | 'dismissed'
  | 'stale';

export interface StoryboardDecisionOption {
  id: string;
  title: string;
  summary: string;
  rationale?: string;
  tradeoffs: string[];
  estimatedCredits?: number;
  preview?: JsonValue;
}

export interface StoryboardDecision {
  schemaVersion: 1;
  id: string;
  kind: StoryboardDecisionKind;
  question: string;
  explanation?: string;
  state: StoryboardDecisionState;
  baseFingerprint: StoryboardFingerprint;
  options: StoryboardDecisionOption[];
  allowMultiple: boolean;
  allowFreeform: boolean;
  selectedOptionIds: string[];
  freeform?: string;
  sceneId?: string;
  variantSetId?: string;
  parentDecisionId?: string;
  createdAt: number;
  resolvedAt?: number;
}

export interface TimelineVariantScope {
  startTime: number;
  endTime: number;
  trackIds: string[];
  includeLinked: boolean;
}

export interface TimelineFragmentTrack {
  localTrackId: string;
  sourceTrackId: string;
  kind: 'video' | 'audio';
}

export interface TimelineFragmentClip {
  localId: string;
  sourceClipId?: string;
  localTrackId: string;
  startOffsetSeconds: number;
  durationSeconds: number;
  payload: JsonObject;
}

export interface TimelineFragmentOwnedPayload {
  ownerClipId: string;
  payload: JsonObject;
}

export interface TimelineFragmentTransition {
  fromClipId?: string;
  toClipId?: string;
  payload: JsonObject;
}

export interface TimelineFragmentLink {
  fromClipId: string;
  toClipId: string;
}

export interface TimelineFragment {
  schemaVersion: 1;
  durationSeconds: number;
  tracks: TimelineFragmentTrack[];
  clips: TimelineFragmentClip[];
  links: TimelineFragmentLink[];
  keyframes: TimelineFragmentOwnedPayload[];
  effects: TimelineFragmentOwnedPayload[];
  masks: TimelineFragmentOwnedPayload[];
  transitions: TimelineFragmentTransition[];
  markers: JsonObject[];
  annotations: JsonObject[];
  sceneIds: string[];
  candidateIds: string[];
  warnings: string[];
}

export type TimelineVariantSetStatus =
  | 'building'
  | 'review'
  | 'stale'
  | 'committed'
  | 'archived';

export type TimelineVariantOptionState =
  | 'planned'
  | 'building'
  | 'ready'
  | 'failed'
  | 'rejected'
  | 'accepted';

export interface TimelineVariantSet {
  schemaVersion: 1;
  id: string;
  title: string;
  baseCompositionId: string;
  sceneIds: string[];
  scope: TimelineVariantScope;
  baseFingerprint: StoryboardFingerprint;
  boundaryFingerprint: StoryboardFingerprint;
  status: TimelineVariantSetStatus;
  optionIds: string[];
  committedOptionId?: string;
  createdAt: number;
}

export interface TimelineVariantOptionLineage {
  kind: 'refinement' | 'hybrid';
  parentOptionIds: string[];
  instruction?: string;
  lockedSubranges: Array<{ startTime: number; endTime: number }>;
}

export interface TimelineVariantOption {
  schemaVersion: 1;
  id: string;
  variantSetId: string;
  title: string;
  rationale: string;
  state: TimelineVariantOptionState;
  fragment: TimelineFragment;
  materializedCompositionId?: string;
  candidateIds: string[];
  expectedFingerprint?: StoryboardFingerprint;
  lineage?: TimelineVariantOptionLineage;
}

export type StoryboardGenerationDefaults = Partial<Omit<
  StoryboardGenerationBrief,
  'schemaVersion' | 'id' | 'sceneId' | 'revision' | 'createdAt'
>>;

export interface StoryboardTemplateBeat {
  id: string;
  title: string;
  purpose: string;
  targetShare?: number;
  defaultSceneKind?: string;
  evidenceExpectations: string[];
  generationDefaults?: StoryboardGenerationDefaults;
}

export interface StoryboardTemplate {
  schemaVersion: 1;
  id: string;
  name: string;
  version: number;
  description: string;
  targetDurationSeconds?: number;
  aspectRatio?: string;
  beats: StoryboardTemplateBeat[];
}

export interface StoryboardProjectState {
  schemaVersion: 1;
  plans: Record<string, StoryboardPlan>;
  scenes: Record<string, StoryboardScene>;
  generationBriefs: Record<string, StoryboardGenerationBrief>;
  candidates: Record<string, StoryboardCandidate>;
  evidenceRefs: Record<string, StoryboardEvidenceRef>;
  coverageBySceneId: Record<string, StoryboardCoverage>;
  variantSets: Record<string, TimelineVariantSet>;
  variantOptions: Record<string, TimelineVariantOption>;
  decisions: Record<string, StoryboardDecision>;
  templates: Record<string, StoryboardTemplate>;
}
