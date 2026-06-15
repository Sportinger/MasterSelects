interface TransitionPreviewProps {
  type: string;
}

export function TransitionPreview({ type }: TransitionPreviewProps) {
  if (
    type === 'crossfade' ||
    type === 'blur-dissolve' ||
    type === 'dip-to-color' ||
    type === 'dip-to-black' ||
    type === 'dip-to-white'
  ) {
    const isBlur = type === 'blur-dissolve';
    const dipColor = type === 'dip-to-white' ? '#f4f4f5' : '#050505';
    const middleOpacity = type === 'crossfade' || isBlur ? 0 : 0.9;
    return (
      <svg viewBox="0 0 80 40" className="transition-preview-svg">
        <defs>
          <linearGradient id={`fadeOutGrad-${type}`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#4a9eff" stopOpacity="1" />
            <stop offset="100%" stopColor="#4a9eff" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`fadeInGrad-${type}`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#ff6b4a" stopOpacity="0" />
            <stop offset="100%" stopColor="#ff6b4a" stopOpacity="1" />
          </linearGradient>
          {isBlur ? (
            <filter id={`blurPreview-${type}`} x="-20%" y="-30%" width="140%" height="160%">
              <feGaussianBlur stdDeviation="2.2" />
            </filter>
          ) : null}
        </defs>
        <rect
          x="0"
          y="8"
          width="50"
          height="24"
          fill={`url(#fadeOutGrad-${type})`}
          filter={isBlur ? `url(#blurPreview-${type})` : undefined}
          rx="2"
        />
        <rect
          x="30"
          y="8"
          width="50"
          height="24"
          fill={`url(#fadeInGrad-${type})`}
          filter={isBlur ? `url(#blurPreview-${type})` : undefined}
          rx="2"
        />
        <rect x="28" y="5" width="24" height="30" fill={dipColor} opacity={middleOpacity} rx="2" />
        {isBlur ? (
          <path d="M20 12c8 5 20 5 28 0M30 20c8 5 20 5 28 0M19 28c8 5 20 5 28 0" stroke="#ffffff" strokeWidth="1.6" opacity="0.7" />
        ) : null}
      </svg>
    );
  }

  if (type === 'flash') {
    return (
      <svg viewBox="0 0 80 40" className="transition-preview-svg">
        <defs>
          <radialGradient id="flashPreviewGlow" cx="50%" cy="50%" r="55%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
            <stop offset="55%" stopColor="#fff7bf" stopOpacity="0.82" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect x="5" y="8" width="34" height="24" fill="#4a9eff" rx="2" />
        <rect x="41" y="8" width="34" height="24" fill="#ff6b4a" rx="2" />
        <rect x="0" y="0" width="80" height="40" fill="url(#flashPreviewGlow)" />
        <path d="M42 6 32 21h9l-6 13 15-18h-9z" fill="#ffffff" opacity="0.95" />
      </svg>
    );
  }

  if (type === 'light-leak') {
    return (
      <svg viewBox="0 0 80 40" className="transition-preview-svg">
        <defs>
          <linearGradient id="lightLeakPreview" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#ff8a3d" stopOpacity="0.92" />
            <stop offset="34%" stopColor="#ffb36a" stopOpacity="0.54" />
            <stop offset="68%" stopColor="#fff2bf" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#fff2bf" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="lightLeakCorePreview" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
        </defs>
        <rect x="5" y="8" width="34" height="24" fill="#4a9eff" rx="2" />
        <rect x="41" y="8" width="34" height="24" fill="#ff6b4a" rx="2" />
        <rect x="0" y="0" width="58" height="40" fill="url(#lightLeakPreview)" />
        <g transform="rotate(8 24 20)">
          <rect x="12" y="-8" width="10" height="56" fill="url(#lightLeakCorePreview)" opacity="0.85" />
          <rect x="25" y="-8" width="6" height="56" fill="#ffcf8a" opacity="0.32" />
        </g>
      </svg>
    );
  }

  if (type === 'light-sweep') {
    return (
      <svg viewBox="0 0 80 40" className="transition-preview-svg">
        <defs>
          <linearGradient id="lightSweepPreview" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#fff7d2" stopOpacity="0" />
            <stop offset="45%" stopColor="#fff7d2" stopOpacity="0.28" />
            <stop offset="50%" stopColor="#ffffff" stopOpacity="0.96" />
            <stop offset="55%" stopColor="#fff7d2" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#fff7d2" stopOpacity="0" />
          </linearGradient>
        </defs>
        <rect x="5" y="8" width="34" height="24" fill="#4a9eff" rx="2" />
        <rect x="41" y="8" width="34" height="24" fill="#ff6b4a" rx="2" />
        <g transform="rotate(-22 40 20)">
          <rect x="-4" y="15" width="88" height="10" fill="url(#lightSweepPreview)" />
          <rect x="38" y="10" width="3" height="20" fill="#ffffff" opacity="0.78" rx="1.5" />
        </g>
      </svg>
    );
  }

  if (type === 'noise-dissolve' || type === 'block-glitch' || type === 'crt-collapse') {
    if (type === 'crt-collapse') {
      return (
        <svg viewBox="0 0 80 40" className="transition-preview-svg">
          <rect x="7" y="7" width="34" height="26" fill="#4a9eff" rx="2" opacity="0.64" />
          <rect x="39" y="19" width="34" height="2" fill="#ff6b4a" rx="1" opacity="0.96" />
          <rect x="12" y="18" width="56" height="4" fill="#ffffff" rx="2" opacity="0.72" />
          <path d="M10 15h18M48 15h22M10 25h24M45 25h24" stroke="#ff6b4a" strokeWidth="1.5" opacity="0.55" />
        </svg>
      );
    }

    const patternId = type === 'block-glitch' ? 'blockGlitchPreview' : 'noiseDissolvePreview';
    const patternSize = type === 'block-glitch' ? 12 : 8;
    return (
      <svg viewBox="0 0 80 40" className="transition-preview-svg">
        <defs>
          <pattern id={patternId} width={patternSize} height={patternSize} patternUnits="userSpaceOnUse">
            <rect width={patternSize} height={patternSize} fill="#4a9eff" />
            {type === 'block-glitch' ? (
              <>
                <rect x="0" y="0" width="7" height="5" fill="#ff6b4a" />
                <rect x="8" y="3" width="4" height="9" fill="#ff6b4a" />
                <rect x="2" y="8" width="6" height="4" fill="#ff6b4a" />
              </>
            ) : (
              <>
                <rect x="1" y="1" width="2" height="2" fill="#ff6b4a" />
                <rect x="5" y="2" width="2" height="2" fill="#ff6b4a" />
                <rect x="2" y="5" width="3" height="2" fill="#ff6b4a" />
              </>
            )}
          </pattern>
        </defs>
        <rect x="6" y="8" width="68" height="24" fill={`url(#${patternId})`} rx="2" />
        <path
          d={type === 'block-glitch' ? 'M17 8v24M41 8v24M65 8v24M6 20h68' : 'M14 8v24M34 8v24M54 8v24'}
          stroke="white"
          strokeWidth="1"
          opacity="0.45"
        />
      </svg>
    );
  }

  if (
    type === 'checker-wipe' ||
    type === 'doom-bars' ||
    type === 'paint-splatter' ||
    type === 'polka-dot-curtain' ||
    type === 'puzzle-push' ||
    type === 'magnetic-tiles' ||
    type === 'random-blocks' ||
    type === 'venetian-blinds-horizontal' ||
    type === 'venetian-blinds-vertical' ||
    type === 'zig-zag-blocks'
  ) {
    const patternId = `patternPreview-${type}`;
    const isChecker = type === 'checker-wipe';
    const isDoomBars = type === 'doom-bars';
    const isPaintSplatter = type === 'paint-splatter';
    const isPolkaDot = type === 'polka-dot-curtain';
    const isPuzzle = type === 'puzzle-push';
    const isMagnetic = type === 'magnetic-tiles';
    const isRandomBlocks = type === 'random-blocks';
    const isZigZag = type === 'zig-zag-blocks';
    const isVertical = type === 'venetian-blinds-vertical';
    const patternWidth = isChecker
      ? 12
      : isPolkaDot
        ? 12
        : isPaintSplatter
          ? 24
          : isPuzzle || isMagnetic || isRandomBlocks
            ? 20
            : isVertical
              ? 10
              : 80;
    const patternHeight = isChecker
      ? 12
      : isPolkaDot
        ? 12
        : isPaintSplatter
          ? 18
          : isPuzzle || isMagnetic || isRandomBlocks
            ? 12
            : isVertical
              ? 40
              : 8;
    const guidePath = isChecker
      ? 'M6 20h68M40 8v24'
      : isPolkaDot
        ? 'M18 20h44M40 10v20'
        : isPaintSplatter
          ? 'M18 23c8-9 25-11 39-2M31 13l3 5M49 12l-4 6'
          : isDoomBars
            ? 'M16 8v24M28 8v24M40 8v24M52 8v24M64 8v24'
            : isMagnetic
              ? 'M23 8v24M40 8v24M57 8v24M6 20h68M40 20m-8 0a8 8 0 1 0 16 0a8 8 0 1 0-16 0'
            : isPuzzle
              ? 'M23 8v24M40 8v24M57 8v24M6 20h68'
              : isRandomBlocks
              ? 'M20 8v24M40 8v24M60 8v24M6 20h68'
              : isZigZag
                ? 'M6 16l12 6 12-6 12 6 12-6 12 6 8-4'
                : isVertical
                  ? 'M20 8v24M40 8v24M60 8v24'
                  : 'M6 14h68M6 20h68M6 26h68';
    return (
      <svg viewBox="0 0 80 40" className="transition-preview-svg">
        <defs>
          <pattern
            id={patternId}
            width={patternWidth}
            height={patternHeight}
            patternUnits="userSpaceOnUse"
          >
            <rect width="80" height="40" fill="#4a9eff" />
            {isChecker ? (
              <>
                <rect x="0" y="0" width="6" height="6" fill="#ff6b4a" />
                <rect x="6" y="6" width="6" height="6" fill="#ff6b4a" />
              </>
            ) : isPolkaDot ? (
              <>
                <circle cx="6" cy="6" r="4" fill="#ff6b4a" />
                <circle cx="0" cy="0" r="2" fill="#ff6b4a" opacity="0.65" />
              </>
            ) : isPaintSplatter ? (
              <>
                <circle cx="10" cy="8" r="6" fill="#ff6b4a" />
                <circle cx="17" cy="4" r="3" fill="#ff6b4a" />
                <circle cx="4" cy="14" r="2.5" fill="#ff6b4a" />
                <circle cx="22" cy="15" r="2" fill="#ff6b4a" opacity="0.7" />
              </>
            ) : isDoomBars ? (
              <>
                <rect x="0" y="0" width="6" height="40" fill="#ff6b4a" />
                <rect x="12" y="12" width="6" height="28" fill="#ff6b4a" />
                <rect x="24" y="0" width="6" height="34" fill="#ff6b4a" />
                <rect x="36" y="8" width="6" height="32" fill="#ff6b4a" />
                <rect x="48" y="0" width="6" height="30" fill="#ff6b4a" />
                <rect x="60" y="16" width="6" height="24" fill="#ff6b4a" />
              </>
            ) : isMagnetic ? (
              <>
                <rect x="0" y="0" width="8" height="6" fill="#ff6b4a" opacity="0.62" />
                <rect x="11" y="5" width="7" height="7" fill="#ff6b4a" />
                <rect x="3" y="9" width="6" height="3" fill="#ff6b4a" opacity="0.8" />
                <circle cx="10" cy="6" r="5" fill="#111827" opacity="0.28" />
              </>
            ) : isPuzzle ? (
              <>
                <rect x="0" y="0" width="10" height="6" fill="#ff6b4a" />
                <rect x="10" y="6" width="10" height="6" fill="#ff6b4a" opacity="0.82" />
                <rect x="4" y="6" width="6" height="6" fill="#111827" opacity="0.35" />
              </>
            ) : isRandomBlocks ? (
              <>
                <rect x="0" y="0" width="12" height="7" fill="#ff6b4a" />
                <rect x="13" y="4" width="7" height="8" fill="#ff6b4a" />
                <rect x="4" y="8" width="9" height="4" fill="#ff6b4a" />
              </>
            ) : isZigZag ? (
              <path d="M0 0h80v4H63l-10 4H36l-10-4H0Z" fill="#ff6b4a" />
            ) : isVertical ? (
              <rect x="0" y="0" width="5" height="40" fill="#ff6b4a" />
            ) : (
              <rect x="0" y="0" width="80" height="4" fill="#ff6b4a" />
            )}
          </pattern>
        </defs>
        <rect x="6" y="8" width="68" height="24" fill={`url(#${patternId})`} rx="2" />
        <path
          d={guidePath}
          stroke="white"
          strokeWidth="1"
          opacity="0.5"
        />
      </svg>
    );
  }

  if (type === 'wipe-left' || type === 'wipe-right' || type === 'wipe-up' || type === 'wipe-down') {
    const incomingX = type === 'wipe-right' ? 22 : 38;
    const incomingY = type === 'wipe-down' ? 4 : 12;
    const isVertical = type === 'wipe-up' || type === 'wipe-down';
    return (
      <svg viewBox="0 0 80 40" className="transition-preview-svg">
        <rect x="6" y="8" width="52" height="24" fill="#4a9eff" rx="2" />
        <rect
          x={isVertical ? 14 : incomingX}
          y={isVertical ? incomingY : 8}
          width={isVertical ? 52 : 52}
          height={isVertical ? 24 : 24}
          fill="#ff6b4a"
          rx="2"
        />
        {isVertical ? (
          <path
            d={type === 'wipe-down' ? 'M12 13h56' : 'M12 27h56'}
            stroke="white"
            strokeWidth="2"
            strokeLinecap="round"
            opacity="0.8"
          />
        ) : (
          <path
            d={type === 'wipe-right' ? 'M24 6v28' : 'M56 6v28'}
            stroke="white"
            strokeWidth="2"
            strokeLinecap="round"
            opacity="0.8"
          />
        )}
      </svg>
    );
  }

  const irisPreviewPaths: Record<string, string> = {
    'circle-iris': 'M40 8a12 12 0 1 1 0 24a12 12 0 0 1 0-24',
    'oval-iris': 'M40 9a20 11 0 1 1 0 22a20 11 0 0 1 0-22',
    'diamond-iris': 'M40 8 58 20 40 32 22 20Z',
    'square-iris': 'M24 8h32v24H24Z',
    'triangle-iris': 'M40 7 59 32H21Z',
    'cross-iris': 'M35 8h10v8h11v8H45v8H35v-8H24v-8h11Z',
    'star-iris': 'M40 7 44 16 54 16 46 22 49 32 40 26 31 32 34 22 26 16 36 16Z',
  };
  const irisPath = irisPreviewPaths[type];
  if (irisPath) {
    return (
      <svg viewBox="0 0 80 40" className="transition-preview-svg">
        <rect x="8" y="6" width="64" height="28" fill="#4a9eff" rx="2" />
        <path d={irisPath} fill="#ff6b4a" opacity="0.9" />
      </svg>
    );
  }

  if (
    type === 'clock-wipe' ||
    type === 'center-wipe' ||
    type === 'barn-door-horizontal' ||
    type === 'barn-door-vertical'
  ) {
    return (
      <svg viewBox="0 0 80 40" className="transition-preview-svg">
        <rect x="8" y="6" width="64" height="28" fill="#4a9eff" rx="2" />
        {type === 'clock-wipe' ? (
          <path d="M40 20V8A12 12 0 0 1 52 20Z" fill="#ff6b4a" opacity="0.9" />
        ) : type === 'barn-door-vertical' ? (
          <rect x="8" y="13" width="64" height="14" fill="#ff6b4a" opacity="0.9" />
        ) : (
          <rect x="28" y="6" width="24" height="28" fill="#ff6b4a" opacity="0.9" />
        )}
      </svg>
    );
  }

  if (type.startsWith('push-') || type.startsWith('slide-')) {
    const isPush = type.startsWith('push-');
    const direction = type.replace(/^push-|^slide-/, '');
    const isVertical = direction === 'up' || direction === 'down';
    const incomingX = direction === 'right' ? 12 : direction === 'left' ? 38 : 24;
    const incomingY = direction === 'down' ? 4 : direction === 'up' ? 14 : 8;
    const outgoingX = isPush && direction === 'right' ? 36 : isPush && direction === 'left' ? 8 : 14;
    const outgoingY = isPush && direction === 'down' ? 14 : isPush && direction === 'up' ? 2 : 8;
    const arrowPath = direction === 'right'
      ? 'M32 20h18m-6-6 6 6-6 6'
      : direction === 'up'
        ? 'M40 28V10m-6 6 6-6 6 6'
        : direction === 'down'
          ? 'M40 12v18m-6-6 6 6 6-6'
          : 'M48 20H30m6-6-6 6 6 6';
    return (
      <svg viewBox="0 0 80 40" className="transition-preview-svg">
        <rect
          x={outgoingX}
          y={outgoingY}
          width={isVertical ? 52 : 36}
          height="24"
          fill="#4a9eff"
          rx="2"
          opacity={isPush ? 0.85 : 0.65}
        />
        <rect
          x={incomingX}
          y={incomingY}
          width={isVertical ? 52 : 36}
          height="24"
          fill="#ff6b4a"
          rx="2"
          opacity="0.9"
        />
        <path
          d={arrowPath}
          stroke="white"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.85"
        />
      </svg>
    );
  }

  if (type === 'zoom-in' || type === 'zoom-out' || type === 'spin-zoom') {
    const innerScale = type === 'zoom-out' ? 0.72 : 1;
    const outerScale = type === 'zoom-in' ? 1.24 : 1;
    const spinPath = type === 'spin-zoom' ? 'M23 25c8 9 25 9 34 0m-6-1 6 1-3 6' : '';
    return (
      <svg viewBox="0 0 80 40" className="transition-preview-svg">
        <g transform={`translate(40 20) scale(${outerScale}) translate(-40 -20)`}>
          <rect x="8" y="6" width="38" height="28" fill="#4a9eff" rx="2" opacity="0.62" />
        </g>
        <g transform={`translate(40 20) scale(${innerScale}) translate(-40 -20)`}>
          <rect
            x="30"
            y="7"
            width="42"
            height="26"
            fill="#ff6b4a"
            rx="2"
            opacity="0.9"
            transform={type === 'spin-zoom' ? 'rotate(-8 51 20)' : undefined}
          />
        </g>
        {type === 'spin-zoom' ? (
          <path d={spinPath} stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.85" />
        ) : (
          <path
            d={type === 'zoom-in' ? 'M40 20h14m-5-5 5 5-5 5' : 'M54 20H40m5-5-5 5 5 5'}
            stroke="white"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.85"
          />
        )}
      </svg>
    );
  }

  if (type === 'directional-blur' || type === 'whip-pan') {
    const isWhip = type === 'whip-pan';
    return (
      <svg viewBox="0 0 80 40" className="transition-preview-svg">
        <defs>
          <linearGradient id={`motionBlurGrad-${type}`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#4a9eff" stopOpacity="0.15" />
            <stop offset="42%" stopColor="#4a9eff" stopOpacity="0.78" />
            <stop offset="58%" stopColor="#ff6b4a" stopOpacity="0.78" />
            <stop offset="100%" stopColor="#ff6b4a" stopOpacity="0.15" />
          </linearGradient>
        </defs>
        <rect x="7" y="9" width="32" height="22" fill="#4a9eff" rx="2" opacity={isWhip ? 0.48 : 0.64} />
        <rect x={isWhip ? '43' : '38'} y="9" width="32" height="22" fill="#ff6b4a" rx="2" opacity="0.76" />
        <rect x="5" y="14" width="70" height="4" fill={`url(#motionBlurGrad-${type})`} rx="2" />
        <rect x="10" y="22" width="60" height="3" fill={`url(#motionBlurGrad-${type})`} rx="2" opacity="0.72" />
        <path
          d={isWhip ? 'M22 20h36m-8-7 8 7-8 7' : 'M14 20h52M18 14h44M18 26h44'}
          stroke="white"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.78"
        />
      </svg>
    );
  }

  if (type === 'rotate-left' || type === 'rotate-right' || type === 'rotate-90') {
    const isRight = type === 'rotate-right';
    const isQuarter = type === 'rotate-90';
    const outgoingRotation = isQuarter ? -22 : isRight ? 12 : -12;
    const incomingRotation = isQuarter ? 22 : isRight ? -12 : 12;
    const arrowPath = isRight ? 'M54 11c9 8 8 22-2 29m1-7-1 7 7-1' : 'M26 11c-9 8-8 22 2 29m-1-7 1 7-7-1';
    return (
      <svg viewBox="0 0 80 40" className="transition-preview-svg">
        <rect
          x="10"
          y="8"
          width="34"
          height="24"
          fill="#4a9eff"
          rx="2"
          opacity="0.72"
          transform={`rotate(${outgoingRotation} 27 20)`}
        />
        <rect
          x="36"
          y="8"
          width="34"
          height="24"
          fill="#ff6b4a"
          rx="2"
          opacity="0.88"
          transform={`rotate(${incomingRotation} 53 20)`}
        />
        <path
          d={arrowPath}
          fill="none"
          stroke="white"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.85"
        />
      </svg>
    );
  }

  if (
    type === 'flip-horizontal' ||
    type === 'flip-vertical' ||
    type === 'card-spin' ||
    type === 'tumble-away' ||
    type === 'roll-3d' ||
    type === 'spinback-3d'
  ) {
    const cardTransform = type === 'flip-vertical'
      ? 'skewX(-12)'
      : type === 'roll-3d'
        ? 'rotate(-7 40 20) skewX(14)'
        : type === 'spinback-3d'
          ? 'rotate(-20 40 20) skewY(-18) translate(8 5) scale(0.72)'
          : type === 'tumble-away'
            ? 'rotate(12 40 20) skewY(-10) translate(5 5) scale(0.82)'
            : type === 'card-spin'
              ? 'rotate(-10 40 20) skewY(-16)'
              : 'skewY(-16)';
    const axisPath = type === 'flip-vertical' ? 'M20 20h40' : 'M40 8v24';
    return (
      <svg viewBox="0 0 80 40" className="transition-preview-svg">
        <rect x="12" y="8" width="32" height="24" fill="#4a9eff" rx="2" opacity="0.55" />
        <rect
          x="32"
          y="7"
          width="28"
          height="26"
          fill="#ff6b4a"
          rx="2"
          opacity="0.92"
          transform={cardTransform}
        />
        <path
          d={type === 'card-spin'
            ? 'M27 25c9 8 27 8 36-1m-7-1 7 1-3 6'
            : type === 'roll-3d'
              ? 'M26 14c10-8 28-8 38 0m-5-5 5 5-7 1'
              : type === 'spinback-3d'
                ? 'M26 26c8-12 25-17 37-8m-6-6 6 6-7 1'
                : type === 'tumble-away'
                  ? 'M25 15c8 12 20 16 32 10m-3-6 3 6-6 1'
                  : axisPath}
          stroke="white"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.85"
        />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 80 40" className="transition-preview-svg">
      <rect x="5" y="8" width="30" height="24" fill="#4a9eff" rx="2" />
      <rect x="45" y="8" width="30" height="24" fill="#ff6b4a" rx="2" />
      <path d="M38 20 L42 20" stroke="white" strokeWidth="2" />
    </svg>
  );
}
