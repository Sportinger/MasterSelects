import { tryKernelFirst } from '../kernelClient/kernelChatGateway';
import { buildFlashBoardChatSystemPrompt } from './FlashBoardChatPrompt';
import { sendKieChat } from './FlashBoardChatProviderTransport';
import {
  appendFlashBoardChatRunToolCalls,
  beginFlashBoardChatRun,
  completeFlashBoardChatRun,
} from './FlashBoardChatRunAudit';
import { findPreconditionResolver } from '../kernelClient/preconditionResolvers';
import type { KernelRunReport } from '../kernelClient/runReport';
import type {
  FlashBoardChatRequest,
  FlashBoardExecutedToolCall,
} from './FlashBoardChatTypes';

export type { KernelProgressEvent } from '../kernelClient/runProgress';
export type { KernelRunReport } from '../kernelClient/runReport';
export type {
  AgentActivityEvent,
  ChatIntent,
  DecisionPolicy,
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
  FLASHBOARD_CHAT_SYSTEM_PROMPT,
} from './FlashBoardChatPrompt';
export type { FlashBoardChatRunRecord } from './FlashBoardChatRunAudit';

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
    const kernelResult = await tryKernelFirst(request.playbookPrompt ?? prompt, {
      autoApprove: true,
      satisfyPrecondition: async (precondition, context) => {
        const resolver = findPreconditionResolver(precondition.kind);
        return resolver ? resolver.satisfy(context) : false;
      },
      ...(request.intent === undefined ? {} : { intent: request.intent }),
      ...(request.decisionPolicy === undefined
        ? {}
        : { decisionPolicy: request.decisionPolicy }),
      ...(request.activeDecision === undefined
        ? {}
        : { activeDecision: request.activeDecision }),
      ...(request.idempotencyKey === undefined
        ? {}
        : { seed: request.idempotencyKey }),
      ...(request.onKernelProgress === undefined
        ? {}
        : { onProgress: request.onKernelProgress }),
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    });
    if (kernelResult.handled) {
      if (kernelResult.decision) request.onKernelDecision?.(kernelResult.decision);
      const kernelRun = beginFlashBoardChatRun({ ...request, prompt });
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

  request.onPhase?.(
    request.provider === 'kie' && request.hostedAvailable ? 'kernel' : 'provider',
  );
  const systemPrompt = buildFlashBoardChatSystemPrompt({
    includeContext: true,
    userPrompt: request.playbookPrompt ?? prompt,
    visualReferences: request.visualReferences,
  });
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
    const response = await sendKieChat(tracedRequest, systemPrompt);
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
