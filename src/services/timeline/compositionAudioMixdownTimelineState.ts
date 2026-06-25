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
  if (options.audioElement) {
    const previousClip = useTimelineStore.getState().clips.find((clip) => clip.id === clipId);
    const previousElement = getCompositionMixdownPlaybackElement(previousClip);
    if (previousElement && previousElement !== options.audioElement) {
      detachLegacyTimelineMediaElement(previousElement, {
        disposeAudioRouting: true,
        revokeObjectUrls: true,
      });
    }
  }

  useTimelineStore.setState((state) => ({
    clips: applyCompositionAudioMixdownToClips(state.clips, clipId, result, options),
  }));
}
