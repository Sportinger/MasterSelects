import { useTimelineStore } from '../../../stores/timeline';
import {
  DEFAULT_STORYBOARD_PLAN_ID,
  listStoryboardTimelineScenes,
  type UpdateStoryboardSceneInput,
} from '../../storyboard/core';
import type { StoryboardSceneStatus } from '../../../types/storyboard';
import type { ToolResult } from '../types';

type TimelineStore = ReturnType<typeof useTimelineStore.getState>;

const STORYBOARD_SCENE_STATUSES: readonly StoryboardSceneStatus[] = [
  'draft',
  'ready',
  'gathering',
  'generating',
  'review',
  'accepted',
  'filled',
  'blocked',
];

const STRING_PATCH_KEYS = [
  'title',
  'description',
  'intent',
  'visualDirection',
  'audioDirection',
  'transitionIntent',
  'sceneKind',
  'beatId',
  'color',
  'notes',
] as const satisfies readonly (keyof UpdateStoryboardSceneInput)[];

function failure(error: string): ToolResult {
  return { success: false, error };
}

function optionalString(value: unknown, field: string): string | undefined | ToolResult {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return failure(`${field} must be a string`);
  return value;
}

function optionalPositiveNumber(value: unknown, field: string): number | undefined | ToolResult {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return failure(`${field} must be a finite number greater than zero`);
  }
  return value;
}

function optionalNonNegativeNumber(value: unknown, field: string): number | undefined | ToolResult {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return failure(`${field} must be a finite number greater than or equal to zero`);
  }
  return value;
}

function isFailure(value: unknown): value is ToolResult {
  return Boolean(value && typeof value === 'object' && 'success' in value);
}

function createEditablePatch(
  args: Record<string, unknown>,
): UpdateStoryboardSceneInput | ToolResult {
  const patch: UpdateStoryboardSceneInput = {};
  for (const key of STRING_PATCH_KEYS) {
    const value = optionalString(args[key], key);
    if (isFailure(value)) return value;
    if (value !== undefined) patch[key] = value;
  }

  const targetDurationSeconds = optionalPositiveNumber(
    args.targetDurationSeconds,
    'targetDurationSeconds',
  );
  if (isFailure(targetDurationSeconds)) return targetDurationSeconds;
  if (targetDurationSeconds !== undefined) {
    patch.targetDurationSeconds = targetDurationSeconds;
  }

  if (args.status !== undefined) {
    if (
      typeof args.status !== 'string' ||
      !STORYBOARD_SCENE_STATUSES.includes(args.status as StoryboardSceneStatus)
    ) {
      return failure(`status must be one of: ${STORYBOARD_SCENE_STATUSES.join(', ')}`);
    }
    patch.status = args.status as StoryboardSceneStatus;
  }
  return patch;
}

function describeSceneClip(clip: TimelineStore['clips'][number]) {
  return {
    clipId: clip.id,
    trackId: clip.trackId,
    startTime: clip.startTime,
    durationSeconds: clip.duration,
    ...clip.storyboardProperties,
  };
}

export async function handleAddStoryboardScene(
  args: Record<string, unknown>,
  timelineStore: TimelineStore,
): Promise<ToolResult> {
  const startTime = args.startTime === undefined
    ? timelineStore.playheadPosition
    : optionalNonNegativeNumber(args.startTime, 'startTime');
  if (isFailure(startTime)) return startTime;

  const durationSeconds = optionalPositiveNumber(args.durationSeconds, 'durationSeconds');
  if (isFailure(durationSeconds)) return durationSeconds;
  const patch = createEditablePatch(args);
  if (isFailure(patch)) return patch;

  const trackId = optionalString(args.trackId, 'trackId');
  if (isFailure(trackId)) return trackId;
  const track = trackId
    ? timelineStore.tracks.find(candidate => candidate.id === trackId)
    : timelineStore.tracks.find(candidate =>
      candidate.type === 'video' && !candidate.locked && candidate.visible !== false
    ) ?? timelineStore.tracks.find(candidate =>
      candidate.type === 'video' && !candidate.locked
    );
  if (!track) return failure(trackId ? `Track not found: ${trackId}` : 'No unlocked video track is available');
  if (track.type !== 'video') return failure(`Storyboard scenes require a video track: ${track.id}`);
  if (track.locked) return failure(`Track is locked: ${track.id}`);

  const planIdValue = optionalString(args.planId, 'planId');
  if (isFailure(planIdValue)) return planIdValue;
  const {
    title,
    description,
    targetDurationSeconds,
    status,
    ...properties
  } = patch;
  const clipId = useTimelineStore.getState().addStoryboardClip(
    track.id,
    startTime ?? timelineStore.playheadPosition,
    {
      planId: planIdValue?.trim() || DEFAULT_STORYBOARD_PLAN_ID,
      durationSeconds,
      title,
      description,
      targetDurationSeconds,
      status,
      properties,
    },
  );
  if (!clipId) return failure('The editor could not create the storyboard scene');
  const created = useTimelineStore.getState().clips.find(clip => clip.id === clipId);
  if (!created) return failure(`Created storyboard scene could not be resolved: ${clipId}`);
  return { success: true, data: describeSceneClip(created) };
}

export async function handleUpdateStoryboardScene(
  args: Record<string, unknown>,
  timelineStore: TimelineStore,
): Promise<ToolResult> {
  const sceneId = optionalString(args.sceneId, 'sceneId');
  if (isFailure(sceneId)) return sceneId;
  if (!sceneId?.trim()) return failure('sceneId is required');
  const existing = listStoryboardTimelineScenes(timelineStore.clips)
    .filter(clip => clip.storyboardProperties?.sceneId === sceneId);
  if (existing.length === 0) return failure(`Storyboard scene not found: ${sceneId}`);

  const patch = createEditablePatch(args);
  if (isFailure(patch)) return patch;
  if (Object.keys(patch).length === 0) return failure('No storyboard scene fields were supplied');
  const updatedCount = useTimelineStore.getState().updateStoryboardScene(
    sceneId,
    patch,
    { historyLabel: 'Update storyboard scene' },
  );
  const updated = listStoryboardTimelineScenes(useTimelineStore.getState().clips)
    .filter(clip => clip.storyboardProperties?.sceneId === sceneId);
  return {
    success: updatedCount > 0,
    data: {
      sceneId,
      updatedClipCount: updatedCount,
      clips: updated.map(describeSceneClip),
    },
  };
}

export async function handleListStoryboardScenes(
  args: Record<string, unknown>,
  timelineStore: TimelineStore,
): Promise<ToolResult> {
  const planId = optionalString(args.planId, 'planId');
  if (isFailure(planId)) return planId;
  const scenes = listStoryboardTimelineScenes(timelineStore.clips, planId?.trim() || undefined);
  return {
    success: true,
    data: {
      planId: planId?.trim() || null,
      count: scenes.length,
      scenes: scenes.map(describeSceneClip),
    },
  };
}
