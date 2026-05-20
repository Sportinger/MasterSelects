import type { TimelineClip } from '../../types';
import type { VectorAnimationClipSettings } from '../../types/vectorAnimation';
import { isVectorAnimationSourceType } from '../../types/vectorAnimation';
import { lottieRuntimeManager } from './LottieRuntimeManager';
import { riveRuntimeManager } from './RiveRuntimeManager';
import type { VectorAnimationRuntimePrepareResult } from './types';

class VectorAnimationRuntimeManager {
  async prepareClipSource(
    clip: TimelineClip,
    fileOverride?: File,
  ): Promise<VectorAnimationRuntimePrepareResult> {
    if (clip.source?.type === 'lottie') {
      return lottieRuntimeManager.prepareClipSource(clip, fileOverride);
    }
    if (clip.source?.type === 'rive') {
      return riveRuntimeManager.prepareClipSource(clip, fileOverride);
    }
    throw new Error(`prepareClipSource called for non-vector clip ${clip.id}`);
  }

  renderClipAtTime(
    clip: TimelineClip,
    timelineTime: number,
    settingsOverride?: VectorAnimationClipSettings,
  ): HTMLCanvasElement | null {
    if (clip.source?.type === 'lottie') {
      return lottieRuntimeManager.renderClipAtTime(clip, timelineTime, settingsOverride);
    }
    if (clip.source?.type === 'rive') {
      return riveRuntimeManager.renderClipAtTime(clip, timelineTime, settingsOverride);
    }
    return clip.source?.textCanvas ?? null;
  }

  destroyClipRuntime(clipId: string, sourceType?: unknown): void {
    if (sourceType === 'lottie') {
      lottieRuntimeManager.destroyClipRuntime(clipId);
      return;
    }
    if (sourceType === 'rive') {
      riveRuntimeManager.destroyClipRuntime(clipId);
      return;
    }
    lottieRuntimeManager.destroyClipRuntime(clipId);
    riveRuntimeManager.destroyClipRuntime(clipId);
  }

  pruneClipRuntimes(knownClipIds: Iterable<string>): void {
    lottieRuntimeManager.pruneClipRuntimes(knownClipIds);
    riveRuntimeManager.pruneClipRuntimes(knownClipIds);
  }

  destroyAll(): void {
    lottieRuntimeManager.destroyAll();
    riveRuntimeManager.destroyAll();
  }

  isVectorClip(clip: TimelineClip): boolean {
    return isVectorAnimationSourceType(clip.source?.type);
  }
}

export const vectorAnimationRuntimeManager = new VectorAnimationRuntimeManager();
