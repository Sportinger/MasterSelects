import { providerHasTargetFrame, sameProviderSeekFrame, type FrameSelectionProvider } from './videoSyncFrameSelection';
import { scrubSettleState } from '../scrubSettleState';

export interface VideoSyncFrameProviderPolicyTarget extends FrameSelectionProvider {
  currentTime: number;
  getPendingSeekTime?: () => number | null | undefined;
  hasFrame?: () => boolean;
  getCurrentFrame?: () => unknown;
  isFullMode?: () => boolean;
  isDecodePending?: () => boolean;
  hasBufferedFutureFrame?: (minFrameDelta?: number) => boolean;
  isAdvanceSeekPending?: () => boolean;
}

export interface VideoSyncAudioElementPolicyTarget {
  paused: boolean;
  readyState: number;
  played?: { length: number } | null | undefined;
}

export interface VideoSyncHtmlAudioFallbackTarget {
  paused: boolean;
  readyState: number;
  seeking: boolean;
  currentSrc: string;
  src: string;
}

const FRESH_RUNTIME_FRAME_TOLERANCE = 0.12;

export function videoSyncProviderHasFrame(
  provider:
    | Pick<VideoSyncFrameProviderPolicyTarget, 'hasFrame' | 'getCurrentFrame'>
    | null
    | undefined
): boolean {
  if (!provider) {
    return false;
  }

  return (provider.hasFrame?.() ?? false) || !!provider.getCurrentFrame?.();
}

export function selectPausedWebCodecsProvider<
  TClipProvider extends VideoSyncFrameProviderPolicyTarget,
  TRuntimeProvider extends VideoSyncFrameProviderPolicyTarget
>(
  clipProvider: TClipProvider | null | undefined,
  runtimeProvider: TRuntimeProvider | null | undefined,
  targetTime: number,
  options?: { preferFreshRuntime?: boolean }
): TClipProvider | TRuntimeProvider | null {
  const preferFreshRuntime = options?.preferFreshRuntime === true;
  const providerDistance = (
    provider: VideoSyncFrameProviderPolicyTarget | null | undefined
  ): number => {
    if (!provider?.isFullMode?.()) {
      return Number.POSITIVE_INFINITY;
    }
    if (!videoSyncProviderHasFrame(provider)) {
      return Number.POSITIVE_INFINITY;
    }
    if (providerHasTargetFrame(provider, targetTime)) return 0;
    const effectiveTime = provider.getPendingSeekTime?.() ?? provider.currentTime;
    return Number.isFinite(effectiveTime)
      ? Math.abs(effectiveTime - targetTime)
      : Number.POSITIVE_INFINITY;
  };

  const clipPlayer = clipProvider?.isFullMode?.() ? clipProvider : null;
  const runtimeIsFullMode = !!runtimeProvider?.isFullMode?.();
  const runtimeHasFrame = videoSyncProviderHasFrame(runtimeProvider);
  const runtimeEffectiveTime = runtimeProvider?.getPendingSeekTime?.() ?? runtimeProvider?.currentTime;

  if (
    runtimeIsFullMode &&
    runtimeHasFrame &&
    runtimeEffectiveTime !== undefined &&
    providerHasTargetFrame(runtimeProvider!, targetTime)
  ) {
    return runtimeProvider ?? null;
  }

  const clipHasFrame = videoSyncProviderHasFrame(clipPlayer);
  const runtimeDistance = providerDistance(runtimeProvider);
  const clipDistance = providerDistance(clipPlayer);

  if (!clipPlayer) {
    return runtimeHasFrame && runtimeIsFullMode ? runtimeProvider ?? null : null;
  }

  if (preferFreshRuntime && runtimeIsFullMode) {
    const runtimeIsFresh = runtimeHasFrame && runtimeDistance <= FRESH_RUNTIME_FRAME_TOLERANCE;
    const clipIsFresh = clipHasFrame && clipDistance <= FRESH_RUNTIME_FRAME_TOLERANCE;

    if (runtimeIsFresh && runtimeDistance <= clipDistance) {
      return runtimeProvider ?? null;
    }
    if (clipIsFresh) {
      return clipPlayer;
    }
    return runtimeProvider ?? null;
  }

  if (runtimeHasFrame && runtimeDistance < clipDistance) {
    return runtimeProvider ?? null;
  }

  if (clipHasFrame) {
    return clipPlayer;
  }

  if (runtimeHasFrame && runtimeIsFullMode) {
    return runtimeProvider ?? null;
  }

  return clipPlayer;
}

