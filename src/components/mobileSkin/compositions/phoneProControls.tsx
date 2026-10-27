// Touch controls shared by the Q1 pro sheets (compositions, tracks, markers, trim modes, replace):
// a button, a labelled text field, a frame stepper, a section and a status message. Chips, switches,
// tabs and greyed rows come from transition/phoneChoiceControls. Every control is at least 44 px
// tall, lets go of pointer focus after a tap and keeps a styled :focus-visible ring for the keyboard.

import type { ReactNode } from 'react';

import { usePhoneUiStore } from '../state/phoneUiStore';
import { blurAfterPointer } from './phoneProFocus';
import { ProGlyph, type ProGlyphName } from './phoneProGlyphs';
import './phoneProControls.css';

export interface ProButtonProps {
  label: string;
  onPress: () => void;
  testId: string;
  tone?: 'plain' | 'primary' | 'danger';
  /** Visible but unavailable: tapping explains instead of acting (owner rule: grey out, never hide). */
  unavailableReason?: string | null;
  ariaLabel?: string;
  pressed?: boolean;
  compact?: boolean;
  children?: ReactNode;
  data?: Record<string, string>;
}

export function ProButton({ label, onPress, testId, tone = 'plain', unavailableReason, ariaLabel, pressed, compact, children, data }: ProButtonProps) {
  const unavailable = Boolean(unavailableReason);
  const dataAttributes = Object.fromEntries(Object.entries(data ?? {}).map(([key, value]) => [`data-${key}`, value]));
  return (
    <button
      type="button"
      className={`phone-pro-button phone-pro-button--${tone}${compact ? ' phone-pro-button--compact' : ''}`}
      aria-label={ariaLabel}
      aria-disabled={unavailable || undefined}
      aria-pressed={pressed}
      data-testid={testId}
      {...dataAttributes}
      onPointerUp={blurAfterPointer}
      onClick={() => {
        if (unavailable) usePhoneUiStore.getState().showUnavailable({ actionId: testId, label: ariaLabel ?? label, reason: unavailableReason! });
        else onPress();
      }}
    >
      {children ?? label}
    </button>
  );
}

export interface ProTextFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  testId: string;
  onSubmit?: () => void;
  maxLength?: number;
  autoFocus?: boolean;
  placeholder?: string;
}

export function ProTextField({ label, value, onChange, testId, onSubmit, maxLength = 200, autoFocus, placeholder }: ProTextFieldProps) {
  return (
    <label className="phone-pro-field">
      <span className="phone-pro-field__label">{label}</span>
      <input
        className="phone-pro-field__input"
        type="text"
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        autoFocus={autoFocus}
        enterKeyHint="done"
        data-testid={testId}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); onSubmit?.(); } }}
      />
    </label>
  );
}

export interface ProStepperProps {
  label: string;
  value: string;
  steps: ReadonlyArray<{ label: string; delta: number }>;
  onStep: (delta: number) => void;
  testId: string;
  unavailableReason?: string | null;
  onReset?: () => void;
}

/** "−10f −1f [value] +1f +10f" with an optional reset: precise steps a thumb can hit. */
export function ProStepper({ label, value, steps, onStep, testId, unavailableReason, onReset }: ProStepperProps) {
  const negative = steps.filter((step) => step.delta < 0);
  const positive = steps.filter((step) => step.delta > 0);
  const stepButton = (step: { label: string; delta: number }) => (
    <ProButton
      key={step.label}
      compact
      label={step.label}
      ariaLabel={`${label} ${step.label}`}
      testId={`${testId}-${step.delta < 0 ? 'minus' : 'plus'}-${Math.abs(step.delta)}`}
      unavailableReason={unavailableReason}
      onPress={() => onStep(step.delta)}
    />
  );
  return (
    <div className="phone-pro-stepper" role="group" aria-label={label}>
      <div className="phone-pro-stepper__head">
        <span>{label}</span>
        <span className="phone-pro-stepper__value" data-testid={`${testId}-value`}>{value}</span>
      </div>
      <div className="phone-pro-stepper__row">
        {negative.map(stepButton)}
        {onReset ? <ProButton compact label="Reset" testId={`${testId}-reset`} unavailableReason={unavailableReason} onPress={onReset} /> : null}
        {positive.map(stepButton)}
      </div>
    </div>
  );
}

export function ProSection({ title, children, testId }: { title?: string; children: ReactNode; testId?: string }) {
  return (
    <section className="phone-pro-section" data-testid={testId}>
      {title ? <h3 className="phone-pro-section__title">{title}</h3> : null}
      {children}
    </section>
  );
}

export function ProMessage({ text, tone = 'info', testId }: { text: string | null; tone?: 'info' | 'error'; testId: string }) {
  if (!text) return null;
  return (
    <p className={`phone-pro-message phone-pro-message--${tone}`} role={tone === 'error' ? 'alert' : 'status'} data-testid={testId}>
      {text}
    </p>
  );
}

export interface ProEmptyStateProps {
  icon?: ProGlyphName;
  title: string;
  /** At most two short lines. */
  body?: string;
  action?: { label: string; onPress: () => void; testId: string; unavailableReason?: string | null };
  testId?: string;
}

/** Shared empty state of the phone sheets: line icon, title, a short body and one next step. */
export function ProEmptyState({ icon = 'empty', title, body, action, testId }: ProEmptyStateProps) {
  return (
    <div className="phone-pro-empty" data-testid={testId}>
      <span className="phone-pro-empty__icon"><ProGlyph name={icon} size={32} /></span>
      <p className="phone-pro-empty__title">{title}</p>
      {body ? <p className="phone-pro-empty__body">{body}</p> : null}
      {action ? (
        <ProButton label={action.label} tone="primary" testId={action.testId} unavailableReason={action.unavailableReason} onPress={action.onPress} />
      ) : null}
    </div>
  );
}
