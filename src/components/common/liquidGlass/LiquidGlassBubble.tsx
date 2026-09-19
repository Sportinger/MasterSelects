// Liquid-glass primitives: LiquidGlassLens adds Chromium-only backdrop
// refraction to any `.ms-liquid-glass` surface, and LiquidGlassBubble is the
// reusable tap-to-expand control (glass circle that stretches into an action
// pill). Styling contract lives in liquidGlass.css.

import { useEffect, useRef, useState, type ReactNode } from 'react';

import './liquidGlass.css';

const LENS_DEFS_ID = 'ms-liquid-glass-defs';
const LENS_FILTER_ID = 'ms-liquid-glass-lens';
// Bump when the filter/map below changes so live sessions replace the
// already-injected defs instead of keeping the stale filter across HMR.
const LENS_VERSION = '3';

// Displacement map stretched over the surface: R encodes x-shift, G encodes
// y-shift, and the flat neutral-gray center confines refraction to the rim.
// Rendered to a PNG via canvas - feImage handles raster data URIs more
// reliably than nested SVG documents.
const lensMapUri = (): string | null => {
  const w = 256;
  const h = 128;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const xRamp = ctx.createLinearGradient(0, 0, w, 0);
  xRamp.addColorStop(0, '#000000');
  xRamp.addColorStop(1, '#ff0000');
  ctx.fillStyle = xRamp;
  ctx.fillRect(0, 0, w, h);

  ctx.globalCompositeOperation = 'screen';
  const yRamp = ctx.createLinearGradient(0, 0, 0, h);
  yRamp.addColorStop(0, '#000000');
  yRamp.addColorStop(1, '#00ff00');
  ctx.fillStyle = yRamp;
  ctx.fillRect(0, 0, w, h);

  ctx.globalCompositeOperation = 'source-over';
  const center = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) / 2);
  center.addColorStop(0, 'rgba(128, 128, 128, 1)');
  center.addColorStop(0.48, 'rgba(128, 128, 128, 1)');
  center.addColorStop(1, 'rgba(128, 128, 128, 0)');
  ctx.fillStyle = center;
  ctx.fillRect(0, 0, w, h);

  return canvas.toDataURL('image/png');
};

let lensState: boolean | null = null;

/**
 * Injects the shared SVG displacement filter once and reports whether the
 * refraction lens can render here. Safari and Firefox parse `url()` backdrop
 * filters but silently ignore them (the element would lose its blur), so the
 * lens is gated on a real Chromium engine marker.
 */
export function ensureLiquidGlassLens(): boolean {
  if (lensState !== null) return lensState;
  if (typeof document === 'undefined' || typeof CSS === 'undefined') {
    return false; // undecided (SSR/tests): probe again on a real DOM
  }
  const chromium = 'userAgentData' in navigator
    && CSS.supports('backdrop-filter', 'url(#probe)');
  if (!chromium) {
    lensState = false;
    return false;
  }
  const existing = document.getElementById(LENS_DEFS_ID);
  if (existing && existing.getAttribute('data-v') !== LENS_VERSION) {
    existing.remove();
  }
  if (!document.getElementById(LENS_DEFS_ID)) {
    const map = lensMapUri();
    if (!map) {
      lensState = false;
      return false;
    }
    const host = document.createElement('div');
    host.innerHTML =
      `<svg id="${LENS_DEFS_ID}" data-v="${LENS_VERSION}" width="0" height="0" style="position:fixed" aria-hidden="true" focusable="false">`
      + `<filter id="${LENS_FILTER_ID}" x="0%" y="0%" width="100%" height="100%" color-interpolation-filters="sRGB">`
      + `<feImage href="${map}" preserveAspectRatio="none" result="map"/>`
      + '<feDisplacementMap in="SourceGraphic" in2="map" scale="52" xChannelSelector="R" yChannelSelector="G"/>'
      + '</filter></svg>';
    const svg = host.firstElementChild;
    if (svg) document.body.appendChild(svg);
  }
  lensState = true;
  return true;
}

export function useLiquidGlassLens(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(ensureLiquidGlassLens());
  }, []);
  return ready;
}

/** Drop into any `.ms-liquid-glass` container to add rim refraction. */
export function LiquidGlassLens() {
  const ready = useLiquidGlassLens();
  if (!ready) return null;
  return <span className="ms-liquid-glass-lens" aria-hidden="true" />;
}

export interface LiquidGlassBubbleProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Trigger icon; stays visible as the pill's leading cell while open. */
  icon: ReactNode;
  /** Accessible name for the trigger and the revealed action group. */
  label: string;
  triggerTitle?: string;
  className?: string;
  children: ReactNode;
}

/**
 * A liquid-glass circle that stretches into an action pill on tap. Content
 * stays mounted (hidden + inert while closed) so both morph directions
 * animate. Closes on outside pointer-down and Escape; clicks inside never
 * propagate to the surface underneath.
 */
export function LiquidGlassBubble({
  open,
  onOpenChange,
  icon,
  label,
  triggerTitle,
  className,
  children,
}: LiquidGlassBubbleProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const lensReady = useLiquidGlassLens();

  // Closing while focus sits on a drawer action (Escape from keyboard use)
  // would drop focus to <body> once the drawer turns inert - hand it back
  // to the trigger instead.
  useEffect(() => {
    if (open) return;
    const drawer = drawerRef.current;
    if (drawer && drawer.contains(document.activeElement)) {
      triggerRef.current?.focus();
    }
  }, [open]);

  // The drawer opens to the content's measured size (published as CSS vars)
  // so the width/height springs can overshoot it - a real liquid stretch.
  useEffect(() => {
    const root = rootRef.current;
    const inner = innerRef.current;
    if (!root || !inner) return undefined;
    const apply = () => {
      root.style.setProperty('--lgb-drawer-width', `${inner.offsetWidth}px`);
      root.style.setProperty('--lgb-drawer-height', `${inner.offsetHeight}px`);
    };
    apply();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(apply);
    observer.observe(inner);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!open) return undefined;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        onOpenChange(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChange(false);
    };

    // Capture phase: a pointer-down inside a sibling bubble stops propagation
    // (so surfaces underneath don't react), which must still close this one.
    document.addEventListener('pointerdown', closeOnOutsidePointer, true);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer, true);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [open, onOpenChange]);

  return (
    <div
      ref={rootRef}
      className={`ms-liquid-glass ms-liquid-bubble${lensReady ? ' ms-liquid-glass-refracting' : ''}${open ? ' open' : ''}${className ? ` ${className}` : ''}`}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {lensReady && <span className="ms-liquid-glass-lens" aria-hidden="true" />}
      <button
        ref={triggerRef}
        type="button"
        className="ms-liquid-bubble-trigger"
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={label}
        title={triggerTitle}
        onClick={() => onOpenChange(!open)}
      >
        {icon}
      </button>
      <div
        ref={drawerRef}
        className="ms-liquid-bubble-drawer"
        inert={!open}
        aria-hidden={!open}
      >
        <div ref={innerRef} className="ms-liquid-bubble-drawer-inner" role="group" aria-label={label}>
          {children}
        </div>
      </div>
    </div>
  );
}
