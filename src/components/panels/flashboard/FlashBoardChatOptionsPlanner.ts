import {
  DEFAULT_FLASHBOARD_OPENAI_REASONING_EFFORT,
  FLASHBOARD_CHAT_MODEL_OPTIONS,
  FLASHBOARD_CHAT_PROVIDERS,
  getFlashBoardChatCreditLabel,
  getOpenAiReasoningEffortOptions,
  isOpenAiReasoningEffortSupported,
  type FlashBoardChatModelOption,
  type FlashBoardChatProvider,
  type FlashBoardChatProviderOption,
  type FlashBoardOpenAiReasoningEffort,
} from '../../../services/flashboard/FlashBoardChatService';

interface BuildFlashBoardChatOptionsStateInput {
  chatModel: string;
  chatProvider: FlashBoardChatProvider;
  isChatting: boolean;
}

export interface FlashBoardChatOptionsState {
  activeChatModel?: FlashBoardChatModelOption;
  activeChatModelId: string;
  chatButtonLabel: string;
  chatChargeTitle?: string;
  chatCreditLabel: string | null;
  chatModelOptions: FlashBoardChatModelOption[];
  chatProviderLabel: string;
  chatProviderOptions: FlashBoardChatProviderOption[];
  chatReasoningEffortOptions: ReturnType<typeof getOpenAiReasoningEffortOptions>;
  chatReasoningSupported: boolean;
  chatTemperatureSupported: boolean;
}

export function buildFlashBoardChatModelOptions({
  chatProvider,
}: Pick<BuildFlashBoardChatOptionsStateInput, 'chatProvider'>): FlashBoardChatModelOption[] {
  return FLASHBOARD_CHAT_MODEL_OPTIONS[chatProvider];
}

export function buildFlashBoardChatOptionsState({
  chatModel,
  chatProvider,
  isChatting,
}: BuildFlashBoardChatOptionsStateInput): FlashBoardChatOptionsState {
  const chatModelOptions = buildFlashBoardChatModelOptions({ chatProvider });
  const activeChatModel = chatModelOptions.find((model) => model.id === chatModel) ?? chatModelOptions[0];
  const activeChatModelId = activeChatModel?.id ?? chatModel;
  const chatTemperatureSupported = activeChatModel?.supportsTemperature ?? chatProvider !== 'kie';
  const chatReasoningSupported = chatProvider === 'kie' && isOpenAiReasoningEffortSupported(activeChatModelId);
  const chatReasoningEffortOptions = chatReasoningSupported ? getOpenAiReasoningEffortOptions(activeChatModelId) : [];
  const chatProviderOptions = FLASHBOARD_CHAT_PROVIDERS;
  const chatProviderLabel = chatProviderOptions.find((provider) => provider.id === chatProvider)?.label ?? 'Chat';
  const chatCreditLabel = chatProvider === 'kie'
    ? getFlashBoardChatCreditLabel(activeChatModelId)
    : null;

  return {
    activeChatModel,
    activeChatModelId,
    chatButtonLabel: isChatting ? 'Stop' : 'Chat',
    chatChargeTitle: chatCreditLabel
      ? `${chatCreditLabel} of actual Kie.ai usage across the complete agent turn. An active turn can finish if the balance runs out; starting a new turn then requires credits.`
      : undefined,
    chatCreditLabel,
    chatModelOptions,
    chatProviderLabel,
    chatProviderOptions,
    chatReasoningEffortOptions,
    chatReasoningSupported,
    chatTemperatureSupported,
  };
}

export function buildFlashBoardChatProviderDefaultModel(
  provider: FlashBoardChatProvider,
): string | undefined {
  return FLASHBOARD_CHAT_MODEL_OPTIONS[provider][0]?.id;
}

export function buildFlashBoardChatProviderFallback({
  chatProvider,
  chatProviderOptions,
}: {
  chatProvider: FlashBoardChatProvider;
  chatProviderOptions: FlashBoardChatProviderOption[];
}): FlashBoardChatProvider | undefined {
  return chatProviderOptions.some((provider) => provider.id === chatProvider)
    ? undefined
    : chatProviderOptions[0]?.id;
}

export function buildFlashBoardChatModelFallback({
  chatModel,
  chatModelOptions,
}: {
  chatModel: string;
  chatModelOptions: FlashBoardChatModelOption[];
}): string | undefined {
  return chatModelOptions.length > 0 && !chatModelOptions.some((model) => model.id === chatModel)
    ? chatModelOptions[0]?.id ?? chatModel
    : undefined;
}

export function buildFlashBoardChatReasoningFallback({
  chatReasoningEffortOptions,
  chatReasoningSupported,
  openAiReasoningEffort,
}: {
  chatReasoningEffortOptions: ReturnType<typeof getOpenAiReasoningEffortOptions>;
  chatReasoningSupported: boolean;
  openAiReasoningEffort: FlashBoardOpenAiReasoningEffort;
}): FlashBoardOpenAiReasoningEffort | undefined {
  return chatReasoningSupported
    && chatReasoningEffortOptions.length > 0
    && !chatReasoningEffortOptions.some((option) => option.id === openAiReasoningEffort)
    ? DEFAULT_FLASHBOARD_OPENAI_REASONING_EFFORT
    : undefined;
}
