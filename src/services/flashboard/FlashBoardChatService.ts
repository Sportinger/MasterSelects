import { sendIntelligenceChat } from './FlashBoardChatProviderTransport';
import {
  appendFlashBoardChatRunToolCalls,
  beginFlashBoardChatRun,
  completeFlashBoardChatRun,
} from './FlashBoardChatRunAudit';
import type {
  FlashBoardChatRequest,
} from './FlashBoardChatTypes';

export type { KernelProgressEvent } from '../kernelClient/runProgress';
export type { KernelRunReport } from '../kernelClient/runReport';
export type {
  AgentActivityEvent,
  ChatIntent,
  DecisionPolicy,
  FlashBoardChatAgentMode,
  FlashBoardChatExecutionProfile,
  FlashBoardChatModelClass,
  FlashBoardExecutedToolCall,
  FlashBoardChatModelOption,
  FlashBoardChatPromptVersion,
  FlashBoardChatProvider,
  FlashBoardChatProviderOption,
  FlashBoardChatRequest,
  FlashBoardChatRunSource,
  FlashBoardChatToolExecutionMode,
  FlashBoardChatVisualReference,
  FlashBoardOpenAiReasoningEffort,
} from './FlashBoardChatTypes';
export { DEFAULT_FLASHBOARD_DECISION_POLICY } from './FlashBoardChatTypes';
export {
  DEFAULT_FLASHBOARD_CHAT_MODEL,
  DEFAULT_FLASHBOARD_CHAT_PROVIDER,
  DEFAULT_FLASHBOARD_CHAT_TEMPERATURE,
  DEFAULT_FLASHBOARD_OPENAI_REASONING_EFFORT,
  FLASHBOARD_CHAT_MODEL_OPTIONS,
  FLASHBOARD_CHAT_PROVIDERS,
  FLASHBOARD_OPENAI_REASONING_EFFORT_OPTIONS,
  getFlashBoardChatCreditCost,
  getFlashBoardChatCreditLabel,
  getOpenAiReasoningEffortOptions,
  isOpenAiReasoningEffortSupported,
} from './FlashBoardChatConfig';
export {
  buildFlashBoardChatSystemPrompt,
  FLASHBOARD_CHAT_SYSTEM_PROMPT,
} from './FlashBoardChatPrompt';
export type { FlashBoardChatRunRecord } from './FlashBoardChatRunAudit';

export async function sendFlashBoardChatMessage(request: FlashBoardChatRequest): Promise<string> {
  const prompt = request.prompt.trim();
  if (!prompt) {
    throw new Error('Write a prompt before starting chat.');
  }

  request.onPhase?.('kernel');
  const executedToolCalls: Parameters<typeof completeFlashBoardChatRun>[1]['executedToolCalls'] = [];
  const run = beginFlashBoardChatRun({ ...request, prompt });
  const tracedRequest: FlashBoardChatRequest = {
    ...request,
    activityRunId: run.runId,
    prompt,
    onExecutedToolCalls: (toolCalls) => {
      executedToolCalls.push(...toolCalls);
      appendFlashBoardChatRunToolCalls(run.runId, toolCalls);
      request.onExecutedToolCalls?.(toolCalls);
    },
    onActivityEvent: request.onActivityEvent,
  };

  try {
    const response = await sendIntelligenceChat(tracedRequest);
    const completed = completeFlashBoardChatRun(run.runId, {
      executedToolCalls,
      response,
    });
    if (completed) request.onRunCompleted?.(completed);
    return response;
  } catch (error) {
    const completed = completeFlashBoardChatRun(run.runId, {
      error,
      executedToolCalls,
    });
    if (completed) request.onRunCompleted?.(completed);
    throw error;
  }
}
