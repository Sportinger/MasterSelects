import type { TimelineClip } from '../../types';
import { useTimelineStore } from '../../stores/timeline';
import {
  createCompositionMixdownAudioElement,
  getCompositionAudioMixdownKey,
  requestCompositionAudioMixdown,
} from '../timeline/compositionAudioMixdownCache';
import { applyCompositionAudioMixdownToTimelineClip } from '../timeline/compositionAudioMixdownTimelineState';
import { resolveAudioSyncMedia } from './audioSyncMediaResolver';
import { shouldUseInlineCompositionMixdown } from '../timeline/compositionAudioClipLinks';

export class AudioTrackCompositionPlaybackMixdownManager {
  private pendingCompositionPlaybackMixdowns = new Set<string>();

  ensureCompositionAudioPlaybackElement(
    clip: TimelineClip,
    attachTo: 'source' | 'mixdown',
  ): HTMLAudioElement | null {
    if (!clip.isComposition || !clip.compositionId) return null;
    if (attachTo === 'mixdown' && !shouldUseInlineCompositionMixdown(useTimelineStore.getState().clips, clip)) {
      return null;
    }

    const syncMedia = resolveAudioSyncMedia(clip);
    if (attachTo === 'source') {
      if (syncMedia.sourceType !== 'audio') return null;
      if (syncMedia.htmlAudioElement) return syncMedia.htmlAudioElement;
    } else if (clip.mixdownAudio) {
      return clip.mixdownAudio;
    }

    const existingBuffer = clip.mixdownBuffer;
    if (existingBuffer && clip.hasMixdownAudio !== false) {
      const element = createCompositionMixdownAudioElement(clip.id, existingBuffer, {
        compositionId: clip.compositionId,
      });
      if (!element) return null;
      applyCompositionAudioMixdownToTimelineClip(clip.id, {
        key: getCompositionAudioMixdownKey(clip) ?? clip.compositionId,
        buffer: existingBuffer,
        waveform: clip.mixdownWaveform ?? clip.waveform ?? [],
        duration: syncMedia.naturalDuration ?? existingBuffer.duration ?? clip.duration,
        hasAudio: true,
      }, { audioElement: element });
      return element;
    }

    const pendingKey = `${attachTo}:${clip.id}`;
    if (this.pendingCompositionPlaybackMixdowns.has(pendingKey)) {
      return null;
    }

    this.pendingCompositionPlaybackMixdowns.add(pendingKey);
    useTimelineStore.setState((state) => ({
      clips: state.clips.map(candidate =>
        candidate.id === clip.id
          ? { ...candidate, mixdownGenerating: true }
          : candidate
      ),
    }));

    void requestCompositionAudioMixdown(clip)
      .then((result) => {
        if (!result) {
          useTimelineStore.setState((state) => ({
            clips: state.clips.map(candidate =>
              candidate.id === clip.id
                ? { ...candidate, mixdownGenerating: false }
                : candidate
            ),
          }));
          return;
        }
        if (!result.hasAudio) {
          applyCompositionAudioMixdownToTimelineClip(clip.id, result);
          return;
        }
        const element = createCompositionMixdownAudioElement(clip.id, result.buffer, {
          compositionId: clip.compositionId,
        });
        if (!element) {
          applyCompositionAudioMixdownToTimelineClip(clip.id, result);
          return;
        }
        applyCompositionAudioMixdownToTimelineClip(clip.id, result, { audioElement: element });
      })
      .finally(() => {
        this.pendingCompositionPlaybackMixdowns.delete(pendingKey);
      });

    return null;
  }
}
