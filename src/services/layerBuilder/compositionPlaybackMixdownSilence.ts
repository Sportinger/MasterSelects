import type { TimelineClip } from '../../types/timeline';
import { isSilentGeneratedComposition } from '../timeline/generatedCompositionAudio';
import { getCompositionAudioMixdownKey } from '../timeline/compositionAudioMixdownCache';

export class CompositionPlaybackMixdownSilenceTracker {
  private completedKeys = new Map<string, string>();

  shouldSkip(clip: TimelineClip, key: string | null): boolean {
    return isSilentGeneratedComposition(clip) || (!!key && this.completedKeys.get(clip.id) === key);
  }

  isCurrent(current: TimelineClip | undefined, requestedKey: string | null): boolean {
    return !!current && getCompositionAudioMixdownKey(current) === requestedKey;
  }

  remember(clipId: string, key: string): void {
    this.completedKeys.set(clipId, key);
  }
}
