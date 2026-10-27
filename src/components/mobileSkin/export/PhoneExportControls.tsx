// Small touch controls of the export sheet: option chips (greyed with a reason on tap), a labelled
// group and a numeric field. 44px targets; pointer focus is released on pointerup, keyboard focus
// keeps the styled :focus-visible ring.
import type { PointerEvent, ReactNode } from 'react';
import { usePhoneUiStore } from '../state/phoneUiStore';

export function releasePointerFocus(event: PointerEvent<HTMLElement>): void {
  if (event.pointerType !== 'mouse' || event.button === 0) event.currentTarget.blur();
}

interface ChipProps {
  testId: string;
  pressed: boolean;
  /** When set, the chip is greyed and a tap explains why instead of selecting. */
  disabledReason?: string | null;
  onSelect: () => void;
  children: ReactNode;
}

export function PhoneExportChip({ testId, pressed, disabledReason, onSelect, children }: ChipProps) {
  const showToast = usePhoneUiStore((store) => store.showToast);
  const disabled = Boolean(disabledReason);
  return (
    <button
      type="button"
      className="phone-export-chip"
      aria-pressed={pressed}
      aria-disabled={disabled}
      title={disabledReason ?? undefined}
      data-testid={testId}
      onPointerUp={releasePointerFocus}
      onClick={() => {
        if (disabledReason) showToast(disabledReason, 'info');
        else onSelect();
      }}
    >
      {children}
    </button>
  );
}

export function PhoneExportGroup({ label, children, note }: { label: string; children: ReactNode; note?: string | null }) {
  return (
    <div className="phone-export-group" role="group" aria-label={label}>
      <span className="phone-export-group__label">{label}</span>
      <div className="phone-export-group__chips">{children}</div>
      {note ? <p className="phone-export-group__note">{note}</p> : null}
    </div>
  );
}

interface NumberFieldProps {
  testId: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onCommit: (value: number) => void;
}

/** Commits on change of a valid number; the browser's numeric keyboard opens on phones. */
export function PhoneExportNumberField({ testId, label, value, min, max, step = 1, suffix, onCommit }: NumberFieldProps) {
  return (
    <label className="phone-export-number">
      <span>{label}</span>
      <input
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        value={Number.isFinite(value) ? value : ''}
        data-testid={testId}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (event.target.value !== '' && Number.isFinite(next)) onCommit(next);
        }}
      />
      {suffix ? <span className="phone-export-number__suffix">{suffix}</span> : null}
    </label>
  );
}
