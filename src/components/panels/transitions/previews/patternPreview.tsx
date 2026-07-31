import type { CSSProperties, ReactNode } from 'react';
import './patternPreview.css';
import {
  PREVIEW_BLUE,
  PREVIEW_CORAL,
  PREVIEW_DARK,
  PREVIEW_WHITE,
  PreviewSvg,
  type TransitionPreviewRenderer,
} from './previewShared';

const PATTERN_TYPES = new Set([
  'checker-wipe',
  'random-blocks',
  'paint-splatter',
  'polka-dot-curtain',
  'doom-bars',
  'venetian-blinds-horizontal',
  'venetian-blinds-vertical',
  'zig-zag-blocks',
  'puzzle-push',
  'shatter-glass',
  'magnetic-tiles',
]);

const CHECKER_CELLS = Array.from({ length: 15 }, (_, index) => {
  const column = index % 5;
  const row = Math.floor(index / 5);
  return {
    x: 5 + column * 14,
    y: 6 + row * (28 / 3),
    order: ((column + row) % 2) * 6 + row * 2 + column,
  };
});

const RANDOM_BLOCKS = [
  { x: 5, y: 6, width: 17, height: 9, order: 8 },
  { x: 22, y: 6, width: 26, height: 9, order: 1 },
  { x: 48, y: 6, width: 10, height: 9, order: 10 },
  { x: 58, y: 6, width: 17, height: 9, order: 4 },
  { x: 5, y: 15, width: 10, height: 11, order: 3 },
  { x: 15, y: 15, width: 22, height: 11, order: 9 },
  { x: 37, y: 15, width: 17, height: 11, order: 0 },
  { x: 54, y: 15, width: 21, height: 11, order: 7 },
  { x: 5, y: 26, width: 24, height: 8, order: 6 },
  { x: 29, y: 26, width: 13, height: 8, order: 2 },
  { x: 42, y: 26, width: 33, height: 8, order: 5 },
];

const GRID_5_BY_3 = Array.from({ length: 15 }, (_, index) => {
  const column = index % 5;
  const row = Math.floor(index / 5);
  return {
    column,
    row,
    x: 5 + column * 14,
    y: 6 + row * (28 / 3),
  };
});

const PUZZLE_MOTIONS = [
  [-8, 0, -2],
  [0, -6, 1],
  [7, 0, 2],
  [0, 7, -1],
  [9, 0, 1],
  [0, 6, -2],
  [-7, 0, 2],
  [0, -7, -1],
  [-9, 0, -2],
  [0, 7, 1],
  [8, 0, 2],
  [0, -6, -1],
];

const SHATTER_SHARDS = [
  { path: 'M5 6h17l-2 9H5Z', x: -9, y: -7, r: -13 },
  { path: 'M22 6h17l1 9H20Z', x: -4, y: -9, r: 8 },
  { path: 'M39 6h19l-3 9H40Z', x: 4, y: -10, r: -8 },
  { path: 'M58 6h17v9H55Z', x: 10, y: -7, r: 14 },
  { path: 'M5 15h15l3 5-4 5H5Z', x: -11, y: 0, r: 9 },
  { path: 'M20 15h20v5l-6 5H19l4-5Z', x: -5, y: 2, r: -11 },
  { path: 'M40 15h15l-3 5 7 5H34l6-5Z', x: 5, y: -1, r: 12 },
  { path: 'M55 15h20v10H59l-7-5Z', x: 11, y: 1, r: -9 },
  { path: 'M5 25h14l5 9H5Z', x: -10, y: 8, r: -12 },
  { path: 'M19 25h15l6 9H24Z', x: -4, y: 10, r: 10 },
  { path: 'M34 25h25l-4 9H40Z', x: 5, y: 9, r: -8 },
  { path: 'M59 25h16v9H55Z', x: 10, y: 8, r: 13 },
];

const pieceStyle = (order: number, step = 0.026): CSSProperties => ({
  '--tp-pattern-delay': `${order * step}s`,
} as CSSProperties);

