import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { AnimatableProperty, Keyframe } from '../../../types';
import type { TimelineTrackProps } from '../types';
import { buildTimelineKeyframeRowGeometries, type TimelineKeyframeRowGeometry } from '../../../timeline';
import {
  resolveTimelineTrackPenKeyframeValue,
  shouldHideTimelineTrack3DOnlyProperties,
  sortTimelineTrackPropertyRows,
  type TimelineTrackPropertyClip,
} from '../utils/timelineTrackPropertyRows';

export type TrackPropertyTracksProps = {
  trackId: string;
  selectedClip: TimelineTrackPropertyClip | null;
  clipKeyframes: Map<string, Array<{ id: string; clipId: string; time: number; property: AnimatableProperty; value: number; easing: string }>>;
  renderKeyframeDiamonds: (trackId: string, property: AnimatableProperty) => React.ReactNode;
  expandedCurveProperties: Map<string, Set<AnimatableProperty>>;
  activeTimelineToolId: TimelineTrackProps['activeTimelineToolId'];
  selectedKeyframeIds: Set<string>;
  onSelectKeyframe: (keyframeId: string, addToSelection: boolean) => void;
  onMoveKeyframe: (keyframeId: string, newTime: number) => void;
  onUpdateBezierHandle: TimelineTrackProps['onUpdateBezierHandle'];
  applyTimelineEditOperation?: TimelineTrackProps['applyTimelineEditOperation'];
  addKeyframe: (clipId: string, property: AnimatableProperty, value: number, time?: number, easing?: string | null) => void;
  timeToPixel: (time: number) => number;
  pixelToTime: (pixel: number) => number;
};

// Render keyframe tracks for timeline area (right column) - flat list without folder structure.
export function TrackPropertyTracks({
  trackId,
  selectedClip,
  clipKeyframes,
  renderKeyframeDiamonds,
  activeTimelineToolId,
  selectedKeyframeIds,
  addKeyframe,
  timeToPixel,
  pixelToTime,
}: TrackPropertyTracksProps) {
  const clipId = selectedClip?.id;

  const keyframeProperties = useMemo(() => {
    if (!clipId) return new Set<string>();
    const props = new Set<string>();
    const keyframes = clipKeyframes.get(clipId) || [];
    keyframes.forEach((kf) => props.add(kf.property));
    if (shouldHideTimelineTrack3DOnlyProperties(selectedClip)) {
      props.delete('rotation.x');
      props.delete('rotation.y');
      props.delete('position.z');
      props.delete('scale.z');
    }
    return props;
  }, [clipId, clipKeyframes, selectedClip]);

  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(1000);
  const allKeyframes = useMemo(
    () => (clipId ? (clipKeyframes.get(clipId) ?? []) as Keyframe[] : []),
    [clipId, clipKeyframes],
  );
  const pixelsPerSecond = useMemo(
    () => Math.max(0.001, timeToPixel(1) - timeToPixel(0)),
    [timeToPixel],
  );
  useEffect(() => {
    const updateWidth = () => {
      if (containerRef.current) {
        const nextWidth = containerRef.current.clientWidth;
        if (nextWidth > 0) {
          setContainerWidth(nextWidth);
        }
      }
    };
    updateWidth();
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);

  if (!selectedClip || keyframeProperties.size === 0) {
    return <div className="track-property-tracks" ref={containerRef} />;
  }

  const sortedProperties = sortTimelineTrackPropertyRows(keyframeProperties, selectedClip);
  const keyframeRowGeometryByProperty = new Map<string, TimelineKeyframeRowGeometry>(
    buildTimelineKeyframeRowGeometries({
      trackId,
      clipId: selectedClip.id,
      properties: sortedProperties,
      keyframes: allKeyframes.map((keyframe) => ({
        id: keyframe.id,
        clipId: keyframe.clipId,
        property: keyframe.property,
        time: keyframe.time,
      })),
      selectedKeyframeIds,
      contentWidth: containerWidth,
      pxPerSecond: pixelsPerSecond,
      clipStartTime: selectedClip.startTime,
      rowHeightPx: 18,
    }).map((row) => [row.property, row]),
  );

  const handlePenKeyframeMouseDown = (
    event: React.MouseEvent<HTMLDivElement>,
    property: AnimatableProperty,
    propertyKeyframes: Array<{ time: number; value: number }>,
  ) => {
    if (activeTimelineToolId !== 'pen-keyframe') return;
    if (event.button !== 0 || !selectedClip) return;

    event.preventDefault();
    event.stopPropagation();

    const rect = event.currentTarget.getBoundingClientRect();
    const absoluteTime = pixelToTime(event.clientX - rect.left);
    const localTime = Math.max(0, Math.min(selectedClip.duration, absoluteTime - selectedClip.startTime));
    const value = resolveTimelineTrackPenKeyframeValue(propertyKeyframes, localTime);
    addKeyframe(selectedClip.id, property, value, localTime, 'linear');
  };

  return (
    <div className="track-property-tracks" ref={containerRef}>
      {sortedProperties.map((prop) => {
        const propKeyframes = allKeyframes.filter((kf) => kf.property === prop);
        const rowGeometry = keyframeRowGeometryByProperty.get(prop);

        return (
          <div
            key={prop}
            className="keyframe-track-row flat"
            data-track-id={trackId}
            data-keyframe-property={prop}
            data-geometry-row-id={rowGeometry?.id}
            data-geometry-x={rowGeometry?.rowRect.x}
            data-geometry-y={rowGeometry?.rowRect.y}
            data-geometry-width={rowGeometry?.rowRect.width}
            data-geometry-height={rowGeometry?.rowRect.height}
            data-geometry-diamond-count={rowGeometry?.diamonds.length}
          >
            <div
              className="keyframe-track"
              onMouseDown={(event) => handlePenKeyframeMouseDown(event, prop, propKeyframes)}
            >
              <div className="keyframe-track-line" />
              {renderKeyframeDiamonds(trackId, prop)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
