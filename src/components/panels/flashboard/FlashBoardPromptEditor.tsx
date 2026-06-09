import type { KeyboardEvent, RefObject } from 'react';

interface FlashBoardPromptEditorProps {
  canRestorePrompt: boolean;
  chatInputRef: RefObject<HTMLTextAreaElement | null>;
  chatPanelOpen: boolean;
  chatPrompt: string;
  isAudioMode: boolean;
  isRefiningPrompt: boolean;
  isSunoMode: boolean;
  maxReferenceMedia?: number;
  multiShots: boolean;
  prompt: string;
  promptInputRef: RefObject<HTMLTextAreaElement | null>;
  referenceMediaCount: number;
  sunoNegativeTags: string;
  sunoStyle: string;
  sunoStyleLimit: number;
  onAutosizeInput: (textarea: HTMLTextAreaElement | null) => void;
  onChatInputKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onChatPromptChange: (value: string) => void;
  onClearChatPrompt: () => void;
  onClearPrompt: () => void;
  onPromptChange: (value: string) => void;
  onRestorePromptBeforeAiRewrite: () => void;
  onSunoNegativeTagsChange: (value: string) => void;
  onSunoStyleChange: (value: string) => void;
}

export function FlashBoardPromptEditor({
  canRestorePrompt,
  chatInputRef,
  chatPanelOpen,
  chatPrompt,
  isAudioMode,
  isRefiningPrompt,
  isSunoMode,
  maxReferenceMedia,
  multiShots,
  prompt,
  promptInputRef,
  referenceMediaCount,
  sunoNegativeTags,
  sunoStyle,
  sunoStyleLimit,
  onAutosizeInput,
  onChatInputKeyDown,
  onChatPromptChange,
  onClearChatPrompt,
  onClearPrompt,
  onPromptChange,
  onRestorePromptBeforeAiRewrite,
  onSunoNegativeTagsChange,
  onSunoStyleChange,
}: FlashBoardPromptEditorProps) {
  if (chatPanelOpen) {
    return (
      <div className="fb-bubble-prompt fb-chat-prompt-window">
        <div className="fb-bubble-row">
          <textarea
            ref={chatInputRef}
            className="fb-bubble-input fb-chat-input"
            value={chatPrompt}
            onInput={(event) => onAutosizeInput(event.currentTarget)}
            onKeyDown={onChatInputKeyDown}
            onChange={(event) => onChatPromptChange(event.target.value)}
            placeholder="Ask about the prompt, model choice, or next variation..."
            rows={3}
          />
          <button
            className="fb-bubble-close"
            type="button"
            onClick={onClearChatPrompt}
            title="Clear chat prompt"
          >
            &times;
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`fb-bubble-prompt ${isRefiningPrompt ? 'is-refining' : ''}`}>
      <div className={`fb-bubble-row ${isSunoMode ? 'fb-bubble-row-suno' : ''}`}>
        {isSunoMode ? (
          <div className="fb-suno-prompt-grid">
            <label className="fb-suno-prompt-field fb-suno-prompt-field-lyrics">
              <span>Lyrics</span>
              <textarea
                ref={promptInputRef}
                className="fb-bubble-input fb-suno-input fb-suno-lyrics-input"
                value={prompt}
                onInput={(event) => onAutosizeInput(event.currentTarget)}
                onChange={(event) => onPromptChange(event.target.value)}
                placeholder="Lyrics, song idea, mood, or background music..."
                rows={3}
              />
            </label>
            <label className="fb-suno-prompt-field">
              <span>Style</span>
              <textarea
                className="fb-bubble-input fb-suno-input"
                value={sunoStyle}
                onChange={(event) => onSunoStyleChange(event.target.value)}
                placeholder="cinematic synthwave, ambient piano..."
                maxLength={sunoStyleLimit}
                rows={2}
              />
            </label>
            <label className="fb-suno-prompt-field">
              <span>Negative</span>
              <textarea
                className="fb-bubble-input fb-suno-input"
                value={sunoNegativeTags}
                onChange={(event) => onSunoNegativeTagsChange(event.target.value)}
                placeholder="distorted vocals, harsh noise..."
                maxLength={500}
                rows={2}
              />
            </label>
          </div>
        ) : (
          <textarea
            ref={promptInputRef}
            className="fb-bubble-input"
            value={prompt}
            onInput={(event) => onAutosizeInput(event.currentTarget)}
            onChange={(event) => onPromptChange(event.target.value)}
            placeholder={
              isAudioMode
                ? 'Text to speak...'
                : multiShots
                  ? 'Overall scene or style (optional when using multishot)...'
                  : 'Describe what to generate...'
            }
            rows={isAudioMode ? 2 : multiShots ? 3 : 2}
          />
        )}
        {canRestorePrompt && (
          <button
            className="fb-bubble-rewind"
            type="button"
            onClick={onRestorePromptBeforeAiRewrite}
            title="Restore prompt before AI rewrite"
            aria-label="Restore prompt before AI rewrite"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
              <path d="M6.2 4.1H2.8V.8" />
              <path d="M3 4.1A6 6 0 1 1 2.2 9" />
              <path d="M8 5.2v3.1l2.1 1.2" />
            </svg>
          </button>
        )}
        <button
          className="fb-bubble-close"
          type="button"
          onClick={onClearPrompt}
          title="Clear"
        >
          &times;
        </button>
      </div>

      {referenceMediaCount > 0 && (
        <div className="fb-bubble-reference-hint">
          Use REF 1, REF 2, ... in the prompt. {referenceMediaCount}
          {typeof maxReferenceMedia === 'number' ? `/${maxReferenceMedia}` : ''} linked.
        </div>
      )}
    </div>
  );
}
