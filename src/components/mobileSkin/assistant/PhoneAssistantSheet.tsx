// The assistant on the phone: the editor's own chat runtime (useFlashBoardChatController, the same
// agent, tools, approvals, audit and undo as the desktop FlashBoard chat) with a phone layout - model
// choice, account state, the conversation with each request's tool calls, a live progress line,
// Stop, and Undo after a request. Nothing here talks to a provider itself, and there is no test-only
// path: tests answer the real network calls.
//
// Never blocks the timeline: closing the sheet keeps a running request going (the Direct runs live
// outside this component), and reopening shows its progress again.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent } from 'react';

import { useAccountStore } from '../../../stores/accountStore';
import { useFlashBoardStore } from '../../../stores/flashboardStore';
import { FLASHBOARD_CHAT_AGENT_OPTIONS } from '../../panels/flashboard/flashBoardChatAgentOptions';
import { useFlashBoardChatController } from '../../panels/flashboard/useFlashBoardChatController';
import { useFlashBoardComposerAccessState } from '../../panels/flashboard/useFlashBoardComposerAccessState';
import { usePhoneRuntime } from '../runtime/PhoneRuntimeContext';
import { PhoneSheet } from '../sheets/PhoneSheet';
import { usePhoneUiStore } from '../state/phoneUiStore';
import { PhoneAssistantComposer } from './PhoneAssistantComposer';
import { PhoneAssistantMessages } from './PhoneAssistantMessages';
import {
  buildPhoneToolCallRows, latestSettledAssistantMessage, phoneAssistantServiceNotice, phoneUndoOffer, resolvePhoneAssistantAccess,
} from './phoneAssistantModel';
import { clearPhoneAssistantPrefill, peekPhoneAssistantPrefill } from './phoneAssistantPrefill';
import { PHONE_ASSISTANT_TEST_IDS as IDS } from './phoneAssistantTestIds';
import { PhoneAssistantVariants } from './PhoneAssistantVariants';
import { getToolPolicy } from '../../../services/aiTools/policy';
import './PhoneAssistantSheet.css';

const NEAR_BOTTOM_PX = 48;
const noop = () => undefined;
const isReadOnlyTool = (name: string) => getToolPolicy(name)?.readOnly === true;

/** Same chat workspace the desktop chat and /medium use, so all of them share one conversation. */
function activatePrimaryChatWorkspace(): void {
  const flashBoard = useFlashBoardStore.getState();
  const primaryChat = flashBoard.aiWorkspaces.find((workspace) => workspace.kind === 'chat');
  if (primaryChat) flashBoard.activateAIWorkspace(primaryChat.id);
  else flashBoard.createAIWorkspace({ kind: 'chat', title: 'Chat' });
}

function subscribeOnline(callback: () => void): () => void {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
}

function blurAfterPointer(event: PointerEvent<HTMLElement>): void {
  event.currentTarget.blur();
}

