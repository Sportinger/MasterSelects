import './directionalWipePreview.css';
import {
  PREVIEW_BLUE,
  PREVIEW_CORAL,
  PREVIEW_DARK,
  PREVIEW_WHITE,
  PreviewSvg,
  type TransitionPreviewRenderer,
} from './previewShared';

type WipeDirection = 'left' | 'right' | 'up' | 'down';

const DIRECTION_BY_TYPE: Readonly<Record<string, WipeDirection | undefined>> = {
  'wipe-left': 'left',
  'wipe-right': 'right',
  'wipe-up': 'up',
  'wipe-down': 'down',
};

export const renderDirectionalWipePreview: TransitionPreviewRenderer = ({
  type,
  idPrefix,
}) => {
  const direction = DIRECTION_BY_TYPE[type];
  if (!direction) return null;

  const isHorizontal = direction === 'left' || direction === 'right';
  const frameClipId = `${idPrefix}-directional-wipe-frame`;
  const outgoingGradientId = `${idPrefix}-directional-wipe-outgoing`;
  const incomingGradientId = `${idPrefix}-directional-wipe-incoming`;
  const edgeStart = direction === 'right' || direction === 'down'
    ? (isHorizontal ? 5 : 6)
    : (isHorizontal ? 75 : 34);

  const chevronPath = direction === 'right'
    ? `M${edgeStart - 3} 16l4 4-4 4`
    : direction === 'left'
      ? `M${edgeStart + 3} 16l-4 4 4 4`
      : direction === 'down'
        ? `M36 ${edgeStart - 3}l4 4 4-4`
        : `M36 ${edgeStart + 3}l4-4 4 4`;

  return (
    <PreviewSvg
      type={type}
      className={`tp-directional-wipe tp-directional-wipe--${direction}`}
    >
      <defs>
        <clipPath id={frameClipId}>
          <rect x="5" y="6" width="70" height="28" rx="3" />
        </clipPath>
        <linearGradient id={outgoingGradientId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={PREVIEW_BLUE} />
          <stop offset="100%" stopColor={PREVIEW_BLUE} stopOpacity="0.72" />
        </linearGradient>
        <linearGradient id={incomingGradientId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={PREVIEW_CORAL} stopOpacity="0.82" />
          <stop offset="58%" stopColor={PREVIEW_CORAL} />
          <stop offset="100%" stopColor={PREVIEW_WHITE} stopOpacity="0.56" />
        </linearGradient>
      </defs>

      <rect x="4" y="5" width="72" height="30" rx="4" fill={PREVIEW_DARK} opacity="0.46" />

      <g clipPath={`url(#${frameClipId})`}>
        <rect
          x="5"
          y="6"
          width="70"
          height="28"
          fill={`url(#${outgoingGradientId})`}
        />
        <path
          d="M5 30 37 6h21L26 34H5Z"
          fill={PREVIEW_WHITE}
          opacity="0.06"
        />

        <g className="tp-directional-wipe__incoming">
          <rect
            x="5"
            y="6"
            width="70"
            height="28"
            fill={`url(#${incomingGradientId})`}
          />
          <path
            d="M17 34 55 6h16L33 34Z"
            fill={PREVIEW_WHITE}
            opacity="0.06"
          />
        </g>

        <g className="tp-directional-wipe__edge">
          {isHorizontal ? (
            <>
              <rect
                x={edgeStart - 2.5}
                y="6"
                width="5"
                height="28"
                fill={PREVIEW_DARK}
                opacity="0.2"
              />
              <path
                d={`M${edgeStart} 7v26`}
                stroke={PREVIEW_WHITE}
                strokeWidth="1.25"
                strokeLinecap="round"
                opacity="0.86"
              />
            </>
          ) : (
            <>
              <rect
                x="5"
                y={edgeStart - 2.5}
                width="70"
                height="5"
                fill={PREVIEW_DARK}
                opacity="0.2"
              />
              <path
                d={`M6 ${edgeStart}h68`}
                stroke={PREVIEW_WHITE}
                strokeWidth="1.25"
                strokeLinecap="round"
                opacity="0.86"
              />
            </>
          )}
          <path
            className="tp-directional-wipe__chevron"
            d={chevronPath}
            fill="none"
            stroke={PREVIEW_WHITE}
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      </g>

      <rect
        x="5.5"
        y="6.5"
        width="69"
        height="27"
        rx="2.5"
        fill="none"
        stroke={PREVIEW_WHITE}
        strokeWidth="0.7"
        opacity="0.16"
      />
    </PreviewSvg>
  );
};
