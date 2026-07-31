import {
  PREVIEW_BLUE,
  PREVIEW_CORAL,
  PREVIEW_DARK,
  PREVIEW_WHITE,
  PreviewSvg,
  type TransitionPreviewRenderer,
} from './previewShared';
import './dissolveDipPreview.css';

const FRAME = { x: 4, y: 5, width: 72, height: 30, rx: 4 } as const;
const CUSTOM_DIP_COLOR = '#a855f7';

function renderFrameOutline() {
  return (
    <>
      <rect
        className="tp-dd-frame-sheen"
        x="5"
        y="6"
        width="70"
        height="14"
        rx="3"
        fill={PREVIEW_WHITE}
        opacity="0.09"
      />
      <rect
        className="tp-dd-frame-outline"
        {...FRAME}
        fill="none"
        stroke={PREVIEW_WHITE}
        strokeWidth="0.8"
        opacity="0.28"
      />
    </>
  );
}

export const renderDissolveDipPreview: TransitionPreviewRenderer = ({
  type,
  idPrefix,
}) => {
  const clipId = `${idPrefix}-${type}-dissolve-clip`;
  const softBlurId = `${idPrefix}-${type}-soft-blur`;
  const crossGlowId = `${idPrefix}-${type}-cross-glow`;

  if (type === 'crossfade') {
    return (
      <PreviewSvg type={type} className="transition-preview-dissolve-dip">
        <defs>
          <clipPath id={clipId}>
            <rect {...FRAME} />
          </clipPath>
          <linearGradient id={crossGlowId} x1="4" y1="5" x2="76" y2="35" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor={PREVIEW_BLUE} stopOpacity="0.12" />
            <stop offset="0.48" stopColor={PREVIEW_WHITE} stopOpacity="0.38" />
            <stop offset="1" stopColor={PREVIEW_CORAL} stopOpacity="0.12" />
          </linearGradient>
        </defs>
        <g clipPath={`url(#${clipId})`}>
          <rect className="tp-dd-cross-out tp-dd-animated" {...FRAME} fill={PREVIEW_BLUE} opacity="0.7" />
          <rect className="tp-dd-cross-in tp-dd-animated" {...FRAME} fill={PREVIEW_CORAL} opacity="0.58" />
          <rect className="tp-dd-cross-glow tp-dd-animated" {...FRAME} fill={`url(#${crossGlowId})`} />
          <g className="tp-dd-cross-weave tp-dd-animated" fill="none" stroke={PREVIEW_WHITE} strokeWidth="1">
            <path d="M-2 30C18 30 25 10 43 10S65 27 84 27" opacity="0.38" />
            <path d="M-2 12C18 12 25 30 43 30S65 13 84 13" opacity="0.5" />
          </g>
        </g>
        {renderFrameOutline()}
      </PreviewSvg>
    );
  }

  if (type === 'blur-dissolve') {
    return (
      <PreviewSvg type={type} className="transition-preview-dissolve-dip">
        <defs>
          <clipPath id={clipId}>
            <rect {...FRAME} />
          </clipPath>
          <filter id={softBlurId} x="-30%" y="-50%" width="160%" height="200%" colorInterpolationFilters="sRGB">
            <feGaussianBlur stdDeviation="3.1" />
          </filter>
          <linearGradient id={crossGlowId} x1="8" y1="8" x2="72" y2="32" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor={PREVIEW_BLUE} />
            <stop offset="0.5" stopColor={PREVIEW_WHITE} stopOpacity="0.44" />
            <stop offset="1" stopColor={PREVIEW_CORAL} />
          </linearGradient>
        </defs>
        <g clipPath={`url(#${clipId})`}>
          <rect {...FRAME} fill={PREVIEW_DARK} />
          <g className="tp-dd-blur-out tp-dd-animated" filter={`url(#${softBlurId})`} opacity="0.72">
            <rect x="-4" y="2" width="53" height="36" rx="8" fill={PREVIEW_BLUE} />
            <path d="M-4 27C12 16 27 16 51 6v15C30 29 14 31-4 36Z" fill={PREVIEW_WHITE} opacity="0.13" />
          </g>
          <g className="tp-dd-blur-in tp-dd-animated" filter={`url(#${softBlurId})`} opacity="0.72">
            <rect x="31" y="2" width="53" height="36" rx="8" fill={PREVIEW_CORAL} />
            <path d="M29 34C49 25 60 17 84 10V1H40Z" fill={PREVIEW_WHITE} opacity="0.12" />
          </g>
          <path
            className="tp-dd-blur-ribbon tp-dd-animated"
            d="M-4 26C14 10 29 32 46 15S69 11 85 22"
            fill="none"
            stroke={`url(#${crossGlowId})`}
            strokeWidth="4"
            strokeLinecap="round"
            opacity="0.62"
            filter={`url(#${softBlurId})`}
          />
          <path
            d="M13 15C29 9 47 30 68 22"
            fill="none"
            stroke={PREVIEW_WHITE}
            strokeWidth="1.2"
            strokeLinecap="round"
            opacity="0.42"
          />
        </g>
        {renderFrameOutline()}
      </PreviewSvg>
    );
  }

  if (type === 'additive-dissolve') {
    return (
      <PreviewSvg type={type} className="transition-preview-dissolve-dip">
        <defs>
          <clipPath id={clipId}>
            <rect {...FRAME} />
          </clipPath>
          <radialGradient id={crossGlowId} cx="50%" cy="50%" r="60%">
            <stop offset="0" stopColor={PREVIEW_WHITE} stopOpacity="0.98" />
            <stop offset="0.34" stopColor="#fff3c4" stopOpacity="0.72" />
            <stop offset="1" stopColor={PREVIEW_WHITE} stopOpacity="0" />
          </radialGradient>
        </defs>
        <g clipPath={`url(#${clipId})`}>
          <rect {...FRAME} fill={PREVIEW_DARK} />
          <rect
            className="tp-dd-add-out tp-dd-animated"
            x="-7"
            y="2"
            width="56"
            height="36"
            rx="7"
            fill={PREVIEW_BLUE}
            opacity="0.82"
            style={{ mixBlendMode: 'screen' }}
          />
          <rect
            className="tp-dd-add-in tp-dd-animated"
            x="31"
            y="2"
            width="56"
            height="36"
            rx="7"
            fill={PREVIEW_CORAL}
            opacity="0.82"
            style={{ mixBlendMode: 'screen' }}
          />
          <ellipse
            className="tp-dd-add-glow tp-dd-animated"
            cx="40"
            cy="20"
            rx="27"
            ry="20"
            fill={`url(#${crossGlowId})`}
            opacity="0.78"
            style={{ mixBlendMode: 'screen' }}
          />
          <g
            className="tp-dd-add-spark tp-dd-animated"
            stroke={PREVIEW_WHITE}
            strokeWidth="1.4"
            strokeLinecap="round"
            opacity="0.74"
          >
            <path d="M40 8v5M40 27v5M27 20h5M48 20h5" />
            <path d="m31 11 3 4M49 11l-3 4M31 29l3-4M49 29l-3-4" opacity="0.65" />
          </g>
        </g>
        {renderFrameOutline()}
      </PreviewSvg>
    );
  }

  if (type === 'non-additive-dissolve') {
    return (
      <PreviewSvg type={type} className="transition-preview-dissolve-dip">
        <defs>
          <clipPath id={clipId}>
            <rect {...FRAME} />
          </clipPath>
          <linearGradient id={crossGlowId} x1="19" y1="8" x2="61" y2="32" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor={PREVIEW_DARK} stopOpacity="0" />
            <stop offset="0.5" stopColor={PREVIEW_DARK} stopOpacity="0.96" />
            <stop offset="1" stopColor={PREVIEW_DARK} stopOpacity="0" />
          </linearGradient>
        </defs>
        <g clipPath={`url(#${clipId})`}>
          <rect className="tp-dd-dark-out tp-dd-animated" {...FRAME} fill={PREVIEW_BLUE} opacity="0.72" />
          <rect
            className="tp-dd-dark-in tp-dd-animated"
            {...FRAME}
            fill={PREVIEW_CORAL}
            opacity="0.5"
            style={{ mixBlendMode: 'multiply' }}
          />
          <rect
            className="tp-dd-dark-shade tp-dd-animated"
            x="13"
            y="2"
            width="54"
            height="36"
            fill={`url(#${crossGlowId})`}
            opacity="0.82"
          />
          <path
            className="tp-dd-dark-pulse tp-dd-animated"
            d="M17 20h10l4-5 6 10 6-12 5 7h15"
            fill="none"
            stroke={PREVIEW_WHITE}
            strokeWidth="1.1"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.42"
          />
        </g>
        {renderFrameOutline()}
      </PreviewSvg>
    );
  }

  if (type === 'dip-to-color' || type === 'dip-to-black' || type === 'dip-to-white') {
    const dipColor = type === 'dip-to-color'
      ? CUSTOM_DIP_COLOR
      : type === 'dip-to-white'
        ? PREVIEW_WHITE
        : PREVIEW_DARK;
    const symbolStroke = type === 'dip-to-white' ? PREVIEW_DARK : PREVIEW_WHITE;

    return (
      <PreviewSvg type={type} className="transition-preview-dissolve-dip">
        <defs>
          <clipPath id={clipId}>
            <rect {...FRAME} />
          </clipPath>
          <linearGradient id={crossGlowId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={PREVIEW_WHITE} stopOpacity="0.28" />
            <stop offset="0.48" stopColor={PREVIEW_WHITE} stopOpacity="0.03" />
            <stop offset="1" stopColor={PREVIEW_DARK} stopOpacity="0.2" />
          </linearGradient>
        </defs>
        <g clipPath={`url(#${clipId})`}>
          <rect className="tp-dd-dip-out tp-dd-animated" {...FRAME} fill={PREVIEW_BLUE} opacity="0.56" />
          <rect className="tp-dd-dip-in tp-dd-animated" {...FRAME} fill={PREVIEW_CORAL} opacity="0.44" />
          <rect className="tp-dd-dip-color tp-dd-animated" {...FRAME} fill={dipColor} opacity="0.74" />
          <rect className="tp-dd-dip-lustre tp-dd-animated" {...FRAME} fill={`url(#${crossGlowId})`} opacity="0.72" />
          <g
            className="tp-dd-dip-symbol tp-dd-animated"
            fill="none"
            stroke={symbolStroke}
            strokeWidth="1.2"
            strokeLinecap="round"
            opacity="0.72"
          >
            <path d="M28 20h24" />
            <path d="m32 16-4 4 4 4M48 16l4 4-4 4" />
            {type === 'dip-to-color' ? (
              <circle cx="40" cy="20" r="4.2" fill={CUSTOM_DIP_COLOR} stroke={PREVIEW_WHITE} strokeWidth="1" />
            ) : (
              <circle cx="40" cy="20" r="3.4" fill={dipColor} />
            )}
          </g>
        </g>
        {renderFrameOutline()}
      </PreviewSvg>
    );
  }

  return null;
};
