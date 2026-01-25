// TimelineRuler component - Time ruler at the top of the timeline

import React, { memo } from 'react';
import type { TimelineRulerProps } from './types';

function TimelineRulerComponent({
  duration,
  zoom,
  scrollX,
  onRulerMouseDown,
  formatTime,
}: TimelineRulerProps) {
  // Time to pixel conversion
  const timeToPixel = (time: number) => time * zoom;

  const width = timeToPixel(duration);
  const markers: React.ReactElement[] = [];

  // Calculate marker interval based on zoom level
  // Lower zoom = more zoomed out = need larger intervals
  let interval = 1; // 1 second default
  let mainMarkerMultiple = 5; // Show label every 5 markers by default

  if (zoom >= 100) {
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

  for (let t = 0; t <= duration; t += interval) {
    const x = timeToPixel(t);
    const markerIndex = Math.round(t / interval);
    const isMainMarker = markerIndex % mainMarkerMultiple === 0;

    markers.push(
      <div
        key={t}
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
      style={{ width, transform: `translateX(-${scrollX}px)` }}
      onMouseDown={onRulerMouseDown}
    >
      {markers}
    </div>
  );
}

export const TimelineRuler = memo(TimelineRulerComponent);
