import type { RefObject } from 'react';
import type {
  FlashBoardChatModelClass,
  FlashBoardChatProvider,
  FlashBoardChatProviderOption,
} from '../../../services/flashboard/FlashBoardChatService';

type ChatControlsPopover = 'chatProvider' | 'chatModelClass';
type RenderedPopover = string | null;
type ModelClassAvailabilityStatus = 'idle' | 'loading' | 'ready' | 'unavailable';

const MODEL_CLASS_OPTIONS = [
  {
    id: 'very-fast',
    label: 'Very Fast',
    title: 'Very Fast: lowest latency with lighter reasoning.',
  },
  {
    id: 'fast',
    label: 'Fast',
    title: 'Fast: balanced latency and reasoning on priority service.',
  },
  {
    id: 'slow',
    label: 'Slow',
    title: 'Slow: deepest reasoning on priority service.',
  },
] as const satisfies ReadonlyArray<{
  id: FlashBoardChatModelClass;
  label: string;
  title: string;
}>;

export const FLASHBOARD_CHAT_MODEL_CLASS_OPTION_COUNT = MODEL_CLASS_OPTIONS.length;

function modelClassLabel(modelClass: FlashBoardChatModelClass): string {
  return MODEL_CLASS_OPTIONS.find((option) => option.id === modelClass)?.label ?? 'Fast';
}

interface FlashBoardChatControlsProps {
  activePopover: RenderedPopover;
  availableChatModelClasses: readonly FlashBoardChatModelClass[];
  chatError: string | null;
  chatModelClass: FlashBoardChatModelClass;
  chatModelClassAvailabilityStatus: ModelClassAvailabilityStatus;
  chatPrompt: string;
  chatProvider: FlashBoardChatProvider;
  chatProviderLabel: string;
  chatProviderOptions: FlashBoardChatProviderOption[];
  hasChatMessages: boolean;
  isChatting: boolean;
  popoverHostClassName: string;
  popoverRef: RefObject<HTMLDivElement | null>;
  renderedPopover: RenderedPopover;
  showChatModelClass: boolean;
  onChatModelClassSelect: (modelClass: FlashBoardChatModelClass) => void;
  onChatProviderSelect: (provider: FlashBoardChatProvider) => void;
  onClearChatHistory: () => void;
  onClosePopover: (popover: ChatControlsPopover) => void;
  onOpenPromptBook: () => void;
  onOpenPopover: (popover: ChatControlsPopover) => void;
}

export function FlashBoardChatControls({
  activePopover,
  availableChatModelClasses,
  chatError,
  chatModelClass,
  chatModelClassAvailabilityStatus,
  chatPrompt,
  chatProvider,
  chatProviderLabel,
  chatProviderOptions,
  hasChatMessages,
  isChatting,
  popoverHostClassName,
  popoverRef,
  renderedPopover,
  showChatModelClass,
  onChatModelClassSelect,
  onChatProviderSelect,
  onClearChatHistory,
  onClosePopover,
  onOpenPromptBook,
  onOpenPopover,
}: FlashBoardChatControlsProps) {
  return (
    <div className="fb-control-stack fb-chat-control-stack">
      <div className={popoverHostClassName} ref={popoverRef}>
        <button
          className={`fb-pill fb-chat-model-pill ${activePopover === 'chatProvider' ? 'active' : ''}`}
          type="button"
          onClick={() => onOpenPopover('chatProvider')}
          title={`Model: ${chatProviderLabel}`}
          aria-haspopup="menu"
          aria-expanded={activePopover === 'chatProvider'}
        >
          <span className="fb-pill-label">Model</span>
        </button>
        {showChatModelClass && (
          <button
            className={`fb-pill fb-chat-profile-pill ${activePopover === 'chatModelClass' ? 'active' : ''}`}
            type="button"
            onClick={() => onOpenPopover('chatModelClass')}
            title={`Model speed: ${modelClassLabel(chatModelClass)}`}
            aria-haspopup="menu"
            aria-expanded={activePopover === 'chatModelClass'}
            disabled={isChatting}
          >
            <span className="fb-pill-label">{modelClassLabel(chatModelClass)}</span>
          </button>
        )}
        <button
          className="fb-pill fb-prompt-book-pill"
          type="button"
          onClick={onOpenPromptBook}
          title="Open chat Prompt Book"
        >
          <span className="fb-pill-label">Prompt Book</span>
        </button>
        <button
          className="fb-pill fb-chat-clear-pill"
          type="button"
          onClick={onClearChatHistory}
          disabled={!hasChatMessages && !chatPrompt && !chatError}
          title="Clear chat history and start a new chat"
        >
          <span className="fb-pill-label">New</span>
        </button>

        {renderedPopover === 'chatProvider' && (
          <div className="fb-popover" role="menu" aria-label="Chat model">
            <div className="fb-popover-title">Model</div>
            <div className="fb-popover-pills">
              {chatProviderOptions.map((provider) => (
                <button
                  key={provider.id}
                  className={`fb-popover-pill ${chatProvider === provider.id ? 'active' : ''}`}
                  type="button"
                  role="menuitemradio"
                  aria-checked={chatProvider === provider.id}
                  onClick={() => {
                    onChatProviderSelect(provider.id);
                    onClosePopover('chatProvider');
                  }}
                  disabled={isChatting}
                >
                  <span className="fb-popover-pill-label">{provider.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {showChatModelClass && renderedPopover === 'chatModelClass' && (
          <div className="fb-popover" role="menu" aria-label="Model speed">
            <div className="fb-popover-title">Model speed</div>
            <div className="fb-popover-pills">
              {MODEL_CLASS_OPTIONS.map((option) => {
                const available = availableChatModelClasses.includes(option.id);
                const title = available
                  ? option.title
                  : chatModelClassAvailabilityStatus === 'loading'
                    ? 'Checking Fast V2 model availability.'
                    : 'This Fast V2 model speed is currently unavailable.';
                return (
                  <button
                    key={option.id}
                    className={`fb-popover-pill ${chatModelClass === option.id ? 'active' : ''}`}
                    type="button"
                    role="menuitemradio"
                    aria-checked={chatModelClass === option.id}
                    aria-disabled={isChatting || !available}
                    onClick={() => {
                      onChatModelClassSelect(option.id);
                      onClosePopover('chatModelClass');
                    }}
                    disabled={isChatting || !available}
                    title={title}
                  >
                    <span className="fb-popover-pill-label">{option.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