export const renderPatternPreview: TransitionPreviewRenderer = ({ type, idPrefix }) => {
  if (!PATTERN_TYPES.has(type)) return null;

  const frameClipId = `${idPrefix}-pattern-frame`;
  const outgoingGradientId = `${idPrefix}-pattern-outgoing`;
  const incomingGradientId = `${idPrefix}-pattern-incoming`;
  const outgoingFill = `url(#${outgoingGradientId})`;
  const incomingFill = `url(#${incomingGradientId})`;
  let signature: ReactNode = null;

  switch (type) {
    case 'checker-wipe':
      signature = (
        <g>
          {CHECKER_CELLS.map((cell, index) => (
            <rect
              key={index}
              className="tp-pattern__reveal-piece tp-pattern__checker-cell"
              x={cell.x}
              y={cell.y}
              width="14.15"
              height={28 / 3 + 0.15}
              rx="0.7"
              fill={incomingFill}
              stroke={PREVIEW_WHITE}
              strokeWidth="0.35"
              strokeOpacity="0.15"
              style={pieceStyle(cell.order)}
            />
          ))}
        </g>
      );
      break;

    case 'random-blocks':
      signature = (
        <g>
          {RANDOM_BLOCKS.map((block, index) => (
            <rect
              key={index}
              className="tp-pattern__reveal-piece tp-pattern__random-block"
              x={block.x}
              y={block.y}
              width={block.width}
              height={block.height}
              rx="0.9"
              fill={incomingFill}
              stroke={PREVIEW_WHITE}
              strokeWidth="0.4"
              strokeOpacity="0.14"
              style={pieceStyle(block.order, 0.035)}
            />
          ))}
        </g>
      );
      break;

    case 'paint-splatter':
      signature = (
        <g className="tp-pattern__splat-cloud">
          <path
            d="M24 25c-4-5-1-11 5-12 2-6 10-7 14-3 6-3 13 1 12 7 6 2 7 9 2 12-5 4-11 2-14-1-5 5-15 3-19-3Z"
            fill={incomingFill}
          />
          <circle cx="17" cy="15" r="3.4" fill={PREVIEW_CORAL} />
          <circle cx="61" cy="11" r="3" fill={PREVIEW_CORAL} />
          <circle cx="65" cy="27" r="4.2" fill={PREVIEW_CORAL} />
          <circle cx="21" cy="31" r="2.6" fill={PREVIEW_CORAL} />
          <circle cx="12" cy="24" r="2.1" fill={PREVIEW_CORAL} />
          <circle cx="52" cy="33" r="1.8" fill={PREVIEW_CORAL} />
          <circle cx="31" cy="8" r="1.8" fill={PREVIEW_CORAL} />
          <circle cx="70" cy="18" r="1.5" fill={PREVIEW_CORAL} />
        </g>
      );
      break;

    case 'polka-dot-curtain':
      signature = (
        <g>
          {GRID_5_BY_3.map((dot, index) => (
            <circle
              key={index}
              className="tp-pattern__polka-dot"
              cx={dot.x + 7}
              cy={dot.y + 28 / 6}
              r="3.15"
              fill={incomingFill}
              style={pieceStyle(dot.column + dot.row * 0.7, 0.045)}
            />
          ))}
        </g>
      );
      break;

    case 'doom-bars':
      signature = (
        <g>
          {Array.from({ length: 8 }, (_, index) => (
            <rect
              key={index}
              className="tp-pattern__doom-bar"
              x={5 + index * 8.75}
              y="6"
              width="8.9"
              height="28"
              fill={incomingFill}
              stroke={PREVIEW_DARK}
              strokeWidth="0.45"
              strokeOpacity="0.28"
              style={pieceStyle([2, 7, 0, 5, 1, 6, 3, 4][index], 0.038)}
            />
          ))}
        </g>
      );
      break;

    case 'venetian-blinds-horizontal':
      signature = (
        <g>
          {Array.from({ length: 6 }, (_, index) => (
            <rect
              key={index}
              className={`tp-pattern__venetian-strip tp-pattern__venetian-strip--${index % 2 ? 'end' : 'start'}`}
              x="5"
              y={6 + index * (28 / 6)}
              width="70"
              height={28 / 6 + 0.2}
              fill={incomingFill}
              stroke={PREVIEW_WHITE}
              strokeWidth="0.3"
              strokeOpacity="0.13"
              style={pieceStyle(index, 0.045)}
            />
          ))}
        </g>
      );
      break;

    case 'venetian-blinds-vertical':
      signature = (
        <g>
          {Array.from({ length: 10 }, (_, index) => (
            <rect
              key={index}
              className={`tp-pattern__vertical-strip tp-pattern__vertical-strip--${index % 2 ? 'end' : 'start'}`}
              x={5 + index * 7}
              y="6"
              width="7.15"
              height="28"
              fill={incomingFill}
              stroke={PREVIEW_WHITE}
              strokeWidth="0.3"
              strokeOpacity="0.13"
              style={pieceStyle(index, 0.03)}
            />
          ))}
        </g>
      );
      break;

    case 'zig-zag-blocks':
      signature = (
        <g className="tp-pattern__zig-zag">
          <path
            d="M5 6h65l5 3-5 3 5 3-5 3 5 3-5 3 5 3-5 3 5 3-5 2H5Z"
            fill={incomingFill}
          />
          <path
            d="m70 6 5 3-5 3 5 3-5 3 5 3-5 3 5 3-5 3 5 3-5 2"
            fill="none"
            stroke={PREVIEW_WHITE}
            strokeWidth="1.1"
            strokeLinejoin="round"
            opacity="0.82"
          />
        </g>
      );
      break;

    case 'puzzle-push':
      signature = (
        <g>
          {Array.from({ length: 12 }, (_, index) => {
            const column = index % 4;
            const row = Math.floor(index / 4);
            const [x, y, rotation] = PUZZLE_MOTIONS[index];
            return (
              <rect
                key={index}
                className="tp-pattern__puzzle-piece"
                x={5 + column * 17.5}
                y={6 + row * (28 / 3)}
                width="17.7"
                height={28 / 3 + 0.2}
                rx="1.2"
                fill={incomingFill}
                stroke={PREVIEW_WHITE}
                strokeWidth="0.55"
                strokeOpacity="0.24"
                style={{
                  '--tp-pattern-delay': `${(column + row) * 0.045}s`,
                  '--tp-puzzle-x': `${x}px`,
                  '--tp-puzzle-y': `${y}px`,
                  '--tp-puzzle-r': `${rotation}deg`,
                } as CSSProperties}
              />
            );
          })}
        </g>
      );
      break;

    case 'shatter-glass':
      signature = (
        <g>
          {SHATTER_SHARDS.map((shard, index) => (
            <path
              key={index}
              className="tp-pattern__glass-shard"
              d={shard.path}
              fill={outgoingFill}
              stroke={PREVIEW_WHITE}
              strokeWidth="0.48"
              strokeOpacity="0.42"
              style={{
                '--tp-pattern-delay': `${(index % 4) * 0.038}s`,
                '--tp-shard-mid-x': `${shard.x * 0.22}px`,
                '--tp-shard-mid-y': `${shard.y * 0.22}px`,
                '--tp-shard-mid-r': `${shard.r * 0.22}deg`,
                '--tp-shard-end-x': `${shard.x}px`,
                '--tp-shard-end-y': `${shard.y}px`,
                '--tp-shard-end-r': `${shard.r}deg`,
              } as CSSProperties}
            />
          ))}
        </g>
      );
      break;

    case 'magnetic-tiles':
      signature = (
        <g>
          {GRID_5_BY_3.map((tile, index) => {
            const centerX = tile.x + 7;
            const centerY = tile.y + 28 / 6;
            return (
              <rect
                key={index}
                className="tp-pattern__magnetic-tile"
                x={tile.x}
                y={tile.y}
                width="14.1"
                height={28 / 3 + 0.15}
                rx="1.1"
                fill={incomingFill}
                stroke={PREVIEW_WHITE}
                strokeWidth="0.45"
                strokeOpacity="0.22"
                style={{
                  '--tp-pattern-delay': `${Math.abs(tile.column - 2) * 0.035 + Math.abs(tile.row - 1) * 0.025}s`,
                  '--tp-magnetic-x': `${(40 - centerX) * 0.48}px`,
                  '--tp-magnetic-y': `${(20 - centerY) * 0.48}px`,
                } as CSSProperties}
              />
            );
          })}
          <circle
            className="tp-pattern__magnetic-core"
            cx="40"
            cy="20"
            r="3"
            fill={PREVIEW_DARK}
            stroke={PREVIEW_WHITE}
            strokeWidth="0.8"
            opacity="0.72"
          />
        </g>
      );
      break;
  }

  const baseFill = type === 'shatter-glass' ? incomingFill : outgoingFill;

  return (
    <PreviewSvg type={type} className={`tp-pattern tp-pattern--${type}`}>
      <defs>
        <clipPath id={frameClipId}>
          <rect x="5" y="6" width="70" height="28" rx="3" />
        </clipPath>
        <linearGradient id={outgoingGradientId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={PREVIEW_BLUE} />
          <stop offset="100%" stopColor={PREVIEW_BLUE} stopOpacity="0.7" />
        </linearGradient>
        <linearGradient id={incomingGradientId} x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor={PREVIEW_CORAL} stopOpacity="0.82" />
          <stop offset="64%" stopColor={PREVIEW_CORAL} />
          <stop offset="100%" stopColor={PREVIEW_WHITE} stopOpacity="0.52" />
        </linearGradient>
      </defs>

      <rect x="4" y="5" width="72" height="30" rx="4" fill={PREVIEW_DARK} opacity="0.5" />
      <g clipPath={`url(#${frameClipId})`}>
        <rect x="5" y="6" width="70" height="28" fill={baseFill} />
        {signature}
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
