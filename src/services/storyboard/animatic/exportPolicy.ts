import type { TimelineClip, TimelineTrack } from '../../../types/timeline';
import { isStoryboardTimelineClip } from '../core/sceneCardOperations';
import type {
  StoryboardAnimaticRenderMode,
  StoryboardExportGuard,
  StoryboardExportWarning,
} from './types';

function visibleTrack(trackId: string, tracks: readonly TimelineTrack[]): boolean {
  return tracks.find(track => track.id === trackId)?.visible !== false;
}

function isFilledVisualClip(candidate: TimelineClip | undefined): boolean {
  return !!candidate?.source && !['audio', 'midi', 'storyboard'].includes(candidate.source.type);
}

export function listUnfilledStoryboardExportWarnings(input: {
  readonly clips: readonly TimelineClip[];
  readonly tracks: readonly TimelineTrack[];
  readonly startTime: number;
  readonly endTime: number;
}): StoryboardExportWarning[] {
  return input.clips
    .filter(isStoryboardTimelineClip)
    .filter(clip => visibleTrack(clip.trackId, input.tracks))
    .filter(clip => clip.startTime < input.endTime && clip.startTime + clip.duration > input.startTime)
    .filter(clip => !(clip.storyboardProperties?.filledClipIds ?? []).some(id =>
      isFilledVisualClip(input.clips.find(candidate => candidate.id === id))
    ))
    .toSorted((left, right) => left.startTime - right.startTime || left.id.localeCompare(right.id))
    .map((clip) => {
      const properties = clip.storyboardProperties!;
      return {
        id: `unfilled:${properties.sceneId}`,
        sceneId: properties.sceneId,
        sceneClipId: clip.id,
        title: properties.title,
        startTime: clip.startTime,
        endTime: clip.startTime + clip.duration,
        message: `Scene "${properties.title}" has no accepted media. Choose Animatic export to render its slate.`,
      };
    });
}

export function resolveStoryboardExportGuard(input: {
  readonly mode: Exclude<StoryboardAnimaticRenderMode, 'preview'>;
  readonly clips: readonly TimelineClip[];
  readonly tracks: readonly TimelineTrack[];
  readonly startTime: number;
  readonly endTime: number;
}): StoryboardExportGuard {
  const warnings = listUnfilledStoryboardExportWarnings(input);
  return {
    mode: input.mode,
    warnings,
    blocked: input.mode === 'normal-export' && warnings.length > 0,
  };
}
