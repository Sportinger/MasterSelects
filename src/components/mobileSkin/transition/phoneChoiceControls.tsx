// Small touch controls of the phone tool sheets (transition, speed and others): a choice tile/chip, an on/off switch,
// a segmented tab row and a greyed option that explains itself (owner rule: grey out, never hide).
// Every control is at least 44 px tall, drops pointer focus after a tap (no stuck ring) and keeps a
// styled :focus-visible ring for the keyboard (phoneChoiceControls.css).

import type { PointerEvent, ReactNode } from 'react';

import { usePhoneUiStore } from '../state/phoneUiStore';
import './phoneChoiceControls.css';

/** Pointer-focus hygiene: a tapped control lets go of focus; keyboard focus stays. */
export function blurAfterPointer(event: PointerEvent<HTMLElement>): void {
  // Keyboard activation never sends pointerup, so keyboard focus (and :focus-visible) stays.
  event.currentTarget.blur();
}

function explain(id: string, label: string, reason: string): void {
  usePhoneUiStore.getState().showUnavailable({ actionId: id, label, reason });
}

export interface PhoneChoiceProps {
  label: string;
  selected: boolean;
  onSelect: () => void;
  testId: string;
  /** Visible but unavailable: tapping explains instead of selecting. */
  unavailableReason?: string | null;
  /** 'tile' for the grid of looks, 'chip' for the compact row. */
  variant?: 'tile' | 'chip';
  glyph?: ReactNode;
  /** A picture above the label (tile variant): the look of the choice instead of letters. */
  media?: ReactNode;
}

export function PhoneChoice({ label, selected, onSelect, testId, unavailableReason, variant = 'chip', glyph, media }: PhoneChoiceProps) {
  const unavailable = Boolean(unavailableReason);
  return (
    <button
      type="button"
      className={`phone-choice phone-choice--${variant}${media ? ' phone-choice--media' : ''}`}
      aria-pressed={selected}
      aria-disabled={unavailable || undefined}
      data-testid={testId}
      onPointerUp={blurAfterPointer}
      onClick={() => (unavailable ? explain(testId, label, unavailableReason!) : onSelect())}
    >
      {media ? <span className="phone-choice__media" aria-hidden="true">{media}</span> : null}
      {!media && glyph && <span className="phone-choice__glyph" aria-hidden="true">{glyph}</span>}
      <span className="phone-choice__label">{label}</span>
    </button>
  );
}

export interface PhoneSwitchProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  testId: string;
  hint?: string;
  unavailableReason?: string | null;
}

export function PhoneSwitch({ label, checked, onChange, testId, hint, unavailableReason }: PhoneSwitchProps) {
  const unavailable = Boolean(unavailableReason);
  return (
    <button
      type="button"
      role="switch"
      className="phone-switch"
      aria-checked={checked}
      aria-disabled={unavailable || undefined}
      data-testid={testId}
      onPointerUp={blurAfterPointer}
      onClick={() => (unavailable ? explain(testId, label, unavailableReason!) : onChange(!checked))}
    >
      <span className="phone-switch__text">
        <span className="phone-switch__label">{label}</span>
        {hint && <span className="phone-switch__hint">{hint}</span>}
      </span>
      <span className="phone-switch__track" aria-hidden="true"><span className="phone-switch__thumb" /></span>
    </button>
  );
}

export interface PhoneTabsProps<T extends string> {
  label: string;
  tabs: ReadonlyArray<{ id: T; label: string; testId: string }>;
  active: T;
  onSelect: (id: T) => void;
}

export function PhoneTabs<T extends string>({ label, tabs, active, onSelect }: PhoneTabsProps<T>) {
  return (
    <div className="phone-tabs" role="tablist" aria-label={label}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          className="phone-tabs__tab"
          aria-selected={tab.id === active}
          data-testid={tab.testId}
          onPointerUp={blurAfterPointer}
          onClick={() => onSelect(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

/** A row for an option that exists in the editor but not on the phone yet. */
export function PhoneGreyedOption({ label, reason, testId }: { label: string; reason: string; testId: string }) {
  return (
    <button
      type="button"
      className="phone-greyed"
      aria-disabled="true"
      data-testid={testId}
      onPointerUp={blurAfterPointer}
      onClick={() => explain(testId, label, reason)}
    >
      <span className="phone-greyed__label">{label}</span>
      <span className="phone-greyed__badge">Not on phone yet</span>
    </button>
  );
}
