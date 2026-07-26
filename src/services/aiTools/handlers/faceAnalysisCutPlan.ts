interface TimelineRange {
  start: number;
  end: number;
}

interface FaceTimelineAppearance {
  timelineStart: number;
  timelineEnd: number;
}

interface CutRange {
  timelineStart: number;
  timelineEnd: number;
}

const MIN_RANGE_SECONDS = 0.01;
const MERGE_EPSILON_SECONDS = 0.01;

export function buildKeepOnlyFaceCutPlan(
  clipId: string,
  personId: string,
  timelineRange: TimelineRange,
  appearances: FaceTimelineAppearance[],
) {
  const keepRanges = appearances
    .map(appearance => ({
      timelineStart: Math.max(timelineRange.start, Math.min(appearance.timelineStart, appearance.timelineEnd)),
      timelineEnd: Math.min(timelineRange.end, Math.max(appearance.timelineStart, appearance.timelineEnd)),
    }))
    .filter(range => range.timelineEnd - range.timelineStart >= MIN_RANGE_SECONDS)
    .toSorted((left, right) => left.timelineStart - right.timelineStart)
    .reduce<CutRange[]>((merged, range) => {
      const previous = merged.at(-1);
      if (previous && range.timelineStart <= previous.timelineEnd + MERGE_EPSILON_SECONDS) {
        previous.timelineEnd = Math.max(previous.timelineEnd, range.timelineEnd);
      } else {
        merged.push({ ...range });
      }
      return merged;
    }, []);

  const removeRanges: CutRange[] = [];
  let cursor = timelineRange.start;
  for (const keepRange of keepRanges) {
    if (keepRange.timelineStart - cursor >= MIN_RANGE_SECONDS) {
      removeRanges.push({
        timelineStart: cursor,
        timelineEnd: keepRange.timelineStart,
      });
    }
    cursor = Math.max(cursor, keepRange.timelineEnd);
  }
  if (timelineRange.end - cursor >= MIN_RANGE_SECONDS) {
    removeRanges.push({
      timelineStart: cursor,
      timelineEnd: timelineRange.end,
    });
  }

  return {
    personId,
    keepRanges,
    removeRanges,
    keptSeconds: keepRanges.reduce(
      (total, range) => total + range.timelineEnd - range.timelineStart,
      0,
    ),
    removedSeconds: removeRanges.reduce(
      (total, range) => total + range.timelineEnd - range.timelineStart,
      0,
    ),
    recommendedToolCall: {
      tool: 'cutRangesFromClip',
      args: { clipId, ranges: removeRanges },
    },
    note: 'removeRanges is the complement of keepRanges inside timelineRange. Pass it unchanged to cutRangesFromClip; linked audio is handled automatically.',
  };
}
