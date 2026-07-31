import {
  PREVIEW_BLUE,
  PREVIEW_CORAL,
  PREVIEW_DARK,
  PREVIEW_WHITE,
  PreviewSvg,
  type TransitionPreviewRenderer,
} from './previewShared';
import './lightPreview.css';

const LIGHT_PREVIEW_TYPES = new Set([
  'flash',
  'light-leak',
  'light-sweep',
  'chroma-leak',
  'lens-flare',
  'film-burn',
  'projector-flicker',
  'film-roll',
  'vignette-bloom',
]);

export const renderLightPreview: TransitionPreviewRenderer = ({ type, idPrefix }) => {
  if (!LIGHT_PREVIEW_TYPES.has(type)) return null;

  const assetPrefix = `${idPrefix}-light-${type}`;
  const clipId = `${assetPrefix}-clip`;
  const blueGradientId = `${assetPrefix}-blue`;
  const coralGradientId = `${assetPrefix}-coral`;

  const frameDefs = (
    <defs>
      <clipPath id={clipId}>
        <rect x="5" y="6" width="70" height="28" rx="3" />
      </clipPath>
      <linearGradient id={blueGradientId} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={PREVIEW_BLUE} />
        <stop offset="1" stopColor={PREVIEW_BLUE} stopOpacity="0.68" />
      </linearGradient>
      <linearGradient id={coralGradientId} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={PREVIEW_CORAL} />
        <stop offset="1" stopColor={PREVIEW_CORAL} stopOpacity="0.72" />
      </linearGradient>
    </defs>
  );

  const frameOutline = (
    <rect
      x="5.5"
      y="6.5"
      width="69"
      height="27"
      rx="2.5"
      fill="none"
      stroke={PREVIEW_WHITE}
      strokeOpacity="0.18"
    />
  );

  if (type === 'flash') {
    const flashGradientId = `${assetPrefix}-burst`;
    return (
      <PreviewSvg type={type} className="tp-light-preview">
        {frameDefs}
        <defs>
          <radialGradient id={flashGradientId}>
            <stop offset="0" stopColor={PREVIEW_WHITE} />
            <stop offset="0.35" stopColor="#fff7bd" stopOpacity="0.98" />
            <stop offset="1" stopColor={PREVIEW_WHITE} stopOpacity="0" />
          </radialGradient>
        </defs>
        <g clipPath={`url(#${clipId})`}>
          <rect x="5" y="6" width="35" height="28" fill={`url(#${blueGradientId})`} />
          <rect x="40" y="6" width="35" height="28" fill={`url(#${coralGradientId})`} />
          <ellipse
            className="tp-light-flash-glow"
            cx="41"
            cy="19"
            rx="27"
            ry="21"
            fill={`url(#${flashGradientId})`}
          />
          <g className="tp-light-flash-burst" stroke={PREVIEW_WHITE} strokeLinecap="round">
            <path d="M41 4v8M41 27v9M25 20h9M49 20h12" strokeWidth="1.8" />
            <path d="m30 9 6 6m10 10 6 6M52 9l-6 6M36 25l-6 6" strokeWidth="1.2" />
            <path d="m41 13 2.3 4.3 4.7 2.4-4.7 2.2-2.3 4.4-2.2-4.4-4.6-2.2 4.6-2.4z" fill={PREVIEW_WHITE} strokeWidth="0.6" />
          </g>
        </g>
        {frameOutline}
      </PreviewSvg>
    );
  }

  if (type === 'light-leak') {
    const leakGradientId = `${assetPrefix}-warm-leak`;
    const leakCoreId = `${assetPrefix}-warm-core`;
    return (
      <PreviewSvg type={type} className="tp-light-preview">
        {frameDefs}
        <defs>
          <linearGradient id={leakGradientId}>
            <stop offset="0" stopColor="#ff5a36" stopOpacity="0" />
            <stop offset="0.36" stopColor="#ff6b35" stopOpacity="0.72" />
            <stop offset="0.68" stopColor="#ffbb65" stopOpacity="0.9" />
            <stop offset="1" stopColor="#fff4c5" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={leakCoreId}>
            <stop offset="0" stopColor={PREVIEW_WHITE} stopOpacity="0" />
            <stop offset="0.5" stopColor="#fff4c5" stopOpacity="0.84" />
            <stop offset="1" stopColor={PREVIEW_WHITE} stopOpacity="0" />
          </linearGradient>
        </defs>
        <g clipPath={`url(#${clipId})`}>
          <rect x="5" y="6" width="70" height="28" fill={`url(#${blueGradientId})`} />
          <rect x="41" y="6" width="34" height="28" fill={`url(#${coralGradientId})`} opacity="0.58" />
          <g className="tp-light-leak-band">
            <g transform="rotate(10 28 20)">
              <ellipse cx="28" cy="20" rx="23" ry="30" fill={`url(#${leakGradientId})`} />
              <rect x="23" y="-3" width="9" height="46" fill={`url(#${leakCoreId})`} opacity="0.78" />
            </g>
          </g>
          <circle className="tp-light-leak-ember" cx="22" cy="13" r="2.3" fill="#ffd18a" opacity="0.62" />
        </g>
        {frameOutline}
      </PreviewSvg>
    );
  }

  if (type === 'light-sweep') {
    const sweepGradientId = `${assetPrefix}-sweep`;
    return (
      <PreviewSvg type={type} className="tp-light-preview">
        {frameDefs}
        <defs>
          <linearGradient id={sweepGradientId}>
            <stop offset="0" stopColor={PREVIEW_WHITE} stopOpacity="0" />
            <stop offset="0.38" stopColor="#fff5c9" stopOpacity="0.14" />
            <stop offset="0.5" stopColor={PREVIEW_WHITE} stopOpacity="0.98" />
            <stop offset="0.62" stopColor="#fff5c9" stopOpacity="0.14" />
            <stop offset="1" stopColor={PREVIEW_WHITE} stopOpacity="0" />
          </linearGradient>
        </defs>
        <g clipPath={`url(#${clipId})`}>
          <rect x="5" y="6" width="70" height="28" fill={`url(#${blueGradientId})`} />
          <path d="M8 28 25 10h31L39 28z" fill={PREVIEW_CORAL} opacity="0.38" />
          <g className="tp-light-sweep-beam">
            <g transform="rotate(-17 40 20)">
              <rect x="27" y="-7" width="22" height="54" fill={`url(#${sweepGradientId})`} />
              <path d="M38-7v54" stroke={PREVIEW_WHITE} strokeWidth="1.5" opacity="0.76" />
            </g>
          </g>
        </g>
        <path d="M13 30h42" stroke={PREVIEW_WHITE} strokeWidth="1" opacity="0.26" />
        {frameOutline}
      </PreviewSvg>
    );
  }

  if (type === 'chroma-leak') {
    const redLeakId = `${assetPrefix}-red`;
    const cyanLeakId = `${assetPrefix}-cyan`;
    const greenLeakId = `${assetPrefix}-green`;
    return (
      <PreviewSvg type={type} className="tp-light-preview tp-light-chroma">
        {frameDefs}
        <defs>
          <radialGradient id={redLeakId}>
            <stop offset="0" stopColor="#ff315d" stopOpacity="0.9" />
            <stop offset="1" stopColor="#ff315d" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={cyanLeakId}>
            <stop offset="0" stopColor="#23d8ff" stopOpacity="0.92" />
            <stop offset="1" stopColor="#23d8ff" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={greenLeakId}>
            <stop offset="0" stopColor="#5bffac" stopOpacity="0.8" />
            <stop offset="1" stopColor="#5bffac" stopOpacity="0" />
          </radialGradient>
        </defs>
        <g clipPath={`url(#${clipId})`}>
          <rect x="5" y="6" width="70" height="28" fill={PREVIEW_DARK} />
          <rect x="7" y="8" width="66" height="24" fill={`url(#${blueGradientId})`} opacity="0.5" />
          <ellipse className="tp-light-chroma-red" cx="31" cy="22" rx="22" ry="27" fill={`url(#${redLeakId})`} />
          <ellipse className="tp-light-chroma-cyan" cx="48" cy="17" rx="21" ry="25" fill={`url(#${cyanLeakId})`} />
          <ellipse className="tp-light-chroma-green" cx="40" cy="26" rx="17" ry="17" fill={`url(#${greenLeakId})`} />
          <path d="M25 8c8 7 13 16 15 25M52 7c-7 8-11 17-12 26" stroke={PREVIEW_WHITE} strokeWidth="1" opacity="0.36" />
        </g>
        {frameOutline}
      </PreviewSvg>
    );
  }

  if (type === 'lens-flare') {
    const flareGradientId = `${assetPrefix}-orb`;
    const flareBlurId = `${assetPrefix}-blur`;
    return (
      <PreviewSvg type={type} className="tp-light-preview">
        {frameDefs}
        <defs>
          <radialGradient id={flareGradientId}>
            <stop offset="0" stopColor={PREVIEW_WHITE} />
            <stop offset="0.2" stopColor="#fffbd7" stopOpacity="0.96" />
            <stop offset="0.52" stopColor="#6fdcff" stopOpacity="0.4" />
            <stop offset="1" stopColor="#6888ff" stopOpacity="0" />
          </radialGradient>
          <filter id={flareBlurId} x="-30%" y="-60%" width="160%" height="220%">
            <feGaussianBlur stdDeviation="0.8" />
          </filter>
        </defs>
        <g clipPath={`url(#${clipId})`}>
          <rect x="5" y="6" width="70" height="28" fill={PREVIEW_DARK} />
          <rect x="5" y="6" width="35" height="28" fill={PREVIEW_BLUE} opacity="0.24" />
          <rect x="40" y="6" width="35" height="28" fill={PREVIEW_CORAL} opacity="0.16" />
          <g className="tp-light-flare-system">
            <ellipse cx="43" cy="18" rx="16" ry="14" fill={`url(#${flareGradientId})`} />
            <rect x="10" y="17.2" width="61" height="1.6" rx="0.8" fill={PREVIEW_WHITE} opacity="0.72" filter={`url(#${flareBlurId})`} />
            <circle cx="43" cy="18" r="2.4" fill={PREVIEW_WHITE} />
            <circle cx="30" cy="22" r="3.2" fill="none" stroke="#65dbff" strokeWidth="1" opacity="0.56" />
            <circle cx="20" cy="25" r="1.7" fill="#ff89c9" opacity="0.46" />
            <circle cx="57" cy="14" r="1.35" fill="#fff6a5" opacity="0.66" />
          </g>
        </g>
        {frameOutline}
      </PreviewSvg>
    );
  }

  if (type === 'film-burn') {
    const burnGradientId = `${assetPrefix}-burn`;
    const burnCoreId = `${assetPrefix}-core`;
    return (
      <PreviewSvg type={type} className="tp-light-preview">
        {frameDefs}
        <defs>
          <linearGradient id={burnGradientId}>
            <stop offset="0" stopColor="#8d160f" stopOpacity="0.86" />
            <stop offset="0.55" stopColor="#ff481e" stopOpacity="0.92" />
            <stop offset="0.82" stopColor="#ffb52e" stopOpacity="0.96" />
            <stop offset="1" stopColor="#fff2ae" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={burnCoreId}>
            <stop offset="0" stopColor="#ff8b24" stopOpacity="0" />
            <stop offset="0.55" stopColor="#fff4bd" stopOpacity="0.95" />
            <stop offset="1" stopColor={PREVIEW_WHITE} stopOpacity="0" />
          </linearGradient>
        </defs>
        <g clipPath={`url(#${clipId})`}>
          <rect x="5" y="6" width="70" height="28" fill={`url(#${blueGradientId})`} />
          <rect x="42" y="6" width="33" height="28" fill={`url(#${coralGradientId})`} opacity="0.42" />
          <g className="tp-light-burn-front">
            <path d="M-32 1H20c5 5 1 8 7 12-5 4 2 9-5 14 4 5 1 9-2 13h-52z" fill={`url(#${burnGradientId})`} />
            <path d="M15 1c5 5 1 8 7 12-5 4 2 9-5 14 4 5 1 9-2 13h8c4-5 0-9 5-14-5-5 1-9-4-14 4-4 2-8-1-11z" fill={`url(#${burnCoreId})`} />
            <circle cx="20" cy="10" r="1.6" fill="#fff2ae" />
            <circle cx="25" cy="25" r="1.1" fill="#ffbe45" />
          </g>
        </g>
        {frameOutline}
      </PreviewSvg>
    );
  }

  if (type === 'projector-flicker') {
    const projectorGradientId = `${assetPrefix}-projector`;
    return (
      <PreviewSvg type={type} className="tp-light-preview">
        {frameDefs}
        <defs>
          <linearGradient id={projectorGradientId} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#fff0b1" stopOpacity="0.18" />
            <stop offset="0.48" stopColor={PREVIEW_WHITE} stopOpacity="0.7" />
            <stop offset="1" stopColor="#ffd98c" stopOpacity="0.22" />
          </linearGradient>
        </defs>
        <g clipPath={`url(#${clipId})`}>
          <rect x="5" y="6" width="70" height="28" fill={PREVIEW_DARK} />
          <g className="tp-light-projector-frame">
            <rect x="8" y="8" width="64" height="24" fill={`url(#${blueGradientId})`} opacity="0.7" />
            <rect x="42" y="8" width="30" height="24" fill={`url(#${coralGradientId})`} opacity="0.45" />
            <path d="M11 13h50M17 25h52" stroke={PREVIEW_WHITE} strokeWidth="1" opacity="0.24" />
          </g>
          <rect className="tp-light-projector-flash" x="5" y="6" width="70" height="28" fill={`url(#${projectorGradientId})`} />
          <path className="tp-light-projector-scratch" d="M57 7 54 33" stroke={PREVIEW_WHITE} strokeWidth="0.75" opacity="0.5" />
        </g>
        {frameOutline}
      </PreviewSvg>
    );
  }

  if (type === 'film-roll') {
    return (
      <PreviewSvg type={type} className="tp-light-preview">
        {frameDefs}
        <g clipPath={`url(#${clipId})`}>
          <rect x="5" y="6" width="70" height="28" fill={PREVIEW_DARK} />
          <g className="tp-light-film-strip">
            <rect x="7" y="-38" width="66" height="22" fill={`url(#${blueGradientId})`} />
            <rect x="7" y="-16" width="66" height="22" fill={`url(#${coralGradientId})`} />
            <rect x="7" y="6" width="66" height="22" fill={`url(#${blueGradientId})`} />
            <rect x="7" y="28" width="66" height="22" fill={`url(#${coralGradientId})`} />
            <rect x="7" y="50" width="66" height="22" fill={`url(#${blueGradientId})`} />
            <path d="M7-16h66M7 6h66M7 28h66M7 50h66" stroke={PREVIEW_WHITE} strokeWidth="1.2" opacity="0.68" />
            <g fill={PREVIEW_DARK}>
              <path d="M9-35h4v5H9zm0 11h4v5H9zm0 11h4v5H9zm0 11h4v5H9zm0 11h4v5H9zm0 11h4v5H9zm0 11h4v5H9zm0 11h4v5H9zm0 11h4v5H9zm0 11h4v5H9z" />
              <path d="M67-35h4v5h-4zm0 11h4v5h-4zm0 11h4v5h-4zm0 11h4v5h-4zm0 11h4v5h-4zm0 11h4v5h-4zm0 11h4v5h-4zm0 11h4v5h-4zm0 11h4v5h-4zm0 11h4v5h-4z" />
            </g>
          </g>
          <path d="M14 20h52" stroke={PREVIEW_WHITE} strokeWidth="1.1" opacity="0.46" />
        </g>
        {frameOutline}
      </PreviewSvg>
    );
  }

  const bloomGradientId = `${assetPrefix}-bloom`;
  const vignetteGradientId = `${assetPrefix}-vignette`;
  return (
    <PreviewSvg type={type} className="tp-light-preview">
      {frameDefs}
      <defs>
        <radialGradient id={bloomGradientId}>
          <stop offset="0" stopColor={PREVIEW_WHITE} stopOpacity="0.96" />
          <stop offset="0.24" stopColor="#ffe0bd" stopOpacity="0.86" />
          <stop offset="0.58" stopColor={PREVIEW_CORAL} stopOpacity="0.38" />
          <stop offset="1" stopColor={PREVIEW_CORAL} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={vignetteGradientId}>
          <stop offset="0" stopColor={PREVIEW_DARK} stopOpacity="0" />
          <stop offset="0.55" stopColor={PREVIEW_DARK} stopOpacity="0.08" />
          <stop offset="1" stopColor={PREVIEW_DARK} stopOpacity="0.92" />
        </radialGradient>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        <rect x="5" y="6" width="70" height="28" fill={`url(#${blueGradientId})`} />
        <path d="M8 29 27 11h25l20 18z" fill={PREVIEW_CORAL} opacity="0.38" />
        <ellipse className="tp-light-bloom-core" cx="40" cy="20" rx="28" ry="20" fill={`url(#${bloomGradientId})`} />
        <rect x="5" y="6" width="70" height="28" fill={`url(#${vignetteGradientId})`} />
      </g>
      <circle cx="40" cy="20" r="2" fill={PREVIEW_WHITE} opacity="0.68" />
      {frameOutline}
    </PreviewSvg>
  );
};
