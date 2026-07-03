import { useTimelineStore } from '../../stores/timeline';
import type { TimelineClip } from '../../types';
import type { CompositionAudioMixdownRequestResult } from './compositionAudioMixdownCache';
import { applyCompositionAudioMixdownToClips } from './compositionAudioMixdownClipState';
import { detachLegacyTimelineMediaElement } from './timelineClipSourceRuntimeCleanup';

function getCompositionMixdownPlaybackElement(clip: TimelineClip | undefined): HTMLAudioElement | undefined {
  if (!clip) return undefined;
  if (clip.source?.type === 'audio') return clip.source.audioElement;
  return clip.mixdownAudio;
}

export function applyCompositionAudioMixdownToTimelineClip(
  clipId: string,
  result: CompositionAudioMixdownRequestResult,
  options: { audioElement?: HTMLAudioElement } = {},
): void {
  useTimelineStore.setState((state) => {
    if (options.audioElement) {
      const previousElement = getCompositionMixdownPlaybackElement(
        state.clips.find((clip) => clip.id === clipId),
      );
      if (previousElement && previousElement !== options.audioElement) {
        detachLegacyTimelineMediaElement(previousElement, {
          disposeAudioRouting: true,
          revokeObjectUrls: true,
        });
      }
    }

    return { clips: applyCompositionAudioMixdownToClips(state.clips, clipId, result, options) };
  });
}
