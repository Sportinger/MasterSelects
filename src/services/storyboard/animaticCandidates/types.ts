import type {
  StoryboardCandidate,
  StoryboardCandidateState,
} from '../contracts';
import type { StoryboardAnimaticCameraMove } from '../animatic';

export type StoryboardConceptPromotionRole =
  | 'visual-reference'
  | 'start-frame'
  | 'end-frame'
  | 'card-thumbnail-and-generation-reference';

export interface StoryboardAnimaticGenerationProvenance {
  candidateId: string;
  generationBriefRevision?: number;
  generationRecordId?: string;
  generationRequestKey?: string;
  negativePrompt?: string;
  outputId?: string;
  prompt?: string;
  referenceMediaFileIds: string[];
  endFrameMediaFileId?: string;
  sourceBriefId?: string;
  startFrameMediaFileId?: string;
}

export type StoryboardAnimaticMedia =
  | {
      candidateId: string;
      durationSeconds: number;
      kind: 'candidate-video';
      mediaFileId: string;
      provenance: StoryboardAnimaticGenerationProvenance;
    }
  | {
      cameraMove: StoryboardAnimaticCameraMove;
      candidateId: string;
      durationSeconds: number;
      kind: 'concept-image';
      mediaFileId: string;
      promotionRoles: StoryboardConceptPromotionRole[];
      provenance: StoryboardAnimaticGenerationProvenance;
    }
  | {
      description: string;
      durationSeconds: number;
      kind: 'scene-slate';
      sceneId: string;
      title: string;
    };

export interface StoryboardAnimaticNarrationLink {
  candidateId: string;
  durationSeconds?: number;
  generationRecordId: string;
  generationRequestKey: string;
  mediaFileId?: string;
  provenance: StoryboardAnimaticGenerationProvenance;
  sceneId: string;
  state: StoryboardCandidateState;
  targetDurationSeconds: number;
  durationDeltaSeconds?: number;
}

export interface StoryboardConceptPromotionResult {
  candidate: StoryboardCandidate;
  createdBriefId: string;
  createdBriefRevision: number;
  role: StoryboardConceptPromotionRole | null;
  state: import('../contracts').StoryboardProjectState;
}
