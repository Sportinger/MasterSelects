// TimelineKeyframes component - Keyframe diamonds/handles

import { memo, useMemo } from 'react';
import type { TimelineKeyframesProps } from './types';

interface KeyframeDisplay {
  kf: ReturnType<TimelineKeyframesProps['getClipKeyframes']>[0];
  clip: TimelineKeyframesProps['clips'][0];
  absTime: number;
}

function TimelineKeyframesComponent({
  trackId,
  property,
  clips,
  selectedKeyframeIds,
  getClipKeyframes,
  onSelectKeyframe,
  timeToPixel,
}: TimelineKeyframesProps) {
  // Get all clips on this track
  const trackClips = useMemo(
    () => clips.filter((c) => c.trackId === trackId),
    [clips, trackId]
  );

  // Get all keyframes once and group by clip/property - O(n) instead of O(n^2)
  const allKeyframes = useMemo(() => {
    const result: KeyframeDisplay[] = [];
    const keyframesByClip = new Map<string, ReturnType<typeof getClipKeyframes>>();

    // Pre-group keyframes by clip ID for O(1) lookups
    trackClips.forEach((clip) => {
      const kfs = getClipKeyframes(clip.id);
      keyframesByClip.set(clip.id, kfs);
    });

    // Now iterate with O(1) lookups
    trackClips.forEach((clip) => {
      const clipKeyframes = keyframesByClip.get(clip.id) || [];
      clipKeyframes
        .filter((k) => k.property === property)
        .forEach((kf) => {
          result.push({
            kf,
            clip,
            absTime: clip.startTime + kf.time,
          });
        });
    });

    return result;
  }, [trackClips, property, getClipKeyframes]);

  return (
    <>
      {allKeyframes.map(({ kf, absTime }) => {
        const xPos = timeToPixel(absTime);
        const isSelected = selectedKeyframeIds.has(kf.id);

        return (
          <div
            key={kf.id}
            className={`keyframe-diamond ${isSelected ? 'selected' : ''}`}
            style={{ left: `${xPos}px` }}
            onClick={(e) => {
              e.stopPropagation();
              onSelectKeyframe(kf.id, e.shiftKey);
            }}
            title={`${property}: ${kf.value.toFixed(3)} @ ${absTime.toFixed(2)}s (${kf.easing})`}
          />
        );
      })}
    </>
  );
}

export const TimelineKeyframes = memo(TimelineKeyframesComponent);
