import type {
  StoryboardCandidate,
  StoryboardGenerationBrief,
  StoryboardProjectState,
} from '../contracts';
import { getStoryboardConceptPromotionRoles } from './promotions';
import type {
  StoryboardAnimaticGenerationProvenance,
  StoryboardAnimaticMedia,
} from './types';
import type { StoryboardAnimaticCameraMove } from '../animatic';

export const DEFAULT_STORYBOARD_ANIMATIC_CAMERA_MOVE: StoryboardAnimaticCameraMove =
  'push-in';

function sourceBriefForCandidate(
  state: StoryboardProjectState,
  candidate: StoryboardCandidate,
): StoryboardGenerationBrief | undefined {
  if (candidate.generationBriefRevision === undefined) return undefined;
  return Object.values(state.generationBriefs)
    .filter((brief) => (
      brief.sceneId === candidate.sceneId
      && brief.revision === candidate.generationBriefRevision
    ))
    .toSorted((left, right) => left.id.localeCompare(right.id))[0];
}

export function resolveStoryboardAnimaticGenerationProvenance(
  state: StoryboardProjectState,
  candidate: StoryboardCandidate,
): StoryboardAnimaticGenerationProvenance {
  const sourceBrief = sourceBriefForCandidate(state, candidate);
  return {
    candidateId: candidate.id,
    referenceMediaFileIds: [...(sourceBrief?.referenceMediaFileIds ?? [])],
    ...(candidate.generationBriefRevision === undefined
      ? {}
      : { generationBriefRevision: candidate.generationBriefRevision }),
    ...(candidate.generationRecordId
      ? { generationRecordId: candidate.generationRecordId }
      : {}),
    ...(candidate.generationRequestKey
      ? { generationRequestKey: candidate.generationRequestKey }
      : {}),
    ...(candidate.outputId ? { outputId: candidate.outputId } : {}),
    ...(sourceBrief
      ? {
          sourceBriefId: sourceBrief.id,
          prompt: sourceBrief.prompt,
          ...(sourceBrief.negativePrompt
            ? { negativePrompt: sourceBrief.negativePrompt }
            : {}),
          ...(sourceBrief.startFrameMediaFileId
            ? { startFrameMediaFileId: sourceBrief.startFrameMediaFileId }
            : {}),
          ...(sourceBrief.endFrameMediaFileId
            ? { endFrameMediaFileId: sourceBrief.endFrameMediaFileId }
            : {}),
        }
      : {}),
  };
}

function compareCandidates(
  left: StoryboardCandidate,
  right: StoryboardCandidate,
): number {
  return right.createdAt - left.createdAt || left.id.localeCompare(right.id);
}

function acceptedVideoCandidate(
  state: StoryboardProjectState,
  sceneId: string,
): StoryboardCandidate | undefined {
  const scene = state.scenes[sceneId];
  const candidates = Object.values(state.candidates)
    .filter((candidate) => (
      candidate.sceneId === sceneId
      && candidate.state === 'accepted'
      && Boolean(candidate.mediaFileId)
      && (
        candidate.kind === 'generated-video'
        || candidate.kind === 'source-cut'
        || candidate.kind === 'hybrid'
      )
    ))
    .toSorted(compareCandidates);
  return candidates.find((candidate) => candidate.id === scene?.selectedCandidateId)
    ?? candidates[0];
}

export function resolveStoryboardAnimaticMedia(
  state: StoryboardProjectState,
  sceneId: string,
  options: { cameraMove?: StoryboardAnimaticCameraMove } = {},
): StoryboardAnimaticMedia {
  const scene = state.scenes[sceneId];
  if (!scene) throw new Error(`Unknown storyboard scene: ${sceneId}`);

  const video = acceptedVideoCandidate(state, sceneId);
  if (video?.mediaFileId) {
    return {
      kind: 'candidate-video',
      candidateId: video.id,
      mediaFileId: video.mediaFileId,
      durationSeconds: video.durationSeconds ?? scene.targetDurationSeconds,
      provenance: resolveStoryboardAnimaticGenerationProvenance(state, video),
    };
  }

  const selected = scene.selectedCandidateId
    ? state.candidates[scene.selectedCandidateId]
    : undefined;
  const promotionRoles = selected
    ? getStoryboardConceptPromotionRoles(state, selected.id)
    : [];
  if (
    selected?.kind === 'generated-image'
    && (selected.state === 'ready' || selected.state === 'accepted')
    && selected.mediaFileId
    && promotionRoles.includes('card-thumbnail-and-generation-reference')
  ) {
    return {
      kind: 'concept-image',
      cameraMove: options.cameraMove ?? DEFAULT_STORYBOARD_ANIMATIC_CAMERA_MOVE,
      candidateId: selected.id,
      durationSeconds: selected.durationSeconds ?? scene.targetDurationSeconds,
      mediaFileId: selected.mediaFileId,
      promotionRoles,
      provenance: resolveStoryboardAnimaticGenerationProvenance(state, selected),
    };
  }

  return {
    kind: 'scene-slate',
    description: scene.description,
    durationSeconds: scene.targetDurationSeconds,
    sceneId,
    title: scene.title,
  };
}
