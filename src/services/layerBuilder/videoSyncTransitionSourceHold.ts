import type { TimelineClip } from '../../types';
import {
  ensureRuntimeFrameProvider,
  getRuntimeFrameProvider,
  updateRuntimePlaybackTime,
} from '../mediaRuntime/runtimePlayback';
import type { RuntimeFrameProvider } from '../mediaRuntime/types';
import { scrubSettleState } from '../scrubSettleState';

type RuntimePlaybackSource = Parameters<typeof updateRuntimePlaybackTime>[0];

export function syncTransitionSourceHold({
  clip,
  video,
  clipRuntimeProvider,
  isInteractivePreview,
  playbackRuntimeSource,
  scrubRuntimeSource,
  clipTime,
  syncPausedWebCodecsProvider,
}: {
  clip: TimelineClip;
  video: HTMLVideoElement | null;
  clipRuntimeProvider: RuntimeFrameProvider | null | undefined;
  isInteractivePreview: boolean;
  playbackRuntimeSource: RuntimePlaybackSource;
  scrubRuntimeSource: RuntimePlaybackSource;
  clipTime: number;
  syncPausedWebCodecsProvider: (
    provider: RuntimeFrameProvider,
    providerKey: string,
    targetTime: number,
    isDragging: boolean,
    schedulePreciseSeek: boolean,
    allowSequentialDuringDrag: boolean,
  ) => void;
}): void {
  const holdRuntimeSource = isInteractivePreview ? scrubRuntimeSource : playbackRuntimeSource;
  updateRuntimePlaybackTime(holdRuntimeSource, clipTime);
  if (isInteractivePreview) {
    void ensureRuntimeFrameProvider(scrubRuntimeSource, 'interactive', clipTime);
  }

  const holdProvider = getRuntimeFrameProvider(holdRuntimeSource) ?? clipRuntimeProvider;
  if (holdProvider?.isPlaying) {
    holdProvider.pause?.();
  }
  if (video && !video.paused) {
    video.pause();
  }
  if (holdProvider?.isFullMode()) {
    syncPausedWebCodecsProvider(
      holdProvider,
      `${clip.id}:transition-hold`,
      clipTime,
      isInteractivePreview,
      true,
      true,
    );
  }
  scrubSettleState.resolve(clip.id);
}
