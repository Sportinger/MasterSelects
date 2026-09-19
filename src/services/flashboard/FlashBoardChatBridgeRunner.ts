import { hasHostedAiSession, useAccountStore } from '../../stores/accountStore';
import { useMediaStore } from '../../stores/mediaStore';
import {
  useFlashBoardStore,
  type FlashBoardChatMessage,
} from '../../stores/flashboardStore';
import { createAgentActivityEvent } from './FlashBoardChatActivity';
import { prepareFlashBoardChatVisualReferences } from './FlashBoardChatVisualReferences';
import {
  DEFAULT_FLASHBOARD_CHAT_MODEL,
  DEFAULT_FLASHBOARD_CHAT_TEMPERATURE,
  DEFAULT_FLASHBOARD_OPENAI_REASONING_EFFORT,
  FLASHBOARD_CHAT_MODEL_OPTIONS,
} from './FlashBoardChatConfig';
import { buildFlashBoardChatRequestPrompt } from './FlashBoardChatHistory';
import type { KernelRunReport } from '../kernelClient/runReport';
import {
  sendFlashBoardChatMessage,
  type FlashBoardChatRunRecord,
} from './FlashBoardChatService';
import type {
  AgentActivityEvent,
  FlashBoardChatAgentMode,
  FlashBoardChatRequest,
  FlashBoardChatPromptVersion,
  FlashBoardChatProvider,
  FlashBoardChatRunSource,
  FlashBoardChatToolExecutionMode,
  FlashBoardChatModelClass,
  FlashBoardExecutedToolCall,
  FlashBoardOpenAiReasoningEffort,
  DecisionPolicy,
} from './FlashBoardChatTypes';

export interface FlashBoardBridgeChatTurnInput {
  agentPath?: FlashBoardChatRequest['agentPath'];
  conversationRef?: string;
  decisionPolicy?: DecisionPolicy;
  historyMessages?: FlashBoardChatMessage[];
  idempotencyKey?: string;
  includeHistory?: boolean;
  model?: string;
  onActivityEvent?: (event: AgentActivityEvent) => void;
  onExecutedToolCalls?: (toolCalls: FlashBoardExecutedToolCall[]) => void;
  onKernelProgress?: import('../kernelClient/runProgress').KernelProgressReporter;
  onKernelReport?: (report: KernelRunReport) => void;
  onPhase?: (phase: 'kernel' | 'provider') => void;
  openAiReasoningEffort?: FlashBoardOpenAiReasoningEffort;
  persistToChat?: boolean;
  preproductionRunId?: string;
  prompt: string;
  provider?: FlashBoardChatProvider;
  requestedAgentMode?: Extract<FlashBoardChatAgentMode, 'logic'>;
  requestedModelClass?: FlashBoardChatModelClass;
  referenceMediaFileIds?: string[];
  runSource?: FlashBoardChatRunSource;
  signal?: AbortSignal;
  temperature?: number;
  toolExecutionMode?: FlashBoardChatToolExecutionMode;
}

export interface FlashBoardBridgeChatTurnResult {
  assistantMessageId?: string;
  kernelReport?: KernelRunReport;
  model: string;
  persistedToChat: boolean;
  promptVersion: FlashBoardChatPromptVersion;
  provider: FlashBoardChatProvider;
  response: string;
  run: FlashBoardChatRunRecord;
  toolCalls: FlashBoardExecutedToolCall[];
}

