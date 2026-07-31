import type {
  StoryboardCoverage,
  StoryboardEvidenceRef,
  StoryboardGenerationBrief,
  StoryboardProjectState,
} from '../contracts';
import type { MediaFile } from '../../../stores/mediaStore/types';
import type { TimelineClip } from '../../../types/timeline';

export interface StoryboardMomentAlias {
  readonly handle: string;
  readonly indexVersion: string;
}
export interface StoryboardEvidenceMoment {
  readonly handle: string;
  readonly indexVersion: string;
  readonly mediaFileId: string;
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly speaker?: string;
  readonly excerpt?: string;
  readonly facts?: readonly string[];
  readonly legacyHandles?: readonly StoryboardMomentAlias[];
}

export interface StoryboardMomentIndex {
  readonly version: string;
  readonly moments: readonly StoryboardEvidenceMoment[];
}

export type StoryboardEvidenceResolutionStatus =
  | 'current'
  | 'repairable'
  | 'stale'
  | 'missing'
  | 'invalid';

export interface StoryboardEvidenceResolution {
  readonly ref: StoryboardEvidenceRef;
  readonly status: StoryboardEvidenceResolutionStatus;
  readonly label: string;
  readonly detail: string;
  readonly mediaFileId?: string;
  readonly startSeconds?: number;
  readonly endSeconds?: number;
  readonly moment?: StoryboardEvidenceMoment;
  readonly candidateId?: string;
  readonly suggestedRef?: StoryboardEvidenceRef;
}

export interface StoryboardGenerationCapabilityAvailability {
  readonly image?: boolean;
  readonly video?: boolean;
  readonly audio?: boolean;
}

export interface StoryboardCoverageEvaluation {
  readonly coverage: StoryboardCoverage;
  readonly evidence: readonly StoryboardEvidenceResolution[];
  readonly latestBrief?: StoryboardGenerationBrief;
}

export interface EvaluateStoryboardCoverageInput {
  readonly state: StoryboardProjectState;
  readonly sceneId: string;
  readonly mediaFiles: readonly MediaFile[];
  readonly momentIndex?: StoryboardMomentIndex;
  readonly capabilityAvailability?: StoryboardGenerationCapabilityAvailability;
  readonly evaluatedAt: number;
}

export interface StoryboardDurationConstraint {
  readonly minSeconds?: number;
  readonly maxSeconds?: number;
  readonly label?: string;
}

export interface StoryboardDurationInterval {
  readonly clipId: string;
  readonly clipName: string;
  readonly startTime: number;
  readonly endTime: number;
}

export interface StoryboardDurationUnionSegment {
  readonly startTime: number;
  readonly endTime: number;
  readonly clipIds: readonly string[];
}

export interface StoryboardDurationAssessment {
  readonly targetSeconds: number;
  readonly actualSeconds: number;
  readonly deltaSeconds: number;
  readonly deltaPercent: number | null;
  readonly toleranceSeconds: number;
  readonly tone: 'neutral' | 'green' | 'yellow' | 'red';
  readonly toneLabel: string;
  readonly badgeLabel: string;
  readonly accessibleLabel: string;
  readonly intervals: readonly StoryboardDurationInterval[];
  readonly unionSegments: readonly StoryboardDurationUnionSegment[];
  readonly constraint?: StoryboardDurationConstraint;
}

export interface AssessStoryboardDurationInput {
  readonly sceneClip: TimelineClip;
  readonly clips: readonly TimelineClip[];
  readonly constraint?: StoryboardDurationConstraint;
  readonly toleranceSeconds?: number;
}
