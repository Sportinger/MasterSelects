import type {
  StoryboardCandidate,
  StoryboardProjectState,
} from '../contracts';
import { resolveStoryboardAnimaticGenerationProvenance } from './mediaResolver';
import type { StoryboardAnimaticNarrationLink } from './types';

export const STORYBOARD_ANIMATIC_NARRATION_MARKER =
  '[storyboard-animatic-narration:v1]';

function hasNarrationMarker(candidate: StoryboardCandidate): boolean {
  return candidate.rationale?.startsWith(STORYBOARD_ANIMATIC_NARRATION_MARKER)
    === true;
}

function removeNarrationMarker(rationale: string | undefined): string | undefined {
  if (!rationale?.startsWith(STORYBOARD_ANIMATIC_NARRATION_MARKER)) {
    return rationale;
  }
  const remaining = rationale
    .slice(STORYBOARD_ANIMATIC_NARRATION_MARKER.length)
    .trim();
  return remaining || undefined;
}

function withNarrationMarker(rationale: string | undefined): string {
  const remaining = removeNarrationMarker(rationale);
  return remaining
    ? `${STORYBOARD_ANIMATIC_NARRATION_MARKER}\n${remaining}`
    : STORYBOARD_ANIMATIC_NARRATION_MARKER;
}

function updateCandidateRationale(
  candidate: StoryboardCandidate,
  rationale: string | undefined,
): StoryboardCandidate {
  const updated = { ...candidate };
  if (rationale) updated.rationale = rationale;
  else delete updated.rationale;
  return updated;
}

export function linkStoryboardAnimaticNarrationCandidate(
  state: StoryboardProjectState,
  candidateId: string,
): StoryboardProjectState {
  const candidate = state.candidates[candidateId];
  if (!candidate) throw new Error(`Unknown storyboard candidate: ${candidateId}`);
  if (candidate.kind !== 'generated-audio') {
    throw new Error('Animatic narration must link to a generated-audio candidate.');
  }
  if (!candidate.generationRecordId || !candidate.generationRequestKey) {
    throw new Error('Animatic narration requires generation record and request linkage.');
  }
  if (!state.scenes[candidate.sceneId]) {
    throw new Error(`Unknown storyboard scene: ${candidate.sceneId}`);
  }

  const candidates = { ...state.candidates };
  for (const existing of Object.values(state.candidates)) {
    if (
      existing.sceneId !== candidate.sceneId
      || existing.kind !== 'generated-audio'
      || !hasNarrationMarker(existing)
    ) {
      continue;
    }
    candidates[existing.id] = updateCandidateRationale(
      existing,
      removeNarrationMarker(existing.rationale),
    );
  }
  candidates[candidate.id] = updateCandidateRationale(
    candidate,
    withNarrationMarker(candidate.rationale),
  );
  return { ...state, candidates };
}

export function unlinkStoryboardAnimaticNarrationCandidate(
  state: StoryboardProjectState,
  candidateId: string,
): StoryboardProjectState {
  const candidate = state.candidates[candidateId];
  if (!candidate) throw new Error(`Unknown storyboard candidate: ${candidateId}`);
  if (!hasNarrationMarker(candidate)) return state;
  return {
    ...state,
    candidates: {
      ...state.candidates,
      [candidate.id]: updateCandidateRationale(
        candidate,
        removeNarrationMarker(candidate.rationale),
      ),
    },
  };
}

function narrationStateRank(candidate: StoryboardCandidate): number {
  switch (candidate.state) {
    case 'accepted':
      return 0;
    case 'ready':
      return 1;
    case 'processing':
      return 2;
    case 'queued':
      return 3;
    case 'awaiting-approval':
      return 4;
    case 'proposed':
      return 5;
    case 'failed':
      return 6;
    case 'canceled':
      return 7;
    case 'rejected':
      return 8;
  }
}

export function resolveStoryboardAnimaticNarration(
  state: StoryboardProjectState,
  sceneId: string,
): StoryboardAnimaticNarrationLink | null {
  const scene = state.scenes[sceneId];
  if (!scene) throw new Error(`Unknown storyboard scene: ${sceneId}`);
  const candidate = Object.values(state.candidates)
    .filter((entry) => (
      entry.sceneId === sceneId
      && entry.kind === 'generated-audio'
      && hasNarrationMarker(entry)
      && Boolean(entry.generationRecordId)
      && Boolean(entry.generationRequestKey)
    ))
    .toSorted((left, right) => (
      narrationStateRank(left) - narrationStateRank(right)
      || right.createdAt - left.createdAt
      || left.id.localeCompare(right.id)
    ))[0];
  if (!candidate?.generationRecordId || !candidate.generationRequestKey) return null;
  const durationDeltaSeconds = candidate.durationSeconds === undefined
    ? undefined
    : candidate.durationSeconds - scene.targetDurationSeconds;
  return {
    candidateId: candidate.id,
    generationRecordId: candidate.generationRecordId,
    generationRequestKey: candidate.generationRequestKey,
    provenance: resolveStoryboardAnimaticGenerationProvenance(state, candidate),
    sceneId,
    state: candidate.state,
    targetDurationSeconds: scene.targetDurationSeconds,
    ...(candidate.durationSeconds === undefined
      ? {}
      : {
          durationSeconds: candidate.durationSeconds,
          durationDeltaSeconds,
        }),
    ...(candidate.mediaFileId ? { mediaFileId: candidate.mediaFileId } : {}),
  };
}
