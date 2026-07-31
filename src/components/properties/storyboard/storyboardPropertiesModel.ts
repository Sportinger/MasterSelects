import type {
  StoryboardClipProperties,
  StoryboardSceneStatus,
} from '../../../types/storyboard';
import type { TimelineClip } from '../../../types/timeline';
import {
  cloneStoryboardClipProperties,
  isStoryboardTimelineClip,
} from '../../../services/storyboard/core';

export const STORYBOARD_SCENE_STATUSES: readonly StoryboardSceneStatus[] = [
  'draft',
  'ready',
  'gathering',
  'generating',
  'review',
  'accepted',
  'filled',
  'blocked',
];

export type StoryboardPropertiesEditablePatch = Partial<Pick<
  StoryboardClipProperties,
  | 'title'
  | 'description'
  | 'intent'
  | 'visualDirection'
  | 'audioDirection'
  | 'transitionIntent'
  | 'sceneKind'
  | 'beatId'
  | 'color'
  | 'targetDurationSeconds'
  | 'status'
  | 'notes'
>>;

export interface StoryboardPropertiesClipUpdate {
  name?: string;
  storyboardProperties: StoryboardClipProperties;
}

function nonEmptyTitle(value: string, fallback: string): string {
  return value.trim() || fallback;
}

export function createStoryboardPropertiesClipUpdate(
  clip: Pick<TimelineClip, 'name' | 'source' | 'storyboardProperties'>,
  patch: StoryboardPropertiesEditablePatch,
): StoryboardPropertiesClipUpdate | null {
  if (!isStoryboardTimelineClip(clip)) return null;
  const current = cloneStoryboardClipProperties(clip.storyboardProperties)!;
  const next = {
    ...current,
    ...patch,
  };
  if (patch.title !== undefined) {
    next.title = nonEmptyTitle(patch.title, current.title);
  }
  if (patch.targetDurationSeconds !== undefined) {
    next.targetDurationSeconds = Number.isFinite(patch.targetDurationSeconds) &&
      patch.targetDurationSeconds > 0
      ? patch.targetDurationSeconds
      : current.targetDurationSeconds;
  }
  return {
    name: next.title !== clip.name ? next.title : undefined,
    storyboardProperties: next,
  };
}
