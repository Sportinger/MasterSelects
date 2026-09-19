import { liveInputRuntime } from '../../services/mediaRuntime/liveInputRuntime';
import type { TimelineClip } from '../../stores/timeline/types';

const LIVE_EXPORT_POLL_INTERVAL_MS = 100;

export function isLiveInputClip(
  clip: Pick<TimelineClip, 'source'>,
): boolean {
  return clip.source?.type === 'video' && Boolean(clip.source.liveInputId);
}

export function hasLiveInputClip(
  clips: readonly TimelineClip[],
  depth = 0,
): boolean {
  if (depth > 8) return false;
  return clips.some((clip) => (
    isLiveInputClip(clip) ||
    (clip.nestedClips ? hasLiveInputClip(clip.nestedClips, depth + 1) : false)
  ));
}

export function getLiveInputExportVideo(
  clip: Pick<TimelineClip, 'name' | 'source'>,
): HTMLVideoElement | null {
  const liveInputId = clip.source?.liveInputId;
  if (!liveInputId) return null;
  return liveInputRuntime.getVideoElement(liveInputId, true);
}

export function requireLiveInputExportVideo(
  clip: Pick<TimelineClip, 'name' | 'source'>,
): HTMLVideoElement {
  const video = getLiveInputExportVideo(clip);
  if (video) return video;
  throw new Error(
    `Live Input "${clip.name}" is disconnected. Reconnect it in Properties > Live before exporting.`,
  );
}

export function getLiveInputExportCanvas(
  clip: Pick<TimelineClip, 'source'>,
): HTMLCanvasElement | null {
  const liveInputId = clip.source?.liveInputId;
  return liveInputId ? liveInputRuntime.getPresentationCanvas(liveInputId) : null;
}

export function getLiveInputExportPresentation(
  clip: Pick<TimelineClip, 'source'>,
): { width: number; height: number; rotation: 0 | 90 | 180 | 270 } | null {
  const liveInputId = clip.source?.liveInputId;
  return liveInputId ? liveInputRuntime.getVideoPresentation(liveInputId) : null;
}

export async function waitForLiveInputExportTime(input: {
  startedAtMs: number;
  elapsedSeconds: number;
  isCancelled?: () => boolean;
}): Promise<void> {
  const targetMs = input.startedAtMs + Math.max(0, input.elapsedSeconds) * 1000;
  while (!input.isCancelled?.()) {
    const remainingMs = targetMs - performance.now();
    if (remainingMs <= 0) return;
    await new Promise<void>((resolve) => {
      setTimeout(resolve, Math.min(remainingMs, LIVE_EXPORT_POLL_INTERVAL_MS));
    });
  }
}
