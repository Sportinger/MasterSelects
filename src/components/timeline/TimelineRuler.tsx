// TimelineRuler component - stacked ruler lanes at the top of the timeline.
//
// Renders one DOM row per ruler lane (issue #257). Each row keeps the Mesa-safe
// pattern: plain <div> ticks for the visible window only (viewport + overscan,
// dpr-aligned), never the full content width. Linear lanes (time / timecode /
// frames) use createLinearLaneTicks; the bars lane projects time through the
// TempoMap via createBarsLaneTicks. No frame<->time crossfade — each lane's
// format is fixed and only tick density adapts to zoom.
//
// Annotation bars, their drag/trim/keyboard interactions, and the reader popover
// live in hooks/useRulerAnnotations + components/RulerAnnotation*.

import {
  memo,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
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
import { TempoRulerLane } from './components/TempoRulerLane';
import { RulerAnnotationBars } from './components/RulerAnnotationBars';
import { RulerAnnotationPortals } from './components/RulerAnnotationPortals';
import { useRulerAnnotations } from './hooks/useRulerAnnotations';
import {
  TimelineRulerActionMenu,
  type TimelineRulerActionMenuState,
} from './TimelineRulerActionMenu';
import './TimelineAnnotations.css';

const RULER_VIEWPORT_FALLBACK_PX = 1600;
const RULER_VIEWPORT_MIN_PX = 1600;
const RULER_RENDER_OVERSCAN_PX = 512;
// A press that moves less than this is a click (selects the lane); more is a
// scrub drag (handled by the ruler's mousedown, never selects).
const LANE_CLICK_SELECT_THRESHOLD_PX = 4;
const DEFAULT_ANNOTATION_FRAME_RATE = 30;

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
  onSelectLane,
  scrollX,
  onRulerMouseDown,
  onSetInPoint,
  onSetOutPoint,
  onAddMarker,
  formatTime,
  cacheRanges = [],
  videoBakeRegions = [],
  videoBakeRegionSelection = null,
}: TimelineRulerProps) {
  const rulerRef = useRef<HTMLDivElement | null>(null);
  const laneClickStartXRef = useRef<number | null>(null);
  const [measuredViewportWidth, setMeasuredViewportWidth] = useState(RULER_VIEWPORT_FALLBACK_PX);
  const [actionMenu, setActionMenu] = useState<TimelineRulerActionMenuState | null>(null);

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

  const annotations = useRulerAnnotations({
    actionMenu,
    duration,
    frameRate: frameRate ?? DEFAULT_ANNOTATION_FRAME_RATE,
    rulerRef,
    setActionMenu,
    visibleEndTime,
    visibleStartTime,
    zoom,
  });

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
    // The tempo lane is an editor, not a tick lane — it renders its own flags.
    if (lane.format === 'tempo') return [];
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
      aria-label="Timeline ruler"
      style={{ width, transform: `translateX(-${alignedScrollX}px)` }}
      onMouseDown={onRulerMouseDown}
      onPointerDown={(event: ReactPointerEvent<HTMLDivElement>) => {
        if (event.pointerType === 'mouse' || event.button !== 0) return;
        onRulerMouseDown(event);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        annotations.clearContextAnnotation();
        const rect = event.currentTarget.getBoundingClientRect();
        const time = Math.max(0, Math.min(duration, (event.clientX - rect.left) / Math.max(zoom, 0.001)));
        setActionMenu({ time, x: event.clientX, y: event.clientY });
      }}
    >
      {effectiveLanes.map((lane) => {
        // The active highlight only matters when choosing among >1 lanes.
        const isActive = effectiveLanes.length > 1 && lane.id === activeRulerLaneId;
        const ticks = renderLaneTicks(lane);
        const handleLaneMouseDown = (event: ReactMouseEvent) => {
          // Record the press start; let it bubble so the ruler scrub still fires.
          laneClickStartXRef.current = event.clientX;
        };
        const handleLaneMouseUp = (event: ReactMouseEvent) => {
          const startX = laneClickStartXRef.current;
          laneClickStartXRef.current = null;
          // The tempo lane is an editor, so clicking it never changes which lane
          // is the active timebase.
          if (startX === null || !onSelectLane || lane.format === 'tempo') return;
          // A click (no meaningful drag) selects the lane; a scrub drag does not.
          if (Math.abs(event.clientX - startX) <= LANE_CLICK_SELECT_THRESHOLD_PX) {
            onSelectLane(lane.id);
          }
        };
        return (
          <div
            key={lane.id}
            className={`ruler-lane ${lane.format}${isActive ? ' is-active' : ''}`}
            data-ruler-lane-format={lane.format}
            data-ruler-lane-id={lane.id}
            onMouseDown={handleLaneMouseDown}
            onMouseUp={handleLaneMouseUp}
          >
            {lane.format === 'tempo' && (
              <TempoRulerLane
                tempoMap={effectiveTempoMap}
                zoom={zoom}
                duration={duration}
                visibleStartTime={visibleStartTime}
                visibleEndTime={visibleEndTime}
                devicePixelRatio={devicePixelRatio}
              />
            )}
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
      <RulerAnnotationBars
        annotations={annotations.visibleAnnotations}
        draggingAnnotationId={annotations.draggingAnnotationId}
        formatTime={formatTime}
        onBeginDrag={annotations.beginAnnotationDrag}
        onContextMenu={annotations.openAnnotationContextMenu}
        onDragEnd={annotations.endAnnotationDrag}
        onDragMove={annotations.updateAnnotationDrag}
        onNudge={annotations.nudgeAnnotation}
        onOpen={annotations.openExpandedAnnotation}
        timeToPixel={timeToPixel}
      />
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
      <TimelineRulerActionMenu
        formatTime={formatTime}
        menu={actionMenu}
        onAddAnnotation={annotations.addCompositionAnnotation}
        onAddMarker={onAddMarker}
        onClose={annotations.closeActionMenu}
        onConvertAnnotationToClip={annotations.contextAnnotation && annotations.contextAnnotation.scope !== 'clip'
          ? annotations.linkContextAnnotationToClip
          : undefined}
        onConvertAnnotationToComposition={annotations.contextAnnotation?.scope === 'clip'
          ? annotations.convertContextAnnotationToComposition
          : undefined}
        onSetInPoint={onSetInPoint}
        onSetOutPoint={onSetOutPoint}
      />
      <RulerAnnotationPortals
        clipLinkTooltipRef={annotations.clipLinkTooltipRef}
        expandedAnnotation={annotations.expandedAnnotation}
        expandedAnnotationData={annotations.expandedAnnotationData}
        expandedAnnotationRef={annotations.expandedAnnotationRef}
        formatTime={formatTime}
        onCloseExpanded={annotations.closeExpandedAnnotation}
        pendingClipLink={annotations.pendingClipLink}
      />
    </div>
  );
}

export const TimelineRuler = memo(TimelineRulerComponent);
