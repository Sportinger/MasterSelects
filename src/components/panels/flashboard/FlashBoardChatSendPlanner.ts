import type {
  FlashBoardChatProvider,
  FlashBoardChatRequest,
  FlashBoardOpenAiReasoningEffort,
  ChatIntent,
  DecisionPolicy,
} from '../../../services/flashboard/FlashBoardChatService';
import { buildFlashBoardChatRequestPrompt } from '../../../services/flashboard/FlashBoardChatHistory';
import type { FlashBoardChatMessage } from './FlashBoardChatOutput';

export { buildFlashBoardChatRequestPrompt } from '../../../services/flashboard/FlashBoardChatHistory';

type FlashBoardChatDialogTarget = 'auth' | 'pricing' | 'settings';
type FlashBoardChatPlannedRequest = Omit<FlashBoardChatRequest, 'signal'>;

interface BuildFlashBoardChatSendPlanInput {
  activeChatModelId: string;
  canUseByoChat: boolean;
  canUseHostedChat: boolean;
  chatMessages: FlashBoardChatMessage[];
  chatPanelOpen: boolean;
  planThreeEnabled: boolean;
  chatProvider: FlashBoardChatProvider;
  chatTemperature: number;
  chatIntent?: ChatIntent;
  decisionPolicy?: DecisionPolicy;
  effectiveChatPrompt: string;
  hasHostedSession: boolean;
  hostedAIEnabled: boolean;
  isChatting: boolean;
  lemonadeContextSize: number;
  lemonadeEndpoint: string;
  kieAiApiKey: string;
  openAiReasoningEffort: FlashBoardOpenAiReasoningEffort;
  shouldUseHostedChat: boolean;
  useHostedProductionProviders: boolean;
}

export type FlashBoardChatSendPlan =
  | { action: 'openPanel' }
  | { action: 'abort' }
  | { action: 'error'; dialogTarget?: FlashBoardChatDialogTarget; errorMessage: string }
  | { action: 'send'; request: FlashBoardChatPlannedRequest };

export function buildFlashBoardPlanThreePrompt(
  userPrompt: string,
  planThreeEnabled: boolean,
  intent: ChatIntent = 'execute',
): string {
  if (!planThreeEnabled) return userPrompt;

  if (intent === 'plan') {
    return `[PLAN 3 MODE]
Develop exactly three separate storyboard or range-variant options without materializing real compositions or changing real media.

- Option 1 — Balanced: the clearest, most faithful interpretation of the brief.
- Option 2 — Dynamic: a tighter, more energetic alternative.
- Option 3 — Alternative: a distinctly different creative interpretation that still respects the brief.
- Keep all three options independently identifiable, explain their trade-offs, and prepare only local/non-paid briefs.
- Do not submit generation jobs, import media, export, or claim that an option is already playable.

Original request:
${userPrompt}`;
  }

  return `[PLAN 3 MODE]
Carry out the request as exactly three separate, new, user-visible compositions. Preserve all existing compositions.

- Version 1 — Balanced: the clearest, most faithful interpretation of the brief.
- Version 2 — Dynamic: a tighter, more energetic alternative.
- Version 3 — Alternative: a distinctly different creative interpretation that still respects the brief.
- Give the three compositions clear, related names and make them meaningfully different through clip selection, structure, pacing, and/or visual treatment.
- Fully build and verify all three in this turn. Do not merely describe three ideas, do not place all versions in one composition, and do not stop after the first version.

Original request:
${userPrompt}`;
}

export function buildFlashBoardChatIntentPrompt(
  userPrompt: string,
  intent: ChatIntent,
  decisionPolicy: DecisionPolicy,
): string {
  if (intent === 'execute' && decisionPolicy === 'automatic') return userPrompt;
  const policyInstruction = decisionPolicy === 'every-decision'
    ? 'Pause for every material creative decision and present explicit options.'
    : decisionPolicy === 'milestones'
      ? 'Pause at meaningful creative or spending milestones and present explicit options.'
      : 'Proceed automatically within the active safety and spending gates.';
  const intentInstruction = intent === 'plan'
    ? 'Work only on storyboard, decisions, templates, evidence, coverage, and generation preparation. Do not mutate real media, submit a provider job, export, or imply that those actions happened.'
    : 'Execute through the verified editor tools, while respecting every approval and decision gate.';
  return `[DIRECTING MODE: ${intent.toUpperCase()}]
${intentInstruction}
${policyInstruction}

User request:
${userPrompt}`;
}