export function shouldSeekPausedWebCodecsProviderPolicy(
  provider: VideoSyncFrameProviderPolicyTarget | null | undefined,
  targetTime: number,
  options?: { lastPreciseSeekAt?: number; now?: number }
): boolean {
  if (!provider) {
    return false;
  }

  const pendingSeek = provider.getPendingSeekTime?.();
  if (pendingSeek != null && sameProviderSeekFrame(provider, pendingSeek, targetTime)) {
    if (provider.isDecodePending?.()) {
      return false;
    }

    const lastPreciseSeekAt = options?.lastPreciseSeekAt;
    if (
      lastPreciseSeekAt !== undefined &&
      (options?.now ?? performance.now()) - lastPreciseSeekAt < 450
    ) {
      return false;
    }

    return (
      !videoSyncProviderHasFrame(provider) ||
      !providerHasTargetFrame(provider, targetTime)
    );
  }

  if (provider.isDecodePending?.()) {
    return false;
  }

  return !videoSyncProviderHasFrame(provider) || !providerHasTargetFrame(provider, targetTime);
}

export function shouldFastSeekPausedWebCodecsProviderPolicy(
  provider: VideoSyncFrameProviderPolicyTarget | null | undefined,
  targetTime: number,
  state: {
    lastFastSeekTarget?: number;
    lastFastSeekAt?: number;
    now?: number;
  }
): boolean {
  if (!provider) {
    return false;
  }

  const decodeBusy = provider.isDecodePending?.() ?? false;
  const hasFrame = videoSyncProviderHasFrame(provider);
  const effectivePos = provider.getPendingSeekTime?.() ?? provider.currentTime;
  const posDiff = Math.abs(effectivePos - targetTime);
  const targetMovedSinceFastSeek =
    state.lastFastSeekTarget === undefined ||
    Math.abs(state.lastFastSeekTarget - targetTime) > 0.01;
  const staleBusySeek =
    decodeBusy &&
    targetMovedSinceFastSeek &&
    (state.now ?? performance.now()) - (state.lastFastSeekAt ?? 0) > 180;

  return (
    (!decodeBusy || staleBusySeek) &&
    (!hasFrame || posDiff > 0.05 || targetMovedSinceFastSeek)
  );
}

export function shouldUseSequentialScrubSeekPolicy(
  provider: VideoSyncFrameProviderPolicyTarget | null | undefined,
  targetTime: number
): boolean {
  if (!provider || !videoSyncProviderHasFrame(provider)) {
    return false;
  }

  if (provider.isDecodePending?.()) {
    return false;
  }

  const effectivePos = provider.getPendingSeekTime?.() ?? provider.currentTime;
  const delta = targetTime - effectivePos;

  return Math.abs(delta) > 0.01 && Math.abs(delta) <= 4.5;
}

export function isPlaybackProviderReadyForAudioStartPolicy(
  provider: VideoSyncFrameProviderPolicyTarget | null | undefined,
  targetTime: number
): boolean {
  if (!provider || !videoSyncProviderHasFrame(provider)) {
    return false;
  }

  if (provider.isAdvanceSeekPending?.()) {
    return false;
  }

  const effectiveTime = provider.getPendingSeekTime?.() ?? provider.currentTime;
  return (
    Math.abs(effectiveTime - targetTime) <= 0.05 &&
    (provider.hasBufferedFutureFrame?.(0.5) ?? true)
  );
}

export function shouldCorrectPlaybackAudioDriftPolicy(
  audioElement: VideoSyncAudioElementPolicyTarget | null | undefined,
  playbackReadyForAudio: boolean,
  holdScrubRelease: boolean
): boolean {
  if (!audioElement || holdScrubRelease || audioElement.paused) {
    return false;
  }

  if (!playbackReadyForAudio || audioElement.readyState < 2) {
    return false;
  }

  return (audioElement.played?.length ?? 0) > 0;
}

export function canStartLiveHtmlPlaybackFallbackPolicy(
  audioElement: VideoSyncHtmlAudioFallbackTarget | null | undefined,
  playbackReadyForAudio: boolean,
  holdScrubRelease: boolean
): boolean {
  if (!audioElement || playbackReadyForAudio || holdScrubRelease) {
    return false;
  }

  return (
    audioElement.readyState >= 2 &&
    !audioElement.seeking &&
    Boolean(audioElement.currentSrc || audioElement.src)
  );
}

export function shouldHoldScrubReleaseIntoPlaybackPolicy(
  clipId: string,
  provider: VideoSyncFrameProviderPolicyTarget | null | undefined,
  targetTime: number
): boolean {
  const settle = scrubSettleState.get(clipId);
  if (
    !settle ||
    (settle.reason !== 'scrub-stop' && settle.reason !== 'manual-seek') ||
    !scrubSettleState.isPending(clipId)
  ) {
    return false;
  }

  if (!provider || !videoSyncProviderHasFrame(provider)) {
    return true;
  }

  const pendingTarget = provider.getPendingSeekTime?.() ?? provider.currentTime;
  const pendingDiff = Math.abs(pendingTarget - targetTime);
  const displayedDiff = Math.abs(provider.currentTime - targetTime);
  const decodeBusy = provider.isDecodePending?.() ?? false;

  if (pendingDiff <= 0.01 && displayedDiff <= 0.001 && !decodeBusy) {
    scrubSettleState.resolve(clipId);
    return false;
  }

  return true;
}
