// TimelineRuler component - Time ruler at the top of the timeline

import React, { memo } from 'react';
import type { TimelineRulerProps } from './types';
import { createTimelineGridPlan, formatTimelineTimecode } from './utils/timelineGrid';

const RULER_VIEWPORT_FALLBACK_PX = 1600;
const RULER_VIEWPORT_MIN_PX = 1600;
const RULER_RENDER_OVERSCAN_PX = 512;

function TimelineRulerComponent({
  duration,
  zoom,
  frameRate,
  scrollX,
  onRulerMouseDown,
  formatTime,
  cacheRanges = [],
}: TimelineRulerProps) {
  // Time to pixel conversion
  const timeToPixel = (time: number) => time * zoom;

  const width = timeToPixel(duration);
  const markers: React.ReactElement[] = [];
  const viewportWidth = typeof window === 'undefined'
    ? RULER_VIEWPORT_FALLBACK_PX
    : Math.max(RULER_VIEWPORT_MIN_PX, window.innerWidth);
  const visibleStartTime = Math.max(0, (scrollX - RULER_RENDER_OVERSCAN_PX) / Math.max(zoom, 0.001));
  const visibleEndTime = Math.min(
    duration,
    (scrollX + viewportWidth + RULER_RENDER_OVERSCAN_PX) / Math.max(zoom, 0.001),
  );
  const visibleCacheRanges = cacheRanges
    .map((range) => {
      const start = Math.max(0, Math.min(duration, range.start));
      const end = Math.max(start, Math.min(duration, range.end));
      return { ...range, start, end };
    })
    .filter((range) => range.end > range.start && range.end >= visibleStartTime && range.start <= visibleEndTime);

  const gridPlan = createTimelineGridPlan({ zoom, frameRate });
  const interval = gridPlan.minorIntervalSeconds;
  const firstMarkerIndex = Math.max(0, Math.floor(visibleStartTime / interval));
  const lastMarkerIndex = Math.max(firstMarkerIndex, Math.ceil(visibleEndTime / interval));

  for (let markerIndex = firstMarkerIndex; markerIndex <= lastMarkerIndex; markerIndex += 1) {
    const t = markerIndex * interval;
    if (t < 0 || t > duration) continue;
    const x = timeToPixel(t);
    const isMainMarker = markerIndex % gridPlan.majorEveryMinor === 0;
    const label = gridPlan.labelMode === 'timecode'
      ? formatTimelineTimecode(t, gridPlan.frameRate)
      : formatTime(t);

    markers.push(
      <div
        key={`${gridPlan.mode}-${markerIndex}`}
        className={`time-marker ${gridPlan.mode} ${isMainMarker ? 'main' : 'sub'}`}
        style={{ left: x }}
      >
        {isMainMarker && <span className="time-label">{label}</span>}
      </div>
    );
  }

  return (
    <div
      className="time-ruler"
      data-ai-id="timeline-ruler"
      style={{ width, transform: `translateX(-${scrollX}px)` }}
      onMouseDown={onRulerMouseDown}
    >
      {markers}
      {visibleCacheRanges.map((range, index) => (
        <div
          key={`${range.type}-${index}-${range.start.toFixed(3)}`}
          className={`timeline-ruler-cache-indicator ${range.type}`}
          style={{
            left: timeToPixel(range.start),
            width: Math.max(2, timeToPixel(range.end - range.start)),
          }}
          title={`${range.type === 'proxy' ? 'Proxy' : 'Cache'}: ${formatTime(range.start)} - ${formatTime(range.end)}`}
        />
      ))}
    </div>
  );
}

export const TimelineRuler = memo(TimelineRulerComponent);
