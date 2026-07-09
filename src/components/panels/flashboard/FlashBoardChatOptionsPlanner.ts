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
import { DEFAULT_LEMONADE_MODEL, type LemonadeModelInfo } from '../../../services/lemonadeProvider';

interface BuildFlashBoardChatOptionsStateInput {
  chatModel: string;
  chatProvider: FlashBoardChatProvider;
  isChatting: boolean;
  lemonadeModels: LemonadeModelInfo[];
  useHostedProductionProviders: boolean;
  useOpenAiKeyByDefault: boolean;
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
  chatModel,
  chatProvider,
  lemonadeModels,
}: Pick<BuildFlashBoardChatOptionsStateInput, 'chatModel' | 'chatProvider' | 'lemonadeModels'>): FlashBoardChatModelOption[] {
  if (chatProvider !== 'lemonade') {
    return FLASHBOARD_CHAT_MODEL_OPTIONS[chatProvider];
  }

  const discoveredModels = lemonadeModels.map((model) => ({
    id: model.id,
    label: model.name || model.id,
    provider: 'lemonade' as const,
    supportsTemperature: true,
  }));
  const fallbackModels = FLASHBOARD_CHAT_MODEL_OPTIONS.lemonade;
  const mergedModels = discoveredModels.length > 0 ? discoveredModels : fallbackModels;

  if (discoveredModels.length === 0 && chatModel && !mergedModels.some((model) => model.id === chatModel)) {
    return [
      ...mergedModels,
      {
        id: chatModel,
        label: chatModel === DEFAULT_LEMONADE_MODEL ? 'Lemonade' : chatModel,
        provider: 'lemonade',
        supportsTemperature: true,
      },
    ];
  }

  return mergedModels;
}

export function buildFlashBoardChatOptionsState({
  chatModel,
  chatProvider,
  isChatting,
  lemonadeModels,
  useHostedProductionProviders,
  useOpenAiKeyByDefault,
}: BuildFlashBoardChatOptionsStateInput): FlashBoardChatOptionsState {
  const chatModelOptions = buildFlashBoardChatModelOptions({ chatModel, chatProvider, lemonadeModels });
  const activeChatModel = chatModelOptions.find((model) => model.id === chatModel) ?? chatModelOptions[0];
  const activeChatModelId = activeChatModel?.id ?? chatModel;
  const chatTemperatureSupported = activeChatModel?.supportsTemperature ?? chatProvider !== 'openai';
  const chatReasoningSupported = chatProvider === 'openai' && isOpenAiReasoningEffortSupported(activeChatModelId);
  const chatReasoningEffortOptions = chatReasoningSupported ? getOpenAiReasoningEffortOptions(activeChatModelId) : [];
  const chatProviderOptions = useHostedProductionProviders
    ? FLASHBOARD_CHAT_PROVIDERS.filter((provider) => provider.id === 'openai')
    : FLASHBOARD_CHAT_PROVIDERS;
  const chatProviderLabel = chatProviderOptions.find((provider) => provider.id === chatProvider)?.label ?? 'Chat';
  const chatCreditLabel = chatProvider === 'openai' && (useHostedProductionProviders || !useOpenAiKeyByDefault)
    ? getFlashBoardChatCreditLabel(activeChatModelId)
    : null;

  return {
    activeChatModel,
    activeChatModelId,
    chatButtonLabel: isChatting ? 'Stop' : chatCreditLabel ? `Chat - ${chatCreditLabel}` : 'Chat',
    chatChargeTitle: chatCreditLabel
      ? `${chatCreditLabel} per hosted model round. Tool follow-up rounds are charged separately.`
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
  lemonadeModels: LemonadeModelInfo[],
): string | undefined {
  return provider === 'lemonade'
    ? lemonadeModels[0]?.id ?? FLASHBOARD_CHAT_MODEL_OPTIONS.lemonade[0]?.id
    : FLASHBOARD_CHAT_MODEL_OPTIONS[provider][0]?.id;
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
