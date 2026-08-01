import { useCallback, useState } from 'react';
import type { ComponentProps } from 'react';
import type { AnimatableProperty } from '../../../types';
import { TimelineKeyframes } from '../TimelineKeyframes';

type TimelineKeyframesProps = ComponentProps<typeof TimelineKeyframes>;

interface UseTimelineKeyframeDiamondsRendererProps {
  clipDrag: TimelineKeyframesProps['clipDrag'];
  clipKeyframes: TimelineKeyframesProps['clipKeyframes'];
  clips: TimelineKeyframesProps['clips'];
  onMoveKeyframe: TimelineKeyframesProps['onMoveKeyframe'];
  onDeleteKeyframes: TimelineKeyframesProps['onDeleteKeyframes'];
  onSelectKeyframe: TimelineKeyframesProps['onSelectKeyframe'];
  onToggleCurveExpanded: TimelineKeyframesProps['onToggleCurveExpanded'];
  onUpdateKeyframe: TimelineKeyframesProps['onUpdateKeyframe'];
  pixelToTime: TimelineKeyframesProps['pixelToTime'];
  scrollX: number;
  selectedKeyframeIds: TimelineKeyframesProps['selectedKeyframeIds'];
  timelineRef: TimelineKeyframesProps['timelineRef'];
  timeToPixel: TimelineKeyframesProps['timeToPixel'];
}

export function useTimelineKeyframeDiamondsRenderer({
  clipDrag,
  clipKeyframes,
  clips,
  onMoveKeyframe,
  onDeleteKeyframes,
  onSelectKeyframe,
  onToggleCurveExpanded,
  onUpdateKeyframe,
  pixelToTime,
  scrollX,
  selectedKeyframeIds,
  timelineRef,
  timeToPixel,
}: UseTimelineKeyframeDiamondsRendererProps) {
  const [hoveredKeyframeRow, setHoveredKeyframeRow] = useState<{
    trackId: string;
    property: AnimatableProperty;
  } | null>(null);

  const handleKeyframeRowHover = useCallback((trackId: string, property: AnimatableProperty, hovered: boolean) => {
    if (hovered) {
      setHoveredKeyframeRow({ trackId, property });
      return;
    }

    setHoveredKeyframeRow(current =>
      current?.trackId === trackId && current.property === property ? null : current
    );
  }, []);

  const renderKeyframeDiamonds = useCallback(
    (trackId: string, property: AnimatableProperty) => {
      const isRowHovered =
        hoveredKeyframeRow?.trackId === trackId &&
        hoveredKeyframeRow.property === property;

      return (
        <TimelineKeyframes
          trackId={trackId}
          property={property}
          clips={clips}
          selectedKeyframeIds={selectedKeyframeIds}
          clipKeyframes={clipKeyframes}
          clipDrag={clipDrag}
          scrollX={scrollX}
          timelineRef={timelineRef}
          onSelectKeyframe={onSelectKeyframe}
          onMoveKeyframe={onMoveKeyframe}
          onDeleteKeyframes={onDeleteKeyframes}
          onUpdateKeyframe={onUpdateKeyframe}
          onToggleCurveExpanded={onToggleCurveExpanded}
          timeToPixel={timeToPixel}
          pixelToTime={pixelToTime}
          isRowHovered={isRowHovered}
          onKeyframeRowHover={handleKeyframeRowHover}
        />
      );
    },
    [clips, selectedKeyframeIds, clipKeyframes, clipDrag, scrollX, timelineRef, onSelectKeyframe, onMoveKeyframe, onDeleteKeyframes, onUpdateKeyframe, onToggleCurveExpanded, timeToPixel, pixelToTime, hoveredKeyframeRow, handleKeyframeRowHover]
  );

  return {
    handleKeyframeRowHover,
    hoveredKeyframeRow,
    renderKeyframeDiamonds,
  };
}
