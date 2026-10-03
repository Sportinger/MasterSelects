import { createStoreSpeedSource, resolveClipSourceTime, videoFrameSourceTime } from '../timeline/retime/clipRetime';
import { FRAME_TOLERANCE } from '../../stores/timeline/constants';
import type { TimelineClip } from '../../types/timeline';
import { peekRuntimeFrameProvider } from '../mediaRuntime/runtimePlayback';

export interface RamPreviewTimeDeps {
  getSourceTimeForClip: (clipId: string, localTime: number) => number;
  getInterpolatedSpeed: (clipId: string, time: number) => number;
}

export function getRamPreviewClipTime(
  clip: TimelineClip,
  timelineTime: number,
  deps: RamPreviewTimeDeps
): number {
  const clipLocalTime = timelineTime - clip.startTime;
  return videoFrameSourceTime(resolveClipSourceTime(clip, clipLocalTime, createStoreSpeedSource(clip.id, deps)));
}

export function getNestedRamPreviewClipTime(
  compositionTime: number,
  nestedClip: TimelineClip
): number {
  const nestedLocalTime = compositionTime - nestedClip.startTime;
  return videoFrameSourceTime(resolveClipSourceTime(nestedClip, nestedLocalTime));
}

export function verifyRamPreviewVideoPositions(
  timelineTime: number,
  clipsAtTime: TimelineClip[],
  deps: RamPreviewTimeDeps,
  getRuntimeSource: (clip: TimelineClip) => TimelineClip['source']
): boolean {
  for (const clip of clipsAtTime) {
    if (clip.source?.type !== 'video' || !clip.source.videoElement) continue;

    const video = clip.source.videoElement;
    const runtimeProvider = peekRuntimeFrameProvider(getRuntimeSource(clip));
    const expectedTime = getRamPreviewClipTime(clip, timelineTime, deps);
    const actualTime = runtimeProvider?.isFullMode()
      ? runtimeProvider.currentTime
      : video.currentTime;

    if (Math.abs(actualTime - expectedTime) > FRAME_TOLERANCE) {
      return false;
    }
  }
  return true;
}