export function PhoneAssistantSheet() {
  const closeSheet = usePhoneUiStore((state) => state.closeSheet);
  const showToast = usePhoneUiStore((state) => state.showToast);
  const { history } = usePhoneRuntime();
  const access = useFlashBoardComposerAccessState();
  const accountKnown = useAccountStore((state) => state.isInitialized);
  const creditBalance = useAccountStore((state) => state.creditBalance);
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  // A task chosen elsewhere (All tools → Assistant) arrives typed into the field, never sent.
  const [prefill] = useState(peekPhoneAssistantPrefill);
  const [note, setNote] = useState<string | null>(null);
  const [undone, setUndone] = useState<{ messageId: string; steps: number } | null>(null);
  const [nearBottom, setNearBottom] = useState(true);
  /** Prompt that Try again typed back in; sent once the field shows it. */
  const [retryPrompt, setRetryPrompt] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    activatePrimaryChatWorkspace();
    if (prefill !== null) clearPhoneAssistantPrefill();
  }, [prefill]);

  const chat = useFlashBoardChatController({
    closePopover: noop,
    hasHostedSession: access.hasHostedSession,
    hostedAIEnabled: access.hostedAIEnabled,
    ...(prefill === null ? {} : { initialChatPrompt: prefill }),
    initialMode: 'chat',
    openAuthDialog: access.openAuthDialog,
    openPricingDialog: access.openPricingDialog,
  });
  const { chatMessages: messages, isChatting } = chat;

  const accessState = resolvePhoneAssistantAccess({
    online,
    accountKnown,
    authenticated: access.accountSession?.authenticated === true,
    guest: access.accountSession?.guest === true,
    creditBalance,
  });

  const openAccountDialog = (dialog: 'auth' | 'pricing' | 'account') => {
    const account = useAccountStore.getState();
    if (dialog === 'auth') account.openAuthDialog();
    else if (dialog === 'pricing') account.openPricingDialog();
    else account.openAccountDialog();
  };

  // Follow the conversation while the reader is at the bottom; otherwise offer a jump.
  const scrollToLatest = useCallback(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
    setNearBottom(true);
  }, []);
  useEffect(() => {
    // Every change of the conversation (new message, streamed text, tool call) re-pins the bottom.
    const list = listRef.current;
    if (nearBottom && list) list.scrollTop = list.scrollHeight;
  }, [messages, nearBottom]);
  useEffect(() => {
    const list = listRef.current;
    if (!list) return undefined;
    const onScroll = () => setNearBottom(list.scrollHeight - list.scrollTop - list.clientHeight <= NEAR_BOTTOM_PX);
    list.addEventListener('scroll', onScroll, { passive: true });
    return () => list.removeEventListener('scroll', onScroll);
  }, []);

  const send = () => {
    if (isChatting) {
      void chat.handleChatButtonClick();
      return;
    }
    if (accessState.blocksSending) {
      setNote(accessState.message);
      return;
    }
    if (!chat.chatPrompt.trim()) {
      setNote('Write what the assistant should do first.');
      return;
    }
    setNote(null);
    setNearBottom(true);
    void chat.handleChatButtonClick();
  };

  const serviceNotice = isChatting ? null : phoneAssistantServiceNotice(messages);
  const retryRequest = () => {
    if (accessState.blocksSending) {
      setNote(accessState.message);
      return;
    }
    if (!serviceNotice?.retryPrompt) {
      setNote('Type the request again and send it.');
      return;
    }
    chat.handleChatPromptChange(serviceNotice.retryPrompt);
    setRetryPrompt(serviceNotice.retryPrompt);
  };
  useEffect(() => {
    if (retryPrompt === null || chat.chatPrompt !== retryPrompt) return;
    setRetryPrompt(null);
    send();
    // send() reads the field this render shows; it must run once per Try again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryPrompt, chat.chatPrompt]);

  const onPromptKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    send();
  };

  const settled = latestSettledAssistantMessage(messages);
  const undoOffer = phoneUndoOffer(
    settled,
    settled ? buildPhoneToolCallRows(settled, isReadOnlyTool) : [],
    settled && undone?.messageId === settled.id ? undone.steps : 0,
  );
  const undoRequest = () => {
    if (!settled || !undoOffer) return;
    if (!history.canUndo) {
      setNote('Nothing to undo: the editor history has no step left.');
      return;
    }
    history.undo();
    setUndone((current) => ({ messageId: settled.id, steps: (current?.messageId === settled.id ? current.steps : 0) + 1 }));
    setNote(null);
  };

  const close = () => {
    if (isChatting) showToast('The assistant keeps working. Open it again to follow the request.', 'info');
    closeSheet();
  };

  const selectMode = (mode: (typeof FLASHBOARD_CHAT_AGENT_OPTIONS)[number]['id']) => {
    if (isChatting) {
      setNote('The model can change once this request has finished or been stopped.');
      return;
    }
    const unavailableReason = chat.chatAgentUnavailability[mode];
    if (unavailableReason !== undefined) {
      setNote(unavailableReason);
      return;
    }
    chat.handleChatAgentModeSelect(mode);
  };

  const selectedOption = FLASHBOARD_CHAT_AGENT_OPTIONS.find((option) => option.id === chat.chatAgentMode);
  /** Greyed choices say why on screen; a title alone is never seen on a phone. */
  const unavailableReasons = FLASHBOARD_CHAT_AGENT_OPTIONS
    .map((option) => chat.chatAgentUnavailability[option.id])
    .filter((reason): reason is string => reason !== undefined);
  const hasConversation = messages.length > 0 || Boolean(chat.chatPrompt) || Boolean(chat.chatError);

  return (
    <PhoneSheet title="Assistant" height="tall" onCancel={close} cancelLabel="Close">
      <div className="phone-assistant" data-testid={IDS.root}>
        <div className="phone-assistant__bar">
          <div className="phone-assistant__models" role="group" aria-label="Model">
            {FLASHBOARD_CHAT_AGENT_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                className="phone-assistant__model"
                data-testid={IDS.model}
                data-mode={option.id}
                aria-pressed={chat.chatAgentMode === option.id}
                aria-disabled={isChatting || chat.chatAgentUnavailability[option.id] !== undefined}
                data-unavailable={chat.chatAgentUnavailability[option.id] === undefined ? undefined : 'true'}
                title={chat.chatAgentUnavailability[option.id] ?? option.title}
                onPointerUp={blurAfterPointer}
                onClick={() => selectMode(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="phone-assistant__new"
            data-testid={IDS.newChat}
            aria-disabled={!hasConversation}
            onPointerUp={blurAfterPointer}
            onClick={() => {
              if (!hasConversation) {
                setNote('This is already a new conversation.');
                return;
              }
              chat.handleClearChatHistory();
              setUndone(null);
              setNote(null);
            }}
          >
            New
          </button>
        </div>
        {selectedOption ? <p className="phone-assistant__model-detail">{selectedOption.title}</p> : null}
        {unavailableReasons.map((reason) => (
          <p key={reason} className="phone-assistant__model-detail" data-testid={IDS.modelUnavailable} role="status">{reason}</p>
        ))}

        <div className="phone-assistant__access" data-testid={IDS.access} data-access-kind={accessState.kind} role="status">
          <span>{accessState.message}</span>
          {accessState.action ? (
            <button
              type="button"
              className="phone-assistant__access-action"
              data-testid={IDS.accessAction}
              data-dialog={accessState.action.dialog}
              onPointerUp={blurAfterPointer}
              onClick={() => openAccountDialog(accessState.action!.dialog)}
            >
              {accessState.action.label}
            </button>
          ) : null}
        </div>

        {serviceNotice ? (
          <div className="phone-assistant__service" data-testid={IDS.serviceState} data-state={serviceNotice.kind} role="alert">
            <span>{serviceNotice.message}</span>
            <button
              type="button"
              className="phone-assistant__access-action"
              data-testid={IDS.serviceRetry}
              aria-disabled={accessState.blocksSending}
              onPointerUp={blurAfterPointer}
              onClick={retryRequest}
            >
              Try again
            </button>
          </div>
        ) : null}

        <PhoneAssistantVariants disabled={isChatting} onAsk={(text) => { chat.handleChatPromptChange(text); setNote(null); }} />

        <PhoneAssistantMessages
          messages={messages}
          isChatting={isChatting}
          listRef={listRef}
          onDecisionSubmit={chat.handleStoryboardDecisionSubmit}
          onCopyFailed={setNote}
        />
        {!nearBottom && messages.length > 0 ? (
          <button type="button" className="phone-assistant__jump" data-testid={IDS.jumpLatest} onPointerUp={blurAfterPointer} onClick={scrollToLatest}>
            Jump to the latest message
          </button>
        ) : null}

        <PhoneAssistantComposer
          isChatting={isChatting}
          pending={messages.findLast((message) => message.isPending)}
          prompt={chat.chatPrompt}
          blocked={accessState.blocksSending}
          error={note ?? chat.chatError}
          undoOffer={undoOffer}
          onPromptChange={(value) => { chat.handleChatPromptChange(value); setNote(null); }}
          onPromptKeyDown={onPromptKeyDown}
          onSend={send}
          onUndo={undoRequest}
        />
      </div>
    </PhoneSheet>
  );
}
