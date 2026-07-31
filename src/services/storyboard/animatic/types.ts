import type { MediaFile } from '../../../stores/mediaStore/types';
import type { TimelineClip, TimelineTrack } from '../../../types/timeline';

export type StoryboardAnimaticRenderMode = 'preview' | 'animatic-export' | 'normal-export';
export type StoryboardAnimaticCameraMove = 'none' | 'push-in' | 'pull-out';

export interface StoryboardAnimaticSlatePayload {
  readonly title: string;
  readonly description: string;
  readonly status: string;
  readonly targetDurationSeconds: number;
  readonly accentColor: string;
}
export interface StoryboardAnimaticStillPayload {
  readonly clipId: string;
  readonly mediaFileId: string | null;
  readonly imageUrl: string;
  readonly cameraMove: StoryboardAnimaticCameraMove;
  readonly scale: number;
}

export interface StoryboardAnimaticFramePayload {
  readonly schemaVersion: 1;
  readonly mode: StoryboardAnimaticRenderMode;
  readonly kind: 'slate' | 'still-image' | 'real-media';
  readonly sceneId: string;
  readonly sceneClipId: string;
  readonly startTime: number;
  readonly endTime: number;
  readonly localTime: number;
  readonly durationSeconds: number;
  readonly progress: number;
  readonly width: number;
  readonly height: number;
  readonly slate?: StoryboardAnimaticSlatePayload;
  readonly still?: StoryboardAnimaticStillPayload;
  readonly watermark?: string;
}

export interface StoryboardAnimaticResolveInput {
  readonly clips: readonly TimelineClip[];
  readonly tracks: readonly TimelineTrack[];
  readonly mediaFiles: readonly MediaFile[];
  readonly time: number;
  readonly width: number;
  readonly height: number;
  readonly mode: StoryboardAnimaticRenderMode;
  readonly cameraMove?: StoryboardAnimaticCameraMove;
  readonly watermark?: string;
}

export interface StoryboardExportWarning {
  readonly id: string;
  readonly sceneId: string;
  readonly sceneClipId: string;
  readonly title: string;
  readonly startTime: number;
  readonly endTime: number;
  readonly message: string;
}

export interface StoryboardExportGuard {
  readonly mode: Exclude<StoryboardAnimaticRenderMode, 'preview'>;
  readonly warnings: readonly StoryboardExportWarning[];
  readonly blocked: boolean;
}

export interface StoryboardNarrationCue {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly sceneId: string;
  readonly sceneClipId: string;
  readonly startTime: number;
  readonly targetDurationSeconds: number;
  readonly estimatedDurationSeconds: number;
  readonly text: string;
  readonly audioDirection?: string;
  readonly fit: 'fits' | 'fit-scene-to-narration' | 'rewrite-narration-to-fit';
}

export interface StoryboardNarrationPlan {
  readonly schemaVersion: 1;
  readonly kind: 'temporary-storyboard-narration';
  readonly providerSubmission: 'none';
  readonly wordsPerMinute: number;
  readonly cues: readonly StoryboardNarrationCue[];
}
