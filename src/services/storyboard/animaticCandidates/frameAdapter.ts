import type { MediaFile } from '../../../stores/mediaStore/types';
import { resolveStoryboardAnimaticFramePayload } from '../animatic/resolveFramePayload';
import {
  clampAnimaticProgress,
  resolveStillImageScale,
} from '../animatic/stillTiming';
import type {
  StoryboardAnimaticFramePayload,
  StoryboardAnimaticRenderMode,
  StoryboardAnimaticResolveInput,
} from '../animatic/types';
import type { StoryboardProjectState } from '../contracts';
import { resolveStoryboardAnimaticMedia } from './mediaResolver';

const DEFAULT_ACCENT = '#8b5cf6';

export interface ResolveStoryboardCandidateAnimaticFrameInput {
  durationSeconds?: number;
  height: number;
  mediaFiles: readonly MediaFile[];
  mode: StoryboardAnimaticRenderMode;
  sceneClipId: string;
  sceneId: string;
  startTime: number;
  state: StoryboardProjectState;
  time: number;
  watermark?: string;
  width: number;
}

function basePayload(
  input: ResolveStoryboardCandidateAnimaticFrameInput,
  durationSeconds: number,
): Omit<StoryboardAnimaticFramePayload, 'kind'> {
  const duration = Math.max(0.001, durationSeconds);
  const localTime = Math.min(duration, Math.max(0, input.time - input.startTime));
  return {
    schemaVersion: 1,
    mode: input.mode,
    sceneId: input.sceneId,
    sceneClipId: input.sceneClipId,
    startTime: input.startTime,
    endTime: input.startTime + duration,
    localTime,
    durationSeconds: duration,
    progress: clampAnimaticProgress(localTime, duration),
    width: Math.max(1, Math.round(input.width)),
    height: Math.max(1, Math.round(input.height)),
    ...(input.watermark ? { watermark: input.watermark } : {}),
  };
}

export function resolveStoryboardCandidateAnimaticFramePayload(
  input: ResolveStoryboardCandidateAnimaticFrameInput,
): StoryboardAnimaticFramePayload | null {
  const scene = input.state.scenes[input.sceneId];
  if (!scene) throw new Error(`Unknown storyboard scene: ${input.sceneId}`);
  const media = resolveStoryboardAnimaticMedia(input.state, input.sceneId);
  const common = basePayload(
    input,
    input.durationSeconds ?? media.durationSeconds,
  );

  if (media.kind === 'candidate-video') {
    return { ...common, kind: 'real-media' };
  }
  if (input.mode === 'normal-export') return null;

  if (media.kind === 'concept-image') {
    const file = input.mediaFiles.find((candidate) => candidate.id === media.mediaFileId);
    const imageUrl = file?.url || file?.thumbnailUrl;
    if (imageUrl) {
      return {
        ...common,
        kind: 'still-image',
        still: {
          clipId: `storyboard-animatic-candidate:${media.candidateId}`,
          mediaFileId: media.mediaFileId,
          imageUrl,
          cameraMove: media.cameraMove,
          scale: resolveStillImageScale(common.progress, media.cameraMove),
        },
      };
    }
  }

  return {
    ...common,
    kind: 'slate',
    slate: {
      title: scene.title,
      description: scene.description,
      status: scene.status,
      targetDurationSeconds: scene.targetDurationSeconds,
      accentColor: scene.color || DEFAULT_ACCENT,
    },
  };
}

export function resolveStoryboardCandidateAwareAnimaticFramePayload(
  input: StoryboardAnimaticResolveInput & {
    state: StoryboardProjectState;
  },
): StoryboardAnimaticFramePayload | null {
  const timelinePayload = resolveStoryboardAnimaticFramePayload(input);
  if (
    !timelinePayload
    || timelinePayload.kind !== 'slate'
    || input.mode === 'normal-export'
    || !input.state.scenes[timelinePayload.sceneId]
  ) {
    return timelinePayload;
  }

  return resolveStoryboardCandidateAnimaticFramePayload({
    durationSeconds: timelinePayload.durationSeconds,
    height: input.height,
    mediaFiles: input.mediaFiles,
    mode: input.mode,
    sceneClipId: timelinePayload.sceneClipId,
    sceneId: timelinePayload.sceneId,
    startTime: timelinePayload.startTime,
    state: input.state,
    time: input.time,
    watermark: input.watermark,
    width: input.width,
  }) ?? timelinePayload;
}