export async function runFlashBoardBridgeChatTurn(
  input: FlashBoardBridgeChatTurnInput,
): Promise<FlashBoardBridgeChatTurnResult> {
  const visiblePrompt = input.prompt.trim();
  if (!visiblePrompt) throw new Error('Missing chat prompt.');

  const provider = input.provider ?? 'kie';
  const model = resolveModel(input.model);
  const messages = input.includeHistory === false
    ? []
    : input.historyMessages ?? useFlashBoardStore.getState().chatMessages;
  const requestPrompt = input.conversationRef === undefined
    ? buildFlashBoardChatRequestPrompt(messages, visiblePrompt)
    : visiblePrompt;
  const toolCalls: FlashBoardExecutedToolCall[] = [];
  const completedRunRef: { current: FlashBoardChatRunRecord | null } = { current: null };
  const kernelReportRef: { current: KernelRunReport | undefined } = { current: undefined };
  const inputRequestRef: { current: import('../kernelClient/types').KernelUserInputRequest | undefined } = { current: undefined };
  const persistToChat = input.persistToChat !== false;
  const messageIds = persistToChat
    ? appendPendingMessages(visiblePrompt, input.idempotencyKey, input.conversationRef)
    : null;

  try {
    const hostedAvailable = resolveHostedAvailability();
    if (input.agentPath !== 'direct-codex' && !hostedAvailable) {
      throw new Error('Free AI credits are unavailable. Choose a plan to continue.');
    }

    const visualReferences = await prepareFlashBoardChatVisualReferences({
      composer: input.referenceMediaFileIds === undefined
        ? useFlashBoardStore.getState().composer
        : {
            ...useFlashBoardStore.getState().composer,
            startMediaFileId: undefined,
            endMediaFileId: undefined,
            referenceMediaFileIds: input.referenceMediaFileIds,
          },
      mediaFiles: useMediaStore.getState().files,
    });

    const response = await sendFlashBoardChatMessage({
      ...(input.agentPath === undefined ? {} : { agentPath: input.agentPath }),
      hostedAvailable,
      ...(input.conversationRef === undefined
        ? {}
        : { conversationRef: input.conversationRef }),
      decisionPolicy: input.decisionPolicy ?? 'automatic',
      idempotencyKey: input.idempotencyKey,
      model,
      onActivityEvent: (event) => {
        if (messageIds) appendPendingActivity(messageIds.assistantId, event);
        input.onActivityEvent?.(event);
      },
      onExecutedToolCalls: (calls) => {
        toolCalls.push(...calls);
        input.onExecutedToolCalls?.(calls);
      },
      onKernelProgress: (progress) => {
        input.onKernelProgress?.(progress);
        if (!messageIds) return;
        updatePendingKernelProgress(messageIds.assistantId, progress);
        appendPendingActivity(
          messageIds.assistantId,
          createAgentActivityEvent(messageIds.assistantId, {
            kind: 'progress',
            label: progress.detail
              ? `${progress.label}: ${progress.detail}`
              : progress.label,
            ...(progress.current === undefined ? {} : { current: progress.current }),
            ...(progress.total === undefined ? {} : { total: progress.total }),
          }),
        );
      },
      // Without this a bridge-initiated kernel turn persists as a plain text
      // bubble, while the same turn from the UI renders as a run card.
      onKernelReport: (report) => {
        kernelReportRef.current = report;
      },
      onKernelInputRequest: (request) => {
        inputRequestRef.current = request;
      },
      ...(input.onPhase === undefined ? {} : { onPhase: input.onPhase }),
      onRunCompleted: (run) => {
        completedRunRef.current = run;
      },
      openAiReasoningEffort: input.openAiReasoningEffort ?? DEFAULT_FLASHBOARD_OPENAI_REASONING_EFFORT,
      playbookPrompt: visiblePrompt,
      ...(input.preproductionRunId === undefined
        ? {}
        : { preproductionRunId: input.preproductionRunId }),
      prompt: requestPrompt,
      provider,
      ...(input.requestedAgentMode === undefined
        ? {}
        : { requestedAgentMode: input.requestedAgentMode }),
      requestedModelClass: input.requestedModelClass ?? 'fast',
      runSource: input.runSource ?? 'bridge',
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      temperature: input.temperature ?? DEFAULT_FLASHBOARD_CHAT_TEMPERATURE,
      toolExecutionMode: input.toolExecutionMode ?? 'normal',
      ...(visualReferences.length === 0 ? {} : { visualReferences }),
    });
    const completedRun = completedRunRef.current;
    if (!completedRun) throw new Error('Chat completed without a run trace.');
    if (messageIds) {
      completePendingMessage(
        messageIds.assistantId,
        response,
        toolCalls,
        false,
        kernelReportRef.current,
        inputRequestRef.current,
      );
    }
    return {
      ...(messageIds === null ? {} : { assistantMessageId: messageIds.assistantId }),
      ...(kernelReportRef.current === undefined ? {} : { kernelReport: kernelReportRef.current }),
      model,
      persistedToChat: persistToChat,
      promptVersion: completedRun.promptVersion,
      provider,
      response,
      run: completedRun,
      toolCalls,
    };
  } catch (error) {
    if (messageIds) {
      completePendingMessage(
        messageIds.assistantId,
        error instanceof Error ? error.message : String(error),
        toolCalls,
        true,
      );
    }
    throw error;
  }
}

