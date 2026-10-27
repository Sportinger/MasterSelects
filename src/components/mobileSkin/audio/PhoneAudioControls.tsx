// Small touch controls shared by the Volume and Audio sheets: a slider row with a typed value and
// a reset, a toggle, and a greyed row that explains itself on tap (owner rule: grey out, never hide).

import { useEffect, useState, type PointerEvent, type ReactNode } from 'react';

import { usePhoneUiStore } from '../state/phoneUiStore';

/** Pointer-focus hygiene: a tapped control drops focus; keyboard focus keeps its :focus-visible ring. */
export function blurAfterPointer(event: PointerEvent<HTMLElement>): void {
  if (event.pointerType !== 'mouse' || event.button === 0) event.currentTarget.blur();
}

export interface PhoneSliderRowProps {
  id: string;
  label: string;
  /** Slider position (in slider units). */
  sliderValue: number;
  sliderMin: number;
  sliderMax: number;
  sliderStep: number;
  onSlide: (value: number) => void;
  /** Value shown in the typed field (in field units, e.g. percent or seconds). */
  fieldValue: number;
  fieldDecimals: number;
  fieldMin: number;
  fieldMax: number;
  fieldStep: number;
  fieldSuffix: string;
  onField: (value: number) => void;
  /** Secondary readout next to the label, e.g. "-6.0 dB". */
  detail?: string;
  disabled?: boolean;
  onDisabledTap?: () => void;
  onReset?: () => void;
  resetLabel?: string;
  sliderTestId: string;
  fieldTestId: string;
  resetTestId?: string;
  valueText?: string;
}

/** Every typed value uses a decimal point, whatever the browser locale (a number input would show '0,50'). */
const format = (value: number, decimals: number) => (Number.isFinite(value) ? value.toFixed(decimals) : '');
/** Accepts a point or a comma as the decimal separator. */
export function parsePhoneDecimal(text: string): number {
  return Number.parseFloat(text.trim().replace(',', '.'));
}

export function PhoneSliderRow(props: PhoneSliderRowProps) {
  const { disabled = false } = props;
  const [draft, setDraft] = useState(() => format(props.fieldValue, props.fieldDecimals));
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setDraft(format(props.fieldValue, props.fieldDecimals));
  }, [editing, props.fieldValue, props.fieldDecimals]);

  const guard = () => {
    if (!disabled) return false;
    props.onDisabledTap?.();
    return true;
  };

  return (
    <div className="phone-audio-row" data-disabled={disabled || undefined}>
      <div className="phone-audio-row__head">
        <label className="phone-audio-row__label" htmlFor={`${props.id}-field`}>{props.label}</label>
        {props.detail ? <span className="phone-audio-row__detail">{props.detail}</span> : null}
        <span className="phone-audio-row__field-wrap">
          <input
            id={`${props.id}-field`}
            className="phone-audio-row__field"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            aria-valuemin={props.fieldMin}
            aria-valuemax={props.fieldMax}
            value={draft}
            readOnly={disabled}
            aria-disabled={disabled || undefined}
            data-testid={props.fieldTestId}
            onFocus={() => { if (!guard()) setEditing(true); }}
            onBlur={() => setEditing(false)}
            onChange={(event) => {
              if (disabled) return;
              setDraft(event.target.value);
              const parsed = parsePhoneDecimal(event.target.value);
              if (Number.isFinite(parsed)) props.onField(parsed);
            }}
            onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
          />
          <span className="phone-audio-row__suffix" aria-hidden="true">{props.fieldSuffix}</span>
        </span>
        {props.onReset ? (
          <button
            type="button"
            className="phone-audio-row__reset"
            aria-disabled={disabled || undefined}
            data-testid={props.resetTestId}
            onPointerUp={blurAfterPointer}
            onClick={() => { if (!guard()) props.onReset?.(); }}
          >
            {props.resetLabel ?? 'Reset'}
          </button>
        ) : null}
      </div>
      <input
        className="phone-audio-row__slider"
        type="range"
        min={props.sliderMin}
        max={props.sliderMax}
        step={props.sliderStep}
        value={props.sliderValue}
        aria-label={props.label}
        aria-valuetext={props.valueText}
        aria-disabled={disabled || undefined}
        data-testid={props.sliderTestId}
        onPointerDown={(event) => { if (guard()) event.preventDefault(); }}
        onPointerUp={blurAfterPointer}
        onChange={(event) => {
          if (disabled) return;
          const parsed = Number.parseFloat(event.target.value);
          if (Number.isFinite(parsed)) props.onSlide(parsed);
        }}
      />
    </div>
  );
}

export function PhoneToggleButton({ pressed, onToggle, children, testId, disabled = false, onDisabledTap }: {
  pressed: boolean; onToggle: () => void; children: ReactNode; testId: string; disabled?: boolean; onDisabledTap?: () => void;
}) {
  return (
    <button
      type="button"
      className="phone-audio-toggle"
      aria-pressed={pressed}
      aria-disabled={disabled || undefined}
      data-testid={testId}
      onPointerUp={blurAfterPointer}
      onClick={() => (disabled ? onDisabledTap?.() : onToggle())}
    >
      {children}
    </button>
  );
}

export interface PhoneUnavailableItem {
  id: string;
  label: string;
  reason: string;
}

/** Visible, aria-disabled entries; a tap shows the reason in the shared unavailable notice. */
export function PhoneUnavailableList({ items, testIdPrefix, heading }: { items: readonly PhoneUnavailableItem[]; testIdPrefix: string; heading: string }) {
  const showUnavailable = usePhoneUiStore((state) => state.showUnavailable);
  return (
    <div className="phone-audio-more" role="group" aria-label={heading}>
      <span className="phone-audio-more__heading">{heading}</span>
      <div className="phone-audio-more__items">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className="phone-audio-more__item"
            aria-disabled="true"
            data-testid={`${testIdPrefix}${item.id}`}
            onPointerUp={blurAfterPointer}
            onClick={() => showUnavailable({ actionId: `${testIdPrefix}${item.id}`, label: item.label, reason: item.reason })}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}
