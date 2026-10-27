// Resumes a Direct (Fast/Medium/Slow) turn that was running when the page reloaded. It lives in the
// always-mounted FlashBoardRuntimeHost (desktop App and phone runtime), not in a chat view: on the
// phone the Assistant sheet is mounted only while it is open, and a turn waiting for browser-executed
// tools must not stall until someone opens it. The chat views follow the run through the shared Direct
// run registry (FlashBoardDirectChatRun), so Stop and the progress line keep working.
//
// The resumed tool calls join the original request's Undo group (requestGroupId in the reload
// snapshot), so one Undo still takes the whole request back.

import { useEffect, useSyncExternalStore } from 'react';

import {
  DEFAULT_FLASHBOARD_CHAT_MODEL,
  DEFAULT_FLASHBOARD_CHAT_TEMPERATURE,
  type AgentActivityEvent,
  type FlashBoardExecutedToolCall,
} from '../../../services/flashboard/FlashBoardChatService';
import { runAgentRequestScope } from '../../../services/aiTools/agentTransaction';
import { resumeDirectCodexChat } from '../../../services/flashboard/FlashBoardDirectCodexTransport';
import {
  clearDirectCodexReloadSnapshot,
  readDirectCodexReloadSnapshot,
} from '../../../services/flashboard/FlashBoardDirectCodexReloadResume';
import {
  finishFlashBoardDirectChatRun,
  getFlashBoardDirectChatRunConversationRefsSnapshot,
  startFlashBoardDirectChatRun,
  subscribeFlashBoardDirectChatRun,
} from '../../../services/flashboard/FlashBoardDirectChatRun';
import { Logger } from '../../../services/logger';
import { useFlashBoardStore } from '../../../stores/flashboardStore';
import type { FlashBoardChatMessage } from './FlashBoardChatOutput';
import { buildFlashBoardChatCompletionMessages, buildFlashBoardChatErrorMessages } from './FlashBoardChatSendPlanner';
import { createStreamingTextThrottle } from './nodeStreamDisplay';

const log = Logger.create('DirectChatResume');

/** Messages already resumed in this page lifetime; one resume per message across every mount. */
const resumedMessageIds = new Set<string>();

type MessagesUpdater = (updater: (current: FlashBoardChatMessage[]) => FlashBoardChatMessage[]) => void;

/**
 * Starts the resume of the first pending assistant message that has a Direct reload snapshot. Returns the
 * resumed message id, or null when there is nothing to resume (or its conversation already runs).
 */
