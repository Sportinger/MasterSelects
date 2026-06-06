import { buildFadeCurvePath, type FadeCurveKeyframe } from '../utils/fadeCurvePath';

// FadeCurve - Renders SVG bezier curve showing opacity fade
// Note: Not using memo() here to ensure re-render on keyframe changes

export function FadeCurve({
  keyframes,
  clipDuration,
  width,
  height,
}: {
  keyframes: readonly FadeCurveKeyframe[];
  clipDuration: number;
  width: number;
  height: number;
}) {
  const path = buildFadeCurvePath({ keyframes, clipDuration, width, height });
  if (!path) return null;

  return (
    <svg
      className="fade-curve-svg"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
    >
      {/* Filled area under curve */}
      <path
        d={path.fillPath}
        fill="rgba(0, 0, 0, 0.4)"
        stroke="none"
      />
      {/* Curve line */}
      <path
        d={path.curvePath}
        fill="none"
        stroke="rgba(140, 180, 220, 0.8)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Keyframe dots */}
      {path.points.map((point, i) => (
        <circle
          key={i}
          cx={point.x}
          cy={point.y}
          r="3"
          fill="rgba(140, 180, 220, 1)"
        />
      ))}
    </svg>
  );
}
