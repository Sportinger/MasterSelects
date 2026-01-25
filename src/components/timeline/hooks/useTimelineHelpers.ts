// Timeline Helper Functions Hook

import { useCallback, useMemo } from 'react';
import type { TimelineClip, Keyframe } from '../../../types';

interface UseTimelineHelpersProps {
  zoom: number;
  clips: TimelineClip[];
  getClipKeyframes: (clipId: string) => Keyframe[];
}

export function useTimelineHelpers({ zoom, clips, getClipKeyframes }: UseTimelineHelpersProps) {
  // Time conversion helpers
  const timeToPixel = useCallback((time: number) => time * zoom, [zoom]);
  const pixelToTime = useCallback((pixel: number) => pixel / zoom, [zoom]);

  // Calculate grid interval based on zoom (same logic as TimelineRuler)
  const gridInterval = useMemo(() => {
    if (zoom >= 100) return 0.5;
    if (zoom >= 50) return 1;
    if (zoom >= 20) return 2;
    if (zoom >= 10) return 5;
    if (zoom >= 5) return 10;
    if (zoom >= 2) return 30;
    return 60;
  }, [zoom]);

  const gridSize = gridInterval * zoom; // Grid line spacing in pixels

  // Format time as MM:SS.ms
  const formatTime = useCallback((seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 100);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
  }, []);

  // Parse time string (MM:SS.ms or SS.ms or just seconds) back to seconds
  const parseTime = useCallback((timeStr: string): number | null => {
    const trimmed = timeStr.trim();
    if (!trimmed) return null;

    // Try MM:SS.ms format
    const match = trimmed.match(/^(\d+):(\d+)(?:\.(\d+))?$/);
    if (match) {
      const mins = parseInt(match[1], 10);
      const secs = parseInt(match[2], 10);
      const ms = match[3] ? parseInt(match[3].padEnd(2, '0').slice(0, 2), 10) : 0;
      return mins * 60 + secs + ms / 100;
    }

    // Try SS.ms or just seconds
    const num = parseFloat(trimmed);
    if (!isNaN(num) && num >= 0) {
      return num;
    }

    return null;
  }, []);

  // Get clips at a specific time
  const getClipsAtTime = useCallback(
    (time: number) => {
      return clips.filter((c) => time >= c.startTime && time < c.startTime + c.duration);
    },
    [clips]
  );

  // Get all snap target times (clip edges + keyframes)
  const getSnapTargetTimes = useCallback(() => {
    const snapTimes: number[] = [];
    clips.forEach((clip) => {
      snapTimes.push(clip.startTime);
      snapTimes.push(clip.startTime + clip.duration);

      const kfs = getClipKeyframes(clip.id);
      kfs.forEach((kf) => {
        const absTime = clip.startTime + kf.time;
        snapTimes.push(absTime);
      });
    });
    return snapTimes;
  }, [clips, getClipKeyframes]);

  return {
    timeToPixel,
    pixelToTime,
    gridInterval,
    gridSize,
    formatTime,
    parseTime,
    getClipsAtTime,
    getSnapTargetTimes,
  };
}
