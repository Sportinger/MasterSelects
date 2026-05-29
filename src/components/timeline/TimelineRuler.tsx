// TimelineRuler component - Time ruler at the top of the timeline

import React, { memo } from 'react';
import type { TimelineRulerProps } from './types';
import {
  createTimelineGridPlan,
  formatTimelineFrameNumber,
  formatTimelineTimecode,
} from './utils/timelineGrid';

const RULER_VIEWPORT_FALLBACK_PX = 1600;
const RULER_VIEWPORT_MIN_PX = 1600;
const RULER_RENDER_OVERSCAN_PX = 512;

function TimelineRulerComponent({
  duration,
  zoom,
  frameRate,
  displayMode = 'time',
  scrollX,
  onRulerMouseDown,
  formatTime,
  cacheRanges = [],
  videoBakeRegions = [],
  videoBakeRegionSelection = null,
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
  const visibleVideoBakeRegions = [
    ...videoBakeRegions
      .filter(region => region.scope === 'composition')
      .map(region => ({
        key: region.id,
        startTime: region.startTime,
        endTime: region.endTime,
        status: region.status,
        transient: false,
      })),
    ...(videoBakeRegionSelection?.scope === 'composition'
      ? [{
          key: 'composition-video-bake-selection',
          startTime: videoBakeRegionSelection.startTime,
          endTime: videoBakeRegionSelection.endTime,
          status: 'marked' as const,
          transient: true,
        }]
      : []),
  ]
    .map((region) => {
      const start = Math.max(0, Math.min(duration, Math.min(region.startTime, region.endTime)));
      const end = Math.max(start, Math.min(duration, Math.max(region.startTime, region.endTime)));
      return { ...region, start, end };
    })
    .filter((region) => region.end > region.start && region.end >= visibleStartTime && region.start <= visibleEndTime);

  const gridPlan = createTimelineGridPlan({ zoom, frameRate });
  const showFrameLabels = displayMode === 'frames';
  const timeInterval = gridPlan.timeIntervalSeconds;
  const firstTimeMarkerIndex = Math.max(0, Math.floor(visibleStartTime / timeInterval));
  const lastTimeMarkerIndex = Math.max(firstTimeMarkerIndex, Math.ceil(visibleEndTime / timeInterval));

  for (let markerIndex = firstTimeMarkerIndex; markerIndex <= lastTimeMarkerIndex; markerIndex += 1) {
    const t = markerIndex * timeInterval;
    if (t < 0 || t > duration) continue;
    const x = timeToPixel(t);
    const isMainMarker = markerIndex % gridPlan.timeMajorEveryMinor === 0;

    markers.push(
      <div
        key={`time-${markerIndex}`}
        className={`time-marker time ${isMainMarker ? 'main' : 'sub'}`}
        style={{ left: x, opacity: gridPlan.timeGridOpacity }}
      >
        {gridPlan.mode === 'time' && isMainMarker && (
          <span className={`time-label ${showFrameLabels ? 'frame-label' : ''}`}>
            {showFrameLabels ? formatTimelineFrameNumber(t, gridPlan.frameRate) : formatTime(t)}
          </span>
        )}
      </div>
    );
  }

  if (gridPlan.frameGridOpacity > 0) {
    const frameInterval = gridPlan.frameIntervalSeconds;
    const firstFrameMarkerIndex = Math.max(0, Math.floor(visibleStartTime / frameInterval));
    const lastFrameMarkerIndex = Math.max(firstFrameMarkerIndex, Math.ceil(visibleEndTime / frameInterval));

    for (let markerIndex = firstFrameMarkerIndex; markerIndex <= lastFrameMarkerIndex; markerIndex += 1) {
      const t = markerIndex * frameInterval;
      if (t < 0 || t > duration) continue;
      const x = timeToPixel(t);
      const isMainMarker = markerIndex % gridPlan.frameMajorEveryMinor === 0;

      markers.push(
        <div
          key={`frame-${markerIndex}`}
          className={`time-marker frame ${isMainMarker ? 'main' : 'sub'}`}
          style={{ left: x, opacity: gridPlan.frameGridOpacity }}
        >
          {gridPlan.mode === 'frame' && isMainMarker && (
            <span className={`time-label ${showFrameLabels ? 'frame-label' : ''}`}>
              {showFrameLabels ? formatTimelineFrameNumber(t, gridPlan.frameRate) : formatTimelineTimecode(t, gridPlan.frameRate)}
            </span>
          )}
        </div>
      );
    }
  }

  return (
    <div
      className="time-ruler"
      data-ai-id="timeline-ruler"
      style={{ width, transform: `translateX(-${scrollX}px)` }}
      onMouseDown={onRulerMouseDown}
    >
      {markers}
      {visibleVideoBakeRegions.map((region) => (
        <div
          key={region.key}
          className={`timeline-ruler-video-bake-region status-${region.status ?? 'marked'} ${region.transient ? 'selection' : ''}`}
          style={{
            left: timeToPixel(region.start),
            width: Math.max(2, timeToPixel(region.end - region.start)),
          }}
          title={`Video bake: ${formatTime(region.start)} - ${formatTime(region.end)}`}
        />
      ))}
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