export function buildFlashBoardChatSendPlan({
  activeChatModelId,
  canUseByoChat,
  canUseHostedChat,
  chatMessages,
  chatPanelOpen,
  planThreeEnabled,
  chatProvider,
  chatTemperature,
  chatIntent = 'execute',
  decisionPolicy = 'automatic',
  effectiveChatPrompt,
  hasHostedSession,
  hostedAIEnabled,
  isChatting,
  lemonadeContextSize,
  lemonadeEndpoint,
  kieAiApiKey,
  openAiReasoningEffort,
  shouldUseHostedChat,
  useHostedProductionProviders,
}: BuildFlashBoardChatSendPlanInput): FlashBoardChatSendPlan {
  if (!chatPanelOpen) {
    return { action: 'openPanel' };
  }

  if (isChatting) {
    return { action: 'abort' };
  }

  if (!effectiveChatPrompt) {
    return { action: 'error', errorMessage: 'Write a chat prompt before starting chat.' };
  }

  if (chatProvider === 'kie' && !canUseHostedChat && !canUseByoChat) {
    return {
      action: 'error',
      dialogTarget: useHostedProductionProviders || !hasHostedSession
        ? 'auth'
        : !hostedAIEnabled ? 'pricing' : 'settings',
      errorMessage: useHostedProductionProviders
        ? 'Sign in and enable hosted credits to use compact chat.'
        : 'Sign in or add a Kie.ai API key in Settings to use compact chat.',
    };
  }

  const executionPrompt = buildFlashBoardChatIntentPrompt(
    buildFlashBoardPlanThreePrompt(effectiveChatPrompt, planThreeEnabled, chatIntent),
    chatIntent,
    decisionPolicy,
  );

  return {
    action: 'send',
    request: {
      hostedAvailable: shouldUseHostedChat,
      kieAiApiKey,
      lemonadeContextSize: chatProvider === 'lemonade' ? lemonadeContextSize : undefined,
      lemonadeEndpoint,
      model: activeChatModelId,
      intent: chatIntent,
      decisionPolicy,
      openAiReasoningEffort,
      playbookPrompt: executionPrompt,
      prompt: buildFlashBoardChatRequestPrompt(chatMessages, executionPrompt),
      provider: chatProvider,
      temperature: chatTemperature,
      toolExecutionMode: chatIntent === 'plan' ? 'plan' : 'normal',
    },
  };
}

export function buildFlashBoardChatOptimisticMessages({
  assistantMessageId,
  userMessageId,
  userPrompt,
}: {
  assistantMessageId: string;
  userMessageId: string;
  userPrompt: string;
}): FlashBoardChatMessage[] {
  const createdAt = Date.now();
  return [
    { createdAt, id: userMessageId, role: 'user', text: userPrompt },
    { createdAt, id: assistantMessageId, role: 'assistant', text: 'Thinking...', isPending: true },
  ];
}

export function buildFlashBoardChatCompletionMessages(
  messages: FlashBoardChatMessage[],
  assistantMessageId: string,
  response: string,
  editOptions: FlashBoardChatMessage['editOptions'] = undefined,
  toolCalls: FlashBoardChatMessage['toolCalls'] = undefined,
  kernelReport: FlashBoardChatMessage['kernelReport'] = undefined,
  decisionId: FlashBoardChatMessage['decisionId'] = undefined,
): FlashBoardChatMessage[] {
  return messages.map((message) => (
    message.id === assistantMessageId
      ? {
          ...message,
          text: response || 'Empty response.',
          editOptions,
          toolCalls,
          kernelReport,
          decisionId,
          kernelProgress: undefined,
          isPending: false,
        }
      : message
  ));
}

export function buildFlashBoardChatErrorMessages(
  messages: FlashBoardChatMessage[],
  assistantMessageId: string,
  errorMessage: string,
): FlashBoardChatMessage[] {
  return messages.map((message) => (
    message.id === assistantMessageId
      ? {
          ...message,
          text: errorMessage,
          isError: true,
          isPending: false,
          kernelProgress: undefined,
        }
      : message
  ));
}