function resolveModel(requestedModel: string | undefined): string {
  const model = requestedModel?.trim() || DEFAULT_FLASHBOARD_CHAT_MODEL;
  if (!FLASHBOARD_CHAT_MODEL_OPTIONS.kie.some((candidate) => candidate.id === model)) {
    throw new Error(`Unsupported Kie.ai chat model: ${model}`);
  }
  return model;
}

function resolveHostedAvailability(): boolean {
  const account = useAccountStore.getState();
  return hasHostedAiSession(account.session) && account.hostedAIEnabled;
}

function appendPendingMessages(
  prompt: string,
  idempotencyKey?: string,
  conversationRef?: string,
): { assistantId: string; userId: string } {
  const createdAt = Date.now();
  const userId = idempotencyKey
    ? `user-${idempotencyKey}`
    : createMessageId('user');
  const assistantId = idempotencyKey
    ? `assistant-${idempotencyKey}`
    : createMessageId('assistant');
  useFlashBoardStore.getState().setChatMessages((chatMessages) => (
    chatMessages.some((message) => message.id === assistantId)
      ? chatMessages.map((message): FlashBoardChatMessage => (
          message.id === assistantId
            ? { ...message, isError: undefined, isPending: true, text: 'Thinking...' }
            : message
        ))
      : [
          ...chatMessages,
          {
            ...(conversationRef === undefined ? {} : { conversationRef }),
            createdAt,
            id: userId,
            role: 'user',
            text: prompt,
          },
          {
            ...(conversationRef === undefined ? {} : { conversationRef }),
            createdAt,
            id: assistantId,
            role: 'assistant',
            text: 'Thinking...',
            isPending: true,
          },
        ]
  ));
  return { assistantId, userId };
}

function appendPendingActivity(
  assistantId: string,
  event: AgentActivityEvent | null,
): void {
  if (!event) return;
  useFlashBoardStore.getState().setChatMessages((chatMessages) => (
    chatMessages.map((message): FlashBoardChatMessage => (
      message.id === assistantId && message.isPending
        ? {
            ...message,
            activityEvents: [
              ...(message.activityEvents ?? []).filter((candidate) => candidate.id !== event.id),
              event,
            ].slice(-100),
          }
        : message
    ))
  ));
}

function updatePendingKernelProgress(
  assistantId: string,
  progress: import('../kernelClient/runProgress').KernelProgressEvent,
): void {
  useFlashBoardStore.getState().setChatMessages((chatMessages) => (
    chatMessages.map((message): FlashBoardChatMessage => (
      message.id === assistantId && message.isPending
        ? { ...message, kernelProgress: progress, text: progress.label }
        : message
    ))
  ));
}

function completePendingMessage(
  assistantId: string,
  text: string,
  toolCalls: FlashBoardExecutedToolCall[],
  isError = false,
  kernelReport?: KernelRunReport,
  inputRequest?: import('../kernelClient/types').KernelUserInputRequest,
): void {
  useFlashBoardStore.getState().setChatMessages((chatMessages) => (
    chatMessages.map((message): FlashBoardChatMessage => (
      message.id === assistantId
        ? {
            ...message,
            isError: isError || undefined,
            isPending: false,
            kernelProgress: undefined,
            kernelReport,
            inputRequest,
            text: text || 'Empty response.',
            toolCalls,
          }
        : message
    ))
  ));
}

function createMessageId(role: FlashBoardChatMessage['role']): string {
  return `${role}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
