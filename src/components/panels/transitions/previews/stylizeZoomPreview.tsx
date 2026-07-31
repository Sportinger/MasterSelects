import './stylizeZoomPreview.css';
import {
  PREVIEW_BLUE,
  PREVIEW_CORAL,
  PREVIEW_DARK,
  PREVIEW_WHITE,
  PreviewSvg,
  type TransitionPreviewRenderer,
} from './previewShared';

const FRAME = { x: 4, y: 5, width: 72, height: 30, rx: 4 } as const;

function renderFrameChrome() {
  return (
    <>
      <rect x="5" y="6" width="70" height="13" rx="3" fill={PREVIEW_WHITE} opacity="0.07" />
      <rect {...FRAME} fill="none" stroke={PREVIEW_WHITE} strokeWidth="0.8" opacity="0.28" />
    </>
  );
}

function renderZoomScene(
  className: string,
  color: string,
  accent: string,
  opacity: number,
) {
  return (
    <g className={`${className} tp-sz-animated`} opacity={opacity}>
      <rect {...FRAME} fill={color} />
      <circle cx="23" cy="14" r="4" fill={accent} opacity="0.48" />
      <path d="M4 31 23 17l10 8 10-10 33 18v2H4Z" fill={PREVIEW_DARK} opacity="0.28" />
      <path d="m8 30 15-11 10 8 10-9 27 14" fill="none" stroke={PREVIEW_WHITE} strokeWidth="1" opacity="0.24" />
    </g>
  );
}

