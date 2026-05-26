import { useId, useMemo, useRef, useState } from 'react';
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from 'react';
import { formatEqualizerFrequency } from './equalizerFormatting';

const VIEWBOX_WIDTH = 100;
const VIEWBOX_HEIGHT = 58;
const GRAPH_LEFT = 7;
const GRAPH_RIGHT = 95;
const GRAPH_TOP = 6;
const GRAPH_BOTTOM = 49;
const DB_GRID_LINES = [12, 6, 0, -6, -12] as const;
const EQ_BAND_COLORS = [
  '#d9db65',
  '#e7a14f',
  '#e66f62',
  '#4aa7e8',
  '#48c2d8',
  '#8867ff',
  '#b24ee8',
  '#c845c7',
  '#46d49d',
  '#55d074',
] as const;

export interface GraphicalEqualizerBand {
  id: string;
  frequencyHz: number;
  valueDb: number;
  label: ReactNode;
  ariaLabel?: string;
  keyframeToggle?: ReactNode;
}

export interface GraphicalEqualizerControlProps {
  bands: readonly GraphicalEqualizerBand[];
  minDb?: number;
  maxDb?: number;
  step?: number;
  compact?: boolean;
  ariaLabel?: string;
  disabled?: boolean;
  onChange: (bandIndex: number, valueDb: number) => void;
  onResetBand?: (bandIndex: number) => void;
}

type GraphPoint = {
  index: number;
  x: number;
  y: number;
  valueDb: number;
  frequencyHz: number;
};

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function getStepPrecision(step: number): number {
  const [, decimals = ''] = String(step).split('.');
  return Math.min(6, decimals.length);
}

function quantize(value: number, step: number): number {
  if (!Number.isFinite(step) || step <= 0) return value;
  const precision = getStepPrecision(step);
  return Number((Math.round(value / step) * step).toFixed(precision));
}

function formatSignedDb(value: number): string {
  const prefix = value > 0 ? '+' : '';
  return `${prefix}${value.toFixed(1)} dB`;
}

function valueToY(valueDb: number, minDb: number, maxDb: number): number {
  const value = clamp(valueDb, minDb, maxDb);
  const normalized = (maxDb - value) / (maxDb - minDb);
  return GRAPH_TOP + normalized * (GRAPH_BOTTOM - GRAPH_TOP);
}

function yToValue(y: number, minDb: number, maxDb: number, step: number): number {
  const normalized = clamp((y - GRAPH_TOP) / (GRAPH_BOTTOM - GRAPH_TOP), 0, 1);
  return clamp(quantize(maxDb - normalized * (maxDb - minDb), step), minDb, maxDb);
}

function frequencyToX(frequencyHz: number, minFrequency: number, maxFrequency: number): number {
  const safeFrequency = Math.max(1, frequencyHz);
  const minLog = Math.log10(Math.max(1, minFrequency));
  const maxLog = Math.log10(Math.max(minFrequency + 1, maxFrequency));
  const normalized = (Math.log10(safeFrequency) - minLog) / (maxLog - minLog);
  return GRAPH_LEFT + clamp(normalized, 0, 1) * (GRAPH_RIGHT - GRAPH_LEFT);
}

