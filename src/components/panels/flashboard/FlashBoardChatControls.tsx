import type { RefObject } from 'react';
import { LEMONADE_CONTEXT_SIZE_OPTIONS } from '../../../services/lemonadeProvider';
import type {
  FlashBoardChatModelOption,
  FlashBoardChatProvider,
  FlashBoardChatProviderOption,
  FlashBoardOpenAiReasoningEffort,
} from '../../../services/flashboard/FlashBoardChatService';

type ChatControlsPopover = 'chatProvider' | 'chatModel' | 'chatContext' | 'chatTemperature' | 'chatReasoning' | null;
type RenderedPopover = string | null;
type LemonadeStatus = 'idle' | 'checking' | 'online' | 'offline';

interface ChatReasoningOption {
  id: FlashBoardOpenAiReasoningEffort;
  label: string;
}

interface FlashBoardChatControlsProps {
  activeChatModel?: FlashBoardChatModelOption;
  activeChatModelId: string;
  activePopover: RenderedPopover;
  chatError: string | null;
  chatModelOptions: FlashBoardChatModelOption[];
  chatPrompt: string;
  chatProvider: FlashBoardChatProvider;
  chatProviderLabel: string;
  chatProviderOptions: FlashBoardChatProviderOption[];
  editOptionsMode: boolean;
  editOptionsModeEnabled: boolean;
  chatReasoningEffortOptions: ChatReasoningOption[];
  chatReasoningSupported: boolean;
  chatTemperature: number;
  chatTemperatureSupported: boolean;
  hasChatMessages: boolean;
  isChatting: boolean;
  lemonadeContextSize: number;
  lemonadeStatus: LemonadeStatus;
  openAiReasoningEffort: FlashBoardOpenAiReasoningEffort;
  popoverHostClassName: string;
  popoverRef: RefObject<HTMLDivElement | null>;
  renderedPopover: RenderedPopover;
  onChatErrorClear: () => void;
  onChatModelChange: (modelId: string) => void;
  onChatProviderSelect: (provider: FlashBoardChatProvider) => void;
  onChatTemperatureChange: (temperature: number) => void;
  onClearChatHistory: () => void;
  onClosePopover: (popover: NonNullable<ChatControlsPopover>) => void;
  onEditOptionsModeToggle: () => void;
  onLemonadeContextSizeChange: (contextSize: number) => void;
  onOpenPromptBook: () => void;
  onOpenPopover: (popover: NonNullable<ChatControlsPopover>) => void;
  onReasoningEffortChange: (effort: FlashBoardOpenAiReasoningEffort) => void;
}

