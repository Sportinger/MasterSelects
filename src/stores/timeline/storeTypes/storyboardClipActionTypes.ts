import type {
  CreateStoryboardTimelineClipInput,
  UpdateStoryboardSceneInput,
} from '../../../services/storyboard/core';

export type AddStoryboardClipOptions = Partial<Omit<
  CreateStoryboardTimelineClipInput,
  'trackId' | 'startTime' | 'clipId' | 'createSceneId'
>>;

export interface StoryboardClipActions {
  addStoryboardClip: (
    trackId: string,
    startTime: number,
    options?: AddStoryboardClipOptions,
  ) => string | null;
  updateStoryboardScene: (
    sceneId: string,
    patch: UpdateStoryboardSceneInput,
    options?: {
      captureHistory?: boolean;
      historyLabel?: string;
    },
  ) => number;
}
