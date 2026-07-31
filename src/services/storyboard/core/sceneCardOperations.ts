import type {
  StoryboardClipProperties,
  StoryboardSceneStatus,
} from '../../../types/storyboard';
import type { TimelineClip } from '../../../types/timeline';
import {
  cloneStoryboardClipProperties,
  createStoryboardSceneId,
  type StoryboardSceneIdFactory,
} from './sceneIdentity';

export const DEFAULT_STORYBOARD_SCENE_DURATION_SECONDS = 5;
export const DEFAULT_STORYBOARD_PLAN_ID = 'default-storyboard-plan';
export const STORYBOARD_SOURCE_NATURAL_DURATION = Number.MAX_SAFE_INTEGER;

export interface CreateStoryboardTimelineClipInput {
  trackId: string;
  planId: string;
  startTime: number;
  title?: string;
  description?: string;
  durationSeconds?: number;
  targetDurationSeconds?: number;
  sceneId?: string;
  clipId?: string;
  status?: StoryboardSceneStatus;
  properties?: Partial<Omit<
    StoryboardClipProperties,
    'schemaVersion' | 'planId' | 'sceneId' | 'title' | 'description' |
    'targetDurationSeconds' | 'status'
  >>;
  createSceneId?: StoryboardSceneIdFactory;
}

export interface UpdateStoryboardSceneInput {
  title?: string;
  description?: string;
  intent?: string;
  visualDirection?: string;
  audioDirection?: string;
  transitionIntent?: string;
  sceneKind?: string;
  beatId?: string;
  color?: string;
  targetDurationSeconds?: number;
  status?: StoryboardSceneStatus;
  notes?: string;
}

function positiveFinite(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function cloneDefaultTransform(): TimelineClip['transform'] {
  return {
    opacity: 1,
    blendMode: 'normal',
    position: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1 },
    rotation: { x: 0, y: 0, z: 0 },
  };
}

export function isStoryboardTimelineClip(
  clip: Pick<TimelineClip, 'source' | 'storyboardProperties'>,
): boolean {
  return clip.source?.type === 'storyboard' && !!clip.storyboardProperties;
}

export function createStoryboardTimelineClip(
  input: CreateStoryboardTimelineClipInput,
): TimelineClip {
  const createSceneId = input.createSceneId ?? createStoryboardSceneId;
  const sceneId = input.sceneId?.trim() || createSceneId();
  const title = input.title?.trim() || 'Untitled scene';
  const description = input.description?.trim() || '';
  const duration = positiveFinite(
    input.durationSeconds,
    positiveFinite(input.targetDurationSeconds, DEFAULT_STORYBOARD_SCENE_DURATION_SECONDS),
  );
  const targetDurationSeconds = positiveFinite(input.targetDurationSeconds, duration);
  const clipId = input.clipId?.trim() || `storyboard-${sceneId}`;
  const storyboardProperties: StoryboardClipProperties = {
    schemaVersion: 1,
    planId: input.planId,
    sceneId,
    title,
    description,
    targetDurationSeconds,
    status: input.status ?? 'draft',
    ...input.properties,
  };

  return {
    id: clipId,
    trackId: input.trackId,
    name: title,
    file: new File(
      [JSON.stringify({ planId: input.planId, sceneId })],
      `${sceneId}.storyboard.json`,
      { type: 'application/json' },
    ),
    startTime: Math.max(0, input.startTime),
    duration,
    inPoint: 0,
    outPoint: duration,
    source: {
      type: 'storyboard',
      naturalDuration: STORYBOARD_SOURCE_NATURAL_DURATION,
    },
    storyboardProperties,
    transform: cloneDefaultTransform(),
    effects: [],
    isLoading: false,
    needsReload: false,
  };
}

export function updateStoryboardTimelineClip(
  clip: TimelineClip,
  patch: UpdateStoryboardSceneInput,
): TimelineClip {
  if (!isStoryboardTimelineClip(clip)) return clip;
  const current = cloneStoryboardClipProperties(clip.storyboardProperties)!;
  const nextTitle = patch.title?.trim();
  const targetDurationSeconds = patch.targetDurationSeconds === undefined
    ? current.targetDurationSeconds
    : positiveFinite(patch.targetDurationSeconds, current.targetDurationSeconds);
  const storyboardProperties: StoryboardClipProperties = {
    ...current,
    ...patch,
    title: nextTitle || current.title,
    targetDurationSeconds,
  };
  return {
    ...clip,
    name: nextTitle || clip.name,
    storyboardProperties,
  };
}

export function listStoryboardTimelineScenes(
  clips: readonly TimelineClip[],
  planId?: string,
): TimelineClip[] {
  return clips
    .filter(isStoryboardTimelineClip)
    .filter(clip => !planId || clip.storyboardProperties?.planId === planId)
    .toSorted((left, right) =>
      left.startTime - right.startTime ||
      left.trackId.localeCompare(right.trackId) ||
      left.id.localeCompare(right.id)
    );
}
