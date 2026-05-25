// TimelineRuler component - Time ruler at the top of the timeline

import React, { memo } from 'react';
import type { TimelineRulerProps } from './types';

const RULER_VIEWPORT_FALLBACK_PX = 1600;
const RULER_VIEWPORT_MIN_PX = 1600;
const RULER_RENDER_OVERSCAN_PX = 512;

function TimelineRulerComponent({
  duration,
  zoom,
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

  // Calculate marker interval based on zoom level
  // Lower zoom = more zoomed out = need larger intervals
  let interval = 1; // 1 second default
  let mainMarkerMultiple = 5; // Show label every 5 markers by default

  if (zoom >= 1000) {
    interval = 0.05;
    mainMarkerMultiple = 20; // Every 1 second
  } else if (zoom >= 500) {
    interval = 0.1;
    mainMarkerMultiple = 10; // Every 1 second
  } else if (zoom >= 250) {
    interval = 0.25;
    mainMarkerMultiple = 4; // Every 1 second
  } else if (zoom >= 100) {
    interval = 0.5;
    mainMarkerMultiple = 2; // Every 1 second
  } else if (zoom >= 50) {
    interval = 1;
    mainMarkerMultiple = 5; // Every 5 seconds
  } else if (zoom >= 20) {
    interval = 2;
    mainMarkerMultiple = 5; // Every 10 seconds
  } else if (zoom >= 10) {
    interval = 5;
    mainMarkerMultiple = 2; // Every 10 seconds
  } else if (zoom >= 5) {
    interval = 10;
    mainMarkerMultiple = 3; // Every 30 seconds
  } else if (zoom >= 2) {
    interval = 30;
    mainMarkerMultiple = 2; // Every 60 seconds
  } else {
    interval = 60; // 1 minute
    mainMarkerMultiple = 5; // Every 5 minutes
  }

  const firstMarkerIndex = Math.max(0, Math.floor(visibleStartTime / interval));
  const lastMarkerIndex = Math.max(firstMarkerIndex, Math.ceil(visibleEndTime / interval));

  for (let markerIndex = firstMarkerIndex; markerIndex <= lastMarkerIndex; markerIndex += 1) {
    const t = markerIndex * interval;
    if (t < 0 || t > duration) continue;
    const x = timeToPixel(t);
    const isMainMarker = markerIndex % mainMarkerMultiple === 0;

    markers.push(
      <div
        key={t.toFixed(3)}
        className={`time-marker ${isMainMarker ? 'main' : 'sub'}`}
        style={{ left: x }}
      >
        {isMainMarker && <span className="time-label">{formatTime(t)}</span>}
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
