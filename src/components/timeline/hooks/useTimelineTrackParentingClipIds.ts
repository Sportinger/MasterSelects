import { useMemo } from 'react';

import type { TimelineTrackProps } from '../types';
import {
  type TimelineTrackShellClip,
} from '../utils/timelineTrackInteractionShellState';
import { buildTimelineTrackParentingClipIds } from '../utils/timelineTrackParentingClipIds';

export function useTimelineTrackParentingClipIds(input: {
  trackClips: readonly TimelineTrackShellClip[];
  selectedClipIds: TimelineTrackProps['selectedClipIds'];
  hoveredClipId: string | null;
  pickWhipDrag: Parameters<typeof buildTimelineTrackParentingClipIds>[0]['pickWhipDrag'];
  parentingEnabled: boolean;
}) {
  const { trackClips, selectedClipIds, hoveredClipId, pickWhipDrag, parentingEnabled } = input;
  return useMemo(() => buildTimelineTrackParentingClipIds(input), [
    hoveredClipId,
    parentingEnabled,
    pickWhipDrag,
    selectedClipIds,
    trackClips,
  ]);
}