function createSmoothPath(points: readonly GraphPoint[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;

  const commands = [`M ${points[0].x} ${points[0].y}`];

  for (let index = 0; index < points.length - 1; index += 1) {
    const previous = points[index - 1] ?? points[index];
    const current = points[index];
    const next = points[index + 1];
    const afterNext = points[index + 2] ?? next;

    const cp1x = current.x + (next.x - previous.x) / 6;
    const cp1y = current.y + (next.y - previous.y) / 6;
    const cp2x = next.x - (afterNext.x - current.x) / 6;
    const cp2y = next.y - (afterNext.y - current.y) / 6;

    commands.push(`C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${next.x} ${next.y}`);
  }

  return commands.join(' ');
}

function createAreaPath(curvePath: string, points: readonly GraphPoint[], zeroY: number): string {
  if (!curvePath || points.length === 0) return '';
  const first = points[0];
  const last = points[points.length - 1];
  return `${curvePath} L ${last.x} ${zeroY} L ${first.x} ${zeroY} Z`;
}

function getNearestPointIndex(points: readonly GraphPoint[], x: number): number {
  if (points.length === 0) return -1;

  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;

  points.forEach((point, index) => {
    const distance = Math.abs(point.x - x);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  });

  return nearestIndex;
}

export function GraphicalEqualizerControl({
  bands,
  minDb = -12,
  maxDb = 12,
  step = 0.5,
  compact = false,
  ariaLabel = 'Graphic equalizer',
  disabled = false,
  onChange,
  onResetBand,
}: GraphicalEqualizerControlProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const draggingBandIndexRef = useRef<number | null>(null);
  const [activeBandIndex, setActiveBandIndex] = useState<number | null>(null);
  const rawId = useId();
  const idPrefix = rawId.replace(/[^a-zA-Z0-9_-]/g, '');
  const positiveClipId = `${idPrefix}-eq-positive`;
  const negativeClipId = `${idPrefix}-eq-negative`;
  const responseGradientId = `${idPrefix}-eq-response`;

  const points = useMemo<GraphPoint[]>(() => {
    const frequencies = bands.map(band => band.frequencyHz);
    const minFrequency = Math.min(...frequencies, 20);
    const maxFrequency = Math.max(...frequencies, 22000);

    return bands.map((band, index) => ({
      index,
      x: frequencyToX(band.frequencyHz, minFrequency, maxFrequency),
      y: valueToY(band.valueDb, minDb, maxDb),
      valueDb: clamp(band.valueDb, minDb, maxDb),
      frequencyHz: band.frequencyHz,
    }));
  }, [bands, maxDb, minDb]);

  const zeroY = valueToY(0, minDb, maxDb);
  const curvePath = createSmoothPath(points);
  const areaPath = createAreaPath(curvePath, points, zeroY);

  const getPointerCoordinates = (event: ReactPointerEvent<SVGSVGElement> | ReactMouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    return {
      x: ((event.clientX - rect.left) / rect.width) * VIEWBOX_WIDTH,
      y: ((event.clientY - rect.top) / rect.height) * VIEWBOX_HEIGHT,
    };
  };

  const updateBandFromPointer = (
    event: ReactPointerEvent<SVGSVGElement>,
    bandIndex: number,
  ) => {
    if (disabled || bandIndex < 0) return;
    const coordinates = getPointerCoordinates(event);
    if (!coordinates) return;

    const value = yToValue(coordinates.y, minDb, maxDb, step);
    if (Math.abs(value - (bands[bandIndex]?.valueDb ?? 0)) > 0.0001) {
      onChange(bandIndex, value);
    }
  };

  const handlePointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (disabled || event.button !== 0) return;
    const coordinates = getPointerCoordinates(event);
    if (!coordinates) return;

    const bandIndex = getNearestPointIndex(points, coordinates.x);
    if (bandIndex < 0) return;

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    activePointerIdRef.current = event.pointerId;
    draggingBandIndexRef.current = bandIndex;
    setActiveBandIndex(bandIndex);
    updateBandFromPointer(event, bandIndex);
  };

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const coordinates = getPointerCoordinates(event);
    if (coordinates && draggingBandIndexRef.current === null) {
      setActiveBandIndex(getNearestPointIndex(points, coordinates.x));
    }

    if (activePointerIdRef.current !== event.pointerId || draggingBandIndexRef.current === null) {
      return;
    }

    event.preventDefault();
    updateBandFromPointer(event, draggingBandIndexRef.current);
  };

  const finishPointerDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (activePointerIdRef.current === event.pointerId) {
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // Pointer capture can already be released by the browser.
      }
      activePointerIdRef.current = null;
      draggingBandIndexRef.current = null;
    }
  };

  const handlePointerLeave = () => {
    if (draggingBandIndexRef.current === null) {
      setActiveBandIndex(null);
    }
  };

  const handleContextMenu = (event: ReactMouseEvent<SVGSVGElement>) => {
    if (disabled || !onResetBand) return;
    const coordinates = getPointerCoordinates(event);
    if (!coordinates) return;

    const bandIndex = getNearestPointIndex(points, coordinates.x);
    if (bandIndex < 0) return;

    event.preventDefault();
    event.stopPropagation();
    onResetBand(bandIndex);
  };

  return (
    <div className={`graphic-eq ${compact ? 'compact' : ''}`}>
      <div className="graphic-eq-stage">
        <svg
          ref={svgRef}
          className="graphic-eq-graph"
          viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
          role="group"
          aria-label={ariaLabel}
          preserveAspectRatio="none"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishPointerDrag}
          onPointerCancel={finishPointerDrag}
          onPointerLeave={handlePointerLeave}
          onContextMenu={handleContextMenu}
        >
          <defs>
            <linearGradient id={responseGradientId} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor={EQ_BAND_COLORS[0]} stopOpacity="0.64" />
              <stop offset="34%" stopColor={EQ_BAND_COLORS[4]} stopOpacity="0.68" />
              <stop offset="68%" stopColor={EQ_BAND_COLORS[6]} stopOpacity="0.68" />
              <stop offset="100%" stopColor={EQ_BAND_COLORS[9]} stopOpacity="0.64" />
            </linearGradient>
            <clipPath id={positiveClipId}>
              <rect x="0" y="0" width={VIEWBOX_WIDTH} height={zeroY} />
            </clipPath>
            <clipPath id={negativeClipId}>
              <rect x="0" y={zeroY} width={VIEWBOX_WIDTH} height={VIEWBOX_HEIGHT - zeroY} />
            </clipPath>
          </defs>

          <rect className="graphic-eq-frame" x="0" y="0" width={VIEWBOX_WIDTH} height={VIEWBOX_HEIGHT} />

          {DB_GRID_LINES.map(db => {
            const y = valueToY(db, minDb, maxDb);
            return (
              <g key={db} className={`graphic-eq-db-line ${db === 0 ? 'zero' : ''}`}>
                <line x1={GRAPH_LEFT} y1={y} x2={GRAPH_RIGHT} y2={y} />
                <text x={2.4} y={y + 1.4}>{db > 0 ? `+${db}` : db}</text>
              </g>
            );
          })}

          {points.map((point, index) => (
            <g key={bands[index].id} className="graphic-eq-frequency-line">
              <line x1={point.x} y1={GRAPH_TOP} x2={point.x} y2={GRAPH_BOTTOM} />
              {!compact && (
                <text x={point.x} y={55}>{formatEqualizerFrequency(point.frequencyHz)}</text>
              )}
            </g>
          ))}

          {points.map((point, index) => {
            const magnitude = Math.abs(point.valueDb);
            if (magnitude < 0.05) return null;
            const color = EQ_BAND_COLORS[index % EQ_BAND_COLORS.length];
            return (
              <ellipse
                key={`${bands[index].id}-lobe`}
                className="graphic-eq-band-lobe"
                cx={point.x}
                cy={point.y}
                rx={4.2 + magnitude * 0.55}
                ry={2.8 + magnitude * 0.9}
                fill={color}
                stroke={color}
              />
            );
          })}

          {areaPath && (
            <>
              <path className="graphic-eq-area positive" d={areaPath} clipPath={`url(#${positiveClipId})`} />
              <path className="graphic-eq-area negative" d={areaPath} clipPath={`url(#${negativeClipId})`} />
            </>
          )}

          {curvePath && (
            <>
              <path className="graphic-eq-curve-shadow" d={curvePath} />
              <path className="graphic-eq-curve" d={curvePath} stroke={`url(#${responseGradientId})`} />
            </>
          )}

          {points.map((point, index) => {
            const color = EQ_BAND_COLORS[index % EQ_BAND_COLORS.length];
            const active = activeBandIndex === index;
            return (
              <g
                key={`${bands[index].id}-point`}
                className={`graphic-eq-point ${active ? 'active' : ''}`}
              >
                {active && <line className="graphic-eq-active-line" x1={point.x} y1={GRAPH_TOP} x2={point.x} y2={GRAPH_BOTTOM} />}
                <circle
                  cx={point.x}
                  cy={point.y}
                  r={active ? 2.65 : 2.15}
                  fill={color}
                  stroke={active ? '#ffffff' : 'rgba(255,255,255,0.72)'}
                />
                {active && (
                  <text className="graphic-eq-point-readout" x={point.x} y={Math.max(8, point.y - 4.6)}>
                    {formatSignedDb(point.valueDb)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      <div className="graphic-eq-band-controls">
        {bands.map((band, index) => {
          const value = clamp(band.valueDb, minDb, maxDb);
          const bandColor = EQ_BAND_COLORS[index % EQ_BAND_COLORS.length];
          return (
            <div
              key={band.id}
              className={`graphic-eq-band-control ${activeBandIndex === index ? 'active' : ''}`}
              onPointerEnter={() => setActiveBandIndex(index)}
              onPointerLeave={() => {
                if (draggingBandIndexRef.current === null) setActiveBandIndex(null);
              }}
            >
              <div className={`graphic-eq-band-topline ${band.keyframeToggle ? 'has-keyframe' : ''}`}>
                {band.keyframeToggle && <span className="graphic-eq-band-kf">{band.keyframeToggle}</span>}
                <span className={`graphic-eq-band-value ${value > 0 ? 'boost' : value < 0 ? 'cut' : ''}`}>
                  {formatSignedDb(value)}
                </span>
              </div>
              <input
                type="range"
                className="graphic-eq-band-range"
                min={minDb}
                max={maxDb}
                step={step}
                value={value}
                disabled={disabled}
                aria-label={band.ariaLabel ?? `${formatEqualizerFrequency(band.frequencyHz)} EQ`}
                title={`${formatEqualizerFrequency(band.frequencyHz)}Hz: ${formatSignedDb(value)}`}
                onChange={(event) => onChange(index, Number(event.currentTarget.value))}
                onContextMenu={(event) => {
                  if (!onResetBand) return;
                  event.preventDefault();
                  event.stopPropagation();
                  onResetBand(index);
                }}
                style={{ accentColor: bandColor, color: bandColor }}
              />
              <div className="graphic-eq-band-label">{band.label}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
