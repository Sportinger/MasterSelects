import type { KeyboardEvent, RefObject } from 'react';
import { FlashBoardElevenLabsVoicePanel } from './FlashBoardElevenLabsVoicePanel';
import { FlashBoardSunoTuningPanel } from './FlashBoardSunoTuningPanel';

interface FlashBoardPromptEditorProps {
  canRestorePrompt: boolean;
  chatInputRef: RefObject<HTMLTextAreaElement | null>;
  chatPanelOpen: boolean;
  chatPrompt: string;
  elevenLabsVoicePanel: {
    emptyMessage: string;
    error: string | null;
    isLoading: boolean;
    search: string;
    selectedVoiceId: string;
    voiceId: string;
    voiceName: string;
    voices: Array<{ id: string; name: string; meta: string; previewUrl?: string }>;
    onPreviewVoice: (previewUrl: string | undefined) => void;
    onRefresh: () => void;
    onSearchChange: (value: string) => void;
    onSelectVoice: (voiceId: string) => void;
    onVoiceIdChange: (value: string) => void;
    onVoiceNameChange: (value: string) => void;
  };
  isAudioMode: boolean;
  isElevenLabsMode: boolean;
  isRefiningPrompt: boolean;
  isSunoMode: boolean;
  maxReferenceMedia?: number;
  multiShots: boolean;
  prompt: string;
  promptBeforeAiRewrite: string | null;
  promptInputRef: RefObject<HTMLTextAreaElement | null>;
  promptRefineTitle: string;
  referenceMediaCount: number;
  sunoNegativeTags: string;
  sunoStyle: string;
  sunoStyleLimit: number;
  sunoAudioReferenceActive: boolean;
  sunoAudioWeight: number;
  sunoStyleWeight: number;
  sunoWeirdnessConstraint: number;
  onAutosizeInput: (textarea: HTMLTextAreaElement | null) => void;
  onChatInputKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onChatPromptChange: (value: string) => void;
  onClearChatPrompt: () => void;
  onClearPrompt: () => void;
  onDismissPromptBeforeAiRewrite: () => void;
  onPromptChange: (value: string) => void;
  onRefinePrompt: () => void | Promise<void>;
  onRestorePromptBeforeAiRewrite: () => void;
  onSunoNegativeTagsChange: (value: string) => void;
  onSunoAudioWeightChange: (value: number) => void;
  onSunoResetTuning: () => void;
  onSunoStyleChange: (value: string) => void;
  onSunoStyleWeightChange: (value: number) => void;
  onSunoWeirdnessConstraintChange: (value: number) => void;
}

