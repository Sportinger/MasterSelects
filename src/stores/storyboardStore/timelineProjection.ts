import type {
  StoryboardPlan,
  StoryboardProjectState,
  StoryboardScene,
} from '../../services/storyboard/contracts';
import type { TimelineClip } from '../../types/timeline';
import { cloneStoryboardStoreProjectState } from './projectState';

type StoryboardTimelineClip = TimelineClip & {
  storyboardProperties: NonNullable<TimelineClip['storyboardProperties']>;
};

function isStoryboardClip(clip: TimelineClip): clip is StoryboardTimelineClip {
  return clip.source?.type === 'storyboard' && clip.storyboardProperties !== undefined;
}

function sceneFromClip(
  clip: StoryboardTimelineClip,
  existing: StoryboardScene | undefined,
  now: number,
): StoryboardScene {
  const properties = clip.storyboardProperties;
  const projected: StoryboardScene = {
    schemaVersion: 1,
    id: properties.sceneId,
    planId: properties.planId,
    title: properties.title,
    description: properties.description,
    targetDurationSeconds: properties.targetDurationSeconds,
    status: properties.status,
    filledClipIds: [...(properties.filledClipIds ?? existing?.filledClipIds ?? [])],
    evidenceRefIds: [...(properties.evidenceRefIds ?? existing?.evidenceRefIds ?? [])],
    variantSetIds: [...(properties.variantSetIds ?? existing?.variantSetIds ?? [])],
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    ...(properties.intent === undefined ? {} : { intent: properties.intent }),
    ...(properties.visualDirection === undefined ? {} : { visualDirection: properties.visualDirection }),
    ...(properties.audioDirection === undefined ? {} : { audioDirection: properties.audioDirection }),
    ...(properties.transitionIntent === undefined ? {} : { transitionIntent: properties.transitionIntent }),
    ...(properties.sceneKind === undefined ? {} : { sceneKind: properties.sceneKind }),
    ...(properties.beatId === undefined ? {} : { beatId: properties.beatId }),
    ...(properties.color === undefined ? {} : { color: properties.color }),
    ...(properties.generationBriefId === undefined
      ? existing?.generationBriefId === undefined ? {} : { generationBriefId: existing.generationBriefId }
      : { generationBriefId: properties.generationBriefId }),
    ...(properties.selectedCandidateId === undefined
      ? existing?.selectedCandidateId === undefined ? {} : { selectedCandidateId: existing.selectedCandidateId }
      : { selectedCandidateId: properties.selectedCandidateId }),
    ...(properties.notes === undefined ? {} : { notes: properties.notes }),
  };

  if (existing) {
    const { updatedAt: _existingUpdatedAt, ...existingComparable } = existing;
    const { updatedAt: _projectedUpdatedAt, ...projectedComparable } = projected;
    if (JSON.stringify(existingComparable) === JSON.stringify(projectedComparable)) {
      projected.updatedAt = existing.updatedAt;
    }
  }
  return projected;
}

function planWithProjectedScenes(
  planId: string,
  projectedSceneIds: string[],
  existing: StoryboardPlan | undefined,
  now: number,
): StoryboardPlan {
  const sceneIds = [
    ...projectedSceneIds,
    ...(existing?.sceneIds ?? []).filter((sceneId) => !projectedSceneIds.includes(sceneId)),
  ];
  const plan: StoryboardPlan = existing
    ? { ...existing, sceneIds, updatedAt: now }
    : {
        schemaVersion: 1,
        id: planId,
        title: planId === 'storyboard-plan-default' ? 'Storyboard' : planId,
        sceneIds,
        createdAt: now,
        updatedAt: now,
      };
  if (existing && JSON.stringify(existing.sceneIds) === JSON.stringify(sceneIds)) {
    plan.updatedAt = existing.updatedAt;
  }
  return plan;
}

/**
 * Reconciles durable normalized scene records with timeline card projections.
 * Existing off-timeline scenes and candidate/evidence lineage are retained;
 * visible card fields and timeline order are authoritative.
 */
export function projectStoryboardTimelineClips(
  state: StoryboardProjectState,
  clips: readonly TimelineClip[],
  now = Date.now(),
): StoryboardProjectState {
  const next = cloneStoryboardStoreProjectState(state);
  const cards = clips
    .filter(isStoryboardClip)
    .sort((left, right) => (
      left.startTime - right.startTime
      || left.trackId.localeCompare(right.trackId)
      || left.id.localeCompare(right.id)
    ));
  const projectedSceneIdsByPlan = new Map<string, string[]>();

  for (const card of cards) {
    const { planId, sceneId } = card.storyboardProperties;
    next.scenes[sceneId] = sceneFromClip(card, next.scenes[sceneId], now);
    const sceneIds = projectedSceneIdsByPlan.get(planId) ?? [];
    if (!sceneIds.includes(sceneId)) sceneIds.push(sceneId);
    projectedSceneIdsByPlan.set(planId, sceneIds);
  }

  for (const [planId, sceneIds] of projectedSceneIdsByPlan) {
    next.plans[planId] = planWithProjectedScenes(planId, sceneIds, next.plans[planId], now);
  }
  return next;
}
