import './glitchMotionPreview.css';
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
      <rect
        x="5"
        y="6"
        width="70"
        height="13"
        rx="3"
        fill={PREVIEW_WHITE}
        opacity="0.07"
      />
      <rect
        {...FRAME}
        fill="none"
        stroke={PREVIEW_WHITE}
        strokeWidth="0.8"
        opacity="0.28"
      />
    </>
  );
}

export const renderGlitchMotionPreview: TransitionPreviewRenderer = ({
  type,
  idPrefix,
}) => {
  const clipId = `${idPrefix}-${type}-frame-clip`;
  const effectId = `${idPrefix}-${type}-effect`;
  const accentId = `${idPrefix}-${type}-accent`;

  if (type === 'block-glitch') {
    return (
      <PreviewSvg type={type} className="tp-glitch-motion">
        <defs>
          <clipPath id={clipId}>
            <rect {...FRAME} />
          </clipPath>
          <linearGradient id={effectId} x1="4" y1="5" x2="76" y2="35" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor={PREVIEW_BLUE} />
            <stop offset="0.48" stopColor={PREVIEW_BLUE} />
            <stop offset="0.52" stopColor={PREVIEW_CORAL} />
            <stop offset="1" stopColor={PREVIEW_CORAL} />
          </linearGradient>
        </defs>
        <g clipPath={`url(#${clipId})`}>
          <rect {...FRAME} fill={`url(#${effectId})`} />
          <g className="tp-gm-block-a tp-gm-animated">
            <rect x="2" y="7" width="26" height="7" fill={PREVIEW_CORAL} />
            <rect x="31" y="16" width="23" height="6" fill={PREVIEW_BLUE} />
            <rect x="55" y="25" width="24" height="7" fill={PREVIEW_BLUE} />
          </g>
          <g className="tp-gm-block-b tp-gm-animated">
            <rect x="11" y="14" width="17" height="5" fill={PREVIEW_BLUE} />
            <rect x="48" y="8" width="24" height="6" fill={PREVIEW_CORAL} opacity="0.86" />
            <rect x="22" y="25" width="27" height="8" fill={PREVIEW_CORAL} opacity="0.9" />
          </g>
          <g className="tp-gm-block-lines tp-gm-animated" fill={PREVIEW_WHITE}>
            <rect x="7" y="14" width="42" height="1" opacity="0.72" />
            <rect x="36" y="23" width="38" height="1.2" opacity="0.58" />
          </g>
        </g>
        {renderFrameChrome()}
      </PreviewSvg>
    );
  }

  if (type === 'crt-collapse') {
    return (
      <PreviewSvg type={type} className="tp-glitch-motion">
        <defs>
          <clipPath id={clipId}>
            <rect {...FRAME} />
          </clipPath>
          <filter id={effectId} x="-20%" y="-400%" width="140%" height="900%" colorInterpolationFilters="sRGB">
            <feGaussianBlur stdDeviation="1.8" />
          </filter>
          <linearGradient id={accentId} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0" stopColor={PREVIEW_WHITE} stopOpacity="0" />
            <stop offset="0.18" stopColor={PREVIEW_WHITE} stopOpacity="0.86" />
            <stop offset="0.5" stopColor={PREVIEW_WHITE} />
            <stop offset="0.82" stopColor={PREVIEW_WHITE} stopOpacity="0.86" />
            <stop offset="1" stopColor={PREVIEW_WHITE} stopOpacity="0" />
          </linearGradient>
        </defs>
        <g clipPath={`url(#${clipId})`}>
          <rect {...FRAME} fill={PREVIEW_DARK} />
          <g className="tp-gm-crt-out tp-gm-animated">
            <rect {...FRAME} fill={PREVIEW_BLUE} opacity="0.68" />
            <path d="M7 11h66M7 17h66M7 23h66M7 29h66" stroke={PREVIEW_DARK} strokeWidth="0.7" opacity="0.38" />
          </g>
          <g className="tp-gm-crt-in tp-gm-animated">
            <rect {...FRAME} fill={PREVIEW_CORAL} opacity="0.78" />
            <path d="M7 11h66M7 17h66M7 23h66M7 29h66" stroke={PREVIEW_DARK} strokeWidth="0.7" opacity="0.32" />
          </g>
          <rect
            className="tp-gm-crt-glow tp-gm-animated"
            x="8"
            y="18.4"
            width="64"
            height="3.2"
            rx="1.6"
            fill={`url(#${accentId})`}
            filter={`url(#${effectId})`}
            opacity="0.94"
          />
          <rect
            className="tp-gm-crt-line tp-gm-animated"
            x="13"
            y="19.35"
            width="54"
            height="1.3"
            rx="0.65"
            fill={PREVIEW_WHITE}
            opacity="0.88"
          />
        </g>
        {renderFrameChrome()}
      </PreviewSvg>
    );
  }

  if (type === 'rgb-split-glitch') {
    return (
      <PreviewSvg type={type} className="tp-glitch-motion">
        <defs>
          <clipPath id={clipId}>
            <rect {...FRAME} />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clipId})`}>
          <rect {...FRAME} fill={PREVIEW_DARK} />
          <g className="tp-gm-rgb-blue tp-gm-animated" fill={PREVIEW_BLUE} opacity="0.82" style={{ mixBlendMode: 'screen' }}>
            <path d="M14 29V11h12l6 7 8-10 12 12 7-6 8 15Z" />
            <circle cx="23" cy="15" r="3.3" />
          </g>
          <g className="tp-gm-rgb-green tp-gm-animated" fill="#61ff9b" opacity="0.58" style={{ mixBlendMode: 'screen' }}>
            <path d="M14 29V11h12l6 7 8-10 12 12 7-6 8 15Z" />
            <circle cx="23" cy="15" r="3.3" />
          </g>
          <g className="tp-gm-rgb-red tp-gm-animated" fill={PREVIEW_CORAL} opacity="0.82" style={{ mixBlendMode: 'screen' }}>
            <path d="M14 29V11h12l6 7 8-10 12 12 7-6 8 15Z" />
            <circle cx="23" cy="15" r="3.3" />
          </g>
          <g className="tp-gm-rgb-tear tp-gm-animated">
            <rect x="7" y="16" width="67" height="3" fill={PREVIEW_DARK} opacity="0.5" />
            <rect x="16" y="16.7" width="49" height="0.9" fill={PREVIEW_WHITE} opacity="0.66" />
          </g>
        </g>
        {renderFrameChrome()}
      </PreviewSvg>
    );
  }

  if (type === 'mosaic-glitch') {
    return (
      <PreviewSvg type={type} className="tp-glitch-motion">
        <defs>
          <clipPath id={clipId}>
            <rect {...FRAME} />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clipId})`}>
          <rect {...FRAME} fill={PREVIEW_DARK} />
          <g className="tp-gm-mosaic-row-a tp-gm-animated">
            <rect x="3" y="5" width="17" height="10" fill={PREVIEW_BLUE} />
            <rect x="21" y="5" width="12" height="10" fill={PREVIEW_CORAL} />
            <rect x="34" y="5" width="21" height="10" fill={PREVIEW_BLUE} opacity="0.78" />
            <rect x="56" y="5" width="22" height="10" fill={PREVIEW_CORAL} opacity="0.9" />
          </g>
          <g className="tp-gm-mosaic-row-b tp-gm-animated">
            <rect x="3" y="16" width="11" height="8" fill={PREVIEW_CORAL} />
            <rect x="15" y="16" width="23" height="8" fill={PREVIEW_BLUE} />
            <rect x="39" y="16" width="13" height="8" fill={PREVIEW_CORAL} opacity="0.82" />
            <rect x="53" y="16" width="25" height="8" fill={PREVIEW_BLUE} opacity="0.82" />
          </g>
          <g className="tp-gm-mosaic-row-c tp-gm-animated">
            <rect x="3" y="25" width="20" height="10" fill={PREVIEW_BLUE} opacity="0.78" />
            <rect x="24" y="25" width="18" height="10" fill={PREVIEW_CORAL} />
            <rect x="43" y="25" width="10" height="10" fill={PREVIEW_BLUE} />
            <rect x="54" y="25" width="24" height="10" fill={PREVIEW_CORAL} opacity="0.84" />
          </g>
          <path d="M20 5v30M33 5v10M55 5v10M14 15v10M38 15v10M52 15v10M23 24v11M42 24v11M53 24v11M4 15h72M4 24h72" stroke={PREVIEW_WHITE} strokeWidth="0.65" opacity="0.34" />
        </g>
        {renderFrameChrome()}
      </PreviewSvg>
    );
  }

  if (type === 'scanline-glitch') {
    return (
      <PreviewSvg type={type} className="tp-glitch-motion">
        <defs>
          <clipPath id={clipId}>
            <rect {...FRAME} />
          </clipPath>
          <linearGradient id={effectId} x1="4" y1="5" x2="76" y2="35" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor={PREVIEW_BLUE} />
            <stop offset="0.52" stopColor={PREVIEW_BLUE} stopOpacity="0.86" />
            <stop offset="0.55" stopColor={PREVIEW_CORAL} stopOpacity="0.88" />
            <stop offset="1" stopColor={PREVIEW_CORAL} />
          </linearGradient>
          <pattern id={accentId} width="4" height="4" patternUnits="userSpaceOnUse">
            <rect width="4" height="2" fill={PREVIEW_DARK} opacity="0.42" />
            <rect y="2" width="4" height="1" fill={PREVIEW_WHITE} opacity="0.08" />
          </pattern>
        </defs>
        <g clipPath={`url(#${clipId})`}>
          <rect {...FRAME} fill={`url(#${effectId})`} />
          <g className="tp-gm-scan-tear-a tp-gm-animated">
            <rect x="1" y="12" width="82" height="5" fill={PREVIEW_CORAL} opacity="0.78" />
            <path d="M7 13h25M48 16h27" stroke={PREVIEW_WHITE} strokeWidth="1" opacity="0.65" />
          </g>
          <g className="tp-gm-scan-tear-b tp-gm-animated">
            <rect x="1" y="24" width="82" height="4" fill={PREVIEW_BLUE} opacity="0.84" />
            <path d="M8 26h34M55 25h19" stroke={PREVIEW_WHITE} strokeWidth="0.8" opacity="0.58" />
          </g>
          <rect {...FRAME} fill={`url(#${accentId})`} />
          <rect
            className="tp-gm-scan-sweep tp-gm-animated"
            x="4"
            y="10"
            width="72"
            height="4"
            fill={PREVIEW_WHITE}
            opacity="0.16"
          />
        </g>
        {renderFrameChrome()}
      </PreviewSvg>
    );
  }

  if (type === 'directional-blur') {
    return (
      <PreviewSvg type={type} className="tp-glitch-motion">
        <defs>
          <clipPath id={clipId}>
            <rect {...FRAME} />
          </clipPath>
          <filter id={effectId} x="-35%" y="-20%" width="170%" height="140%" colorInterpolationFilters="sRGB">
            <feGaussianBlur stdDeviation="3.6 0.45" />
          </filter>
          <linearGradient id={accentId} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0" stopColor={PREVIEW_BLUE} stopOpacity="0" />
            <stop offset="0.3" stopColor={PREVIEW_BLUE} stopOpacity="0.9" />
            <stop offset="0.7" stopColor={PREVIEW_CORAL} stopOpacity="0.9" />
            <stop offset="1" stopColor={PREVIEW_CORAL} stopOpacity="0" />
          </linearGradient>
        </defs>
        <g clipPath={`url(#${clipId})`}>
          <rect {...FRAME} fill={PREVIEW_DARK} />
          <g className="tp-gm-direction-out tp-gm-animated" filter={`url(#${effectId})`}>
            <rect x="-8" y="6" width="55" height="28" rx="4" fill={PREVIEW_BLUE} opacity="0.84" />
          </g>
          <g className="tp-gm-direction-in tp-gm-animated" filter={`url(#${effectId})`}>
            <rect x="33" y="6" width="55" height="28" rx="4" fill={PREVIEW_CORAL} opacity="0.84" />
          </g>
          <g className="tp-gm-direction-streaks tp-gm-animated" fill="none" strokeLinecap="round">
            <path d="M1 13h66" stroke={`url(#${accentId})`} strokeWidth="3.2" opacity="0.72" />
            <path d="M11 21h72" stroke={`url(#${accentId})`} strokeWidth="2" opacity="0.9" />
            <path d="M-4 28h58" stroke={PREVIEW_WHITE} strokeWidth="1.1" opacity="0.48" />
          </g>
        </g>
        {renderFrameChrome()}
      </PreviewSvg>
    );
  }

  if (type === 'whip-pan') {
    return (
      <PreviewSvg type={type} className="tp-glitch-motion">
        <defs>
          <clipPath id={clipId}>
            <rect {...FRAME} />
          </clipPath>
          <linearGradient id={effectId} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0" stopColor={PREVIEW_WHITE} stopOpacity="0" />
            <stop offset="0.5" stopColor={PREVIEW_WHITE} stopOpacity="0.72" />
            <stop offset="1" stopColor={PREVIEW_WHITE} stopOpacity="0" />
          </linearGradient>
        </defs>
        <g clipPath={`url(#${clipId})`}>
          <rect {...FRAME} fill={PREVIEW_DARK} />
          <g className="tp-gm-whip-out tp-gm-animated">
            <rect x="-19" y="5" width="72" height="30" rx="4" fill={PREVIEW_BLUE} />
            <path d="M-13 30 20 5h18L5 35h-18Z" fill={PREVIEW_WHITE} opacity="0.08" />
          </g>
          <g className="tp-gm-whip-in tp-gm-animated">
            <rect x="27" y="5" width="72" height="30" rx="4" fill={PREVIEW_CORAL} />
            <path d="M40 35 74 5h17L57 35Z" fill={PREVIEW_WHITE} opacity="0.09" />
          </g>
          <g className="tp-gm-whip-streaks tp-gm-animated">
            <rect x="3" y="11" width="74" height="2.2" rx="1.1" fill={`url(#${effectId})`} opacity="0.66" />
            <rect x="-8" y="19" width="96" height="1.2" rx="0.6" fill={PREVIEW_WHITE} opacity="0.7" />
            <rect x="8" y="28" width="62" height="1.7" rx="0.85" fill={`url(#${effectId})`} opacity="0.56" />
          </g>
          <path
            className="tp-gm-whip-arrow tp-gm-animated"
            d="M29 20h23m-6-5 6 5-6 5"
            fill="none"
            stroke={PREVIEW_WHITE}
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.78"
          />
        </g>
        {renderFrameChrome()}
      </PreviewSvg>
    );
  }

  return null;
};
