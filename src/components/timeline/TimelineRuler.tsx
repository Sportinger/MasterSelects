// TimelineRuler component - stacked ruler lanes at the top of the timeline.
//
// Renders one DOM row per ruler lane (issue #257). Each row keeps the Mesa-safe
// pattern: plain <div> ticks for the visible window only (viewport + overscan,
// dpr-aligned), never the full content width. Linear lanes (time / timecode /
// frames) use createLinearLaneTicks; the bars lane projects time through the
// TempoMap via createBarsLaneTicks. No frame<->time crossfade — each lane's
// format is fixed and only tick density adapts to zoom.

import { memo, useLayoutEffect, useRef, useState } from 'react';
import type { RulerLane } from '../../types';
import type { TimelineRulerProps } from './types';
import {
  alignTimelineGridPixel,
  createBarsLaneTicks,
  createLinearLaneTicks,
  getTimelineDevicePixelRatio,
  type RulerTick,
} from './utils/timelineGrid';
import { createDefaultRulerLanes, createDefaultTempoMap } from '../../timeline/tempo/rulerDefaults';

const RULER_VIEWPORT_FALLBACK_PX = 1600;
const RULER_VIEWPORT_MIN_PX = 1600;
const RULER_RENDER_OVERSCAN_PX = 512;

function getResizeObserverInlineSize(entry: ResizeObserverEntry): number {
  const borderBox = entry.borderBoxSize;
  const borderBoxSize = Array.isArray(borderBox) ? borderBox[0] : borderBox;
  return borderBoxSize?.inlineSize ?? entry.contentRect.width;
}

function TimelineRulerComponent({
  duration,
  zoom,
  frameRate,
  lanes,
  tempoMap,
  activeRulerLaneId = null,
  scrollX,
  onRulerMouseDown,
  formatTime,
  cacheRanges = [],
  videoBakeRegions = [],
  videoBakeRegionSelection = null,
}: TimelineRulerProps) {
  const rulerRef = useRef<HTMLDivElement | null>(null);
  const [measuredViewportWidth, setMeasuredViewportWidth] = useState(RULER_VIEWPORT_FALLBACK_PX);

  useLayoutEffect(() => {
    const viewportElement = rulerRef.current?.parentElement;
    if (!viewportElement) return undefined;

    const commitViewportWidth = (width: number) => {
      const nextWidth = Math.max(RULER_VIEWPORT_MIN_PX, Math.ceil(width || RULER_VIEWPORT_FALLBACK_PX));
      setMeasuredViewportWidth((previous) => (previous === nextWidth ? previous : nextWidth));
    };

    commitViewportWidth(viewportElement.clientWidth || viewportElement.getBoundingClientRect().width);

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver((entries) => {
        const entry = entries.find((candidate) => candidate.target === viewportElement) ?? entries[0];
        commitViewportWidth(entry ? getResizeObserverInlineSize(entry) : viewportElement.clientWidth);
      });
      observer.observe(viewportElement);
      return () => observer.disconnect();
    }

    if (typeof window !== 'undefined') {
      const handleWindowResize = () => {
        commitViewportWidth(viewportElement.clientWidth || viewportElement.getBoundingClientRect().width);
      };
      window.addEventListener('resize', handleWindowResize);
      return () => window.removeEventListener('resize', handleWindowResize);
    }

    return undefined;
  }, []);

  // Time to pixel conversion
  const timeToPixel = (time: number) => time * zoom;
  const devicePixelRatio = getTimelineDevicePixelRatio();
  const alignedScrollX = alignTimelineGridPixel(scrollX, devicePixelRatio);

  const width = timeToPixel(duration);
  const viewportWidth = measuredViewportWidth;
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

  const effectiveLanes: RulerLane[] = lanes && lanes.length > 0 ? lanes : createDefaultRulerLanes();
  const effectiveTempoMap = tempoMap ?? createDefaultTempoMap();

  const renderLaneTicks = (lane: RulerLane): RulerTick[] => {
    if (lane.format === 'bars') {
      return createBarsLaneTicks({
        tempoMap: effectiveTempoMap,
        zoom,
        startTime: visibleStartTime,
        endTime: visibleEndTime,
        duration,
      });
    }
    return createLinearLaneTicks({
      format: lane.format,
      zoom,
      frameRate,
      startTime: visibleStartTime,
      endTime: visibleEndTime,
      duration,
      formatTime,
    });
  };

  return (
    <div
      ref={rulerRef}
      className="time-ruler"
      data-ai-id="timeline-ruler"
      style={{ width, transform: `translateX(-${alignedScrollX}px)` }}
      onMouseDown={onRulerMouseDown}
    >
      {effectiveLanes.map((lane) => {
        const isActive = lane.id === activeRulerLaneId;
        const ticks = renderLaneTicks(lane);
        return (
          <div
            key={lane.id}
            className={`ruler-lane ${lane.format}${isActive ? ' is-active' : ''}`}
            data-ruler-lane-format={lane.format}
            data-ruler-lane-id={lane.id}
          >
            {ticks.map((tick, tickIndex) => {
              const x = alignTimelineGridPixel(timeToPixel(tick.time), devicePixelRatio);
              return (
                <div
                  key={`${lane.id}-${tickIndex}-${tick.time.toFixed(4)}`}
                  className={`time-marker ${lane.format} ${tick.kind === 'major' ? 'main' : 'sub'}`}
                  style={{ left: x }}
                >
                  {tick.label !== null && (
                    <span className={`time-label ${lane.format === 'frames' ? 'frame-label' : ''}`}>
                      {tick.label}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
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
