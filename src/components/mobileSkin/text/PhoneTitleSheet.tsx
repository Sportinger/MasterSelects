// 'title' sheet: type a title in the row docked above the on-screen keyboard (the sheet itself
// rides on --phone-keyboard-inset). Typing previews the text live in the composition inside one
// owned, cancellable transaction (usePhoneTitleCommands); Done or the check button commits it as
// ONE undo step: a new title at the playhead, or the selected text clip updated. Cancel discards.
// The style tabs (Font, Color, Outline, Shadow, Align) edit the same draft live inside that
// transaction; editing a selected title starts from its style at the playhead. Box and Animation
// stay visible but greyed out with their reason (owner rule).

import { useState, type KeyboardEvent } from 'react';

import { PHONE_M1_TEST_IDS, type PhoneSheetComponent } from '../contracts';
import { PhoneSheet } from '../sheets/PhoneSheet';
import { PhoneIcon } from '../shell/phoneIcons';
import { usePhoneUiStore } from '../state/phoneUiStore';
import { blurAfterPointer } from './phoneControls';
import type { PhoneTextStyle } from './phoneTextStyle';
import {
  PhoneTextAlignPanel, PhoneTextColorPanel, PhoneTextFontPanel, PhoneTextOutlinePanel, PhoneTextShadowPanel,
} from './PhoneTextStylePanels';
import { PHONE_TEXT_STYLE_TABS, PHONE_TEXT_TEST_IDS, phoneTextTabTestId, type PhoneTextStyleTab } from './phoneTextTestIds';
import { usePhoneTitleCommands } from './usePhoneTitleCommands';
import './PhoneTitleSheet.css';

const TAB_LABELS: Record<PhoneTextStyleTab, string> = {
  font: 'Font', color: 'Color', outline: 'Outline', shadow: 'Shadow', box: 'Box', align: 'Align', animation: 'Animation',
};
const UNAVAILABLE_TABS: Partial<Record<PhoneTextStyleTab, string>> = {
  box: 'A filled box behind the text is not in the MasterSelects text engine yet: titles have fill, outline and shadow. For a backdrop, put a colour clip or shape under the title in the full editor.',
  animation: 'Title animation is in the clip tools: tap Done, keep the title selected and tap Animation (In, Out, Combo and character Reveal).',
};

export const PhoneTitleSheet: PhoneSheetComponent = () => {
  const closeSheet = usePhoneUiStore((state) => state.closeSheet);
  const showToast = usePhoneUiStore((state) => state.showToast);
  const showUnavailable = usePhoneUiStore((state) => state.showUnavailable);
  const session = usePhoneTitleCommands();
  const [text, setText] = useState(session.originalText);
  const [style, setStyle] = useState<PhoneTextStyle>(session.originalStyle);
  const [tab, setTab] = useState<PhoneTextStyleTab | null>(null);
  const [multiline, setMultiline] = useState(session.originalText.includes('\n'));
  const [busy, setBusy] = useState(false);
  const empty = text.trim() === '';

  const onChange = (value: string) => {
    const next = multiline ? value : value.replace(/\r?\n/g, ' ');
    setText(next);
    void session.preview(next, style);
  };

  const onStyle = (next: PhoneTextStyle) => {
    setStyle(next);
    void session.preview(text, next);
  };

  const onTab = (next: PhoneTextStyleTab) => {
    const reason = UNAVAILABLE_TABS[next];
    if (reason) {
      showUnavailable({ actionId: `title-${next}`, label: TAB_LABELS[next], reason });
      return;
    }
    // Close the keyboard so the panel has room above it; the text row stays below.
    if (document.activeElement instanceof HTMLTextAreaElement) document.activeElement.blur();
    setTab((current) => (current === next ? null : next));
  };

  const done = async () => {
    if (busy) return;
    if (empty) {
      showToast('Type a title first.', 'info');
      return;
    }
    setBusy(true);
    const result = await session.commit(text, style);
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
        <div className="phone-title-sheet__tabs" role="tablist" aria-label="Text style">
          {PHONE_TEXT_STYLE_TABS.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              className="phone-title-sheet__tab"
              aria-selected={tab === id}
              aria-disabled={UNAVAILABLE_TABS[id] ? 'true' : undefined}
              data-testid={phoneTextTabTestId(id)}
              onPointerUp={blurAfterPointer}
              onClick={() => onTab(id)}
            >
              {TAB_LABELS[id]}
            </button>
          ))}
        </div>
        {tab && (
          <div className="phone-title-sheet__panel" role="tabpanel" aria-label={TAB_LABELS[tab]} data-testid={`${PHONE_TEXT_TEST_IDS.panel}-${tab}`}>
            {tab === 'font' && <PhoneTextFontPanel style={style} onChange={onStyle} />}
            {tab === 'color' && <PhoneTextColorPanel style={style} onChange={onStyle} />}
            {tab === 'outline' && <PhoneTextOutlinePanel style={style} onChange={onStyle} />}
            {tab === 'shadow' && <PhoneTextShadowPanel style={style} onChange={onStyle} />}
            {tab === 'align' && <PhoneTextAlignPanel style={style} onChange={onStyle} />}
            {session.mode === 'create' && empty && (
              <p className="phone-design-note">Type the title below to see the style in the preview.</p>
            )}
          </div>
        )}
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