export function FlashBoardChatControls({
  activeChatModel,
  activeChatModelId,
  activePopover,
  chatError,
  chatModelOptions,
  chatPrompt,
  chatProvider,
  chatProviderLabel,
  chatProviderOptions,
  editOptionsMode,
  editOptionsModeEnabled,
  chatReasoningEffortOptions,
  chatReasoningSupported,
  chatTemperature,
  chatTemperatureSupported,
  hasChatMessages,
  isChatting,
  lemonadeContextSize,
  lemonadeStatus,
  openAiReasoningEffort,
  popoverHostClassName,
  popoverRef,
  renderedPopover,
  onChatErrorClear,
  onChatModelChange,
  onChatProviderSelect,
  onChatTemperatureChange,
  onClearChatHistory,
  onClosePopover,
  onEditOptionsModeToggle,
  onLemonadeContextSizeChange,
  onOpenPromptBook,
  onOpenPopover,
  onReasoningEffortChange,
}: FlashBoardChatControlsProps) {
  const lemonadeContextLabel = LEMONADE_CONTEXT_SIZE_OPTIONS.find((option) => option.value === lemonadeContextSize)?.label ?? `${Math.round(lemonadeContextSize / 1024)}K`;

  return (
    <div className="fb-control-stack fb-chat-control-stack">
      <div className={popoverHostClassName} ref={popoverRef}>
        <button
          className={`fb-pill ${activePopover === 'chatProvider' ? 'active' : ''}`}
          onClick={() => onOpenPopover('chatProvider')}
          title={`Provider: ${chatProviderLabel}`}
        >
          <span className="fb-pill-label">{chatProviderLabel}</span>
        </button>
        <button
          className={`fb-pill ${activePopover === 'chatModel' ? 'active' : ''}`}
          onClick={() => onOpenPopover('chatModel')}
          title={`Model: ${activeChatModel?.label ?? activeChatModelId}`}
        >
          <span className="fb-pill-label">{activeChatModel?.label ?? activeChatModelId}</span>
        </button>
        {chatProvider === 'lemonade' && (
          <button
            className={`fb-pill ${activePopover === 'chatContext' ? 'active' : ''}`}
            onClick={() => onOpenPopover('chatContext')}
            title={`Lemonade context size: ${lemonadeContextLabel}`}
            disabled={isChatting}
          >
            <span className="fb-pill-label">Ctx {lemonadeContextLabel}</span>
          </button>
        )}
        {chatReasoningSupported && (
          <button
            className={`fb-pill ${activePopover === 'chatReasoning' ? 'active' : ''}`}
            onClick={() => onOpenPopover('chatReasoning')}
            title={`Reasoning effort: ${openAiReasoningEffort}`}
          >
            <span className="fb-pill-label">{openAiReasoningEffort}</span>
          </button>
        )}
        <button
          className={`fb-pill ${activePopover === 'chatTemperature' ? 'active' : ''}`}
          onClick={() => onOpenPopover('chatTemperature')}
          title={chatTemperatureSupported ? `Temperature: ${chatTemperature.toFixed(1)}` : 'Temperature fixed for this model'}
        >
          <span className="fb-pill-label">{chatTemperatureSupported ? `Temp ${chatTemperature.toFixed(1)}` : 'Fixed temp'}</span>
        </button>
        {editOptionsModeEnabled && (
          <button
            className={`fb-pill fb-chat-options-pill ${editOptionsMode ? 'active' : ''}`}
            type="button"
            onClick={onEditOptionsModeToggle}
            disabled={isChatting}
            title={editOptionsMode
              ? 'Plan 3 mode on - next prompt proposes three edit choices before applying.'
              : 'Plan 3 mode off - click to propose three edit choices before applying.'}
          >
            <span className="fb-pill-label">Plan 3</span>
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
          <div className="fb-popover">
            <div className="fb-popover-title">Provider</div>
            <div className="fb-popover-pills">
              {chatProviderOptions.map((provider) => (
                <button
                  key={provider.id}
                  className={`fb-popover-pill ${chatProvider === provider.id ? 'active' : ''}`}
                  type="button"
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
            {chatProvider === 'lemonade' && (
              <div className={`fb-chat-status ${lemonadeStatus}`}>
                {lemonadeStatus === 'idle' ? 'Local' : lemonadeStatus}
              </div>
            )}
          </div>
        )}

        {renderedPopover === 'chatModel' && (
          <div className="fb-popover">
            <div className="fb-popover-title">Model</div>
            <div className="fb-popover-pills">
              {chatModelOptions.map((model) => (
                <button
                  key={model.id}
                  className={`fb-popover-pill ${activeChatModelId === model.id ? 'active' : ''}`}
                  type="button"
                  onClick={() => {
                    onChatModelChange(model.id);
                    onChatErrorClear();
                    onClosePopover('chatModel');
                  }}
                  disabled={isChatting}
                  title={model.id}
                >
                  <span className="fb-popover-pill-label">{model.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {renderedPopover === 'chatContext' && (
          <div className="fb-popover">
            <div className="fb-popover-title">Lemonade context</div>
            <div className="fb-popover-pills">
              {LEMONADE_CONTEXT_SIZE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  className={`fb-popover-pill ${lemonadeContextSize === option.value ? 'active' : ''}`}
                  type="button"
                  onClick={() => {
                    onLemonadeContextSizeChange(option.value);
                    onClosePopover('chatContext');
                  }}
                  disabled={isChatting}
                >
                  <span className="fb-popover-pill-label">{option.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {renderedPopover === 'chatReasoning' && (
          <div className="fb-popover">
            <div className="fb-popover-title">Reasoning</div>
            <div className="fb-popover-pills">
              {chatReasoningEffortOptions.map((option) => (
                <button
                  key={option.id}
                  className={`fb-popover-pill ${openAiReasoningEffort === option.id ? 'active' : ''}`}
                  type="button"
                  onClick={() => {
                    onReasoningEffortChange(option.id);
                    onChatErrorClear();
                    onClosePopover('chatReasoning');
                  }}
                  disabled={isChatting}
                >
                  <span className="fb-popover-pill-label">{option.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {renderedPopover === 'chatTemperature' && (
          <div className="fb-popover fb-chat-temperature-popover">
            <div className="fb-popover-title">Temperature</div>
            <label className={`fb-chat-temperature ${chatTemperatureSupported ? '' : 'disabled'}`}>
              <span>Temp</span>
              <input
                type="range"
                min="0"
                max="2"
                step="0.1"
                value={chatTemperature}
                onChange={(event) => onChatTemperatureChange(Number(event.target.value))}
                disabled={isChatting || !chatTemperatureSupported}
              />
              <strong>{chatTemperatureSupported ? chatTemperature.toFixed(1) : 'fixed'}</strong>
            </label>
          </div>
        )}
      </div>
      <div
        className="fb-selected-model-label fb-chat-selected-model-label"
        title={`${chatProviderLabel} / ${activeChatModel?.label ?? activeChatModelId}`}
      >
        Chat
      </div>
    </div>
  );
}
