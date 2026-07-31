import './irisPreview.css';
import {
  PREVIEW_BLUE,
  PREVIEW_CORAL,
  PREVIEW_DARK,
  PREVIEW_WHITE,
  PreviewSvg,
  type TransitionPreviewRenderer,
} from './previewShared';

const IRIS_PATHS: Readonly<Record<string, string | undefined>> = {
  'circle-iris': 'M40 7.5a12.5 12.5 0 1 1 0 25 12.5 12.5 0 0 1 0-25Z',
  'oval-iris': 'M40 9.5a19 10.5 0 1 1 0 21 19 10.5 0 0 1 0-21Z',
  'diamond-iris': 'M40 7.5 58 20 40 32.5 22 20Z',
  'square-iris': 'M25 8h30v24H25Z',
  'triangle-iris': 'M40 7.5 59 32H21Z',
  'cross-iris': 'M35 8h10v8h12v8H45v8H35v-8H23v-8h12Z',
  'star-iris': 'M40 7.5 43.5 15.7 52.4 16.5 45.6 22.3 47.7 31 40 26.4 32.3 31 34.4 22.3 27.6 16.5 36.5 15.7Z',
};

export const renderIrisPreview: TransitionPreviewRenderer = ({ type, idPrefix }) => {
  const irisPath = IRIS_PATHS[type];
  if (!irisPath) return null;

  const shape = type.slice(0, -'-iris'.length);
  const frameClipId = `${idPrefix}-iris-frame`;
  const apertureClipId = `${idPrefix}-iris-aperture`;
  const outgoingGradientId = `${idPrefix}-iris-outgoing`;
  const incomingGradientId = `${idPrefix}-iris-incoming`;

  return (
    <PreviewSvg type={type} className={`tp-iris tp-iris--${shape}`}>
      <defs>
        <clipPath id={frameClipId}>
          <rect x="5" y="6" width="70" height="28" rx="3" />
        </clipPath>
        <clipPath id={apertureClipId} clipPathUnits="userSpaceOnUse">
          <g className="tp-iris__aperture">
            <path d={irisPath} />
          </g>
        </clipPath>
        <linearGradient id={outgoingGradientId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={PREVIEW_BLUE} />
          <stop offset="100%" stopColor={PREVIEW_BLUE} stopOpacity="0.7" />
        </linearGradient>
        <radialGradient id={incomingGradientId} cx="46%" cy="42%" r="76%">
          <stop offset="0%" stopColor={PREVIEW_WHITE} stopOpacity="0.72" />
          <stop offset="24%" stopColor={PREVIEW_CORAL} />
          <stop offset="100%" stopColor={PREVIEW_CORAL} stopOpacity="0.78" />
        </radialGradient>
      </defs>

      <rect x="4" y="5" width="72" height="30" rx="4" fill={PREVIEW_DARK} opacity="0.5" />

      <g clipPath={`url(#${frameClipId})`}>
        <rect
          x="5"
          y="6"
          width="70"
          height="28"
          fill={`url(#${outgoingGradientId})`}
        />
        <path
          d="M6 31 35 6h20L25 34H6Z"
          fill={PREVIEW_WHITE}
          opacity="0.055"
        />

        <g clipPath={`url(#${apertureClipId})`}>
          <rect
            x="5"
            y="6"
            width="70"
            height="28"
            fill={`url(#${incomingGradientId})`}
          />
          <circle cx="55" cy="14" r="9" fill={PREVIEW_WHITE} opacity="0.055" />
        </g>

        <g className="tp-iris__rim">
          <path
            d={irisPath}
            fill="none"
            stroke={PREVIEW_DARK}
            strokeWidth="4"
            vectorEffect="non-scaling-stroke"
            opacity="0.24"
          />
          <path
            d={irisPath}
            fill="none"
            stroke={PREVIEW_WHITE}
            strokeWidth="1.1"
            vectorEffect="non-scaling-stroke"
            opacity="0.82"
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
