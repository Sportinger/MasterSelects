// Timeline Helper Functions Hook

import { useCallback, useMemo } from 'react';
import type { TimelineClip, Keyframe } from '../../../types';
import { parseTimelineClock } from '../utils/parseTimelineClock';
import { createTimelineGridPlan, formatTimelineClock } from '../utils/timelineGrid';

interface UseTimelineHelpersProps {
  zoom: number;
  frameRate?: number | null;
  clips: TimelineClip[];
  getClipKeyframes: (clipId: string) => Keyframe[];
}

export function useTimelineHelpers({ zoom, frameRate, clips, getClipKeyframes }: UseTimelineHelpersProps) {
  // Time conversion helpers
  const timeToPixel = useCallback((time: number) => time * zoom, [zoom]);
  const pixelToTime = useCallback((pixel: number) => pixel / zoom, [zoom]);

  const gridPlan = useMemo(
    () => createTimelineGridPlan({ zoom, frameRate }),
    [frameRate, zoom],
  );
  const gridInterval = gridPlan.minorIntervalSeconds;
  const gridSize = gridPlan.timeIntervalPixels;

  // Format time as MM:SS.cc (shared with the piano-roll Time lane, issue #249 §6).
  const formatTime = useCallback((seconds: number) => formatTimelineClock(seconds), []);

  // Get clips at a specific time
  const getClipsAtTime = useCallback(
    (time: number) => {
      return clips.filter((c) => time >= c.startTime && time < c.startTime + c.duration);
    },
    [clips]
  );

  // Get all snap target times (clip edges + keyframes). Playhead snapping uses
  // the last visible frame because clip end times are exclusive.
  const getSnapTargetTimes = useCallback((mode: 'edge' | 'last-frame' = 'edge') => {
    const snapTimes: number[] = [];
    clips.forEach((clip) => {
      const endTime = clip.startTime + clip.duration;
      const lastFrameTime = Math.max(clip.startTime, endTime - gridPlan.frameIntervalSeconds);
      snapTimes.push(clip.startTime);
      snapTimes.push(mode === 'last-frame' ? lastFrameTime : endTime);

      const kfs = getClipKeyframes(clip.id);
      kfs.forEach((kf) => {
        const absTime = clip.startTime + kf.time;
        snapTimes.push(mode === 'last-frame' && absTime >= endTime ? lastFrameTime : absTime);
      });
    });
    return snapTimes;
  }, [clips, getClipKeyframes, gridPlan.frameIntervalSeconds]);

  return {
    timeToPixel,
    pixelToTime,
    gridInterval,
    gridSize,
    gridPlan,
    formatTime,
    parseTime: parseTimelineClock,
    getClipsAtTime,
    getSnapTargetTimes,
  };
}
