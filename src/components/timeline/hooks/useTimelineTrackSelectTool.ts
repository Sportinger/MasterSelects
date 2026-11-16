import { useCallback } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { useTimelineStore } from '../../../stores/timeline';
import type { TimelineToolId } from '../../../stores/timeline/storeTypes/toolTypes';
import { buildTrackSelectOperation, isTimelineTrackSelectTool } from '../tools/pointer/timelineToolPointerDispatcher';

/**
 * Track-select tools (forward, backward, forward on all tracks) select from a time, so a press
 * anywhere on the row counts: in a gap, or on a clip's trim or fade handle near a cut. Those
 * handles used to swallow the press and nothing was selected. Runs in the capture phase so the
 * handles underneath never start a trim while such a tool is active.
 */
export function useTimelineTrackSelectTool({ activeTimelineToolId, trackId, pixelToTime }: {
  activeTimelineToolId: TimelineToolId;
  trackId: string;
  pixelToTime: (pixels: number) => number;
}) {
  const onMouseDownCapture = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !isTimelineTrackSelectTool(activeTimelineToolId)) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const time = pixelToTime(event.clientX - rect.left);
    if (!Number.isFinite(time)) return;
    event.preventDefault();
    event.stopPropagation();
    useTimelineStore.getState().applyTimelineEditOperation(
      buildTrackSelectOperation(activeTimelineToolId, trackId, Math.max(0, time)),
      { source: 'ui', historyLabel: 'Track select' },
    );
  }, [activeTimelineToolId, pixelToTime, trackId]);
  return { onMouseDownCapture };
}
