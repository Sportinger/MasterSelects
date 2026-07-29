export interface ParallelDecodeClipWindow {
  startTime: number;
  duration: number;
  inPoint: number;
  outPoint: number;
  reversed: boolean;
  speed: number;
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

export function timelineToSourceTime(clipInfo: ParallelDecodeClipWindow, timelineTime: number): number {
  let clipLocalTime: number;

  if (clipInfo.mainTimelineStart !== undefined) {
    clipLocalTime = timelineTime - clipInfo.mainTimelineStart;
  } else if (clipInfo.isNested && clipInfo.parentStartTime !== undefined) {
    const compTime = timelineTime - clipInfo.parentStartTime + (clipInfo.parentInPoint || 0);
    clipLocalTime = compTime - clipInfo.startTime;
  } else {
    clipLocalTime = timelineTime - clipInfo.startTime;
  }

  const speedAdjusted = clipLocalTime * (clipInfo.speed || 1);
  const sourceTime = clipInfo.reversed
    ? clipInfo.outPoint - speedAdjusted
    : clipInfo.inPoint + speedAdjusted;

  return Math.max(clipInfo.inPoint, Math.min(sourceTime, clipInfo.outPoint - 0.001));
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
