// Small touch controls shared by the phone design sheets of this packet (text style, animation,
// keyframes): a slider row (one slider + value + reset), a choice chip, colour swatches with a hex
// field, an on/off switch and a greyed option that explains itself. Every control is at least 44 px
// tall, drops pointer focus after a tap (no stuck ring) and keeps a styled :focus-visible ring for
// the keyboard (PhoneDesignControls.css).

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';

import { usePhoneUiStore } from '../state/phoneUiStore';
import './PhoneDesignControls.css';

/** Pointer-focus hygiene: a tapped control lets go of focus; keyboard focus stays. */
export function blurAfterPointer(event: PointerEvent<HTMLElement>): void {
  // Touch focuses through the compatibility mousedown that follows pointerup, so let go a frame later.
  const target = event.currentTarget;
  window.requestAnimationFrame(() => { if (document.activeElement === target) target.blur(); });
}

export interface PhoneSliderRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  /** Formats the shown value (default: up to the step's decimals). */
  format?: (value: number) => string;
  onChange: (value: number) => void;
  /** Shows a reset button when given. */
  defaultValue?: number;
  disabled?: boolean;
  testId?: string;
}

function decimalsOf(step: number): number {
  const text = String(step);
  return text.includes('.') ? text.split('.')[1].length : 0;
}

export function PhoneSliderRow({ label, value, min, max, step, format, onChange, defaultValue, disabled, testId }: PhoneSliderRowProps) {
  const shown = format ? format(value) : value.toFixed(decimalsOf(step));
  const clamped = Math.min(max, Math.max(min, value));
  const fraction = max > min ? (clamped - min) / (max - min) : 0;
  const trackRef = useRef<HTMLDivElement>(null);
  const snap = (raw: number) => {
    const stepped = Math.round((raw - min) / step) * step + min;
    return Number(Math.min(max, Math.max(min, stepped)).toFixed(decimalsOf(step)));
  };
  const valueAt = (clientX: number) => {
    const box = trackRef.current?.getBoundingClientRect();
    if (!box || box.width <= 0) return clamped;
    return snap(min + ((clientX - box.left) / box.width) * (max - min));
  };
  const emit = (next: number) => { if (!disabled && Math.abs(next - value) > 1e-9) onChange(next); };
  // One finger: a tap jumps there, a drag follows the finger (pointer capture). Vertical moves scroll the sheet.
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || event.button > 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    emit(valueAt(event.clientX));
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || !event.currentTarget.hasPointerCapture?.(event.pointerId)) return;
    emit(valueAt(event.clientX));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const big = (max - min) / 10;
    const delta = { ArrowRight: step, ArrowUp: step, ArrowLeft: -step, ArrowDown: -step, PageUp: big, PageDown: -big }[event.key];
    if (delta !== undefined) { event.preventDefault(); emit(snap(clamped + delta)); }
    else if (event.key === 'Home') { event.preventDefault(); emit(min); }
    else if (event.key === 'End') { event.preventDefault(); emit(max); }
  };
  return (
    <div className="phone-design-slider" data-disabled={disabled ? 'true' : undefined}>
      <span className="phone-design-slider__label">{label}</span>
      <div
        ref={trackRef}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        className="phone-design-slider__range"
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={clamped}
        aria-valuetext={shown}
        aria-disabled={disabled ? 'true' : undefined}
        data-testid={testId}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={blurAfterPointer}
        onKeyDown={onKeyDown}
      >
        <span className="phone-design-slider__track" aria-hidden="true">
          <span className="phone-design-slider__fill" style={{ width: `${fraction * 100}%` }} />
        </span>
        <span className="phone-design-slider__thumb" aria-hidden="true" style={{ left: `${fraction * 100}%` }} />
      </div>
      <span className="phone-design-slider__value" data-testid={testId ? `${testId}-value` : undefined}>{shown}</span>
      {defaultValue !== undefined && (
        <button
          type="button"
          className="phone-design-slider__reset"
          aria-label={`Reset ${label}`}
          aria-disabled={disabled || Math.abs(value - defaultValue) < 1e-9}
          onPointerUp={blurAfterPointer}
          onClick={() => { if (!disabled) onChange(defaultValue); }}
        >
          ↺
        </button>
      )}
    </div>
  );
}

