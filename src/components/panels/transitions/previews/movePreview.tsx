import './movePreview.css';
import {
  PREVIEW_BLUE,
  PREVIEW_CORAL,
  PREVIEW_DARK,
  PREVIEW_WHITE,
  PreviewSvg,
  type TransitionPreviewRenderer,
} from './previewShared';

type MoveMode = 'push' | 'slide';
type MoveDirection = 'left' | 'right' | 'up' | 'down';

export const renderMovePreview: TransitionPreviewRenderer = ({ type, idPrefix }) => {
  const match = /^(push|slide)-(left|right|up|down)$/.exec(type);
  if (!match) return null;

  const mode = match[1] as MoveMode;
  const direction = match[2] as MoveDirection;
  const isHorizontal = direction === 'left' || direction === 'right';
  const frameClipId = `${idPrefix}-move-frame`;
  const outgoingGradientId = `${idPrefix}-move-outgoing`;
  const incomingGradientId = `${idPrefix}-move-incoming`;

  const chevronPath = direction === 'left'
    ? 'M13 15 8 20l5 5'
    : direction === 'right'
      ? 'M67 15l5 5-5 5'
      : direction === 'up'
        ? 'M34 14l6-5 6 5'
        : 'M34 26l6 5 6-5';

  return (
    <PreviewSvg
      type={type}
      className={`tp-move tp-move--${mode} tp-move--${direction}`}
    >
      <defs>
        <clipPath id={frameClipId}>
          <rect x="5" y="6" width="70" height="28" rx="3" />
        </clipPath>
        <linearGradient id={outgoingGradientId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={PREVIEW_BLUE} />
          <stop offset="100%" stopColor={PREVIEW_BLUE} stopOpacity="0.7" />
        </linearGradient>
        <linearGradient id={incomingGradientId} x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor={PREVIEW_CORAL} stopOpacity="0.84" />
          <stop offset="62%" stopColor={PREVIEW_CORAL} />
          <stop offset="100%" stopColor={PREVIEW_WHITE} stopOpacity="0.5" />
        </linearGradient>
      </defs>

      <rect x="4" y="5" width="72" height="30" rx="4" fill={PREVIEW_DARK} opacity="0.5" />

      <g clipPath={`url(#${frameClipId})`}>
        <g className="tp-move__outgoing">
          <rect
            x="5"
            y="6"
            width="70"
            height="28"
            rx={mode === 'slide' ? 3 : 0}
            fill={`url(#${outgoingGradientId})`}
          />
          <circle cx="24" cy="19" r="9" fill={PREVIEW_WHITE} opacity="0.07" />
          <path
            d="M7 31 34 7h19L24 34H7Z"
            fill={PREVIEW_WHITE}
            opacity="0.055"
          />
        </g>

        <g className="tp-move__incoming">
          <rect
            x="5"
            y="6"
            width="70"
            height="28"
            rx={mode === 'slide' ? 3 : 0}
            fill={`url(#${incomingGradientId})`}
          />
          <circle cx="59" cy="15" r="8" fill={PREVIEW_WHITE} opacity="0.065" />
          <path
            d="M18 34 56 6h15L34 34Z"
            fill={PREVIEW_WHITE}
            opacity="0.06"
          />

          <g className="tp-move__leading-edge">
            {isHorizontal ? (
              <>
                <rect
                  className="tp-move__edge-shadow"
                  x={direction === 'left' ? 1 : 71}
                  y="6"
                  width="8"
                  height="28"
                  fill={PREVIEW_DARK}
                />
                <path
                  d={direction === 'left' ? 'M5 7v26' : 'M75 7v26'}
                  stroke={PREVIEW_WHITE}
                  strokeWidth="1.1"
                  strokeLinecap="round"
                  opacity="0.82"
                />
              </>
            ) : (
              <>
                <rect
                  className="tp-move__edge-shadow"
                  x="5"
                  y={direction === 'up' ? 2 : 30}
                  width="70"
                  height="8"
                  fill={PREVIEW_DARK}
                />
                <path
                  d={direction === 'up' ? 'M6 6h68' : 'M6 34h68'}
                  stroke={PREVIEW_WHITE}
                  strokeWidth="1.1"
                  strokeLinecap="round"
                  opacity="0.82"
                />
              </>
            )}
            <path
              className="tp-move__chevron"
              d={chevronPath}
              fill="none"
              stroke={PREVIEW_WHITE}
              strokeWidth="1.45"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
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
