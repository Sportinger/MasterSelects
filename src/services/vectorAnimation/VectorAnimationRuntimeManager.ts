import type { TimelineClip } from '../../types';
import type { VectorAnimationClipSettings } from '../../types/vectorAnimation';
import { isVectorAnimationSourceType } from '../../types/vectorAnimation';
import type { LottieRuntimeManager } from './LottieRuntimeManager';
import type { RiveRuntimeManager } from './RiveRuntimeManager';
import type { VectorAnimationRuntimePrepareResult } from './types';
import type { VectorRuntimePrepareOptions } from './vectorRuntimeReporting';

let lottieRuntimeManager: LottieRuntimeManager | null = null;
let lottieRuntimeManagerPromise: Promise<LottieRuntimeManager> | null = null;
let riveRuntimeManager: RiveRuntimeManager | null = null;
let riveRuntimeManagerPromise: Promise<RiveRuntimeManager> | null = null;

function loadLottieRuntimeManager(): Promise<LottieRuntimeManager> {
  lottieRuntimeManagerPromise ??= import('./LottieRuntimeManager').then((module) => {
    lottieRuntimeManager = module.lottieRuntimeManager;
    return module.lottieRuntimeManager;
  });
  return lottieRuntimeManagerPromise;
}

function loadRiveRuntimeManager(): Promise<RiveRuntimeManager> {
  riveRuntimeManagerPromise ??= import('./RiveRuntimeManager').then((module) => {
    riveRuntimeManager = module.riveRuntimeManager;
    return module.riveRuntimeManager;
  });
  return riveRuntimeManagerPromise;
}

function getLottieRuntimeManager(): LottieRuntimeManager | null {
  if (!lottieRuntimeManager) {
    void loadLottieRuntimeManager();
  }
  return lottieRuntimeManager;
}

function getRiveRuntimeManager(): RiveRuntimeManager | null {
  if (!riveRuntimeManager) {
    void loadRiveRuntimeManager();
  }
  return riveRuntimeManager;
}

class VectorAnimationRuntimeManager {
  async prepareClipSource(
    clip: TimelineClip,
    fileOverride?: File,
    runtimeOptions?: VectorRuntimePrepareOptions,
  ): Promise<VectorAnimationRuntimePrepareResult> {
    if (clip.source?.type === 'lottie') {
      return (await loadLottieRuntimeManager()).prepareClipSource(clip, fileOverride, runtimeOptions);
    }
    if (clip.source?.type === 'rive') {
      return (await loadRiveRuntimeManager()).prepareClipSource(clip, fileOverride, runtimeOptions);
    }
    throw new Error(`prepareClipSource called for non-vector clip ${clip.id}`);
  }

  renderClipAtTime(
    clip: TimelineClip,
    timelineTime: number,
    settingsOverride?: VectorAnimationClipSettings,
  ): HTMLCanvasElement | null {
    if (clip.source?.type === 'lottie') {
      return getLottieRuntimeManager()?.renderClipAtTime(clip, timelineTime, settingsOverride)
        ?? clip.source?.textCanvas
        ?? null;
    }
    if (clip.source?.type === 'rive') {
      return getRiveRuntimeManager()?.renderClipAtTime(clip, timelineTime, settingsOverride)
        ?? clip.source?.textCanvas
        ?? null;
    }
    return clip.source?.textCanvas ?? null;
  }

  destroyClipRuntime(clipId: string, sourceType?: unknown): void {
    if (sourceType === 'lottie') {
      lottieRuntimeManager?.destroyClipRuntime(clipId);
      return;
    }
    if (sourceType === 'rive') {
      riveRuntimeManager?.destroyClipRuntime(clipId);
      return;
    }
    lottieRuntimeManager?.destroyClipRuntime(clipId);
    riveRuntimeManager?.destroyClipRuntime(clipId);
  }

  pruneClipRuntimes(knownClipIds: Iterable<string>): void {
    lottieRuntimeManager?.pruneClipRuntimes(knownClipIds);
    riveRuntimeManager?.pruneClipRuntimes(knownClipIds);
  }

  destroyAll(): void {
    lottieRuntimeManager?.destroyAll();
    riveRuntimeManager?.destroyAll();
  }

  isVectorClip(clip: TimelineClip): boolean {
    return isVectorAnimationSourceType(clip.source?.type);
  }
}

export const vectorAnimationRuntimeManager = new VectorAnimationRuntimeManager();