export const renderStylizeZoomPreview: TransitionPreviewRenderer = ({
  type,
  idPrefix,
}) => {
  const clipId = `${idPrefix}-${type}-frame-clip`;
  const effectId = `${idPrefix}-${type}-effect`;

  if (type === 'noise-dissolve') {
    return (
      <PreviewSvg type={type} className="tp-stylize-zoom">
        <defs>
          <clipPath id={clipId}>
            <rect {...FRAME} />
          </clipPath>
          <linearGradient id={effectId} x1="4" y1="5" x2="76" y2="35" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor={PREVIEW_BLUE} />
            <stop offset="1" stopColor={PREVIEW_BLUE} stopOpacity="0.72" />
          </linearGradient>
        </defs>
        <g clipPath={`url(#${clipId})`}>
          <rect {...FRAME} fill={`url(#${effectId})`} />
          <g className="tp-sz-noise-a tp-sz-animated" fill={PREVIEW_CORAL} opacity="0.88">
            <rect x="7" y="8" width="7" height="5" rx="1" />
            <rect x="27" y="6" width="5" height="7" rx="1" />
            <rect x="44" y="10" width="9" height="5" rx="1" />
            <rect x="63" y="7" width="8" height="7" rx="1" />
            <rect x="16" y="22" width="8" height="8" rx="1" />
            <rect x="37" y="18" width="7" height="6" rx="1" />
            <rect x="56" y="25" width="10" height="7" rx="1" />
          </g>
          <g className="tp-sz-noise-b tp-sz-animated" fill={PREVIEW_CORAL} opacity="0.62">
            <circle cx="20" cy="15" r="3" />
            <circle cx="35" cy="10" r="2.5" />
            <circle cx="58" cy="18" r="4" />
            <circle cx="29" cy="28" r="3.5" />
            <circle cx="69" cy="23" r="2.5" />
            <circle cx="9" cy="27" r="2.5" />
          </g>
          <g className="tp-sz-noise-c tp-sz-animated" fill={PREVIEW_CORAL} opacity="0.4">
            <rect x="11" y="16" width="3" height="3" />
            <rect x="24" y="17" width="4" height="4" />
            <rect x="39" y="27" width="4" height="4" />
            <rect x="49" y="19" width="3" height="3" />
            <rect x="71" y="16" width="3" height="4" />
            <rect x="48" y="30" width="3" height="3" />
          </g>
          <g className="tp-sz-noise-grain tp-sz-animated" fill={PREVIEW_WHITE} opacity="0.62">
            <circle cx="17" cy="10" r="0.8" />
            <circle cx="34" cy="20" r="0.8" />
            <circle cx="46" cy="7" r="0.7" />
            <circle cx="53" cy="28" r="0.8" />
            <circle cx="68" cy="19" r="0.7" />
            <circle cx="8" cy="20" r="0.8" />
          </g>
        </g>
        {renderFrameChrome()}
      </PreviewSvg>
    );
  }

  if (type === 'water-drop') {
    return (
      <PreviewSvg type={type} className="tp-stylize-zoom">
        <defs>
          <clipPath id={clipId}>
            <rect {...FRAME} />
          </clipPath>
          <radialGradient id={effectId} cx="50%" cy="48%" r="58%">
            <stop offset="0" stopColor={PREVIEW_WHITE} stopOpacity="0.34" />
            <stop offset="0.56" stopColor={PREVIEW_BLUE} stopOpacity="0.12" />
            <stop offset="1" stopColor={PREVIEW_DARK} stopOpacity="0.22" />
          </radialGradient>
        </defs>
        <g clipPath={`url(#${clipId})`}>
          <rect {...FRAME} fill={PREVIEW_BLUE} />
          <circle className="tp-sz-water-in tp-sz-animated" cx="40" cy="20" r="17" fill={PREVIEW_CORAL} opacity="0.84" />
          <circle cx="40" cy="20" r="17" fill={`url(#${effectId})`} />
          <g
            className="tp-sz-water-rings tp-sz-animated"
            fill="none"
            stroke={PREVIEW_WHITE}
            strokeWidth="1.15"
            opacity="0.7"
          >
            <ellipse cx="40" cy="20" rx="8" ry="4.8" />
            <ellipse cx="40" cy="20" rx="16" ry="9.2" opacity="0.72" />
            <ellipse cx="40" cy="20" rx="25" ry="13.5" opacity="0.42" />
          </g>
          <ellipse
            className="tp-sz-water-core tp-sz-animated"
            cx="40"
            cy="20"
            rx="3"
            ry="1.8"
            fill={PREVIEW_WHITE}
            opacity="0.78"
          />
        </g>
        {renderFrameChrome()}
      </PreviewSvg>
    );
  }

  if (type === 'swirl') {
    return (
      <PreviewSvg type={type} className="tp-stylize-zoom">
        <defs>
          <clipPath id={clipId}>
            <rect {...FRAME} />
          </clipPath>
          <radialGradient id={effectId} cx="50%" cy="50%" r="62%">
            <stop offset="0" stopColor={PREVIEW_WHITE} stopOpacity="0.25" />
            <stop offset="0.42" stopColor={PREVIEW_DARK} stopOpacity="0.08" />
            <stop offset="1" stopColor={PREVIEW_DARK} stopOpacity="0.38" />
          </radialGradient>
        </defs>
        <g clipPath={`url(#${clipId})`}>
          <rect {...FRAME} fill={PREVIEW_DARK} />
          <g className="tp-sz-swirl-lobes tp-sz-animated">
            <path d="M40 20C30 12 16 7 4 12V5h72v9C61 9 48 11 40 20Z" fill={PREVIEW_BLUE} />
            <path d="M40 20C50 28 64 33 76 28v7H4v-9c15 5 28 3 36-6Z" fill={PREVIEW_CORAL} />
            <path d="M40 20C32 28 23 34 11 35H4V5h10c-2 11 11 17 26 15Z" fill={PREVIEW_BLUE} opacity="0.78" />
            <path d="M40 20C48 12 57 6 69 5h7v30H66c2-11-11-17-26-15Z" fill={PREVIEW_CORAL} opacity="0.78" />
          </g>
          <rect {...FRAME} fill={`url(#${effectId})`} />
          <g
            className="tp-sz-swirl-lines tp-sz-animated"
            fill="none"
            stroke={PREVIEW_WHITE}
            strokeLinecap="round"
          >
            <path d="M24 22c2-9 16-13 23-7 7 6 2 14-6 15-7 1-11-4-8-8 2-3 7-3 9-1" strokeWidth="1.35" opacity="0.78" />
            <path d="M15 16c9-12 30-15 43-5 12 9 7 21-6 26" strokeWidth="0.9" opacity="0.42" />
          </g>
          <circle cx="40" cy="20" r="2.2" fill={PREVIEW_WHITE} opacity="0.76" />
        </g>
        {renderFrameChrome()}
      </PreviewSvg>
    );
  }

  if (type === 'kaleidoscope') {
    return (
      <PreviewSvg type={type} className="tp-stylize-zoom">
        <defs>
          <clipPath id={clipId}>
            <rect {...FRAME} />
          </clipPath>
          <radialGradient id={effectId} cx="50%" cy="50%" r="62%">
            <stop offset="0" stopColor={PREVIEW_WHITE} stopOpacity="0.4" />
            <stop offset="0.55" stopColor={PREVIEW_WHITE} stopOpacity="0.06" />
            <stop offset="1" stopColor={PREVIEW_DARK} stopOpacity="0.24" />
          </radialGradient>
        </defs>
        <g clipPath={`url(#${clipId})`}>
          <rect {...FRAME} fill={PREVIEW_DARK} />
          <g className="tp-sz-kaleido-outer tp-sz-animated">
            <path d="M40 20 4 5h36Z" fill={PREVIEW_BLUE} />
            <path d="M40 20V5h36Z" fill={PREVIEW_CORAL} />
            <path d="M40 20 76 5v15Z" fill={PREVIEW_BLUE} opacity="0.82" />
            <path d="M40 20h36v15Z" fill={PREVIEW_CORAL} opacity="0.82" />
            <path d="M40 20 76 35H40Z" fill={PREVIEW_BLUE} />
            <path d="M40 20v15H4Z" fill={PREVIEW_CORAL} />
            <path d="M40 20 4 35V20Z" fill={PREVIEW_BLUE} opacity="0.82" />
            <path d="M40 20H4V5Z" fill={PREVIEW_CORAL} opacity="0.82" />
          </g>
          <g className="tp-sz-kaleido-inner tp-sz-animated">
            <path d="M40 9 51 20 40 20Z" fill={PREVIEW_WHITE} opacity="0.48" />
            <path d="M51 20 40 31V20Z" fill={PREVIEW_BLUE} opacity="0.86" />
            <path d="M40 31 29 20h11Z" fill={PREVIEW_WHITE} opacity="0.38" />
            <path d="M29 20 40 9v11Z" fill={PREVIEW_CORAL} opacity="0.9" />
          </g>
          <rect {...FRAME} fill={`url(#${effectId})`} />
          <circle cx="40" cy="20" r="2.3" fill={PREVIEW_WHITE} opacity="0.82" />
        </g>
        {renderFrameChrome()}
      </PreviewSvg>
    );
  }

  if (type === 'zoom-in' || type === 'zoom-out') {
    const isZoomIn = type === 'zoom-in';
    return (
      <PreviewSvg type={type} className="tp-stylize-zoom">
        <defs>
          <clipPath id={clipId}>
            <rect {...FRAME} />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clipId})`}>
          <rect {...FRAME} fill={PREVIEW_DARK} />
          {renderZoomScene('tp-sz-zoom-outgoing', PREVIEW_BLUE, PREVIEW_WHITE, 0.5)}
          {renderZoomScene('tp-sz-zoom-incoming', PREVIEW_CORAL, PREVIEW_WHITE, 0.72)}
          <g
            className="tp-sz-zoom-guide tp-sz-animated"
            fill="none"
            stroke={PREVIEW_WHITE}
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.76"
          >
            {isZoomIn ? (
              <>
                <path d="M26 15 20 10M20 10h5M20 10v5M54 25l6 5M60 30h-5M60 30v-5" />
                <rect x="30" y="13" width="20" height="14" rx="2" opacity="0.46" />
              </>
            ) : (
              <>
                <path d="m20 10 6 5M26 15h-5M26 15v-5M60 30l-6-5M54 25h5M54 25v5" />
                <rect x="28" y="12" width="24" height="16" rx="2" opacity="0.46" />
              </>
            )}
          </g>
        </g>
        {renderFrameChrome()}
      </PreviewSvg>
    );
  }

  if (type === 'spin-zoom') {
    return (
      <PreviewSvg type={type} className="tp-stylize-zoom">
        <defs>
          <clipPath id={clipId}>
            <rect {...FRAME} />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clipId})`}>
          <rect {...FRAME} fill={PREVIEW_DARK} />
          {renderZoomScene('tp-sz-spin-out', PREVIEW_BLUE, PREVIEW_WHITE, 0.5)}
          {renderZoomScene('tp-sz-spin-in', PREVIEW_CORAL, PREVIEW_WHITE, 0.76)}
          <path
            className="tp-sz-spin-arrow tp-sz-animated"
            d="M25 25c5 8 20 10 29 4 4-3 6-7 5-11m-4 2 4-2 2 4"
            fill="none"
            stroke={PREVIEW_WHITE}
            strokeWidth="1.35"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.78"
          />
        </g>
        {renderFrameChrome()}
      </PreviewSvg>
    );
  }

  if (type === 'zoom-blur') {
    return (
      <PreviewSvg type={type} className="tp-stylize-zoom">
        <defs>
          <clipPath id={clipId}>
            <rect {...FRAME} />
          </clipPath>
          <radialGradient id={effectId} cx="50%" cy="50%" r="58%">
            <stop offset="0" stopColor={PREVIEW_WHITE} stopOpacity="0.46" />
            <stop offset="0.4" stopColor={PREVIEW_WHITE} stopOpacity="0.08" />
            <stop offset="1" stopColor={PREVIEW_WHITE} stopOpacity="0" />
          </radialGradient>
        </defs>
        <g clipPath={`url(#${clipId})`}>
          <rect {...FRAME} fill={PREVIEW_DARK} />
          {renderZoomScene('tp-sz-blur-out', PREVIEW_BLUE, PREVIEW_WHITE, 0.52)}
          {renderZoomScene('tp-sz-blur-in', PREVIEW_CORAL, PREVIEW_WHITE, 0.68)}
          <g
            className="tp-sz-blur-rays tp-sz-animated"
            fill="none"
            stroke={PREVIEW_WHITE}
            strokeLinecap="round"
          >
            <path d="M40 20 7 7M40 20 22 5M40 20 58 5M40 20 73 7M40 20 76 20M40 20 70 34M40 20 55 35M40 20 24 35M40 20 8 33M40 20 4 20" strokeWidth="1.2" opacity="0.42" />
            <path d="M40 20 14 12M40 20 66 12M40 20 66 28M40 20 14 28" strokeWidth="2.4" opacity="0.25" />
          </g>
          <ellipse
            className="tp-sz-blur-core tp-sz-animated"
            cx="40"
            cy="20"
            rx="18"
            ry="11"
            fill={`url(#${effectId})`}
            opacity="0.66"
          />
        </g>
        {renderFrameChrome()}
      </PreviewSvg>
    );
  }

  return null;
};
