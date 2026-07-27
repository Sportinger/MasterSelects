import { useTimelineStore } from '../../../stores/timeline';
import { collectFaceReviewCandidates } from '../../faceAnalysis/faceReviewCandidates';
import { selectClipAndOpenTab } from '../aiFeedback';
import type { ToolResult } from '../types';
import {
  captureMutationEntitySnapshot,
  describeMutationEntities,
} from './mutationEntityResults';

type TimelineStore = ReturnType<typeof useTimelineStore.getState>;

export async function handleMergeClipFacePeople(
  args: Record<string, unknown>,
  timelineStore: TimelineStore,
): Promise<ToolResult> {
  const clipId = args.clipId as string;
  const sourcePersonId = args.sourcePersonId as string;
  const targetPersonId = args.targetPersonId as string;
  const clip = timelineStore.clips.find(candidate => candidate.id === clipId);
  const people = clip?.analysis?.faceAnalysis?.people;
  if (!clip || !people) return { success: false, error: `Ready face analysis not found: ${clipId}` };
  if (sourcePersonId === targetPersonId) {
    return { success: false, error: 'sourcePersonId and targetPersonId must be different.' };
  }
  if (!people.some(person => person.id === sourcePersonId)) {
    return { success: false, error: `Source person not found: ${sourcePersonId}` };
  }
  if (!people.some(person => person.id === targetPersonId)) {
    return { success: false, error: `Target person not found: ${targetPersonId}` };
  }

  const mutationSnapshot = captureMutationEntitySnapshot(
    'clip',
    useTimelineStore.getState().clips,
  );
  selectClipAndOpenTab(clipId, 'analysis');
  const { mergeFacePeople } = await import('../../faceAnalysis/faceIdentityCorrections');
  await mergeFacePeople(clipId, sourcePersonId, targetPersonId);
  const updated = useTimelineStore.getState().clips.find(candidate => candidate.id === clipId);
  const target = updated?.analysis?.faceAnalysis?.people.find(person => person.id === targetPersonId);
  return {
    success: true,
    data: {
      clipId,
      mergedSourcePersonId: sourcePersonId,
      targetPersonId,
      targetSightings: target?.sampleCount ?? 0,
      remainingPeople: updated?.analysis?.faceAnalysis?.people.length ?? 0,
      persisted: true,
      ...describeMutationEntities(
        mutationSnapshot,
        useTimelineStore.getState().clips,
      ),
    },
  };
}

export async function handleMoveClipFaceAppearance(
  args: Record<string, unknown>,
  timelineStore: TimelineStore,
): Promise<ToolResult> {
  const clipId = args.clipId as string;
  const sourcePersonId = args.sourcePersonId as string;
  const targetPersonId = args.targetPersonId as string;
  const sourceTime = args.sourceTime as number;
  const clip = timelineStore.clips.find(candidate => candidate.id === clipId);
  const people = clip?.analysis?.faceAnalysis?.people;
  if (!clip || !people) return { success: false, error: `Ready face analysis not found: ${clipId}` };
  if (!Number.isFinite(sourceTime)) return { success: false, error: 'sourceTime must be a finite number.' };
  if (sourcePersonId === targetPersonId) {
    return { success: false, error: 'sourcePersonId and targetPersonId must be different.' };
  }
  const source = people.find(person => person.id === sourcePersonId);
  if (!source) return { success: false, error: `Source person not found: ${sourcePersonId}` };
  if (!people.some(person => person.id === targetPersonId)) {
    return { success: false, error: `Target person not found: ${targetPersonId}` };
  }
  const appearance = source.appearances.find(range => sourceTime >= range.start && sourceTime <= range.end);
  if (!appearance) {
    return { success: false, error: `No ${sourcePersonId} appearance contains source time ${sourceTime}.` };
  }

  const mutationSnapshot = captureMutationEntitySnapshot(
    'clip',
    useTimelineStore.getState().clips,
  );
  selectClipAndOpenTab(clipId, 'analysis');
  const { moveFaceAppearance } = await import('../../faceAnalysis/faceIdentityCorrections');
  await moveFaceAppearance(clipId, sourcePersonId, targetPersonId, sourceTime);
  return {
    success: true,
    data: {
      clipId,
      sourcePersonId,
      targetPersonId,
      movedSourceRange: { start: appearance.start, end: appearance.end },
      persisted: true,
      ...describeMutationEntities(
        mutationSnapshot,
        useTimelineStore.getState().clips,
      ),
    },
  };
}

export async function handleAssignClipFaceReviewCandidate(
  args: Record<string, unknown>,
  timelineStore: TimelineStore,
): Promise<ToolResult> {
  const clipId = args.clipId as string;
  const candidateId = args.candidateId as string;
  const targetPersonId = args.targetPersonId as string;
  const clip = timelineStore.clips.find(candidate => candidate.id === clipId);
  const people = clip?.analysis?.faceAnalysis?.people;
  if (!clip || !people) return { success: false, error: `Ready face analysis not found: ${clipId}` };
  if (!people.some(person => person.id === targetPersonId)) {
    return { success: false, error: `Target person not found: ${targetPersonId}` };
  }
  const candidate = collectFaceReviewCandidates(clip.analysis?.frames ?? [])
    .find(review => review.id === candidateId);
  if (!candidate) return { success: false, error: `Needs Review candidate not found: ${candidateId}` };

  const mutationSnapshot = captureMutationEntitySnapshot(
    'clip',
    useTimelineStore.getState().clips,
  );
  selectClipAndOpenTab(clipId, 'analysis');
  const { assignReviewFaces } = await import('../../faceAnalysis/faceIdentityCorrections');
  await assignReviewFaces(clipId, candidate.id, candidate.faceIds, targetPersonId);
  const updated = useTimelineStore.getState().clips.find(item => item.id === clipId);
  const remainingCandidates = collectFaceReviewCandidates(updated?.analysis?.frames ?? []).length;
  return {
    success: true,
    data: {
      clipId,
      candidateId,
      targetPersonId,
      assignedObservations: candidate.observationCount,
      sourceRange: { start: candidate.firstSeen, end: candidate.lastSeen },
      remainingNeedsReview: remainingCandidates,
      persisted: true,
      ...describeMutationEntities(
        mutationSnapshot,
        useTimelineStore.getState().clips,
      ),
    },
  };
}
