import {
  PREVIEW_BLUE,
  PREVIEW_CORAL,
  PREVIEW_DARK,
  PREVIEW_WHITE,
  PreviewSvg,
  type TransitionPreviewRenderer,
} from './previewShared';
import './rotate3dPreview.css';

const ROTATE_3D_TYPES = new Set([
  'rotate-left',
  'rotate-right',
  'rotate-90',
  'flip-horizontal',
  'flip-vertical',
  'card-spin',
  'tumble-away',
  'roll-3d',
  'spinback-3d',
]);

export const renderRotate3dPreview: TransitionPreviewRenderer = ({ type, idPrefix }) => {
  if (!ROTATE_3D_TYPES.has(type)) return null;

  const assetPrefix = `${idPrefix}-rotate-${type}`;
  const blueGradientId = `${assetPrefix}-blue`;
  const coralGradientId = `${assetPrefix}-coral`;
  const edgeGradientId = `${assetPrefix}-edge`;
  const shadowId = `${assetPrefix}-shadow`;

  const defs = (
    <defs>
      <linearGradient id={blueGradientId} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor={PREVIEW_BLUE} />
        <stop offset="1" stopColor={PREVIEW_BLUE} stopOpacity="0.62" />
      </linearGradient>
      <linearGradient id={coralGradientId} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#ff9a72" />
        <stop offset="0.42" stopColor={PREVIEW_CORAL} />
        <stop offset="1" stopColor={PREVIEW_CORAL} stopOpacity="0.68" />
      </linearGradient>
      <linearGradient id={edgeGradientId} x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor={PREVIEW_DARK} stopOpacity="0.78" />
        <stop offset="1" stopColor={PREVIEW_WHITE} stopOpacity="0.28" />
      </linearGradient>
      <filter id={shadowId} x="-25%" y="-30%" width="160%" height="175%">
        <feDropShadow
          dx="1"
          dy="1.4"
          stdDeviation="0.85"
          floodColor={PREVIEW_DARK}
          floodOpacity="0.62"
        />
      </filter>
    </defs>
  );

  if (type === 'rotate-left' || type === 'rotate-right' || type === 'rotate-90') {
    const isLeft = type === 'rotate-left';
    const isRight = type === 'rotate-right';
    const cardClass = isLeft
      ? 'tp-rotate-flat-card-left'
      : isRight
        ? 'tp-rotate-flat-card-right'
        : 'tp-rotate-flat-card-quarter';
    const arrowPath = isLeft
      ? 'M59 22A19 15 0 0 0 28 10l-1-5m1 5 5-1'
      : isRight
        ? 'M21 22A19 15 0 0 1 52 10l1-5m-1 5-5-1'
        : 'M22 27A20 18 0 0 0 58 20m0 0-5-3m5 3-2 5';

    return (
      <PreviewSvg type={type} className="tp-rotate-preview">
        {defs}
        <ellipse cx="40" cy="33" rx="24" ry="3.2" fill={PREVIEW_DARK} opacity="0.46" />
        <g className="tp-rotate-flat-ghost">
          <rect
            x="22"
            y="8"
            width="36"
            height="24"
            rx="2.5"
            fill={`url(#${blueGradientId})`}
            opacity="0.44"
          />
          <path d="M27 13h16M27 17h25M27 27h12" stroke={PREVIEW_WHITE} strokeWidth="1" opacity="0.28" />
        </g>
        <g className={`tp-rotate-flat-card ${cardClass}`} filter={`url(#${shadowId})`}>
          <rect x="23" y="8" width="34" height="24" rx="2.5" fill={`url(#${coralGradientId})`} />
          <path d="M28 13h20M28 17h24M28 27h13" stroke={PREVIEW_WHITE} strokeWidth="1.15" opacity="0.52" />
          <path d="M25 10h30" stroke={PREVIEW_WHITE} strokeWidth="1" opacity="0.4" />
        </g>
        <path
          className="tp-rotate-direction-arrow"
          d={arrowPath}
          fill="none"
          stroke={PREVIEW_WHITE}
          strokeWidth="1.65"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.9"
        />
        {type === 'rotate-90' ? (
          <path d="M61 24h5v5" fill="none" stroke={PREVIEW_WHITE} strokeWidth="1" opacity="0.52" />
        ) : null}
      </PreviewSvg>
    );
  }

  if (type === 'flip-horizontal') {
    return (
      <PreviewSvg type={type} className="tp-rotate-preview">
        {defs}
        <ellipse cx="40" cy="33.5" rx="22" ry="3" fill={PREVIEW_DARK} opacity="0.56" />
        <g className="tp-3d-flip-h-back" filter={`url(#${shadowId})`}>
          <rect x="17" y="8" width="46" height="24" rx="2.5" fill={`url(#${blueGradientId})`} />
          <path d="M22 13h25M22 27h17" stroke={PREVIEW_WHITE} strokeWidth="1" opacity="0.32" />
        </g>
        <g className="tp-3d-flip-h-front" filter={`url(#${shadowId})`}>
          <rect x="17" y="8" width="46" height="24" rx="2.5" fill={`url(#${coralGradientId})`} />
          <path d="M22 13h27M22 27h15" stroke={PREVIEW_WHITE} strokeWidth="1" opacity="0.46" />
          <path d="M61 9h3v24l-3-2z" fill={`url(#${edgeGradientId})`} />
        </g>
        <path d="M40 6v28" stroke={PREVIEW_WHITE} strokeWidth="1.2" strokeDasharray="2 2" opacity="0.7" />
        <path d="m35 9 5-3 5 3M35 31l5 3 5-3" fill="none" stroke={PREVIEW_WHITE} strokeWidth="1" opacity="0.44" />
      </PreviewSvg>
    );
  }

  if (type === 'flip-vertical') {
    return (
      <PreviewSvg type={type} className="tp-rotate-preview">
        {defs}
        <ellipse cx="40" cy="33.5" rx="25" ry="2.8" fill={PREVIEW_DARK} opacity="0.54" />
        <g className="tp-3d-flip-v-back" filter={`url(#${shadowId})`}>
          <rect x="17" y="8" width="46" height="24" rx="2.5" fill={`url(#${blueGradientId})`} />
          <path d="M22 13h28M22 27h17" stroke={PREVIEW_WHITE} strokeWidth="1" opacity="0.32" />
        </g>
        <g className="tp-3d-flip-v-front" filter={`url(#${shadowId})`}>
          <rect x="17" y="8" width="46" height="24" rx="2.5" fill={`url(#${coralGradientId})`} />
          <path d="M22 13h27M22 27h15" stroke={PREVIEW_WHITE} strokeWidth="1" opacity="0.46" />
          <path d="M18 30h44l-3 3H21z" fill={`url(#${edgeGradientId})`} />
        </g>
        <path d="M14 20h52" stroke={PREVIEW_WHITE} strokeWidth="1.2" strokeDasharray="2 2" opacity="0.7" />
        <path d="m17 16-3 4 3 4M63 16l3 4-3 4" fill="none" stroke={PREVIEW_WHITE} strokeWidth="1" opacity="0.44" />
      </PreviewSvg>
    );
  }

  if (type === 'card-spin') {
    return (
      <PreviewSvg type={type} className="tp-rotate-preview">
        {defs}
        <ellipse cx="40" cy="33.5" rx="23" ry="3" fill={PREVIEW_DARK} opacity="0.52" />
        <rect x="21" y="9" width="38" height="22" rx="2" fill={`url(#${blueGradientId})`} opacity="0.3" transform="rotate(10 40 20)" />
        <g className="tp-3d-card-spin" filter={`url(#${shadowId})`}>
          <rect x="22" y="7" width="36" height="26" rx="2.5" fill={`url(#${coralGradientId})`} />
          <path d="M27 12h23M27 17h19M27 28h12" stroke={PREVIEW_WHITE} strokeWidth="1" opacity="0.48" />
          <path d="M56 9h3v25l-3-2z" fill={`url(#${edgeGradientId})`} />
        </g>
        <path
          d="M23 29c8 8 27 8 36-1m-6-2 6 2-3 5"
          fill="none"
          stroke={PREVIEW_WHITE}
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.78"
        />
      </PreviewSvg>
    );
  }

  if (type === 'tumble-away') {
    return (
      <PreviewSvg type={type} className="tp-rotate-preview">
        {defs}
        <ellipse className="tp-3d-tumble-shadow" cx="46" cy="34" rx="18" ry="2.8" fill={PREVIEW_DARK} opacity="0.58" />
        <rect x="13" y="8" width="38" height="24" rx="2.5" fill={`url(#${blueGradientId})`} opacity="0.38" />
        <path d="M15 10 29 20 15 30" fill={PREVIEW_WHITE} opacity="0.08" />
        <g className="tp-3d-tumble-card" filter={`url(#${shadowId})`}>
          <rect x="24" y="8" width="38" height="24" rx="2.5" fill={`url(#${coralGradientId})`} />
          <path d="M29 13h24M29 27h14" stroke={PREVIEW_WHITE} strokeWidth="1" opacity="0.48" />
          <path d="M61 10l4 3v22l-4-3z" fill={`url(#${edgeGradientId})`} />
        </g>
        <path
          d="M24 11c4 8 13 14 25 17m-2-5 2 5-5 1"
          fill="none"
          stroke={PREVIEW_WHITE}
          strokeWidth="1.25"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.7"
        />
      </PreviewSvg>
    );
  }

  if (type === 'roll-3d') {
    return (
      <PreviewSvg type={type} className="tp-rotate-preview">
        {defs}
        <ellipse cx="40" cy="34" rx="27" ry="3" fill={PREVIEW_DARK} opacity="0.6" />
        <path d="M12 18c10-9 42-11 56 0" fill="none" stroke={PREVIEW_BLUE} strokeWidth="3" opacity="0.22" />
        <g className="tp-3d-roll-card" filter={`url(#${shadowId})`}>
          <path d="M17 11Q39 6 63 11l-3 19q-21-5-43 1z" fill={`url(#${coralGradientId})`} />
          <path d="M17 31q22-6 43-1l-2 4q-19-5-40 0z" fill={`url(#${edgeGradientId})`} />
          <path d="M23 14q17-4 32 0M22 19q16-4 29 0" fill="none" stroke={PREVIEW_WHITE} strokeWidth="1" opacity="0.46" />
          <path d="M61 12l3 2-2 18-2-2z" fill={PREVIEW_DARK} opacity="0.44" />
        </g>
        <path
          d="M20 10c10-7 31-7 41 1m-5-5 5 5-6 1"
          fill="none"
          stroke={PREVIEW_WHITE}
          strokeWidth="1.35"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.76"
        />
      </PreviewSvg>
    );
  }

  return (
    <PreviewSvg type={type} className="tp-rotate-preview">
      {defs}
      <ellipse className="tp-3d-spinback-shadow" cx="40" cy="34" rx="21" ry="3" fill={PREVIEW_DARK} opacity="0.56" />
      <g className="tp-3d-spinback-trails">
        <rect x="18" y="8" width="42" height="24" rx="2" fill={`url(#${blueGradientId})`} opacity="0.2" />
        <rect x="29" y="10" width="33" height="19" rx="1.8" fill={PREVIEW_BLUE} opacity="0.2" transform="rotate(-12 45 20)" />
        <rect x="39" y="11" width="25" height="15" rx="1.5" fill={PREVIEW_CORAL} opacity="0.18" transform="rotate(-24 51 19)" />
      </g>
      <path d="M20 29 50 17M20 10l30 7" stroke={PREVIEW_WHITE} strokeWidth="0.8" opacity="0.24" />
      <g className="tp-3d-spinback-card" filter={`url(#${shadowId})`}>
        <rect x="24" y="8" width="38" height="24" rx="2.5" fill={`url(#${coralGradientId})`} />
        <path d="M29 13h24M29 27h14" stroke={PREVIEW_WHITE} strokeWidth="1" opacity="0.48" />
        <path d="M60 10l4 2v21l-4-2z" fill={`url(#${edgeGradientId})`} />
      </g>
      <path
        d="M24 29c6-13 25-20 38-12m-5-5 5 5-6 1"
        fill="none"
        stroke={PREVIEW_WHITE}
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.78"
      />
    </PreviewSvg>
  );
};
