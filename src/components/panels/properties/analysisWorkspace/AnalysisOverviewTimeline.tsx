import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { IconChevronDown } from '@tabler/icons-react';
import { prefersSoftwareTimelineCanvas } from '../../../timeline/utils/timelineCanvasPlatform';
import {
  ANALYSIS_OVERVIEW_LANE_KINDS,
  findAnalysisOverviewEventAtTime,
  getAnalysisOverviewCanvasSize,
  type AnalysisOverviewEvent,
  type AnalysisOverviewInput,
  type AnalysisOverviewLaneKind,
} from './analysisOverviewTypes';
import {
  buildAnalysisOverviewRenderModel,
  type AnalysisOverviewEnvelopeLane,
} from './analysisOverviewBins';
import {
  ANALYSIS_OVERVIEW_LANE_STYLES,
  paintAnalysisOverview,
} from './analysisOverviewPainter';
import './AnalysisOverviewTimeline.css';

export type {
  AnalysisOverviewEvent,
  AnalysisOverviewInput,
  AnalysisOverviewLaneKind,
} from './analysisOverviewTypes';

export interface AnalysisOverviewTimelineProps {
  analysis: AnalysisOverviewInput;
  playheadTime: number;
  selectedSceneId?: string;
  /** Uses this width for deterministic embeds/tests; otherwise observes its viewport. */
  width?: number;
  /** Target graph height; the flexible metrics plot absorbs the difference. */
  height?: number;
  onPlayheadChange?: (time: number) => void;
  onSceneClick?: (scene: AnalysisOverviewEvent) => void;
}

interface HoverMetricReading {
  lane: AnalysisOverviewEnvelopeLane;
  value: number | null;
}

interface HoverDetail {
  kind: 'scenes' | 'cuts' | 'metrics' | 'presence';
  lane: AnalysisOverviewLaneKind;
  event: AnalysisOverviewEvent | undefined;
  count: number;
  readings: readonly HoverMetricReading[];
  time: number;
  x: number;
  y: number;
}

function finiteStartTime(startTime: number | undefined): number {
  return startTime !== undefined && Number.isFinite(startTime) ? startTime : 0;
}

function finiteDuration(duration: number): number {
  return Number.isFinite(duration) && duration > 0 ? duration : 0;
}

function clampPlayhead(time: number, startTime: number, duration: number): number {
  if (!Number.isFinite(time) || duration <= 0) return startTime;
  return Math.min(startTime + duration, Math.max(startTime, time));
}

