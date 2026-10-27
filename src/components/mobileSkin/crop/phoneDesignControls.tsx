// Small touch controls shared by the design sheets (crop & transform, mask, format, overlay):
// a slider row (label, thumb-sized range, value, reset), a chip group (one choice) and a
// toggle chip. Every control is at least 44 px tall, drops pointer focus after a tap and keeps a
// styled :focus-visible ring for the keyboard. Unavailable options stay visible, aria-disabled,
// and explain themselves on tap (owner rule: grey out, never hide).

import type { PointerEvent, ReactNode } from 'react';

import { usePhoneUiStore } from '../state/phoneUiStore';
import { phoneChipTestId } from './phoneChipTestId';
import './PhoneDesignSheets.css';

/** Pointer-focus hygiene: a tapped control must not keep a focus ring; keyboard focus is untouched. */
export function blurAfterPointer(event: PointerEvent<HTMLElement>): void {
  event.currentTarget.blur();
}

export interface PhoneUnavailable {
  /** Short reason shown on tap. */
  reason: string;
}

function useExplain() {
  const showUnavailable = usePhoneUiStore((state) => state.showUnavailable);
  return (id: string, label: string, unavailable: PhoneUnavailable) =>
    showUnavailable({ actionId: id, label, reason: unavailable.reason });
}

export interface PhoneSliderRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  /** Text after the value, e.g. '%', '°', ' px'. */
  unit?: string;
  decimals?: number;
  testId: string;
  onChange: (value: number) => void;
  /** Shows a reset button that sets this value. */
  resetValue?: number;
  unavailable?: PhoneUnavailable;
}

export function PhoneSliderRow({
  label, value, min, max, step = 1, unit = '', decimals = 0, testId, onChange, resetValue, unavailable,
}: PhoneSliderRowProps) {
  const explain = useExplain();
  const shown = Number.isFinite(value) ? value : min;
  const clamped = Math.min(max, Math.max(min, shown));
  const outside = Math.abs(clamped - shown) > 1e-9;
  const disabled = Boolean(unavailable);
  const resetDisabled = disabled || resetValue === undefined || Math.abs(shown - resetValue) < 1e-9;
  return (
    <div className="phone-design-slider" data-testid={testId} data-disabled={disabled || undefined}>
      <div className="phone-design-slider__head">
        <span className="phone-design-slider__label">{label}</span>
        <output className="phone-design-slider__value" data-testid={`${testId}-value`}
          title={outside ? `${shown.toFixed(decimals)}${unit} is outside this slider; dragging sets a value inside it.` : undefined}>
          {shown.toFixed(decimals)}{unit}
        </output>
        {resetValue !== undefined ? (
          <button
            type="button"
            className="phone-design-slider__reset"
            aria-label={`Reset ${label}`}
            aria-disabled={resetDisabled}
            data-testid={`${testId}-reset`}
            onPointerUp={blurAfterPointer}
            onClick={() => { if (!resetDisabled) onChange(resetValue); }}
          >
            Reset
          </button>
        ) : null}
      </div>
      <input
        type="range"
        className="phone-design-slider__range"
        aria-label={label}
        aria-disabled={disabled}
        data-testid={`${testId}-input`}
        min={min}
        max={max}
        step={step}
        value={clamped}
        onPointerUp={blurAfterPointer}
        onPointerDown={(event) => {
          if (!unavailable) return;
          event.preventDefault();
          explain(testId, label, unavailable);
        }}
        onChange={(event) => {
          if (unavailable) return;
          const next = Number(event.target.value);
          if (Number.isFinite(next)) onChange(next);
        }}
      />
    </div>
  );
}

export interface PhoneChipOption<T extends string> {
  value: T;
  label: string;
  unavailable?: PhoneUnavailable;
  /** Optional small glyph drawn before the label. */
  icon?: ReactNode;
}