export function resumeReloadedDirectChatTurn(input: {
  messages: readonly FlashBoardChatMessage[];
  fallbackConversationRef: string | null;
  setMessages: MessagesUpdater;
}): string | null {
  const pendingMessage = input.messages.find((message) => (
    message.role === 'assistant'
    && message.isPending === true
    && !resumedMessageIds.has(message.id)
    && readDirectCodexReloadSnapshot(message.id) !== null
  ));
  if (!pendingMessage) return null;
  const snapshot = readDirectCodexReloadSnapshot(pendingMessage.id);
  if (!snapshot) return null;

  const conversationRef = pendingMessage.conversationRef ?? input.fallbackConversationRef ?? 'default';
  const abortController = startFlashBoardDirectChatRun(conversationRef);
  if (abortController === null) {
    // The hook retries when that run finishes (it watches the run registry).
    log.debug(`A Direct turn already runs in conversation ${conversationRef}; the reloaded turn waits.`);
    return null;
  }
  resumedMessageIds.add(pendingMessage.id);

  const updatePending = (patch: Partial<FlashBoardChatMessage>) => {
    input.setMessages((current) => current.map((message) => (
      message.id === pendingMessage.id && message.isPending ? { ...message, ...patch } : message
    )));
  };
  const executedToolCalls: FlashBoardExecutedToolCall[] = [...(pendingMessage.toolCalls ?? [])];
  let streamedResponse = pendingMessage.isStreaming ? pendingMessage.text : '';
  // A late flush is harmless: only the still-pending message is ever patched.
  const streamedTextUpdate = createStreamingTextThrottle(() => updatePending({
    isStreaming: true, kernelProgress: undefined, text: streamedResponse,
  }));
  const appendActivity = (event: AgentActivityEvent | null) => {
    if (!event) return;
    input.setMessages((current) => current.map((message) => (
      message.id === pendingMessage.id && message.isPending
        ? { ...message, activityEvents: [...(message.activityEvents ?? []).filter((candidate) => candidate.id !== event.id), event].slice(-100) }
        : message
    )));
  };

  updatePending(streamedResponse
    ? { isError: undefined, isStreaming: true, text: streamedResponse }
    : { isError: undefined, text: 'Reconnecting to Codex…' });

  const requestGroupId = snapshot.requestGroupId ?? pendingMessage.id;
  void runAgentRequestScope(requestGroupId, () => resumeDirectCodexChat({
    assistantMessageId: pendingMessage.id,
    request: {
      agentPath: 'direct-codex',
      conversationRef: conversationRef === 'default' ? undefined : conversationRef,
      activityRunId: pendingMessage.id,
      hostedAvailable: true,
      model: DEFAULT_FLASHBOARD_CHAT_MODEL,
      onActivityEvent: appendActivity,
      onExecutedToolCalls: (toolCalls) => {
        executedToolCalls.push(...toolCalls);
        updatePending({ toolCalls: [...executedToolCalls] });
      },
      onPhase: () => {
        if (!streamedResponse) updatePending({ kernelProgress: undefined, text: 'Reconnecting to Codex…' });
      },
      onTextDelta: (delta) => {
        if (!delta) return;
        streamedResponse += delta;
        streamedTextUpdate.schedule();
      },
      prompt: 'Resume the active Codex Direct turn.',
      provider: 'kie',
      resumeMessageId: pendingMessage.id,
      signal: abortController.signal,
      temperature: DEFAULT_FLASHBOARD_CHAT_TEMPERATURE,
      toolExecutionMode: 'normal',
    },
  })).then((response) => {
    if (response === null) throw new Error('The Codex Direct turn can no longer be resumed.');
    streamedTextUpdate.cancel();
    input.setMessages((current) => buildFlashBoardChatCompletionMessages(
      current, pendingMessage.id, response, undefined, executedToolCalls,
    ));
  }).catch((error: unknown) => {
    streamedTextUpdate.cancel();
    clearDirectCodexReloadSnapshot(pendingMessage.id);
    const errorMessage = abortController.signal.aborted
      ? 'Chat stopped.'
      : error instanceof Error ? error.message : 'Chat resume failed.';
    if (!abortController.signal.aborted) log.warn(`Resuming the reloaded Direct turn failed: ${errorMessage}`);
    input.setMessages((current) => buildFlashBoardChatErrorMessages(current, pendingMessage.id, errorMessage));
  }).finally(() => {
    finishFlashBoardDirectChatRun(abortController);
  });
  return pendingMessage.id;
}

/** Test seam: forget which messages were resumed in this page lifetime. */
export function resetResumedDirectChatTurnsForTests(): void {
  resumedMessageIds.clear();
}

/** Mount once in an always-present host. Watches the active chat workspace for a reloaded Direct turn. */
export function useFlashBoardDirectChatReloadResume(): void {
  const workspaceId = useFlashBoardStore((state) => state.activeAIWorkspaceId);
  const messages = useFlashBoardStore((state) => state.chatMessages);
  const conversationRef = useFlashBoardStore((state) => (
    state.aiWorkspaces.find((workspace) => workspace.id === workspaceId)?.chatConversationRef ?? null
  ));
  const setWorkspaceChatMessages = useFlashBoardStore((state) => state.setWorkspaceChatMessages);
  const runningConversations = useSyncExternalStore(
    subscribeFlashBoardDirectChatRun,
    getFlashBoardDirectChatRunConversationRefsSnapshot,
    getFlashBoardDirectChatRunConversationRefsSnapshot,
  );

  useEffect(() => {
    if (!messages.some((message) => message.role === 'assistant' && message.isPending === true)) return;
    resumeReloadedDirectChatTurn({
      messages,
      fallbackConversationRef: conversationRef,
      setMessages: (updater) => setWorkspaceChatMessages(workspaceId, updater),
    });
  }, [conversationRef, messages, runningConversations, setWorkspaceChatMessages, workspaceId]);
}
