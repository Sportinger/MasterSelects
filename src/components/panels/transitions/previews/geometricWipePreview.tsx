import {
  PREVIEW_BLUE,
  PREVIEW_CORAL,
  PREVIEW_DARK,
  PREVIEW_WHITE,
  PreviewSvg,
  type TransitionPreviewRenderer,
} from './previewShared';
import './geometricWipePreview.css';

const GEOMETRIC_WIPE_TYPES = new Set([
  'center-wipe',
  'clock-wipe',
  'barn-door-horizontal',
  'barn-door-vertical',
]);

export const renderGeometricWipePreview: TransitionPreviewRenderer = ({
  type,
  idPrefix,
}) => {
  if (!GEOMETRIC_WIPE_TYPES.has(type)) return null;

  const clipId = `${idPrefix}-geometric-frame`;
  const blueGradientId = `${idPrefix}-geometric-blue`;
  const coralGradientId = `${idPrefix}-geometric-coral`;

  const frameDefs = (
    <defs>
      <clipPath id={clipId}>
        <rect x="6" y="6" width="68" height="28" rx="3" />
      </clipPath>
      <linearGradient id={blueGradientId} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={PREVIEW_BLUE} />
        <stop offset="1" stopColor={PREVIEW_BLUE} stopOpacity="0.76" />
      </linearGradient>
      <linearGradient id={coralGradientId} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={PREVIEW_CORAL} />
        <stop offset="1" stopColor={PREVIEW_CORAL} stopOpacity="0.78" />
      </linearGradient>
    </defs>
  );

  if (type === 'center-wipe') {
    return (
      <PreviewSvg type={type} className="tp-geometric-wipe">
        {frameDefs}
        <rect
          x="6"
          y="6"
          width="68"
          height="28"
          rx="3"
          fill={`url(#${blueGradientId})`}
        />
        <g clipPath={`url(#${clipId})`}>
          <rect
            className="tp-geometric-center-reveal"
            x="6"
            y="6"
            width="68"
            height="28"
            fill={`url(#${coralGradientId})`}
          />
          <path
            className="tp-geometric-center-sheen"
            d="M37 6h6v28h-6z"
            fill={PREVIEW_WHITE}
            opacity="0.12"
          />
        </g>
        <g className="tp-geometric-center-guides">
          <path d="M31 8v24M49 8v24" stroke={PREVIEW_WHITE} strokeWidth="1.4" />
          <path
            d="m28.5 17 3 3-3 3m23-6-3 3 3 3"
            fill="none"
            stroke={PREVIEW_WHITE}
            strokeWidth="1.25"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
        <rect
          x="6.5"
          y="6.5"
          width="67"
          height="27"
          rx="2.5"
          fill="none"
          stroke={PREVIEW_WHITE}
          strokeOpacity="0.2"
        />
      </PreviewSvg>
    );
  }

  if (type === 'clock-wipe') {
    return (
      <PreviewSvg type={type} className="tp-geometric-wipe">
        {frameDefs}
        <rect
          x="6"
          y="6"
          width="68"
          height="28"
          rx="3"
          fill={`url(#${blueGradientId})`}
        />
        <g clipPath={`url(#${clipId})`}>
          <circle
            className="tp-geometric-clock-sweep"
            cx="40"
            cy="20"
            r="39"
            fill="none"
            stroke={`url(#${coralGradientId})`}
            strokeWidth="78"
            pathLength="100"
            strokeDasharray="100"
            strokeDashoffset="75"
            transform="rotate(-90 40 20)"
          />
          <path
            className="tp-geometric-clock-hand"
            d="M40 20V4"
            fill="none"
            stroke={PREVIEW_WHITE}
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </g>
        <circle
          cx="40"
          cy="20"
          r="2.25"
          fill={PREVIEW_DARK}
          fillOpacity="0.56"
          stroke={PREVIEW_WHITE}
          strokeWidth="1"
        />
        <path
          d="M40 8v2M52 20h-2M40 32v-2M28 20h2"
          stroke={PREVIEW_WHITE}
          strokeWidth="1"
          strokeLinecap="round"
          opacity="0.52"
        />
        <rect
          x="6.5"
          y="6.5"
          width="67"
          height="27"
          rx="2.5"
          fill="none"
          stroke={PREVIEW_WHITE}
          strokeOpacity="0.2"
        />
      </PreviewSvg>
    );
  }

  if (type === 'barn-door-horizontal') {
    return (
      <PreviewSvg type={type} className="tp-geometric-wipe">
        {frameDefs}
        <rect
          x="6"
          y="6"
          width="68"
          height="28"
          rx="3"
          fill={`url(#${coralGradientId})`}
        />
        <g clipPath={`url(#${clipId})`}>
          <g className="tp-geometric-door tp-geometric-door-left">
            <rect x="6" y="6" width="34" height="28" fill={`url(#${blueGradientId})`} />
            <path
              d="M12 11h21v18H12zM35.5 6v28"
              fill="none"
              stroke={PREVIEW_WHITE}
              strokeOpacity="0.25"
              strokeWidth="1"
            />
            <circle cx="35" cy="20" r="1.4" fill={PREVIEW_WHITE} opacity="0.82" />
          </g>
          <g className="tp-geometric-door tp-geometric-door-right">
            <rect x="40" y="6" width="34" height="28" fill={`url(#${blueGradientId})`} />
            <path
              d="M47 11h21v18H47zM44.5 6v28"
              fill="none"
              stroke={PREVIEW_WHITE}
              strokeOpacity="0.25"
              strokeWidth="1"
            />
            <circle cx="45" cy="20" r="1.4" fill={PREVIEW_WHITE} opacity="0.82" />
          </g>
          <path
            className="tp-geometric-door-glow tp-geometric-door-glow-horizontal"
            d="M36 6h8v28h-8z"
            fill={PREVIEW_WHITE}
            opacity="0.13"
          />
        </g>
        <rect
          x="6.5"
          y="6.5"
          width="67"
          height="27"
          rx="2.5"
          fill="none"
          stroke={PREVIEW_WHITE}
          strokeOpacity="0.2"
        />
      </PreviewSvg>
    );
  }

  return (
    <PreviewSvg type={type} className="tp-geometric-wipe">
      {frameDefs}
      <rect
        x="6"
        y="6"
        width="68"
        height="28"
        rx="3"
        fill={`url(#${coralGradientId})`}
      />
      <g clipPath={`url(#${clipId})`}>
        <g className="tp-geometric-door tp-geometric-door-top">
          <rect x="6" y="6" width="68" height="14" fill={`url(#${blueGradientId})`} />
          <path
            d="M13 10h54v7H13zM6 17.5h68"
            fill="none"
            stroke={PREVIEW_WHITE}
            strokeOpacity="0.25"
            strokeWidth="1"
          />
          <circle cx="40" cy="16" r="1.25" fill={PREVIEW_WHITE} opacity="0.82" />
        </g>
        <g className="tp-geometric-door tp-geometric-door-bottom">
          <rect x="6" y="20" width="68" height="14" fill={`url(#${blueGradientId})`} />
          <path
            d="M13 23h54v7H13zM6 22.5h68"
            fill="none"
            stroke={PREVIEW_WHITE}
            strokeOpacity="0.25"
            strokeWidth="1"
          />
          <circle cx="40" cy="24" r="1.25" fill={PREVIEW_WHITE} opacity="0.82" />
        </g>
        <path
          className="tp-geometric-door-glow tp-geometric-door-glow-vertical"
          d="M6 17h68v6H6z"
          fill={PREVIEW_WHITE}
          opacity="0.13"
        />
      </g>
      <rect
        x="6.5"
        y="6.5"
        width="67"
        height="27"
        rx="2.5"
        fill="none"
        stroke={PREVIEW_WHITE}
        strokeOpacity="0.2"
      />
    </PreviewSvg>
  );
};
