import {
  DEFAULT_FLASHBOARD_DECISION_POLICY,
  type ChatIntent,
  type DecisionPolicy,
  type FlashBoardChatExecutionProfile,
  type FlashBoardChatModelClass,
  type FlashBoardChatProvider,
  type FlashBoardChatRequest,
  type FlashBoardOpenAiReasoningEffort,
} from '../../../services/flashboard/FlashBoardChatService';
import { buildFlashBoardChatRequestPrompt } from '../../../services/flashboard/FlashBoardChatHistory';
import type { FlashBoardChatMessage } from './FlashBoardChatOutput';

export { buildFlashBoardChatRequestPrompt } from '../../../services/flashboard/FlashBoardChatHistory';

type FlashBoardChatDialogTarget = 'auth' | 'pricing';
type FlashBoardChatPlannedRequest = Omit<FlashBoardChatRequest, 'signal'>;

interface BuildFlashBoardChatSendPlanInput {
  activeChatModelId: string;
  canUseHostedChat: boolean;
  chatMessages: FlashBoardChatMessage[];
  chatPanelOpen: boolean;
  planThreeEnabled: boolean;
  chatExecutionProfile?: FlashBoardChatExecutionProfile;
  chatModelClass?: FlashBoardChatModelClass;
  chatProvider: FlashBoardChatProvider;
  chatTemperature: number;
  chatIntent?: ChatIntent;
  decisionPolicy?: DecisionPolicy;
  effectiveChatPrompt: string;
  hasHostedSession: boolean;
  hostedAIEnabled: boolean;
  isChatting: boolean;
  openAiReasoningEffort: FlashBoardOpenAiReasoningEffort;
}

export type FlashBoardChatSendPlan =
  | { action: 'openPanel' }
  | { action: 'abort' }
  | { action: 'error'; dialogTarget?: FlashBoardChatDialogTarget; errorMessage: string }
  | { action: 'send'; request: FlashBoardChatPlannedRequest };

const MIN_DUPLICATED_PROMPT_LENGTH = 16;

export function normalizeFlashBoardSubmittedPrompt(value: string): string {
  const prompt = value.trim();
  if (prompt.length % 2 !== 0) return prompt;

  const midpoint = prompt.length / 2;
  const firstCopy = prompt.slice(0, midpoint);
  if (
    firstCopy.length < MIN_DUPLICATED_PROMPT_LENGTH
    || !/\s/u.test(firstCopy)
    || prompt.slice(midpoint) !== firstCopy
  ) return prompt;

  return firstCopy;
}

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
  canUseHostedChat,
  chatMessages,
  chatPanelOpen,
  planThreeEnabled,
  chatExecutionProfile = 'fast',
  chatModelClass,
  chatProvider,
  chatTemperature,
  chatIntent = 'execute',
  decisionPolicy = DEFAULT_FLASHBOARD_DECISION_POLICY,
  effectiveChatPrompt,
  hasHostedSession,
  hostedAIEnabled,
  isChatting,
  openAiReasoningEffort,
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

  if (chatProvider === 'kie' && !canUseHostedChat) {
    return {
      action: 'error',
      dialogTarget: !hasHostedSession ? 'auth' : 'pricing',
      errorMessage: !hasHostedSession
        ? 'Sign in to use AI chat.'
        : !hostedAIEnabled
          ? 'Enable hosted credits to use AI chat.'
          : 'Hosted AI is currently unavailable.',
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
      ...(chatProvider === 'kie' && canUseHostedChat
        ? {
            executionProfile: chatExecutionProfile,
            // Only forward a class the availability probe confirmed; a K2
            // selection must never receive a Fast V2 model class.
            ...(chatModelClass === undefined ? {} : { requestedModelClass: chatModelClass }),
          }
        : {}),
      hostedAvailable: canUseHostedChat,
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
          isStreaming: undefined,
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
          isStreaming: undefined,
          kernelProgress: undefined,
        }
      : message
  ));
}
