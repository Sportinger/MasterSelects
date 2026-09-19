import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type DecisionPolicy,
  type FlashBoardChatAgentMode,
} from '../../../services/flashboard/FlashBoardChatService';
import { setFlashBoardGuidedMode } from '../../../services/flashboard/FlashBoardGuidedMode';
import { useFlashBoardStore } from '../../../stores/flashboardStore';
import { useMediaStore } from '../../../stores/mediaStore';
import {
  PromptDictationButton,
  appendPromptDictationText,
} from '../../common/PromptDictationButton';
import { FlashBoardChatOutput } from '../flashboard/FlashBoardChatOutput';
import { FLASHBOARD_CHAT_AGENT_OPTIONS } from '../flashboard/flashBoardChatAgentOptions';
import { FlashBoardPromptBook } from '../flashboard/FlashBoardPromptBook';
import { useFlashBoardChatController } from '../flashboard/useFlashBoardChatController';
import { useFlashBoardChatHistoryScroll } from '../flashboard/useFlashBoardChatHistoryScroll';
import { useFlashBoardComposerAccessState } from '../flashboard/useFlashBoardComposerAccessState';
import {
  AIStudioComposerBar,
  AIStudioPill,
  AIStudioPillRow,
  AIStudioPromptCapsule,
  AIStudioSplitButton,
} from './AIStudioComposerBar';
import { AIStudioMetaballStage } from './AIStudioMetaballStage';
import '../flashboard/FlashBoard.css';
import './AIStudioChat.css';

type ChatComposerMenu = 'model' | 'route' | null;

function agentModeLabel(mode: FlashBoardChatAgentMode): string {
  if (mode === 'direct') return 'Codex Direct';
  if (mode === 'logic') return 'Logic';
  return 'Fast';
}