export interface PhoneChipProps {
  label: ReactNode;
  selected: boolean;
  onSelect: () => void;
  testId?: string;
  ariaLabel?: string;
  /** Visible but unavailable: tapping explains instead of selecting (owner rule: grey out, never hide). */
  unavailableReason?: string;
  className?: string;
  style?: CSSProperties;
}

export function PhoneChip({ label, selected, onSelect, testId, ariaLabel, unavailableReason, className, style }: PhoneChipProps) {
  const showUnavailable = usePhoneUiStore((state) => state.showUnavailable);
  return (
    <button
      type="button"
      className={`phone-design-chip${className ? ` ${className}` : ''}`}
      aria-pressed={selected}
      aria-disabled={unavailableReason ? 'true' : undefined}
      aria-label={ariaLabel}
      data-testid={testId}
      style={style}
      onPointerUp={blurAfterPointer}
      onClick={() => {
        if (unavailableReason) {
          showUnavailable({ actionId: testId ?? String(ariaLabel ?? 'option'), label: String(ariaLabel ?? label), reason: unavailableReason });
          return;
        }
        onSelect();
      }}
    >
      {label}
    </button>
  );
}

export const PHONE_COLOR_SWATCHES = [
  '#ffffff', '#000000', '#f5d33a', '#ff8a1f', '#f0444a', '#ff5fa2', '#9b6bff', '#3a8bff', '#2fd2c9', '#4bd86b',
] as const;

const HEX = /^#[0-9a-f]{6}$/i;

/** Normalises '#abc', 'abc', '#aabbcc' to '#aabbcc'; anything else is null. */
export function normalizePhoneHex(input: string): string | null {
  const raw = input.trim().replace(/^#?/, '#');
  if (/^#[0-9a-f]{3}$/i.test(raw)) return `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`.toLowerCase();
  return HEX.test(raw) ? raw.toLowerCase() : null;
}

export interface PhoneColorRowProps {
  label: string;
  value: string;
  onChange: (hex: string) => void;
  testId: string;
}

/** Swatches plus a hex field. Non-hex stored colours (rgba) show as-is until a swatch or hex replaces them. */
export function PhoneColorRow({ label, value, onChange, testId }: PhoneColorRowProps) {
  const [draft, setDraft] = useState(value);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => { setDraft(value); setInvalid(false); }, [value]);
  const current = normalizePhoneHex(value);
  const commitDraft = () => {
    const hex = normalizePhoneHex(draft);
    if (!hex) { setInvalid(draft.trim() !== value.trim()); return; }
    setInvalid(false);
    if (hex !== current) onChange(hex);
  };
  return (
    <div className="phone-design-color" role="group" aria-label={label}>
      <span className="phone-design-color__label">{label}</span>
      <div className="phone-design-color__swatches">
        {PHONE_COLOR_SWATCHES.map((hex) => (
          <button
            key={hex}
            type="button"
            className="phone-design-color__swatch"
            style={{ background: hex }}
            aria-label={`${label} ${hex}`}
            aria-pressed={current === hex}
            data-testid={`${testId}-${hex.slice(1)}`}
            onPointerUp={blurAfterPointer}
            onClick={() => onChange(hex)}
          />
        ))}
      </div>
      <label className="phone-design-color__hex">
        <span>Hex</span>
        <input
          type="text"
          inputMode="text"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          maxLength={9}
          value={draft}
          aria-invalid={invalid}
          data-testid={`${testId}-hex`}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commitDraft}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commitDraft(); } }}
        />
      </label>
      {invalid && <p className="phone-design-note phone-design-note--warn">Use a hex colour like #ff8800.</p>}
    </div>
  );
}

export interface PhoneSwitchRowProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  testId: string;
}

export function PhoneSwitchRow({ label, checked, onChange, testId }: PhoneSwitchRowProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className="phone-design-switch"
      data-testid={testId}
      onPointerUp={blurAfterPointer}
      onClick={() => onChange(!checked)}
    >
      <span>{label}</span>
      <span className="phone-design-switch__track" aria-hidden="true"><span className="phone-design-switch__thumb" /></span>
    </button>
  );
}