export function FlashBoardPromptEditor({
  canRestorePrompt,
  chatInputRef,
  chatPanelOpen,
  chatPrompt,
  elevenLabsVoicePanel,
  isAudioMode,
  isElevenLabsMode,
  isRefiningPrompt,
  isSunoMode,
  maxReferenceMedia,
  multiShots,
  prompt,
  promptBeforeAiRewrite,
  promptInputRef,
  promptRefineTitle,
  referenceMediaCount,
  sunoNegativeTags,
  sunoStyle,
  sunoStyleLimit,
  sunoAudioReferenceActive,
  sunoAudioWeight,
  sunoStyleWeight,
  sunoWeirdnessConstraint,
  onAutosizeInput,
  onChatInputKeyDown,
  onChatPromptChange,
  onClearChatPrompt,
  onClearPrompt,
  onDismissPromptBeforeAiRewrite,
  onPromptChange,
  onRefinePrompt,
  onRestorePromptBeforeAiRewrite,
  onSunoNegativeTagsChange,
  onSunoAudioWeightChange,
  onSunoResetTuning,
  onSunoStyleChange,
  onSunoStyleWeightChange,
  onSunoWeirdnessConstraintChange,
}: FlashBoardPromptEditorProps) {
  const showPromptBeforeAiRewrite = Boolean(
    promptBeforeAiRewrite?.trim()
    && promptBeforeAiRewrite.trim() !== prompt.trim(),
  );
  const showMagicPrompt = showPromptBeforeAiRewrite && prompt.trim().length > 0;
  const promptInputClassName = `fb-bubble-input ${showMagicPrompt && !isRefiningPrompt ? 'has-magic-prompt' : ''}`;
  const resizePromptOnFocusChange = (textarea: HTMLTextAreaElement) => {
    requestAnimationFrame(() => onAutosizeInput(textarea));
  };

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
      {showPromptBeforeAiRewrite && (
        <div className="fb-original-prompt">
          <div className="fb-original-prompt-header">
            <span>Original</span>
            <div className="fb-original-prompt-actions">
              <button
                type="button"
                onClick={onRestorePromptBeforeAiRewrite}
                title="Restore original prompt"
                aria-label="Restore original prompt"
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                  <path d="M6.2 4.1H2.8V.8" />
                  <path d="M3 4.1A6 6 0 1 1 2.2 9" />
                  <path d="M8 5.2v3.1l2.1 1.2" />
                </svg>
              </button>
              <button
                type="button"
                onClick={onDismissPromptBeforeAiRewrite}
                title="Hide original prompt"
                aria-label="Hide original prompt"
              >
                &times;
              </button>
            </div>
          </div>
          <div className="fb-original-prompt-text" tabIndex={0} aria-label="Original prompt">
            {promptBeforeAiRewrite}
          </div>
        </div>
      )}
      <div className={`fb-bubble-row ${isSunoMode ? 'fb-bubble-row-suno' : ''} ${isElevenLabsMode ? 'fb-bubble-row-elevenlabs' : ''}`}>
        {isSunoMode ? (
          <div className="fb-suno-prompt-grid">
            <FlashBoardSunoTuningPanel
              audioReferenceActive={sunoAudioReferenceActive}
              audioWeight={sunoAudioWeight}
              styleWeight={sunoStyleWeight}
              weirdnessConstraint={sunoWeirdnessConstraint}
              onAudioWeightChange={onSunoAudioWeightChange}
              onResetTuning={onSunoResetTuning}
              onStyleWeightChange={onSunoStyleWeightChange}
              onWeirdnessConstraintChange={onSunoWeirdnessConstraintChange}
            />
            <label className="fb-suno-prompt-field fb-suno-prompt-field-lyrics">
              <span>Lyrics</span>
              <textarea
                ref={promptInputRef}
                className={`${promptInputClassName} fb-suno-input fb-suno-lyrics-input`}
                value={prompt}
                onFocus={(event) => resizePromptOnFocusChange(event.currentTarget)}
                onBlur={(event) => resizePromptOnFocusChange(event.currentTarget)}
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
          <div className={`fb-standard-prompt-stack ${isElevenLabsMode ? 'is-elevenlabs' : ''}`}>
            {isElevenLabsMode && <FlashBoardElevenLabsVoicePanel {...elevenLabsVoicePanel} />}
            <textarea
              ref={promptInputRef}
              className={promptInputClassName}
              value={prompt}
              onFocus={(event) => resizePromptOnFocusChange(event.currentTarget)}
              onBlur={(event) => resizePromptOnFocusChange(event.currentTarget)}
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
          </div>
        )}
        {canRestorePrompt && !showPromptBeforeAiRewrite && (
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
        {!isElevenLabsMode && (
          <button
            className={`fb-bubble-wand ${isRefiningPrompt ? 'is-loading' : ''}`}
            type="button"
            onClick={onRefinePrompt}
            disabled={isRefiningPrompt}
            title={isRefiningPrompt ? 'Refining prompt...' : promptRefineTitle}
            aria-label="Refine prompt"
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.45" aria-hidden="true">
              <path d="M5.5 12.5 13 5" />
              <path d="m10.8 3.2 2 2" />
              <path d="M2.8 1.6 3.3 3l1.5.5-1.5.5-.5 1.4L2.3 4 1 3.5 2.3 3l.5-1.4Z" />
              <path d="m11.8 9.7.4 1.1 1.1.4-1.1.4-.4 1.1-.4-1.1-1.1-.4 1.1-.4.4-1.1Z" />
            </svg>
          </button>
        )}
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
