import { tryKernelFirst } from '../kernelClient/kernelChatGateway';
import { buildFlashBoardChatSystemPrompt } from './FlashBoardChatPrompt';
import { sendKieChat, sendLemonadeChat } from './FlashBoardChatProviderTransport';
import {
  beginFlashBoardChatRun,
  completeFlashBoardChatRun,
} from './FlashBoardChatRunAudit';
import { useSettingsStore } from '../../stores/settingsStore';
import { findPreconditionResolver } from '../kernelClient/preconditionResolvers';
import type { KernelRunReport } from '../kernelClient/runReport';
import type {
  FlashBoardChatRequest,
  FlashBoardExecutedToolCall,
} from './FlashBoardChatTypes';

export type { KernelProgressEvent } from '../kernelClient/runProgress';
export type { KernelRunReport } from '../kernelClient/runReport';
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
  DEFAULT_FLASHBOARD_KERNEL_MODEL,
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

/**
 * Projects kernel run steps into the executed-tool-call shape the chat run
 * audit and the Prompt Book already understand.
 */
function kernelExecutedToolCalls(
  report: KernelRunReport | undefined,
): FlashBoardExecutedToolCall[] {
  if (!report) return [];
  return report.steps.map((step) => ({
    modelContent: step.error ?? (step.status === 'ok' ? 'ok' : step.status),
    result: step.status === 'ok'
      ? { success: true as const }
      : { success: false as const, error: step.error ?? 'Step failed.' },
    toolCall: {
      id: step.stepId,
      name: step.tool,
      arguments: JSON.stringify(step.args ?? {}),
    },
  }));
}

export async function sendFlashBoardChatMessage(request: FlashBoardChatRequest): Promise<string> {
  const prompt = request.prompt.trim();
  if (!prompt) {
    throw new Error('Write a prompt before starting chat.');
  }

  if (request.provider === 'kernel') {
    request.onPhase?.('kernel');
    // Establishing a missing precondition (transcribing, analysing) is a
    // mutating action, so it goes through the approval switch the user already
    // controls — the "Auto" button next to send.
    const autoApprove = useSettingsStore.getState().aiApprovalMode === 'auto';
    const kernelResult = await tryKernelFirst(request.playbookPrompt ?? prompt, {
      autoApprove,
      satisfyPrecondition: async (precondition, context) => {
        const resolver = findPreconditionResolver(precondition.kind);
        return resolver ? resolver.satisfy(context) : false;
      },
      ...(request.idempotencyKey === undefined
        ? {}
        : { seed: request.idempotencyKey }),
      ...(request.onKernelProgress === undefined
        ? {}
        : { onProgress: request.onKernelProgress }),
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    });
    if (kernelResult.handled) {
      const kernelRun = beginFlashBoardChatRun(
        { ...request, prompt },
        kernelResult.runId === undefined
          ? 'agent-kernel: selected MasterSelectsAI run'
          : `agent-kernel: selected MasterSelectsAI run ${kernelResult.runId}`,
      );
      const completed = completeFlashBoardChatRun(kernelRun.runId, {
        executedToolCalls: kernelExecutedToolCalls(kernelResult.report),
        response: kernelResult.message,
      });
      if (completed) request.onRunCompleted?.(completed);
      if (kernelResult.report) request.onKernelReport?.(kernelResult.report);
      return kernelResult.message;
    }

    throw new Error(
      'MasterSelectsAI kernel is unavailable. Start the dev kernel or select AI / Local AI.'
    );
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