function formatTime(time: number): string {
  const totalSeconds = Math.max(0, Math.round(Number.isFinite(time) ? time : 0));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function scoreLabel(score: number | undefined | null): string | undefined {
  if (score === undefined || score === null || !Number.isFinite(score)) return undefined;
  return `${Math.round(Math.min(1, Math.max(0, score)) * 100)}%`;
}

export function AnalysisOverviewTimeline({
  analysis,
  playheadTime,
  selectedSceneId,
  width,
  height = 180,
  onPlayheadChange,
  onSceneClick,
}: AnalysisOverviewTimelineProps) {
  const shellRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrubbingRef = useRef(false);
  const [measuredWidth, setMeasuredWidth] = useState(width ?? 1);
  const [hover, setHover] = useState<HoverDetail | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const viewportWidth = Math.max(1, Math.floor(width ?? measuredWidth));
  const compact = viewportWidth < 360;
  const startTime = finiteStartTime(analysis.startTime);
  const duration = finiteDuration(analysis.duration);
  const endTime = startTime + duration;

  const model = useMemo(() => buildAnalysisOverviewRenderModel(analysis, viewportWidth, {
    compact,
    graphHeight: compact ? Math.min(height, 150) : height,
  }), [analysis, compact, height, viewportWidth]);
  const { layout } = model;
  const graphHeight = layout.height;

  useEffect(() => {
    if (width !== undefined) return undefined;
    const element = shellRef.current;
    if (!element) return undefined;
    const update = () => setMeasuredWidth((current) => {
      const next = Math.max(1, Math.floor(element.clientWidth));
      return current === next ? current : next;
    });
    update();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [width]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const canvasSize = getAnalysisOverviewCanvasSize(
      model.width,
      graphHeight,
      typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1,
    );
    canvas.width = canvasSize.backingWidth;
    canvas.height = canvasSize.backingHeight;
    canvas.style.width = `${canvasSize.cssWidth}px`;
    canvas.style.height = `${canvasSize.cssHeight}px`;
    const context = canvas.getContext('2d', {
      willReadFrequently: prefersSoftwareTimelineCanvas(),
    });
    if (!context) return;
    context.setTransform(
      canvasSize.backingWidth / canvasSize.cssWidth,
      0,
      0,
      canvasSize.backingHeight / canvasSize.cssHeight,
      0,
      0,
    );
    paintAnalysisOverview({ context, model });
  }, [graphHeight, model]);

  const graphMetrics = useCallback(() => {
    const rect = shellRef.current?.getBoundingClientRect();
    return {
      left: rect?.left ?? 0,
      top: rect?.top ?? 0,
      width: rect && rect.width > 0 ? rect.width : viewportWidth,
    };
  }, [viewportWidth]);

  const timeFromClientX = useCallback((clientX: number): number => {
    if (duration <= 0) return startTime;
    const metrics = graphMetrics();
    const relative = Math.min(metrics.width, Math.max(0, clientX - metrics.left));
    return startTime + (relative / metrics.width) * duration;
  }, [duration, graphMetrics, startTime]);

  const handleScrubDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    scrubbingRef.current = true;
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // Pointer capture is unavailable in some test and software environments.
    }
    onPlayheadChange?.(timeFromClientX(event.clientX));
  }, [onPlayheadChange, timeFromClientX]);

  const handleScrubMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (!scrubbingRef.current) return;
    onPlayheadChange?.(timeFromClientX(event.clientX));
  }, [onPlayheadChange, timeFromClientX]);

  const endScrub = useCallback(() => {
    scrubbingRef.current = false;
  }, []);

  const handlePointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const metrics = graphMetrics();
    const x = event.clientX - metrics.left;
    const y = event.clientY - metrics.top;
    if (x < 0 || x > metrics.width || y < 0 || y >= graphHeight || duration <= 0) {
      setHover(null);
      return;
    }
    const time = startTime + (x / metrics.width) * duration;
    const pixel = Math.min(model.width - 1, Math.max(0, Math.floor((x / metrics.width) * model.width)));
    const pointTolerance = (duration / model.width) * 3;
    const within = (row: { top: number; height: number } | undefined) => (
      row !== undefined && y >= row.top && y < row.top + row.height
    );
    const laneEvent = (lane: AnalysisOverviewLaneKind) => findAnalysisOverviewEventAtTime(
      analysis.lanes[lane] ?? [],
      time,
      pointTolerance,
    );

    let next: HoverDetail | null = null;
    const base = { count: 0, readings: [], time, x, y } as const;
    if (within(layout.scenes)) {
      next = { ...base, kind: 'scenes', lane: 'scenes', event: laneEvent('scenes') };
    } else if (within(layout.cuts)) {
      next = {
        ...base,
        kind: 'cuts',
        lane: 'cuts',
        event: laneEvent('cuts'),
        count: model.cuts[pixel]?.eventCount ?? 0,
      };
    } else if (within(layout.metrics)) {
      next = {
        ...base,
        kind: 'metrics',
        lane: 'motion',
        event: undefined,
        readings: (layout.metrics?.lanes ?? []).map((lane) => ({
          lane,
          value: model.envelopes.get(lane)?.[pixel]?.average ?? null,
        })),
      };
    } else {
      const row = layout.presence.find(within);
      if (row) {
        next = { ...base, kind: 'presence', lane: row.lane, event: laneEvent(row.lane) };
      }
    }
    setHover((current) => (
      next !== null
      && current?.kind === next.kind
      && current.lane === next.lane
      && current.event?.id === next.event?.id
      && Math.abs(current.x - next.x) < 1
      ? current
      : next
    ));
  }, [analysis.lanes, duration, graphHeight, graphMetrics, layout, model, startTime]);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (!onPlayheadChange || duration <= 0) return;
    const step = event.shiftKey ? Math.max(1, duration / 20) : Math.max(0.1, duration / 100);
    let next: number;
    if (event.key === 'Home') next = startTime;
    else if (event.key === 'End') next = endTime;
    else if (event.key === 'ArrowLeft') {
      next = clampPlayhead(playheadTime - step, startTime, duration);
    } else if (event.key === 'ArrowRight') {
      next = clampPlayhead(playheadTime + step, startTime, duration);
    } else return;
    onPlayheadChange(next);
    event.preventDefault();
  }, [duration, endTime, onPlayheadChange, playheadTime, startTime]);

  const playheadPercent = duration > 0
    ? ((clampPlayhead(playheadTime, startTime, duration) - startTime) / duration) * 100
    : 0;

  const rowLabels = useMemo(() => {
    const labels: { key: string; top: number; height: number; label: string; colour: string; count?: number }[] = [];
    if (layout.scenes) {
      labels.push({
        key: 'scenes',
        ...layout.scenes,
        label: ANALYSIS_OVERVIEW_LANE_STYLES.scenes.label,
        colour: ANALYSIS_OVERVIEW_LANE_STYLES.scenes.colour,
        count: analysis.lanes.scenes?.length,
      });
    }
    if (layout.cuts) {
      labels.push({
        key: 'cuts',
        ...layout.cuts,
        label: ANALYSIS_OVERVIEW_LANE_STYLES.cuts.label,
        colour: ANALYSIS_OVERVIEW_LANE_STYLES.cuts.colour,
        count: analysis.lanes.cuts?.length,
      });
    }
    for (const row of layout.presence) {
      labels.push({
        key: row.lane,
        top: row.top,
        height: row.height,
        label: ANALYSIS_OVERVIEW_LANE_STYLES[row.lane].label,
        colour: ANALYSIS_OVERVIEW_LANE_STYLES[row.lane].colour,
      });
    }
    return labels;
  }, [analysis.lanes.cuts, analysis.lanes.scenes, layout]);

  const missingLabels = layout.missing.map((lane) => ANALYSIS_OVERVIEW_LANE_STYLES[lane].label);
  const summary = useMemo(() => {
    const available = layout.present
      .map((lane) => `${ANALYSIS_OVERVIEW_LANE_STYLES[lane].label} (${analysis.lanes[lane]?.length ?? 0})`)
      .join(', ');
    const range = `Analysis overview from ${formatTime(startTime)} to ${formatTime(endTime)}.`;
    const availableText = available
      ? ` Signals with data: ${available}.`
      : ' No signals analysed yet.';
    const missingText = layout.present.length > 0 && missingLabels.length > 0
      ? ` No data yet: ${missingLabels.join(', ')}.`
      : '';
    return `${range}${availableText}${missingText}`;
  }, [analysis.lanes, endTime, layout.present, missingLabels, startTime]);

  return (
    <section
      className={[
        'AnalysisOverview',
        compact ? 'AnalysisOverview--compact' : '',
        collapsed ? 'AnalysisOverview--collapsed' : '',
      ].filter(Boolean).join(' ')}
      aria-label="Analysis overview"
      style={width === undefined ? undefined : { width }}
    >
      <header className="AnalysisOverview__header">
        <button
          type="button"
          className="AnalysisOverview__title AnalysisOverview__toggle"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((current) => !current)}
        >
          <IconChevronDown aria-hidden="true" size={15} stroke={1.8} />
          <span>Analysis map</span>
          <small>{layout.present.length}/{ANALYSIS_OVERVIEW_LANE_KINDS.length} signals</small>
        </button>
        <output className="AnalysisOverview__clock" aria-live="off">
          <strong>{formatTime(playheadTime)}</strong>
          <span>/ {formatTime(endTime)}</span>
        </output>
      </header>

      <div
        ref={shellRef}
        className="AnalysisOverview__shell"
        style={{ height: graphHeight }}
        onPointerMove={handlePointerMove}
        onPointerLeave={() => setHover(null)}
      >
        <canvas ref={canvasRef} aria-hidden="true" />

        {rowLabels.map((row) => (
          <span
            key={row.key}
            className="AnalysisOverview__rowLabel"
            style={{ top: row.top, height: row.height }}
          >
            <i style={{ backgroundColor: row.colour }} />
            {row.label}
            {row.count !== undefined ? <em>{row.count}</em> : null}
          </span>
        ))}

        {layout.metrics ? (
          <div className="AnalysisOverview__legend" style={{ top: layout.metrics.top + 3 }}>
            {layout.metrics.lanes.map((lane) => (
              <span key={lane}>
                <i style={{ backgroundColor: ANALYSIS_OVERVIEW_LANE_STYLES[lane].colour }} />
                {ANALYSIS_OVERVIEW_LANE_STYLES[lane].label}
              </span>
            ))}
          </div>
        ) : null}

        <div
          className="AnalysisOverview__scrubber"
          role="slider"
          tabIndex={0}
          aria-label="Analysis overview playhead"
          aria-orientation="horizontal"
          aria-valuemin={startTime}
          aria-valuemax={endTime}
          aria-valuenow={clampPlayhead(playheadTime, startTime, duration)}
          aria-valuetext={formatTime(playheadTime)}
          onPointerDown={handleScrubDown}
          onPointerMove={handleScrubMove}
          onPointerUp={endScrub}
          onPointerCancel={endScrub}
          onKeyDown={handleKeyDown}
        />

        {layout.scenes ? (
          <div
            className="AnalysisOverview__sceneTargets"
            style={{ top: layout.scenes.top, height: layout.scenes.height }}
          >
            {model.scenes.map((scene) => {
              const left = (scene.startPixel / model.width) * 100;
              const sceneWidth = Math.max(
                (1 / model.width) * 100,
                ((scene.endPixel - scene.startPixel + 1) / model.width) * 100,
              );
              const name = scene.label ?? `Scene at ${formatTime(scene.start)}`;
              const selected = selectedSceneId !== undefined
                && scene.sourceEventIds.includes(selectedSceneId);
              return (
                <button
                  key={`${scene.startPixel}:${scene.sourceEvent.id}`}
                  type="button"
                  className={`AnalysisOverview__scene${selected ? ' AnalysisOverview__scene--selected' : ''}`}
                  aria-label={`${name}${scene.eventCount > 1 ? `, ${scene.eventCount} scenes` : ''}`}
                  aria-pressed={selected}
                  onClick={() => onSceneClick?.(scene.sourceEvent)}
                  style={{ left: `${left}%`, width: `${sceneWidth}%` }}
                />
              );
            })}
          </div>
        ) : null}

        {layout.present.length === 0 ? (
          <p className="AnalysisOverview__emptyState">No signals analysed yet</p>
        ) : null}

        {hover ? (
          <div
            className="AnalysisOverview__crosshair"
            aria-hidden="true"
            style={{ left: hover.x }}
          />
        ) : null}
        <div
          className="AnalysisOverview__playhead"
          aria-hidden="true"
          style={{ left: `${playheadPercent}%` }}
        >
          <i />
        </div>

        {hover ? (
          <div
            className="AnalysisOverview__tooltip"
            role="tooltip"
            data-testid="analysis-overview-tooltip"
            style={{
              left: Math.min(Math.max(8, hover.x), Math.max(8, viewportWidth - 158)),
              top: hover.y < graphHeight / 2
                ? Math.min(graphHeight - 8, hover.y + 14)
                : Math.max(8, hover.y - 10),
              transform: hover.y < graphHeight / 2 ? 'none' : 'translateY(-100%)',
            }}
          >
            <span className="AnalysisOverview__tooltipKicker">
              {hover.kind !== 'metrics' ? (
                <i style={{ backgroundColor: ANALYSIS_OVERVIEW_LANE_STYLES[hover.lane].colour }} />
              ) : null}
              {hover.kind === 'metrics' ? 'Frame metrics' : ANALYSIS_OVERVIEW_LANE_STYLES[hover.lane].label}
            </span>
            {hover.kind === 'metrics' ? (
              <ul className="AnalysisOverview__tooltipReadings">
                {hover.readings.map((reading) => (
                  <li key={reading.lane}>
                    <i style={{ backgroundColor: ANALYSIS_OVERVIEW_LANE_STYLES[reading.lane].colour }} />
                    {ANALYSIS_OVERVIEW_LANE_STYLES[reading.lane].label}
                    <b>{scoreLabel(reading.value) ?? '–'}</b>
                  </li>
                ))}
              </ul>
            ) : (
              <strong>
                {hover.event?.label ?? 'No tagged event'}
                {hover.count > 1 ? ` ×${hover.count}` : ''}
              </strong>
            )}
            <small>
              {formatTime(hover.time)}
              {hover.kind !== 'metrics' && scoreLabel(hover.event?.score)
                ? ` · ${scoreLabel(hover.event?.score)}`
                : ''}
            </small>
          </div>
        ) : null}
      </div>

      <footer className="AnalysisOverview__axis" aria-hidden="true">
        <span className="AnalysisOverview__axisEdge">{formatTime(startTime)}</span>
        {model.ticks
          .filter((tick) => tick.fraction >= 0.07 && tick.fraction <= 0.93)
          .map((tick) => (
            <span
              key={tick.time}
              className="AnalysisOverview__tick"
              style={{ left: `${tick.fraction * 100}%` }}
            >
              {formatTime(tick.time)}
            </span>
          ))}
        <span className="AnalysisOverview__axisEdge AnalysisOverview__axisEdge--end">
          {formatTime(endTime)}
        </span>
      </footer>

      {layout.present.length > 0 && missingLabels.length > 0 ? (
        <p className="AnalysisOverview__missingNote">
          No data yet: {missingLabels.join(' · ')}
        </p>
      ) : null}
      <p className="AnalysisOverview__srOnly">{summary}</p>
    </section>
  );
}
