// One slider row shared by the Effects (main parameter), Filters (strength) and Adjust (colour value)
// sheets: label, the editor's touch-safe HandleOnlyRange (a drag starts on the thumb, so a stray tap
// never jumps the value), the value and a reset button. A disabled row stays visible and explains
// itself on tap (owner rule: grey out, never hide).

import type { PointerEvent } from 'react';

import { HandleOnlyRange } from '../../panels/properties/transformTab/HandleOnlyRange';
import { usePhoneUiStore } from '../state/phoneUiStore';
import { PHONE_EFFECTS_TEST_IDS } from './phoneEffectsTestIds';

export interface PhoneValueSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
  /** Reason shown on tap while the row cannot be used; the row stays visible. */
  disabledReason?: string | null;
  /** A short note under the slider (e.g. "Keyframed: changes set a key at the playhead"). */
  note?: string | null;
}

/** Clears transient pointer focus from buttons (pointer-focus hygiene); keyboard focus stays styled. */
export function blurPointerButton(event: PointerEvent<HTMLElement>): void {
  if (event.target instanceof Element) event.target.closest<HTMLElement>('button')?.blur();
}

export function PhoneValueSlider({
  label, value, min, max, step, defaultValue, format, onChange, disabledReason = null, note = null,
}: PhoneValueSliderProps) {
  const showUnavailable = usePhoneUiStore((state) => state.showUnavailable);
  const disabled = Boolean(disabledReason);
  const atDefault = Math.abs(value - defaultValue) <= step / 2;
  const explain = () => {
    if (disabledReason) showUnavailable({ actionId: `slider-${label}`, label, reason: disabledReason });
  };

  return (
    <div className="phone-fx-slider" data-testid={PHONE_EFFECTS_TEST_IDS.slider} data-disabled={disabled || undefined}>
      <div className="phone-fx-slider__head">
        <span className="phone-fx-slider__label">{label}</span>
        <span className="phone-fx-slider__value" data-testid={PHONE_EFFECTS_TEST_IDS.sliderValue}>{format(value)}</span>
        <button
          type="button"
          className="phone-fx-slider__reset"
          data-testid={PHONE_EFFECTS_TEST_IDS.sliderReset}
          aria-disabled={disabled || atDefault}
          aria-label={`Reset ${label}`}
          onPointerUp={blurPointerButton}
          onClick={() => {
            if (disabled) { explain(); return; }
            if (!atDefault) onChange(defaultValue);
          }}
        >
          Reset
        </button>
      </div>
      {/* The tap catcher sits over a disabled range so the reason shows instead of nothing happening. */}
      <div className="phone-fx-slider__track" onClick={disabled ? explain : undefined}>
        <HandleOnlyRange
          aria-label={label}
          disabled={disabled}
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={onChange}
        />
      </div>
      {note && <p className="phone-fx-slider__note">{note}</p>}
    </div>
  );
}
