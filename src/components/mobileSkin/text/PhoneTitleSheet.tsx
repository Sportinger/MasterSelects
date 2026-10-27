// 'title' sheet: type a title in the row docked above the on-screen keyboard (the sheet itself
// rides on --phone-keyboard-inset). Typing previews the text live in the composition inside one
// owned, cancellable transaction (usePhoneTitleCommands); Done or the check button commits it as
// ONE undo step: a new title at the playhead, or the selected text clip updated. Cancel discards.
// Styling tabs are visible but greyed out until text styling ships on the phone.

import { useState, type KeyboardEvent } from 'react';

import { PHONE_M1_TEST_IDS, phoneActionTestId, type PhoneSheetComponent } from '../contracts';
import { PhoneSheet } from '../sheets/PhoneSheet';
import { PhoneIcon } from '../shell/phoneIcons';
import { usePhoneUiStore } from '../state/phoneUiStore';
import { usePhoneTitleCommands } from './usePhoneTitleCommands';

const STYLE_TABS = ['Font', 'Style', 'Outline / Shadow', 'Animation'] as const;
const STYLE_REASON = 'Text styling is not on the phone yet; it arrives with the design tools (M2). The title uses the default text style until then.';

export const PhoneTitleSheet: PhoneSheetComponent = () => {
  const closeSheet = usePhoneUiStore((state) => state.closeSheet);
  const showToast = usePhoneUiStore((state) => state.showToast);
  const showUnavailable = usePhoneUiStore((state) => state.showUnavailable);
  const session = usePhoneTitleCommands();
  const [text, setText] = useState(session.originalText);
  const [multiline, setMultiline] = useState(session.originalText.includes('\n'));
  const [busy, setBusy] = useState(false);
  const empty = text.trim() === '';

  const onChange = (value: string) => {
    const next = multiline ? value : value.replace(/\r?\n/g, ' ');
    setText(next);
    void session.preview(next);
  };

  const done = async () => {
    if (busy) return;
    if (empty) {
      showToast('Type a title first.', 'info');
      return;
    }
    setBusy(true);
    const result = await session.commit(text);
    closeSheet();
    if (!result.ok) showToast(result.message, 'error');
  };

  const cancel = () => {
    if (busy) return;
    session.cancel();
    closeSheet();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !multiline && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void done();
    }
  };

  const status = session.mode === 'edit' ? 'Editing the selected title' : 'New title at the playhead';

  return (
    <PhoneSheet
      title={session.mode === 'edit' ? 'Edit title' : 'Add title'}
      onCancel={cancel}
      onDone={() => { void done(); }}
      doneDisabled={empty || busy}
    >
      <div className="phone-title-sheet">
        <p className="phone-title-sheet__status">{status} · the preview updates while you type.</p>
        <div className="phone-title-sheet__tabs" role="group" aria-label="Text styling">
          {STYLE_TABS.map((label) => (
            <button
              key={label}
              type="button"
              className="phone-title-sheet__tab"
              aria-disabled="true"
              data-testid={phoneActionTestId(`title-${label.toLowerCase().replace(/[^a-z]+/g, '-')}`)}
              onClick={() => showUnavailable({ actionId: `title-${label}`, label, reason: STYLE_REASON })}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="phone-title-sheet__input-row">
          <textarea
            className="phone-title-sheet__input"
            data-testid={PHONE_M1_TEST_IDS.titleInput}
            aria-label="Title text"
            placeholder="Type your title"
            rows={multiline ? 3 : 1}
            value={text}
            autoFocus
            enterKeyHint={multiline ? 'enter' : 'done'}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={onKeyDown}
          />
          <button
            type="button"
            className="phone-title-sheet__toggle"
            aria-pressed={multiline}
            aria-label={multiline ? 'Single line' : 'Multiple lines'}
            title={multiline ? 'Single line' : 'Multiple lines'}
            onClick={() => setMultiline((value) => !value)}
          >
            ¶
          </button>
          <button
            type="button"
            className="phone-title-sheet__commit"
            aria-label="Done"
            aria-disabled={empty || busy}
            onClick={() => { void done(); }}
          >
            <PhoneIcon name="check" />
          </button>
        </div>
      </div>
    </PhoneSheet>
  );
};
