// General-purpose rotary knob (reusable across the app).
//
// A compact alternative to a slider for continuous parameters — same value model
// (min/max/step + a perceptual `scale` taper), vertical drag to turn, right-click
// or double-click to reset. It is framework-neutral about WHERE a live value comes
// from: pass `subscribeLive` (returns an unsubscribe) and the knob paints an
// imperative "automation" overlay that tracks it WITHOUT re-rendering — so a value
// bus, a store, or anything else can drive it. The synth uses SynthKnob to bind it
// to the live-param bus; other features can supply their own source.

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { positionToValue, valueToPosition, type SliderScale } from './sliderScale';
import './Knob.css';

export interface KnobProps {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  scale?: SliderScale;
  gamma?: number;
  /** Optional output quantization (value units). */
  step?: number;
  /** Right-click / double-click resets to this value. */
  defaultValue?: number;
  label?: string;
  unit?: string;
  /** Diameter in px (default 42). */
  size?: number;
  /** Override the value read-out formatting. */
  format?: (value: number) => string;
  /** Imperative live-value source for the automation overlay; returns unsubscribe. */
  subscribeLive?: (cb: (value: number | undefined) => void) => () => void;
  disabled?: boolean;
}

// 270° sweep with the gap at the bottom: min at 7:30, max at 4:30.
const A_MIN = -135;
const A_MAX = 135;
const SWEEP = A_MAX - A_MIN;
// Pixels of vertical drag for a full min→max travel (in position space).
const DRAG_RANGE_PX = 220;

function polar(cx: number, cy: number, r: number, angleDeg: number): [number, number] {
  const a = (angleDeg * Math.PI) / 180;
  return [cx + r * Math.sin(a), cy - r * Math.cos(a)];
}

function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const [x0, y0] = polar(cx, cy, r, a0);
  const [x1, y1] = polar(cx, cy, r, a1);
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
  const sweep = a1 >= a0 ? 1 : 0;
  return `M ${x0} ${y0} A ${r} ${r} 0 ${large} ${sweep} ${x1} ${y1}`;
}

function defaultFormat(value: number, unit?: string, max?: number): string {
  if (unit === 'Hz') return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(Math.round(value));
  if (max !== undefined && Math.abs(max) <= 1) return value.toFixed(2);
  if (Math.abs(value) >= 100) return String(Math.round(value));
  return value.toFixed(Math.abs(value) < 10 ? 2 : 1);
}

export function Knob({
  value, min, max, onChange, scale = 'linear', gamma = 2, step,
  defaultValue, label, unit, size = 42, format, subscribeLive, disabled,
}: KnobProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const liveArcRef = useRef<SVGPathElement | null>(null);
  const liveDotRef = useRef<SVGCircleElement | null>(null);
  const liveValueRef = useRef<HTMLDivElement | null>(null);

  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 4;
  const fmt = useMemo(
    () => format ?? ((v: number) => defaultFormat(v, unit, max)),
    [format, unit, max],
  );

  const position = valueToPosition(value, min, max, scale, gamma);
  const angle = A_MIN + position * SWEEP;
  const [ix, iy] = polar(cx, cy, r - 3, angle);

  const quantize = useCallback((v: number) => {
    const clamped = Math.max(min, Math.min(max, v));
    if (!step) return clamped;
    return Math.max(min, Math.min(max, Math.round(clamped / step) * step));
  }, [min, max, step]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (disabled || e.button !== 0) return;
    // Keep the drag entirely on the knob: capture the pointer and stop the event
    // from reaching the scrollable properties panel (no pointer lock — that made
    // the browser scroll the panel to keep the locked element in view). Focus
    // without scrolling so a below-the-fold knob doesn't jump the panel either.
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture?.(e.pointerId);
    el.focus?.({ preventScroll: true });
    const startPos = valueToPosition(value, min, max, scale, gamma);
    let acc = 0;
    let lastY = e.clientY;

    const move = (ev: PointerEvent) => {
      const fine = ev.shiftKey ? 0.25 : ev.ctrlKey ? 0.05 : 1;
      acc += (lastY - ev.clientY) * fine; // drag up = increase
      lastY = ev.clientY;
      const nextPos = Math.max(0, Math.min(1, startPos + acc / DRAG_RANGE_PX));
      onChange(quantize(positionToValue(nextPos, min, max, scale, gamma)));
    };
    const up = (ev: PointerEvent) => {
      el.releasePointerCapture?.(ev.pointerId);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }, [disabled, value, min, max, scale, gamma, onChange, quantize]);

  const reset = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (defaultValue !== undefined && !disabled) onChange(quantize(defaultValue));
  }, [defaultValue, disabled, onChange, quantize]);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (disabled) return;
    const p = valueToPosition(value, min, max, scale, gamma);
    const stepPos = e.shiftKey ? 0.01 : 0.02;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
      e.preventDefault();
      onChange(quantize(positionToValue(Math.min(1, p + stepPos), min, max, scale, gamma)));
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
      e.preventDefault();
      onChange(quantize(positionToValue(Math.max(0, p - stepPos), min, max, scale, gamma)));
    }
  }, [disabled, value, min, max, scale, gamma, onChange, quantize]);

  // Imperative automation overlay — updates the live arc/dot/value WITHOUT a
  // React re-render, so a 60fps live source never thrashes the panel.
  useEffect(() => {
    if (!subscribeLive) return;
    return subscribeLive((live) => {
      const root = rootRef.current;
      if (!root) return;
      if (live === undefined || max === min) {
        root.classList.remove('is-automating');
        return;
      }
      const p = valueToPosition(live, min, max, scale, gamma);
      const a = A_MIN + p * SWEEP;
      root.classList.add('is-automating');
      liveArcRef.current?.setAttribute('d', arcPath(cx, cy, r, A_MIN, a));
      const [dx, dy] = polar(cx, cy, r, a);
      liveDotRef.current?.setAttribute('cx', String(dx));
      liveDotRef.current?.setAttribute('cy', String(dy));
      if (liveValueRef.current) liveValueRef.current.textContent = fmt(live);
    });
  }, [subscribeLive, min, max, scale, gamma, cx, cy, r, fmt]);

  return (
    <div
      ref={rootRef}
      className={`knob${disabled ? ' knob-disabled' : ''}`}
      style={{ width: size }}
    >
      <div
        className="knob-dial"
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={`${fmt(value)}${unit ? ` ${unit}` : ''}`}
        title={defaultValue !== undefined ? 'Drag to turn · right-click to reset' : 'Drag to turn'}
        onPointerDown={onPointerDown}
        onContextMenu={reset}
        onDoubleClick={reset}
        onKeyDown={onKeyDown}
        style={{ width: size, height: size }}
      >
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <path className="knob-track" d={arcPath(cx, cy, r, A_MIN, A_MAX)} />
          {position > 0.001 && (
            <path className="knob-value" d={arcPath(cx, cy, r, A_MIN, angle)} />
          )}
          <line className="knob-indicator" x1={cx} y1={cy} x2={ix} y2={iy} />
          {/* Automation overlay (hidden until subscribeLive fires a value). */}
          <path ref={liveArcRef} className="knob-live-arc" d="" />
          <circle ref={liveDotRef} className="knob-live-dot" r={2.5} cx={cx} cy={cy} />
        </svg>
      </div>
      {label && <div className="knob-label">{label}</div>}
      <div className="knob-value-text">{fmt(value)}</div>
      <div ref={liveValueRef} className="knob-live-value" />
    </div>
  );
}
