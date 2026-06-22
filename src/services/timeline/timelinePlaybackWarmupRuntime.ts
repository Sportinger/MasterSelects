import type { TimelineClip } from '../../types';
import { getRuntimeFrameProvider } from '../mediaRuntime/runtimePlayback';
import { renderHostPort } from '../render/renderHostPort';
import { flags } from '../../engine/featureFlags';

function isWorkerGpuOnlyPlayback(): boolean {
  try {
    return renderHostPort.getTelemetry().mode === 'worker-gpu-only';
  } catch {
    return false;
  }
}

export function getTimelinePlaybackWarmupVideo(
  source: TimelineClip['source'] | undefined,
): HTMLVideoElement | null {
  if (!source?.videoElement) {
    return null;
  }
  if (isWorkerGpuOnlyPlayback() && flags.useFullWebCodecsPlayback) {
    return null;
  }

  const runtimeProvider = getRuntimeFrameProvider(source);
  const frameProvider =
    runtimeProvider?.isFullMode()
      ? runtimeProvider
      : source.webCodecsPlayer?.isFullMode()
        ? source.webCodecsPlayer
        : null;

  return frameProvider?.isFullMode() ? null : source.videoElement;
}
