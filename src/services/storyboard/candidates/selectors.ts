import type {
  StoryboardCandidate,
  StoryboardCandidateState,
  StoryboardProjectState,
  StoryboardScene,
  StoryboardSceneStatus,
} from '../contracts';

const CANDIDATE_STATE_ORDER: Record<StoryboardCandidateState, number> = {
  accepted: 0,
  ready: 1,
  processing: 2,
  queued: 3,
  'awaiting-approval': 4,
  proposed: 5,
  failed: 6,
  canceled: 7,
  rejected: 8,
};

function compareStableStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareCandidates(
  left: StoryboardCandidate,
  right: StoryboardCandidate,
): number {
  return left.createdAt - right.createdAt
    || CANDIDATE_STATE_ORDER[left.state] - CANDIDATE_STATE_ORDER[right.state]
    || compareStableStrings(left.id, right.id);
}

export function selectStoryboardCandidate(
  state: StoryboardProjectState,
  candidateId: string,
): StoryboardCandidate | undefined {
  return state.candidates[candidateId];
}

export function selectStoryboardCandidatesForScene(
  state: StoryboardProjectState,
  sceneId: string,
): StoryboardCandidate[] {
  return Object.values(state.candidates)
    .filter((candidate) => candidate.sceneId === sceneId)
    .sort(compareCandidates);
}

export function selectStoryboardCandidatesForGenerationRecord(
  state: StoryboardProjectState,
  generationRecordId: string,
): StoryboardCandidate[] {
  return Object.values(state.candidates)
    .filter((candidate) => candidate.generationRecordId === generationRecordId)
    .sort((left, right) => (
      compareStableStrings(
        left.outputId ?? left.mediaFileId ?? '',
        right.outputId ?? right.mediaFileId ?? '',
      )
      || compareCandidates(left, right)
    ));
}

export function selectStoryboardCandidateByProvenance(
  state: StoryboardProjectState,
  provenance: {
    generationRecordId: string;
    mediaFileId?: string;
    outputId?: string;
  },
): StoryboardCandidate | undefined {
  return selectStoryboardCandidatesForGenerationRecord(
    state,
    provenance.generationRecordId,
  ).find((candidate) => (
    (!provenance.outputId || candidate.outputId === provenance.outputId)
    && (!provenance.mediaFileId || candidate.mediaFileId === provenance.mediaFileId)
  ));
}

export function deriveStoryboardSceneStatusFromCandidates(
  scene: StoryboardScene,
  candidates: readonly StoryboardCandidate[],
): StoryboardSceneStatus {
  if (scene.filledClipIds.length > 0) return 'filled';
  if (
    (scene.selectedCandidateId
      && candidates.some((candidate) => (
        candidate.id === scene.selectedCandidateId && candidate.state === 'accepted'
      )))
    || candidates.some((candidate) => candidate.state === 'accepted')
  ) {
    return 'accepted';
  }
  if (candidates.some((candidate) => candidate.state === 'ready')) return 'review';
  if (candidates.some((candidate) => (
    candidate.state === 'queued' || candidate.state === 'processing'
  ))) {
    return 'generating';
  }
  if (scene.status === 'generating') return 'ready';
  return scene.status;
}
