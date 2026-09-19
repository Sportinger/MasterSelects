import { useMemo } from 'react';
import type { Keyframe } from '../../../types/keyframes';
import { useTimelineStore } from '../../../stores/timeline';
import {
  buildFlockDisplayClipKeyframes,
  type FlockDisplayClipTiming,
} from '../utils/flockKeyframeDisplay';

/**
 * Keyframe map for timeline display and interaction surfaces, with flock
 * source-time keys re-expressed in clip-local seconds. Render/playback paths
 * must keep using the store map.
 */
export function useFlockDisplayClipKeyframes(
  clips: readonly FlockDisplayClipTiming[],
  clipKeyframes: Map<string, Keyframe[]>,
): Map<string, Keyframe[]> {
  const getSourceTimeForClip = useTimelineStore((state) => state.getSourceTimeForClip);
  return useMemo(
    () => buildFlockDisplayClipKeyframes(clips, clipKeyframes, getSourceTimeForClip),
    [clips, clipKeyframes, getSourceTimeForClip],
  );
}
