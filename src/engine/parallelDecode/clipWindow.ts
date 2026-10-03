import { useTimelineStore } from '../../stores/timeline';
import { createClipSpeedSource, resolveClipSourceTime, videoFrameSourceTime, type SpeedSource } from '../../services/timeline/retime/clipRetime';
export interface ParallelDecodeClipWindow {
  clipId?: string;
  startTime: number;
  duration: number;
  inPoint: number;
  outPoint: number;
  reversed: boolean;
  speed: number;
  timeRemap?: import('../../types/timeline').ClipTimeRemap;
  source?: { type: 'video'; naturalDuration?: number };
  isNested?: boolean;
  mainTimelineStart?: number;
  mainTimelineDuration?: number;
  parentStartTime?: number;
  parentInPoint?: number;
}

export interface ParallelDecodeClipInfo extends ParallelDecodeClipWindow {
  clipId: string;
  clipName: string;
  fileData?: ArrayBuffer;
  loadFileData?: () => Promise<ArrayBuffer>;
  parentClipId?: string;
}

export interface ParallelDecodePrefetchTarget {
  timelineTime: number;
  shouldBlock: boolean;
}

export function timelineToSourceTime(
  clipInfo: ParallelDecodeClipWindow,
  timelineTime: number,
  speedSource?: SpeedSource,
): number {
  let clipLocalTime: number;

  if (clipInfo.mainTimelineStart !== undefined) {
    clipLocalTime = timelineTime - clipInfo.mainTimelineStart;
  } else if (clipInfo.isNested && clipInfo.parentStartTime !== undefined) {
    const compTime = timelineTime - clipInfo.parentStartTime + (clipInfo.parentInPoint || 0);
    clipLocalTime = compTime - clipInfo.startTime;
  } else {
    clipLocalTime = timelineTime - clipInfo.startTime;
  }

  // Parallel preparation retains reduced records. Recover top-level authored timing
  // for initial/lookahead requests; per-frame export overrides use its FrameContext.
  const state = !speedSource && !clipInfo.isNested && clipInfo.clipId
    ? useTimelineStore.getState() : undefined;
  const clip = state?.clips.find(candidate => candidate.id === clipInfo.clipId) ?? clipInfo;
  const source = speedSource ?? createClipSpeedSource(clip,
    state?.clipKeyframes.get(clipInfo.clipId!) ?? []);
  return videoFrameSourceTime(resolveClipSourceTime(clip, clipLocalTime, source));
}

export function isTimeInClipRange(clipInfo: ParallelDecodeClipWindow, timelineTime: number): boolean {
  if (clipInfo.mainTimelineStart !== undefined) {
    const duration = clipInfo.mainTimelineDuration ?? clipInfo.duration;
    return timelineTime >= clipInfo.mainTimelineStart &&
      timelineTime < clipInfo.mainTimelineStart + duration;
  }

  if (clipInfo.isNested && clipInfo.parentStartTime !== undefined) {
    const compTime = timelineTime - clipInfo.parentStartTime + (clipInfo.parentInPoint || 0);
    return compTime >= clipInfo.startTime && compTime < clipInfo.startTime + clipInfo.duration;
  }

  return timelineTime >= clipInfo.startTime && timelineTime < clipInfo.startTime + clipInfo.duration;
}

export function getClipMainTimelineStart(clipInfo: ParallelDecodeClipWindow): number {
  if (clipInfo.mainTimelineStart !== undefined) {
    return clipInfo.mainTimelineStart;
  }

  if (clipInfo.isNested && clipInfo.parentStartTime !== undefined) {
    return clipInfo.parentStartTime - (clipInfo.parentInPoint || 0) + clipInfo.startTime;
  }

  return clipInfo.startTime;
}

export function getClipMainTimelineDuration(clipInfo: ParallelDecodeClipWindow): number {
  return clipInfo.mainTimelineDuration ?? clipInfo.duration;
}

export function getPrefetchTargetForClip(
  clipInfo: ParallelDecodeClipWindow,
  timelineTime: number,
  upcomingClipPrefetchSeconds: number
): ParallelDecodePrefetchTarget | null {
  if (isTimeInClipRange(clipInfo, timelineTime)) {
    return { timelineTime, shouldBlock: true };
  }

  const clipStart = getClipMainTimelineStart(clipInfo);
  if (
    timelineTime < clipStart &&
    clipStart - timelineTime <= upcomingClipPrefetchSeconds
  ) {
    return { timelineTime: clipStart, shouldBlock: false };
  }

  return null;
}
