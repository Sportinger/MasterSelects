import type {
  StoryboardCandidate,
  StoryboardCandidateState,
  StoryboardProjectState,
} from '../contracts';
import {
  adaptFlashBoardGenerationRecord,
  createGenerationCandidateId,
  type AdaptGenerationRecordInput,
} from './generationRecordAdapter';
import {
  deriveStoryboardSceneStatusFromCandidates,
  selectStoryboardCandidatesForScene,
} from './selectors';

function compareStableStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function preserveUserDecision(
  existing: StoryboardCandidate | undefined,
  projected: StoryboardCandidate,
): StoryboardCandidateState {
  if (existing?.state === 'accepted' || existing?.state === 'rejected') {
    return existing.state;
  }
  if (existing?.state === 'ready' && projected.state !== 'ready') return 'ready';
  return projected.state;
}

function mergeProjectedCandidate(
  existing: StoryboardCandidate | undefined,
  projected: StoryboardCandidate,
): StoryboardCandidate {
  if (!existing) return projected;
  const merged: StoryboardCandidate = {
    ...existing,
    ...projected,
    createdAt: existing.createdAt,
    sourceMomentHandles: existing.sourceMomentHandles,
    state: preserveUserDecision(existing, projected),
  };
  if (existing.generationBriefRevision !== undefined) {
    merged.generationBriefRevision = existing.generationBriefRevision;
  }
  if (existing.generationRequestKey !== undefined) {
    merged.generationRequestKey = existing.generationRequestKey;
  }
  return merged;
}

function alignProjectedCandidateIds(
  state: StoryboardProjectState,
  input: AdaptGenerationRecordInput,
  projected: readonly StoryboardCandidate[],
): StoryboardCandidate[] {
  const existing = Object.values(state.candidates)
    .filter((candidate) => (
      candidate.sceneId === input.sceneId
      && candidate.generationRecordId === input.record.id
    ))
    .sort((left, right) => (
      left.createdAt - right.createdAt || compareStableStrings(left.id, right.id)
    ));
  const claimedIds = new Set<string>();

  return projected.map((candidate) => {
    const exact = existing.find((entry) => (
      !claimedIds.has(entry.id)
      && (
        (candidate.outputId && entry.outputId === candidate.outputId)
        || (candidate.mediaFileId && entry.mediaFileId === candidate.mediaFileId)
      )
    ));
    const prepared = exact ?? existing.find((entry) => (
      !claimedIds.has(entry.id)
      && !entry.outputId
      && !entry.mediaFileId
    ));
    if (!prepared) return candidate;
    claimedIds.add(prepared.id);
    return { ...candidate, id: prepared.id };
  });
}

function removeSupersededPendingCandidate(
  candidates: Record<string, StoryboardCandidate>,
  input: AdaptGenerationRecordInput,
  projected: readonly StoryboardCandidate[],
): Record<string, StoryboardCandidate> {
  if (projected.length === 1 && !projected[0].outputId && !projected[0].mediaFileId) {
    return candidates;
  }
  const pendingId = createGenerationCandidateId(input.record.id, {});
  const pending = candidates[pendingId];
  if (
    !pending
    || projected.some((candidate) => candidate.id === pendingId)
    || pending.state === 'accepted'
    || pending.state === 'rejected'
    || pending.mediaFileId
  ) {
    return candidates;
  }
  const next = { ...candidates };
  delete next[pendingId];
  return next;
}

export interface ReconcileGenerationRecordResult {
  candidates: StoryboardCandidate[];
  state: StoryboardProjectState;
}

export function reconcileStoryboardGenerationRecord(
  state: StoryboardProjectState,
  input: AdaptGenerationRecordInput,
): ReconcileGenerationRecordResult {
  const scene = state.scenes[input.sceneId];
  if (!scene) {
    throw new Error(`Unknown storyboard scene: ${input.sceneId}`);
  }
  const projected = alignProjectedCandidateIds(
    state,
    input,
    adaptFlashBoardGenerationRecord(input),
  );
  let candidates = removeSupersededPendingCandidate(state.candidates, input, projected);
  candidates = { ...candidates };
  const reconciled = projected.map((candidate) => {
    const merged = mergeProjectedCandidate(candidates[candidate.id], candidate);
    candidates[merged.id] = merged;
    return merged;
  });
  const stateWithCandidates: StoryboardProjectState = {
    ...state,
    candidates,
  };
  const sceneCandidates = selectStoryboardCandidatesForScene(
    stateWithCandidates,
    input.sceneId,
  );
  const status = deriveStoryboardSceneStatusFromCandidates(scene, sceneCandidates);

  return {
    candidates: reconciled,
    state: status === scene.status
      ? stateWithCandidates
      : {
          ...stateWithCandidates,
          scenes: {
            ...state.scenes,
            [scene.id]: {
              ...scene,
              status,
              updatedAt: Math.max(scene.updatedAt, input.record.updatedAt),
            },
          },
        },
  };
}

export function setStoryboardCandidateState(
  state: StoryboardProjectState,
  candidateId: string,
  candidateState: StoryboardCandidateState,
): StoryboardProjectState {
  const candidate = state.candidates[candidateId];
  if (!candidate) throw new Error(`Unknown storyboard candidate: ${candidateId}`);
  if (candidate.state === candidateState) return state;

  const candidates = {
    ...state.candidates,
    [candidateId]: {
      ...candidate,
      state: candidateState,
    },
  };
  const scene = state.scenes[candidate.sceneId];
  if (!scene) return { ...state, candidates };
  const stateWithCandidates = { ...state, candidates };
  const sceneStatus = deriveStoryboardSceneStatusFromCandidates(
    scene,
    selectStoryboardCandidatesForScene(stateWithCandidates, scene.id),
  );
  return {
    ...stateWithCandidates,
    scenes: sceneStatus === scene.status
      ? state.scenes
      : {
          ...state.scenes,
          [scene.id]: { ...scene, status: sceneStatus },
        },
  };
}
