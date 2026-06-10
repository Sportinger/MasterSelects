import { useCallback } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { useTimelineStore } from '../../../stores/timeline';
import type { TimelineTrackProps } from '../types';
import type { TimelineClipBodyGeometry } from '../../../timeline';
import {
  dispatchTimelineClipPointerClick,
  dispatchTimelineClipPointerMove,
  isTimelinePointerTool,
} from '../tools/pointer/timelineToolPointerDispatcher';

type TimelineTrackPointerClip = TimelineTrackProps['clips'][number];

type UseTimelineTrackPointerToolsArgs = Pick<TimelineTrackProps, 'activeTimelineToolId' | 'clips' | 'track'> & {
  allTrackClips: readonly TimelineTrackPointerClip[];
  timelineClipGeometryById: ReadonlyMap<string, TimelineClipBodyGeometry>;
};

type ClipPointerRow = Pick<HTMLElement, 'getBoundingClientRect'>;

export function useTimelineTrackPointerTools({
  activeTimelineToolId,
  allTrackClips,
  clips,
  timelineClipGeometryById,
  track,
}: UseTimelineTrackPointerToolsArgs) {
  const hitTestClipAtClientX = useCallback((clientX: number, rowEl: ClipPointerRow): string | null => {
    const rect = rowEl.getBoundingClientRect();
    const contentX = clientX - rect.left;
    for (let index = allTrackClips.length - 1; index >= 0; index -= 1) {
      const clip = allTrackClips[index];
      const clipGeometry = timelineClipGeometryById.get(clip.id);
      if (clipGeometry) {
        const clipRect = clipGeometry.bodyRect;
        if (contentX >= clipRect.x && contentX < clipRect.x + clipRect.width) return clip.id;
      }
    }
    return null;
  }, [allTrackClips, timelineClipGeometryById]);

  const buildClipPointerContext = useCallback((
    clipId: string,
    clientX: number,
    rowEl: ClipPointerRow,
    altKey: boolean,
  ) => {
    const clip = allTrackClips.find((candidate) => candidate.id === clipId);
    if (!clip) return null;
    const rowRect = rowEl.getBoundingClientRect();
    const clipGeometry = timelineClipGeometryById.get(clip.id);
    if (!clipGeometry) return null;
    const clipLeft = rowRect.left + clipGeometry.bodyRect.x;
    const timelineState = useTimelineStore.getState();
    return {
      toolId: activeTimelineToolId,
      clip,
      track,
      clips,
      playheadPosition: timelineState.playheadPosition,
      snappingEnabled: timelineState.snappingEnabled,
      displayStartTime: clip.startTime,
      displayDuration: clip.duration,
      width: Math.max(1, clipGeometry.bodyRect.width),
      clientX,
      rectLeft: clipLeft,
      altKey,
    };
  }, [activeTimelineToolId, allTrackClips, clips, timelineClipGeometryById, track]);

  const clearPointerToolPreview = useCallback(() => {
    if (isTimelinePointerTool(activeTimelineToolId)) {
      useTimelineStore.getState().setTimelineToolPreview(null);
    }
  }, [activeTimelineToolId]);

  const handleTimelineToolPointerMove = useCallback((
    event: ReactMouseEvent<HTMLDivElement>,
    clipId: string | null,
  ): boolean => {
    if (!isTimelinePointerTool(activeTimelineToolId)) return false;
    if (!clipId) {
      useTimelineStore.getState().setTimelineToolPreview(null);
      return false;
    }

    const context = buildClipPointerContext(clipId, event.clientX, event.currentTarget, event.altKey);
    if (!context) return false;

    const result = dispatchTimelineClipPointerMove(context);
    if (!result.handled) return false;

    useTimelineStore.getState().setTimelineToolPreview(result.preview ?? null);
    return true;
  }, [activeTimelineToolId, buildClipPointerContext]);

  const handleTimelineToolPointerClick = useCallback((
    event: ReactMouseEvent<HTMLDivElement>,
    clipId: string,
  ): boolean => {
    if (!isTimelinePointerTool(activeTimelineToolId)) return false;
    const context = buildClipPointerContext(clipId, event.clientX, event.currentTarget, event.altKey);
    if (!context) return false;

    const result = dispatchTimelineClipPointerClick(context);
    if (!result.handled) return false;

    event.preventDefault();
    event.stopPropagation();
    const timelineState = useTimelineStore.getState();
    if ('preview' in result) {
      timelineState.setTimelineToolPreview(result.preview ?? null);
    }
    if (result.operation) {
      timelineState.applyTimelineEditOperation(result.operation, {
        source: 'ui',
        historyLabel: result.operation.type === 'split-all-at-time'
          ? 'Blade all tracks split'
          : 'Blade split',
      });
    }
    if (result.nextToolId) {
      timelineState.setActiveTimelineTool(result.nextToolId);
    }
    return true;
  }, [activeTimelineToolId, buildClipPointerContext]);

  return {
    clearPointerToolPreview,
    handleTimelineToolPointerClick,
    handleTimelineToolPointerMove,
    hitTestClipAtClientX,
  };
}
