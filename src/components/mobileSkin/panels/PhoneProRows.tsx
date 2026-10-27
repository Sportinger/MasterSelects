// Rows the M2 design sheets use for their pro options: a row that opens a desktop panel or a phone
// control (it replaced the greyed "(M3)" rows), and an inline "fit to a length" field. Each control
// is at least 44 px tall, drops pointer focus after a tap and keeps a styled :focus-visible ring.

import { useState, type FormEvent, type PointerEvent } from 'react';

import { PHONE_PANELS_TEST_IDS as IDS } from './phonePanelsTestIds';
import './PhoneProRows.css';

function blurAfterPointer(event: PointerEvent<HTMLElement>): void {
  event.currentTarget.blur();
}

export interface PhoneProRowProps {
  label: string;
  /** Where the row leads, e.g. "Opens Properties". */
  detail: string;
  testId: string;
  onOpen: () => void;
  disabled?: boolean;
}

/** A working pro option: tapping it opens its panel or control. */
export function PhoneProRow({ label, detail, testId, onOpen, disabled = false }: PhoneProRowProps) {
  return (
    <button
      type="button"
      className="phone-pro-row"
      aria-disabled={disabled || undefined}
      data-testid={testId}
      data-pro-row="true"
      onPointerUp={blurAfterPointer}
      onClick={onOpen}
    >
      <span className="phone-pro-row__label">{label}</span>
      <span className="phone-pro-row__detail">{detail}</span>
      <span className="phone-pro-row__chevron" aria-hidden="true">›</span>
    </button>
  );
}

export interface PhoneFitLengthRowProps {
  testId: string;
  /** The clip's current length on the timeline, in seconds. */
  currentLength: number;
  /** Applies the length; returns a note to show (e.g. that the speed was clamped), or null. */
  onFit: (seconds: number) => string | null;
}

/** "Fit to a length": type the length the clip should last; the speed follows. */
export function PhoneFitLengthRow({ testId, currentLength, onFit }: PhoneFitLengthRowProps) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(() => currentLength.toFixed(2));
  const [note, setNote] = useState<string | null>(null);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const seconds = Number.parseFloat(text.replace(',', '.'));
    if (!Number.isFinite(seconds) || seconds <= 0) {
      setNote('Type a length in seconds, for example 2.5.');
      return;
    }
    setNote(onFit(seconds));
  };

  return (
    <div className="phone-pro-fit">
      <PhoneProRow
        label="Fit to a length"
        detail={open ? 'Type the new length' : `Now ${currentLength.toFixed(2)} s`}
        testId={testId}
        onOpen={() => {
          setText(currentLength.toFixed(2));
          setNote(null);
          setOpen((value) => !value);
        }}
      />
      {open ? (
        <form className="phone-pro-fit__form" onSubmit={submit} noValidate>
          <label className="phone-pro-fit__label">
            <span>Length in seconds</span>
            <input
              className="phone-pro-fit__input"
              type="text"
              inputMode="decimal"
              enterKeyHint="done"
              autoComplete="off"
              data-testid={IDS.fitLengthInput}
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          </label>
          <button type="submit" className="phone-pro-fit__apply" data-testid={IDS.fitLengthApply} onPointerUp={blurAfterPointer}>
            Fit
          </button>
          {note ? <p className="phone-pro-fit__note" role="status">{note}</p> : null}
        </form>
      ) : null}
    </div>
  );
}