export function AIStudioChat() {
  const promptHistory = useFlashBoardStore((state) => state.promptHistory);
  const generationRecords = useFlashBoardStore((state) => state.activeGenerationRecords);
  const mediaFiles = useMediaStore((state) => state.files);
  const [promptBookOpen, setPromptBookOpen] = useState(false);
  const [activeMenu, setActiveMenu] = useState<ChatComposerMenu>(null);
  const [copiedPromptBookEntryId, setCopiedPromptBookEntryId] = useState<string | null>(null);
  const copiedPromptBookResetRef = useRef<number | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const chatPromptRef = useRef('');
  const composerRef = useRef<HTMLDivElement | null>(null);
  const closePopover = useCallback(() => setActiveMenu(null), []);
  const {
    hasHostedSession,
    hostedAIEnabled,
    openAuthDialog,
    openPricingDialog,
  } = useFlashBoardComposerAccessState();
  const {
    chatAgentMode,
    chatButtonLabel,
    chatChargeTitle,
    chatError,
    chatMessages,
    chatPrompt,
    copiedChatMessageId,
    decisionPolicy,
    handleChatAgentModeSelect,
    handleChatButtonClick,
    handleChatInputKeyDown,
    handleChatMessageDoubleClick,
    handleChatPromptChange,
    handleClearChatHistory,
    handleDecisionPolicyChange,
    handleStoryboardDecisionSubmit,
    isChatting,
    showChatCloudActions,
  } = useFlashBoardChatController({
    closePopover,
    hasHostedSession,
    hostedAIEnabled,
    initialMode: 'chat',
    openAuthDialog,
    openPricingDialog,
  });
  const chatHistoryRef = useFlashBoardChatHistoryScroll({ chatError, chatMessages });
  const storySelected = decisionPolicy !== 'automatic';
  const automaticPathLabel = import.meta.env.DEV ? 'Direkt' : 'Auto';
  chatPromptRef.current = chatPrompt;

  useEffect(() => {
    const animationFrameId = window.requestAnimationFrame(() => {
      const history = chatHistoryRef.current;
      if (history) history.scrollTop = history.scrollHeight;
    });
    return () => window.cancelAnimationFrame(animationFrameId);
  }, [chatError, chatHistoryRef, chatMessages]);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = '0px';
    input.style.height = `${Math.min(132, input.scrollHeight)}px`;
  }, [chatPrompt]);

  useEffect(() => {
    if (!activeMenu) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!composerRef.current?.contains(event.target as Node)) closePopover();
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [activeMenu, closePopover]);

  useEffect(() => () => {
    if (copiedPromptBookResetRef.current !== null) {
      window.clearTimeout(copiedPromptBookResetRef.current);
    }
  }, []);

  const handlePromptBookCopy = (prompt: string, entryId: string) => {
    if (!navigator.clipboard?.writeText) return;
    void navigator.clipboard.writeText(prompt).then(() => {
      setCopiedPromptBookEntryId(entryId);
      if (copiedPromptBookResetRef.current !== null) {
        window.clearTimeout(copiedPromptBookResetRef.current);
      }
      copiedPromptBookResetRef.current = window.setTimeout(() => {
        setCopiedPromptBookEntryId(null);
        copiedPromptBookResetRef.current = null;
      }, 1200);
    });
  };

  const selectAgentMode = (mode: FlashBoardChatAgentMode) => {
    handleChatAgentModeSelect(mode);
    closePopover();
  };

  const selectRoute = (policy: DecisionPolicy) => {
    setFlashBoardGuidedMode(policy !== 'automatic');
    handleDecisionPolicyChange(policy);
    closePopover();
  };

  const startChat = () => {
    setFlashBoardGuidedMode(storySelected);
    void handleChatButtonClick();
  };

  const appendDictation = useCallback((transcript: string) => {
    const nextPrompt = appendPromptDictationText(chatPromptRef.current, transcript);
    chatPromptRef.current = nextPrompt;
    handleChatPromptChange(nextPrompt);
    inputRef.current?.focus();
  }, [handleChatPromptChange]);

  return (
    <>
      <AIStudioMetaballStage
        showTileScale={false}
        content={(
          <section className="ai-studio-chat" aria-label="AI chat">
            <div className="ai-studio-chat-history">
              <FlashBoardChatOutput
                chatError={chatError}
                chatHistoryRef={chatHistoryRef}
                copiedChatMessageId={copiedChatMessageId}
                messages={chatMessages}
                isChatting={isChatting}
                showChatCloudActions={showChatCloudActions}
                onAuthClick={openAuthDialog}
                onDecisionSubmit={handleStoryboardDecisionSubmit}
                onMessageDoubleClick={handleChatMessageDoubleClick}
                onPricingClick={openPricingDialog}
              />
            </div>
          </section>
        )}
        controls={(
          <AIStudioComposerBar className="ai-studio-chat-control-bar" contentRef={composerRef}>
            <AIStudioPillRow>
              <AIStudioPill
                aria-expanded={activeMenu === 'model'}
                aria-haspopup="menu"
                className={activeMenu === 'model' ? 'active' : ''}
                disabled={isChatting}
                onClick={() => setActiveMenu((menu) => menu === 'model' ? null : 'model')}
                title={`Model: ${agentModeLabel(chatAgentMode)}`}
              >
                Model
              </AIStudioPill>
              <AIStudioPill onClick={() => setPromptBookOpen(true)} title="Open chat Prompt Book">
                Prompt Book
              </AIStudioPill>
              <AIStudioPill
                disabled={!chatMessages.length && !chatPrompt && !chatError}
                onClick={handleClearChatHistory}
                title="Clear chat history and start a new chat"
              >
                New
              </AIStudioPill>
            </AIStudioPillRow>

            <AIStudioPromptCapsule>
              <span aria-hidden="true">
                <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.45">
                  <path d="M5.5 12.5 13 5" />
                  <path d="m10.8 3.2 2 2" />
                  <path d="M2.8 1.6 3.3 3l1.5.5-1.5.5-.5 1.4L2.3 4 1 3.5 2.3 3l.5-1.4Z" />
                </svg>
              </span>
              <textarea
                aria-label="Chat message"
                onChange={(event) => {
                  chatPromptRef.current = event.currentTarget.value;
                  handleChatPromptChange(event.currentTarget.value);
                }}
                onKeyDown={handleChatInputKeyDown}
                placeholder="Ask AI anything…"
                ref={inputRef}
                rows={1}
                value={chatPrompt}
              />
              <PromptDictationButton onTranscript={appendDictation} />
            </AIStudioPromptCapsule>

            <AIStudioSplitButton>
              <div className="ai-studio-chat-route-choice">
                <button
                  aria-expanded={activeMenu === 'route'}
                  aria-haspopup="menu"
                  disabled={isChatting}
                  onClick={() => setActiveMenu((menu) => menu === 'route' ? null : 'route')}
                  title="Choose the path for the current prompt"
                  type="button"
                >
                  <span>{storySelected ? 'Story' : automaticPathLabel}</span>
                  <span aria-hidden="true">⌄</span>
                </button>
                {activeMenu === 'route' && (
                  <div className="ai-studio-chat-route-menu" role="menu" aria-label="Prompt path">
                    <button
                      aria-checked={!storySelected}
                      className={!storySelected ? 'active' : ''}
                      onClick={() => selectRoute('automatic')}
                      role="menuitemradio"
                      type="button"
                    >
                      {automaticPathLabel}
                    </button>
                    <button
                      aria-checked={storySelected}
                      className={storySelected ? 'active' : ''}
                      onClick={() => selectRoute('milestones')}
                      role="menuitemradio"
                      type="button"
                    >
                      Story
                    </button>
                  </div>
                )}
              </div>
              <button
                onClick={startChat}
                title={chatChargeTitle ?? 'Send chat message'}
                type="button"
              >
                <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                  <path d="M3.4 3.5h9.2a1.8 1.8 0 0 1 1.8 1.8v4.4a1.8 1.8 0 0 1-1.8 1.8H7.2L3.6 14v-2.5h-.2a1.8 1.8 0 0 1-1.8-1.8V5.3a1.8 1.8 0 0 1 1.8-1.8Z" />
                  <path d="M5 6.5h6M5 8.9h4" />
                </svg>
                <span>{chatButtonLabel}</span>
              </button>
            </AIStudioSplitButton>

            {activeMenu === 'model' && (
              <div className="ai-studio-control-popover ai-studio-chat-model-menu" role="menu" aria-label="Chat model route">
                <div className="ai-studio-control-popover-title">Model</div>
                <div className="ai-studio-control-popover-options">
                  {FLASHBOARD_CHAT_AGENT_OPTIONS.map((option) => {
                    return (
                      <button
                        aria-checked={chatAgentMode === option.id}
                        className={chatAgentMode === option.id ? 'active' : ''}
                        disabled={isChatting}
                        key={option.id}
                        onClick={() => selectAgentMode(option.id)}
                        role="menuitemradio"
                        title={option.title}
                        type="button"
                      >
                        <span>{option.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </AIStudioComposerBar>
        )}
      />

      {promptBookOpen && (
        <FlashBoardPromptBook
          chatMessages={chatMessages}
          copiedEntryId={copiedPromptBookEntryId}
          entries={promptHistory}
          generationRecords={generationRecords}
          initialKind="chat"
          mediaFiles={mediaFiles}
          onClose={() => setPromptBookOpen(false)}
          onCopy={handlePromptBookCopy}
        />
      )}
    </>
  );
}
