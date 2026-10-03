import type { FrameSelectionProvider } from './videoSyncFrameSelection';
import {
  shouldFastSeekPausedWebCodecsProviderPolicy,
  shouldSeekPausedWebCodecsProviderPolicy,
  shouldUseSequentialScrubSeekPolicy,
  videoSyncProviderHasFrame,
} from './videoSyncWebCodecsPolicy';
import type { VideoSyncWebCodecsSeekState } from './videoSyncWebCodecsSeekState';

const MANUAL_TELEPORT_FAST_SEEK_THRESHOLD = 0.35;

export type PausedWebCodecsProvider = FrameSelectionProvider & {
  currentTime: number;
  seek: (time: number) => void;
  scrubSeek?: (time: number) => void;
  fastSeek?: (time: number) => void;
  isPlaying?: boolean;
  pause?: () => void;
  getPendingSeekTime?: () => number | null | undefined;
  isDecodePending?: () => boolean;
  hasFrame?: () => boolean;
  getCurrentFrame?: () => unknown;
};

export function syncPausedWebCodecsProvider(input: {
  readonly provider: PausedWebCodecsProvider | null | undefined;
  readonly providerKey: string;
  readonly targetTime: number;
  readonly isDragging: boolean;
  readonly schedulePreciseSeek: boolean;
  readonly allowSequentialDuringDrag: boolean;
  readonly wcSeeks: VideoSyncWebCodecsSeekState;
  readonly schedulePreciseWcSeek: (
    providerKey: string,
    provider: { seek: (time: number) => void; currentTime: number },
    time: number,
  ) => void;
}): void {
  const {
    provider,
    providerKey,
    targetTime,
    isDragging,
    schedulePreciseSeek,
    allowSequentialDuringDrag,
    wcSeeks,
  } = input;
  if (!provider) return;

  if (provider.isPlaying) {
    provider.pause?.();
  }

  if (isDragging) {
    const interactiveSeek =
      typeof provider.scrubSeek === 'function'
        ? provider.scrubSeek.bind(provider)
        : provider.seek.bind(provider);
    const supportsInteractiveScrub = typeof provider.scrubSeek === 'function';
    const decodeBusy = provider.isDecodePending?.() ?? false;
    const effectivePos = provider.getPendingSeekTime?.() ?? provider.currentTime;
    const dragDelta = Math.abs(effectivePos - targetTime);

    if (allowSequentialDuringDrag && supportsInteractiveScrub) {
      const canRetargetBusyInteractiveSeek =
        decodeBusy &&
        dragDelta >= 0.12 &&
        performance.now() - (wcSeeks.getLastPreciseSeekAt(providerKey) ?? 0) >= 24;
      if (
        (!decodeBusy || canRetargetBusyInteractiveSeek) &&
        (!videoSyncProviderHasFrame(provider) || dragDelta > 0.01)
      ) {
        wcSeeks.clearFastSeek(providerKey);
        interactiveSeek(targetTime);
        wcSeeks.setLastPreciseSeekAt(providerKey, performance.now());
      }
      return;
    }

    if (allowSequentialDuringDrag && shouldUseSequentialScrubSeekPolicy(provider, targetTime)) {
      wcSeeks.clearFastSeek(providerKey);
      interactiveSeek(targetTime);
      return;
    }

    if (shouldFastSeekPausedWebCodecsProviderPolicy(provider, targetTime, {
      lastFastSeekTarget: wcSeeks.getLastFastSeekTarget(providerKey),
      lastFastSeekAt: wcSeeks.getLastFastSeekAt(providerKey),
    })) {
      provider.fastSeek?.(targetTime);
      wcSeeks.setFastSeek(providerKey, targetTime, performance.now());
      if (schedulePreciseSeek) {
        input.schedulePreciseWcSeek(providerKey, provider, targetTime);
      }
    }
    return;
  }

  const effectivePos = provider.getPendingSeekTime?.() ?? provider.currentTime;
  const lastFastSeekTarget = wcSeeks.getLastFastSeekTarget(providerKey);
  const targetMovedSinceFastSeek =
    lastFastSeekTarget === undefined ||
    Math.abs(lastFastSeekTarget - targetTime) > 0.01;
  const shouldPrimeManualTeleport =
    typeof provider.fastSeek === 'function' &&
    targetMovedSinceFastSeek &&
    !provider.isDecodePending?.() &&
    Math.abs(effectivePos - targetTime) >= MANUAL_TELEPORT_FAST_SEEK_THRESHOLD;

  if (shouldPrimeManualTeleport) {
    provider.fastSeek?.(targetTime);
    wcSeeks.setFastSeek(providerKey, targetTime, performance.now());
    return;
  }

  wcSeeks.clearFastSeek(providerKey);
  if (shouldSeekPausedWebCodecsProviderPolicy(provider, targetTime, {
    lastPreciseSeekAt: wcSeeks.getLastPreciseSeekAt(providerKey),
  })) {
    provider.seek(targetTime);
    wcSeeks.setLastPreciseSeekAt(providerKey, performance.now());
  }
}
