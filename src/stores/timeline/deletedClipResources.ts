import type { TimelineClip } from '../../types';
import { clearAINodeRuntimeCacheForClip } from '../../services/nodeGraph';
import { vectorAnimationRuntimeManager } from '../../services/vectorAnimation/VectorAnimationRuntimeManager';
import { isVectorAnimationSourceType } from '../../types/vectorAnimation';
import { audioRoutingManager } from '../../services/audioRoutingManager';
import { stopTimelineAudioPlayback } from '../../services/audio/timelineAudioPlaybackStopper';
import { clearMasterAudio, playheadState } from '../../services/layerBuilder/PlayheadState';
import { releaseCompositionMixdownClipRuntime } from '../../services/timeline/compositionAudioMixdownRuntimeResources';
import { blobUrlManager } from './helpers/blobUrlManager';

function detachMediaElement(element: HTMLMediaElement | null | undefined): void {
  if (!element) return;
  if (playheadState.masterAudioElement === element) {
    clearMasterAudio();
  }
  try {
    element.pause();
  } catch {
    // Ignore cleanup errors from detached media elements.
  }
  audioRoutingManager.disposeRoute(element);
  element.removeAttribute('src');
  try {
    element.load();
  } catch {
    // Ignore cleanup errors from detached media elements.
  }
}

export function cleanupDeletedClipResources(deletedClips: readonly TimelineClip[]): void {
  if (deletedClips.length === 0) return;
  stopTimelineAudioPlayback();

  for (const clip of deletedClips) {
    if (clip.source?.type === 'video' && clip.source.videoElement) {
      const video = clip.source.videoElement;
      detachMediaElement(video);
      import('../../engine/WebGPUEngine').then(({ engine }) => engine.cleanupVideo(video));
    }
    if (clip.source?.type === 'audio' && clip.source.audioElement) {
      detachMediaElement(clip.source.audioElement);
    }
    if (clip.mixdownAudio) {
      detachMediaElement(clip.mixdownAudio);
    }
    releaseCompositionMixdownClipRuntime(clip);
    if (isVectorAnimationSourceType(clip.source?.type)) {
      vectorAnimationRuntimeManager.destroyClipRuntime(clip.id, clip.source.type);
    }
    clearAINodeRuntimeCacheForClip(clip.id);
    blobUrlManager.revokeAll(clip.id);
  }
}
