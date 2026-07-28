import { tryKernelFirst } from '../kernelClient/kernelChatGateway';
import { buildFlashBoardChatSystemPrompt } from './FlashBoardChatPrompt';
import { sendKieChat, sendLemonadeChat } from './FlashBoardChatProviderTransport';
import {
  beginFlashBoardChatRun,
  completeFlashBoardChatRun,
} from './FlashBoardChatRunAudit';
import type { FlashBoardChatRequest } from './FlashBoardChatTypes';

export type {
  FlashBoardExecutedToolCall,
  FlashBoardChatModelOption,
  FlashBoardChatPromptVersion,
  FlashBoardChatProvider,
  FlashBoardChatProviderOption,
  FlashBoardChatRequest,
  FlashBoardChatRunSource,
  FlashBoardChatToolExecutionMode,
  FlashBoardOpenAiReasoningEffort,
} from './FlashBoardChatTypes';
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
  FLASHBOARD_CHAT_LEGACY_SYSTEM_PROMPT,
  FLASHBOARD_CHAT_SYSTEM_PROMPT,
} from './FlashBoardChatPrompt';
export {
  getFlashBoardChatRun,
  listFlashBoardChatRuns,
  type FlashBoardChatRunRecord,
} from './FlashBoardChatRunAudit';

export async function sendFlashBoardChatMessage(request: FlashBoardChatRequest): Promise<string> {
  const prompt = request.prompt.trim();
  if (!prompt) {
    throw new Error('Write a prompt before starting chat.');
  }

  request.onPhase?.('kernel');
  const kernelResult = await tryKernelFirst(request.playbookPrompt ?? prompt);
  if (kernelResult.handled) {
    // Kernel-handled turns still record a durable chat run so bridge and
    // in-app audits see the same history as legacy turns.
    const kernelRun = beginFlashBoardChatRun(
      { ...request, prompt },
      kernelResult.runId === undefined
        ? 'agent-kernel: kernel-first cutover run'
        : `agent-kernel: kernel-first cutover run ${kernelResult.runId}`,
    );
    const completed = completeFlashBoardChatRun(kernelRun.runId, {
      executedToolCalls: [],
      response: kernelResult.message,
    });
    if (completed) request.onRunCompleted?.(completed);
    return kernelResult.message;
  }

  request.onPhase?.('provider');
  const systemPrompt = buildFlashBoardChatSystemPrompt(request.systemPromptOverride, {
    includeContext: request.systemPromptIncludeContext !== false,
    includePlaybook: request.systemPromptIncludePlaybook,
    promptVersion: request.promptVersion,
    userPrompt: request.playbookPrompt ?? prompt,
  });
  const executedToolCalls: Parameters<typeof completeFlashBoardChatRun>[1]['executedToolCalls'] = [];
  const run = beginFlashBoardChatRun({ ...request, prompt }, systemPrompt);
  const tracedRequest: FlashBoardChatRequest = {
    ...request,
    prompt,
    onExecutedToolCalls: (toolCalls) => {
      executedToolCalls.push(...toolCalls);
      request.onExecutedToolCalls?.(toolCalls);
    },
  };

  try {
    const response = request.provider === 'lemonade'
      ? await sendLemonadeChat(tracedRequest, systemPrompt)
      : await sendKieChat(tracedRequest, systemPrompt);
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
