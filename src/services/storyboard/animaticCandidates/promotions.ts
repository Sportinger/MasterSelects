import {
  createStoryboardGenerationBriefRevision,
  selectLatestStoryboardGenerationBrief,
  type StoryboardGenerationBriefRevisionValues,
} from '../generation';
import type {
  StoryboardCandidate,
  StoryboardGenerationBrief,
  StoryboardProjectState,
  StoryboardScene,
} from '../contracts';
import type {
  StoryboardConceptPromotionResult,
  StoryboardConceptPromotionRole,
} from './types';

export interface PromoteStoryboardConceptCandidateInput {
  candidateId: string;
  createdAt: number;
  expectedBriefRevision?: number;
  role: StoryboardConceptPromotionRole;
  state: StoryboardProjectState;
}

export interface RemoveStoryboardConceptPromotionInput {
  candidateId: string;
  createdAt: number;
  expectedBriefRevision?: number;
  state: StoryboardProjectState;
}

function assertPromotableConcept(
  state: StoryboardProjectState,
  candidateId: string,
): {
  brief: StoryboardGenerationBrief;
  candidate: StoryboardCandidate;
  mediaFileId: string;
  scene: StoryboardScene;
} {
  const candidate = state.candidates[candidateId];
  if (!candidate) throw new Error(`Unknown storyboard candidate: ${candidateId}`);
  if (candidate.kind !== 'generated-image') {
    throw new Error('Only generated-image candidates can be promoted as visual concepts.');
  }
  if (
    candidate.state !== 'ready'
    && candidate.state !== 'accepted'
  ) {
    throw new Error('A visual concept must be imported and ready before promotion.');
  }
  if (!candidate.mediaFileId) {
    throw new Error('A visual concept requires an imported mediaFileId before promotion.');
  }
  const scene = state.scenes[candidate.sceneId];
  if (!scene) throw new Error(`Unknown storyboard scene: ${candidate.sceneId}`);
  const brief = selectLatestStoryboardGenerationBrief(state, scene.id);
  if (!brief) {
    throw new Error(`Scene ${scene.id} has no generation brief to revise.`);
  }
  return { brief, candidate, mediaFileId: candidate.mediaFileId, scene };
}

function revisionValuesWithoutConcept(
  brief: StoryboardGenerationBrief,
  mediaFileId: string,
): StoryboardGenerationBriefRevisionValues {
  const {
    schemaVersion: _schemaVersion,
    id: _id,
    sceneId: _sceneId,
    revision: _revision,
    createdAt: _createdAt,
    startFrameMediaFileId,
    endFrameMediaFileId,
    ...values
  } = brief;
  return {
    ...values,
    referenceMediaFileIds: values.referenceMediaFileIds
      .filter((referenceId) => referenceId !== mediaFileId),
    capabilityPolicy: { ...values.capabilityPolicy },
    ...(startFrameMediaFileId && startFrameMediaFileId !== mediaFileId
      ? { startFrameMediaFileId }
      : {}),
    ...(endFrameMediaFileId && endFrameMediaFileId !== mediaFileId
      ? { endFrameMediaFileId }
      : {}),
  };
}

function valuesForRole(
  brief: StoryboardGenerationBrief,
  mediaFileId: string,
  role: StoryboardConceptPromotionRole | null,
): StoryboardGenerationBriefRevisionValues {
  const values = revisionValuesWithoutConcept(brief, mediaFileId);
  if (role === 'visual-reference' || role === 'card-thumbnail-and-generation-reference') {
    values.referenceMediaFileIds = [...values.referenceMediaFileIds, mediaFileId];
  } else if (role === 'start-frame') {
    values.startFrameMediaFileId = mediaFileId;
  } else if (role === 'end-frame') {
    values.endFrameMediaFileId = mediaFileId;
  }
  return values;
}

function updateSelectedConcept(
  state: StoryboardProjectState,
  sceneId: string,
  candidateId: string,
  role: StoryboardConceptPromotionRole | null,
): StoryboardProjectState {
  const scene = state.scenes[sceneId];
  if (!scene) return state;
  const updatedScene = {
    ...scene,
    ...(role === 'card-thumbnail-and-generation-reference'
      ? { selectedCandidateId: candidateId }
      : {}),
  };
  if (
    role !== 'card-thumbnail-and-generation-reference'
    && updatedScene.selectedCandidateId === candidateId
  ) {
    delete updatedScene.selectedCandidateId;
  }
  return {
    ...state,
    scenes: {
      ...state.scenes,
      [sceneId]: updatedScene,
    },
  };
}

function applyPromotion(
  input: RemoveStoryboardConceptPromotionInput,
  role: StoryboardConceptPromotionRole | null,
): StoryboardConceptPromotionResult {
  const { brief, candidate, mediaFileId, scene } = assertPromotableConcept(
    input.state,
    input.candidateId,
  );
  const expectedBriefRevision = input.expectedBriefRevision ?? brief.revision;
  if (expectedBriefRevision !== brief.revision) {
    throw new Error(
      `Concept promotion revision conflict: expected ${expectedBriefRevision}, current ${brief.revision}.`,
    );
  }
  const revised = createStoryboardGenerationBriefRevision(input.state, {
    ...valuesForRole(brief, mediaFileId, role),
    createdAt: input.createdAt,
    expectedPreviousRevision: expectedBriefRevision,
    sceneId: scene.id,
  });
  return {
    candidate,
    createdBriefId: revised.brief.id,
    createdBriefRevision: revised.brief.revision,
    role,
    state: updateSelectedConcept(
      revised.state,
      scene.id,
      candidate.id,
      role,
    ),
  };
}

export function promoteStoryboardConceptCandidate(
  input: PromoteStoryboardConceptCandidateInput,
): StoryboardConceptPromotionResult {
  return applyPromotion(input, input.role);
}

export function removeStoryboardConceptPromotion(
  input: RemoveStoryboardConceptPromotionInput,
): StoryboardConceptPromotionResult {
  return applyPromotion(input, null);
}

export function getStoryboardConceptPromotionRoles(
  state: StoryboardProjectState,
  candidateId: string,
): StoryboardConceptPromotionRole[] {
  const candidate = state.candidates[candidateId];
  if (
    !candidate
    || candidate.kind !== 'generated-image'
    || !candidate.mediaFileId
  ) {
    return [];
  }
  const scene = state.scenes[candidate.sceneId];
  const brief = selectLatestStoryboardGenerationBrief(state, candidate.sceneId);
  if (!scene || !brief) return [];

  const roles: StoryboardConceptPromotionRole[] = [];
  const isReference = brief.referenceMediaFileIds.includes(candidate.mediaFileId);
  if (scene.selectedCandidateId === candidate.id && isReference) {
    roles.push('card-thumbnail-and-generation-reference');
  } else if (isReference) {
    roles.push('visual-reference');
  }
  if (brief.startFrameMediaFileId === candidate.mediaFileId) {
    roles.push('start-frame');
  }
  if (brief.endFrameMediaFileId === candidate.mediaFileId) {
    roles.push('end-frame');
  }
  return roles;
}
