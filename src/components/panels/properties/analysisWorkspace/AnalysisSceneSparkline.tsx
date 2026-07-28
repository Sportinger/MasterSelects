import { useMemo } from 'react';

export interface AnalysisSceneSparklineCurve {
  values: Float32Array;
  hopSeconds: number;
  startSeconds: number;
}

export interface AnalysisSceneSparklineProps {
  curve: AnalysisSceneSparklineCurve;
  start: number;
  end: number;
  height?: number;
}

const MAX_POINTS = 100;

function normalizeEnergyDb(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, (value + 60) / 60));
}

export function AnalysisSceneSparkline({
  curve,
  start,
  end,
  height = 16,
}: AnalysisSceneSparklineProps) {
  const points = useMemo(() => {
    if (!Number.isFinite(curve.hopSeconds) || curve.hopSeconds <= 0 || end < start) {
      return [];
    }
    const first = Math.max(0, Math.ceil((start - curve.startSeconds) / curve.hopSeconds));
    const last = Math.min(
      curve.values.length - 1,
      Math.floor((end - curve.startSeconds) / curve.hopSeconds),
    );
    const sliceLength = Math.max(0, last - first + 1);
    if (sliceLength < 4) return [];

    const pointCount = Math.min(sliceLength, MAX_POINTS);
    return Array.from({ length: pointCount }, (_, index) => {
      const relativeIndex = Math.round(index * (sliceLength - 1) / (pointCount - 1));
      const normalized = normalizeEnergyDb(curve.values[first + relativeIndex]);
      const x = index * 100 / (pointCount - 1);
      const y = height * (1 - normalized);
      return `${x},${y}`;
    });
  }, [curve, end, height, start]);

  if (points.length < 4) return null;

  return (
    <svg
      aria-hidden="true"
      className="AnalysisSceneSparkline"
      data-point-count={points.length}
      preserveAspectRatio="none"
      viewBox={`0 0 100 ${height}`}
    >
      <polyline
        fill="none"
        points={points.join(' ')}
        stroke="var(--analysis-scene-sparkline-color, var(--text-muted))"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
