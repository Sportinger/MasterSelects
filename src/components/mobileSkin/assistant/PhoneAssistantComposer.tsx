// Bottom of the assistant sheet: the live progress line of a running request, Undo after a finished
// one, the message line (errors, reasons) and the prompt field with Send, which becomes Stop while a
// request runs. Stays above the keyboard: the sheet itself moves up with --phone-keyboard-inset.

import { useEffect, useState, type KeyboardEvent, type PointerEvent } from 'react';

import type { FlashBoardChatMessage } from '../../../stores/flashboardStore';
import { formatPhoneElapsed, phoneProgressLine, type PhoneUndoOffer } from './phoneAssistantModel';
import { PHONE_ASSISTANT_TEST_IDS as IDS } from './phoneAssistantTestIds';

function blurAfterPointer(event: PointerEvent<HTMLElement>): void {
  event.currentTarget.blur();
}

function ProgressLine({ pending }: { pending: FlashBoardChatMessage | undefined }) {
  const [now, setNow] = useState(() => Date.now());
  const [fallbackStart] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const started = pending?.createdAt ?? fallbackStart;
  return (
    <div className="phone-assistant__progress" data-testid={IDS.progress} role="status" aria-live="polite">
      <span className="phone-assistant__spinner" aria-hidden="true" />
      <span className="phone-assistant__progress-text">{phoneProgressLine(pending) || 'Working…'}</span>
      <span className="phone-assistant__progress-time">{formatPhoneElapsed(now - started)}</span>
    </div>
  );
}

interface PhoneAssistantComposerProps {
  isChatting: boolean;
  pending: FlashBoardChatMessage | undefined;
  prompt: string;
  blocked: boolean;
  error: string | null;
  undoOffer: PhoneUndoOffer | null;
  onPromptChange: (value: string) => void;
  onPromptKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onSend: () => void;
  onUndo: () => void;
}

export function PhoneAssistantComposer({
  isChatting, pending, prompt, blocked, error, undoOffer, onPromptChange, onPromptKeyDown, onSend, onUndo,
}: PhoneAssistantComposerProps) {
  const sendDisabled = !isChatting && (blocked || !prompt.trim());
  return (
    <div className="phone-assistant__composer">
      {isChatting ? <ProgressLine pending={pending} /> : null}
      {!isChatting && undoOffer ? (
        <div className="phone-assistant__undo-row">
          <button
            type="button"
            className="phone-assistant__undo"
            data-testid={IDS.undo}
            data-kind={undoOffer.kind}
            data-steps={undoOffer.steps}
            onPointerUp={blurAfterPointer}
            onClick={onUndo}
          >
            {undoOffer.label}
          </button>
          <span className="phone-assistant__undo-hint" data-testid={IDS.undoHint}>{undoOffer.hint}</span>
        </div>
      ) : null}
      {error ? <p className="phone-assistant__error" data-testid={IDS.error} role="alert">{error}</p> : null}
      <div className="phone-assistant__input-row">
        <textarea
          className="phone-assistant__prompt"
          data-testid={IDS.prompt}
          aria-label="Ask the assistant"
          placeholder="Ask for an edit…"
          rows={2}
          enterKeyHint="send"
          value={prompt}
          onChange={(event) => onPromptChange(event.target.value)}
          onKeyDown={onPromptKeyDown}
        />
        <button
          type="button"
          className="phone-assistant__send"
          data-testid={IDS.send}
          data-state={isChatting ? 'stop' : 'send'}
          aria-disabled={sendDisabled}
          onPointerUp={blurAfterPointer}
          onClick={onSend}
        >
          {isChatting ? 'Stop' : 'Send'}
        </button>
      </div>
    </div>
  );
}