export interface PhoneChipGroupProps<T extends string> {
  label: string;
  value: T | null;
  options: readonly PhoneChipOption<T>[];
  /** Test id prefix; each chip gets `${testId}-${value}`. */
  testId: string;
  onChange: (value: T) => void;
  disabled?: PhoneUnavailable;
  /** 'chips' (wrapping text chips), 'tiles' (a grid of pictogram tiles) or 'tile-row' (one scrolling row of 64 px tiles). */
  layout?: 'chips' | 'tiles' | 'tile-row';
}

export { phoneChipTestId };

export function PhoneChipGroup<T extends string>({ label, value, options, testId, onChange, disabled, layout = 'chips' }: PhoneChipGroupProps<T>) {
  const explain = useExplain();
  const groupClass = layout === 'chips' ? 'phone-design-chips' : `phone-design-tiles phone-design-tiles--${layout === 'tiles' ? 'grid' : 'row'}`;
  return (
    <div className={groupClass} role="radiogroup" aria-label={label} data-testid={testId}>
      {options.map((option) => {
        const unavailable = option.unavailable ?? disabled;
        const chipId = phoneChipTestId(testId, option.value);
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            className={layout === 'chips' ? 'phone-design-chip' : 'phone-design-chip phone-design-chip--tile'}
            aria-checked={value === option.value}
            aria-disabled={Boolean(unavailable)}
            data-testid={chipId}
            data-value={option.value}
            onPointerUp={blurAfterPointer}
            onClick={() => {
              if (unavailable) explain(chipId, option.label, unavailable);
              else onChange(option.value);
            }}
          >
            {layout === 'chips' ? option.icon : <span className="phone-design-chip__picture" aria-hidden="true">{option.icon}</span>}
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export interface PhoneToggleChipProps {
  label: string;
  pressed: boolean;
  testId: string;
  onToggle: (pressed: boolean) => void;
  unavailable?: PhoneUnavailable;
}

export function PhoneToggleChip({ label, pressed, testId, onToggle, unavailable }: PhoneToggleChipProps) {
  const explain = useExplain();
  return (
    <button
      type="button"
      className="phone-design-chip phone-design-chip--toggle"
      aria-pressed={pressed}
      aria-disabled={Boolean(unavailable)}
      data-testid={testId}
      onPointerUp={blurAfterPointer}
      onClick={() => {
        if (unavailable) explain(testId, label, unavailable);
        else onToggle(!pressed);
      }}
    >
      {label}
    </button>
  );
}

export interface PhoneActionButtonProps {
  label: string;
  testId: string;
  onPress: () => void;
  unavailable?: PhoneUnavailable;
}

export function PhoneActionButton({ label, testId, onPress, unavailable }: PhoneActionButtonProps) {
  const explain = useExplain();
  return (
    <button
      type="button"
      className="phone-design-chip phone-design-chip--action"
      aria-disabled={Boolean(unavailable)}
      data-testid={testId}
      onPointerUp={blurAfterPointer}
      onClick={() => {
        if (unavailable) explain(testId, label, unavailable);
        else onPress();
      }}
    >
      {label}
    </button>
  );
}

/** Segmented tabs at the top of a sheet body (e.g. Crop | Transform). */
export function PhoneSegmented<T extends string>({ label, value, options, testId, onChange }: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  testId: string;
  onChange: (value: T) => void;
}) {
  return (
    <div className="phone-design-segmented" role="tablist" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          className="phone-design-segmented__tab"
          aria-selected={value === option.value}
          data-testid={phoneChipTestId(testId, option.value)}
          onPointerUp={blurAfterPointer}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** A short line under a sheet's controls; tone 'warn' for things the user should know. */
export function PhoneSheetNote({ children, tone = 'info', testId }: { children: ReactNode; tone?: 'info' | 'warn'; testId?: string }) {
  return <p className={`phone-design-note phone-design-note--${tone}`} data-testid={testId} role={tone === 'warn' ? 'status' : undefined}>{children}</p>;
}
