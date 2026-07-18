import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import {
  DEFAULT_FLASHBOARD_CHAT_MODEL,
  DEFAULT_FLASHBOARD_CHAT_TEMPERATURE,
  DEFAULT_FLASHBOARD_OPENAI_REASONING_EFFORT,
  sendFlashBoardChatMessage,
  type FlashBoardExecutedToolCall,
  type FlashBoardChatProvider,
  type FlashBoardOpenAiReasoningEffort,
} from '../../../services/flashboard/FlashBoardChatService';
import { flags } from '../../../engine/featureFlags';
import { useFlashBoardStore } from '../../../stores/flashboardStore';
import { appendFlashBoardPromptHistoryEntry } from '../../../stores/flashboardStore/activeGenerationRecords';
import type { AIProvider } from '../../../stores/settingsStore';
import {
  checkLemonadeHealth,
  DEFAULT_LEMONADE_MODEL,
  type LemonadeModelInfo,
} from '../../../services/lemonadeProvider';
import {
  buildFlashBoardChatModelFallback,
  buildFlashBoardChatOptionsState,
  buildFlashBoardChatProviderDefaultModel,
  buildFlashBoardChatProviderFallback,
  buildFlashBoardChatReasoningFallback,
} from './FlashBoardChatOptionsPlanner';
import type { FlashBoardChatMessage } from './FlashBoardChatOutput';
import {
  buildFlashBoardChatApplyOptionPrompt,
  buildFlashBoardChatEditOptionsPrompt,
  parseFlashBoardChatEditOptions,
  type FlashBoardChatEditOption,
} from './FlashBoardChatEditOptions';
import {
  buildFlashBoardChatCompletionMessages,
  buildFlashBoardChatErrorMessages,
  buildFlashBoardChatOptimisticMessages,
  buildFlashBoardChatSendPlan,
} from './FlashBoardChatSendPlanner';

interface UseFlashBoardChatControllerInput {
  aiProvider: AIProvider;
  aiSystemPromptSendContext: Partial<Record<AIProvider, boolean>>;
  aiSystemPromptOverrides: Partial<Record<AIProvider, string>>;
  anthropicApiKey: string;
  closePopover: () => void;
  hasAnthropicKey: boolean;
  hasHostedSession: boolean;
  hasOpenAiKey: boolean;
  hostedAIEnabled: boolean;
  initialMode: 'generate' | 'chat';
  lemonadeContextSize: number;
  lemonadeEndpoint: string;
  lemonadeModel: string;
  openAiApiKey: string;
  openAuthDialog: () => void;
  openPricingDialog: () => void;
  openSettings: () => void;
  setAiProvider: (provider: AIProvider) => void;
  setLemonadeModel: (model: string) => void;
  useHostedProductionProviders: boolean;
  useOpenAiKeyByDefault: boolean;
}

function createFlashBoardChatMessageId(role: FlashBoardChatMessage['role']): string {
  return `${role}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function useFlashBoardChatController({
  aiProvider,
  aiSystemPromptSendContext,
  aiSystemPromptOverrides,
  anthropicApiKey,
  closePopover,
  hasAnthropicKey,
  hasHostedSession,
  hasOpenAiKey,
  hostedAIEnabled,
  initialMode,
  lemonadeContextSize,
  lemonadeEndpoint,
  lemonadeModel,
  openAiApiKey,
  openAuthDialog,
  openPricingDialog,
  openSettings,
  setAiProvider,
  setLemonadeModel,
  useHostedProductionProviders,
  useOpenAiKeyByDefault,
}: UseFlashBoardChatControllerInput) {
  const chatAbortRef = useRef<AbortController | null>(null);
  const copiedChatResetTimeoutRef = useRef<number | null>(null);
  const [chatPanelOpen, setChatPanelOpen] = useState(initialMode === 'chat');
  const [chatPrompt, setChatPrompt] = useState('');
  const [chatProvider, setChatProvider] = useState<FlashBoardChatProvider>(aiProvider);
  const [chatModel, setChatModelState] = useState(
    aiProvider === 'lemonade' ? (lemonadeModel.trim() || DEFAULT_LEMONADE_MODEL) : DEFAULT_FLASHBOARD_CHAT_MODEL,
  );
  const [chatTemperature, setChatTemperature] = useState(DEFAULT_FLASHBOARD_CHAT_TEMPERATURE);
  const [openAiReasoningEffort, setOpenAiReasoningEffort] = useState<FlashBoardOpenAiReasoningEffort>(
    DEFAULT_FLASHBOARD_OPENAI_REASONING_EFFORT,
  );
  const chatMessages = useFlashBoardStore((state) => state.chatMessages);
  const setChatMessages = useCallback((
    updater: FlashBoardChatMessage[] | ((current: FlashBoardChatMessage[]) => FlashBoardChatMessage[]),
  ) => {
    useFlashBoardStore.setState((state) => ({
      chatMessages: typeof updater === 'function' ? updater(state.chatMessages) : updater,
    }));
  }, []);
  const [copiedChatMessageId, setCopiedChatMessageId] = useState<string | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);
  const [isChatting, setIsChatting] = useState(false);
  const [chatOptionsMode, setChatOptionsMode] = useState(false);
  const [lemonadeStatus, setLemonadeStatus] = useState<'idle' | 'checking' | 'online' | 'offline'>('idle');
  const [lemonadeModels, setLemonadeModels] = useState<LemonadeModelInfo[]>([]);
  const chatOptionsModeEnabled = flags.flashBoardChatEditOptions;
  const chatSystemPromptProvider: AIProvider = chatProvider === 'lemonade' ? 'lemonade' : 'openai';
  const chatSystemPromptSendContext = aiSystemPromptSendContext[chatSystemPromptProvider] !== false;
  const chatSystemPromptOverride = chatProvider === 'anthropic'
    ? undefined
    : aiSystemPromptOverrides[chatSystemPromptProvider]?.trim()
      ? aiSystemPromptOverrides[chatSystemPromptProvider]
      : undefined;

  const chatOptionsState = useMemo(() => buildFlashBoardChatOptionsState({
    chatModel,
    chatProvider,
    isChatting,
    lemonadeModels,
    useHostedProductionProviders,
    useOpenAiKeyByDefault,
  }), [chatModel, chatProvider, isChatting, lemonadeModels, useHostedProductionProviders, useOpenAiKeyByDefault]);
  const {
    activeChatModelId,
    chatModelOptions,
    chatProviderOptions,
    chatReasoningEffortOptions,
    chatReasoningSupported,
  } = chatOptionsState;
  const canUseHostedChat = Boolean(chatProvider === 'openai' && hasHostedSession && hostedAIEnabled);
  const canUseByoChat = Boolean(chatProvider === 'openai' && !useHostedProductionProviders && hasOpenAiKey);
  const shouldUseHostedChat = Boolean(canUseHostedChat && (useHostedProductionProviders || !useOpenAiKeyByDefault));
  const showChatCloudActions = Boolean(chatError && !hasHostedSession && /sign in/i.test(chatError));

  useEffect(() => {
    const fallbackModel = buildFlashBoardChatModelFallback({ chatModel, chatModelOptions });
    if (fallbackModel) {
      setChatModelState(fallbackModel);
      if (chatProvider === 'lemonade') setLemonadeModel(fallbackModel);
    }
  }, [chatModel, chatModelOptions, chatProvider, setLemonadeModel]);

  useEffect(() => {
    setChatPanelOpen(initialMode === 'chat');
    setChatError(null);
  }, [initialMode]);

  useEffect(() => {
    if (isChatting || chatProvider === 'anthropic' || chatProvider === aiProvider) {
      return;
    }

    setChatProvider(aiProvider);
    setChatModelState(
      aiProvider === 'lemonade'
        ? (lemonadeModel.trim() || DEFAULT_LEMONADE_MODEL)
        : DEFAULT_FLASHBOARD_CHAT_MODEL,
    );
    setChatError(null);
  }, [aiProvider, chatProvider, isChatting, lemonadeModel]);

  useEffect(() => {
    const fallbackReasoningEffort = buildFlashBoardChatReasoningFallback({
      chatReasoningEffortOptions,
      chatReasoningSupported,
      openAiReasoningEffort,
    });
    if (fallbackReasoningEffort) setOpenAiReasoningEffort(fallbackReasoningEffort);
  }, [chatReasoningEffortOptions, chatReasoningSupported, openAiReasoningEffort]);

  useEffect(() => {
    if (!chatPanelOpen || chatProvider !== 'lemonade') {
      return;
    }

    let cancelled = false;
    setLemonadeStatus('checking');

    void checkLemonadeHealth(lemonadeEndpoint).then((health) => {
      if (cancelled) {
        return;
      }

      setLemonadeModels(health.models);
      setLemonadeStatus(health.available ? 'online' : 'offline');
    });

    return () => {
      cancelled = true;
    };
  }, [chatPanelOpen, chatProvider, lemonadeEndpoint]);

  const handleChatProviderSelect = useCallback((provider: FlashBoardChatProvider) => {
    setChatProvider(provider);
    if (provider !== 'anthropic') setAiProvider(provider);
    setChatError(null);

    const nextDefaultModel = buildFlashBoardChatProviderDefaultModel(provider, lemonadeModels);

    if (nextDefaultModel) {
      setChatModelState(nextDefaultModel);
      if (provider === 'lemonade') setLemonadeModel(nextDefaultModel);
    }
  }, [lemonadeModels, setAiProvider, setLemonadeModel]);

  const handleChatModelSelect = useCallback((model: string) => {
    setChatModelState(model);
    if (chatProvider === 'lemonade') setLemonadeModel(model);
  }, [chatProvider, setLemonadeModel]);

  useEffect(() => {
    const fallbackProvider = buildFlashBoardChatProviderFallback({ chatProvider, chatProviderOptions });
    if (fallbackProvider) {
      handleChatProviderSelect(fallbackProvider);
    }
  }, [chatProvider, chatProviderOptions, handleChatProviderSelect]);

  const submitChatPrompt = useCallback(async (
    promptOverride?: string,
    options: { optionsMode?: boolean; visiblePrompt?: string } = {},
  ) => {
    closePopover();

    const effectiveChatPrompt = (promptOverride ?? chatPrompt).trim();
    const useEditOptions = chatOptionsModeEnabled && (options.optionsMode ?? chatOptionsMode);
    const requestPrompt = effectiveChatPrompt && useEditOptions
      ? buildFlashBoardChatEditOptionsPrompt(effectiveChatPrompt)
      : effectiveChatPrompt;
    const visibleUserPrompt = options.visiblePrompt ?? effectiveChatPrompt;
    const chatSendPlan = buildFlashBoardChatSendPlan({
      activeChatModelId,
      anthropicApiKey,
      canUseByoChat,
      canUseHostedChat,
      chatMessages,
      chatPanelOpen,
      chatProvider,
      chatTemperature,
      effectiveChatPrompt: requestPrompt,
      hasAnthropicKey,
      hasHostedSession,
      hostedAIEnabled,
      isChatting,
      lemonadeContextSize,
      lemonadeEndpoint,
      openAiApiKey,
      openAiReasoningEffort,
      shouldUseHostedChat,
      useHostedProductionProviders,
    });

    if (chatSendPlan.action === 'openPanel') {
      setChatPanelOpen(true);
      setChatError(null);
      return;
    }

    if (chatSendPlan.action === 'abort') {
      chatAbortRef.current?.abort();
      return;
    }

    if (chatSendPlan.action === 'error') {
      setChatError(chatSendPlan.errorMessage);
      if (chatSendPlan.dialogTarget === 'auth') openAuthDialog();
      if (chatSendPlan.dialogTarget === 'pricing') openPricingDialog();
      if (chatSendPlan.dialogTarget === 'settings') openSettings();
      return;
    }

    const abortController = new AbortController();
    chatAbortRef.current?.abort();
    chatAbortRef.current = abortController;
    const userMessageId = createFlashBoardChatMessageId('user');
    const assistantMessageId = createFlashBoardChatMessageId('assistant');
    const optimisticMessages = buildFlashBoardChatOptimisticMessages({
      assistantMessageId,
      userMessageId,
      userPrompt: visibleUserPrompt,
    });

    setIsChatting(true);
    setChatError(null);
    if (promptOverride === undefined) {
      setChatPrompt('');
    }
    setChatMessages((current) => [
      ...current,
      ...optimisticMessages,
    ]);
    appendFlashBoardPromptHistoryEntry({ kind: 'chat', prompt: visibleUserPrompt });

    try {
      const executedToolCalls: FlashBoardExecutedToolCall[] = [];
      const response = await sendFlashBoardChatMessage({
        ...chatSendPlan.request,
        onExecutedToolCalls: (toolCalls) => executedToolCalls.push(...toolCalls),
        signal: abortController.signal,
        systemPromptIncludeContext: chatSystemPromptSendContext,
        systemPromptOverride: chatSystemPromptOverride,
      });
      const editOptions = useEditOptions ? parseFlashBoardChatEditOptions(response) : undefined;
      setChatMessages((current) => buildFlashBoardChatCompletionMessages(
        current,
        assistantMessageId,
        response,
        editOptions,
        executedToolCalls,
      ));
    } catch (error) {
      const errorMessage = abortController.signal.aborted
        ? 'Chat stopped.'
        : error instanceof Error ? error.message : 'Chat request failed.';
      setChatMessages((current) => buildFlashBoardChatErrorMessages(current, assistantMessageId, errorMessage));
    } finally {
      if (chatAbortRef.current === abortController) {
        chatAbortRef.current = null;
      }
      setIsChatting(false);
    }
  }, [
    activeChatModelId,
    anthropicApiKey,
    chatSystemPromptOverride,
    chatSystemPromptSendContext,
    chatOptionsMode,
    chatOptionsModeEnabled,
    chatMessages,
    chatPanelOpen,
    chatPrompt,
    chatProvider,
    chatTemperature,
    closePopover,
    canUseByoChat,
    canUseHostedChat,
    hasAnthropicKey,
    hostedAIEnabled,
    hasHostedSession,
    isChatting,
    lemonadeContextSize,
    lemonadeEndpoint,
    openAiApiKey,
    openAiReasoningEffort,
    openAuthDialog,
    openPricingDialog,
    openSettings,
    shouldUseHostedChat,
    setChatMessages,
    useHostedProductionProviders,
  ]);

  const handleChatButtonClick = useCallback(async () => {
    await submitChatPrompt();
  }, [submitChatPrompt]);

  const handleEditOptionSelect = useCallback((option: FlashBoardChatEditOption) => {
    void submitChatPrompt(
      buildFlashBoardChatApplyOptionPrompt(option),
      {
        optionsMode: false,
        visiblePrompt: `Use option ${option.index}: ${option.title}`,
      },
    );
  }, [submitChatPrompt]);

  const handleClearChatHistory = useCallback(() => {
    closePopover();
    chatAbortRef.current?.abort();
    chatAbortRef.current = null;
    if (copiedChatResetTimeoutRef.current !== null) {
      window.clearTimeout(copiedChatResetTimeoutRef.current);
      copiedChatResetTimeoutRef.current = null;
    }
    setChatMessages([]);
    setChatPrompt('');
    setChatError(null);
    setCopiedChatMessageId(null);
    setIsChatting(false);
  }, [closePopover, setChatMessages]);

  const handleChatMessageDoubleClick = useCallback((message: FlashBoardChatMessage) => {
    if (message.role !== 'assistant' || message.isPending || !message.text.trim()) {
      return;
    }

    if (!navigator.clipboard?.writeText) {
      setChatError('Clipboard is unavailable in this browser.');
      return;
    }

    void navigator.clipboard.writeText(message.text).then(() => {
      setCopiedChatMessageId(message.id);
      if (copiedChatResetTimeoutRef.current !== null) {
        window.clearTimeout(copiedChatResetTimeoutRef.current);
      }
      copiedChatResetTimeoutRef.current = window.setTimeout(() => {
        setCopiedChatMessageId(null);
        copiedChatResetTimeoutRef.current = null;
      }, 1100);
    }).catch(() => {
      setChatError('Could not copy response.');
    });
  }, []);

  const handleChatInputKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) {
      return;
    }

    if (event.ctrlKey || event.metaKey) {
      return;
    }

    event.preventDefault();
    void handleChatButtonClick();
  }, [handleChatButtonClick]);

  const handleChatPromptChange = useCallback((value: string) => {
    setChatPrompt(value);
    setChatError(null);
  }, []);

  const handleClearChatPrompt = useCallback(() => {
    setChatPrompt('');
    setChatError(null);
  }, []);

  const clearChatError = useCallback(() => {
    setChatError(null);
  }, []);

  useEffect(() => () => {
    chatAbortRef.current?.abort();
    if (copiedChatResetTimeoutRef.current !== null) {
      window.clearTimeout(copiedChatResetTimeoutRef.current);
    }
  }, []);

  return {
    ...chatOptionsState,
    chatError,
    chatMessages,
    chatOptionsMode,
    chatOptionsModeEnabled,
    chatPanelOpen,
    chatPrompt,
    chatProvider,
    chatTemperature,
    clearChatError,
    copiedChatMessageId,
    handleChatButtonClick,
    handleChatInputKeyDown,
    handleChatMessageDoubleClick,
    handleEditOptionSelect,
    handleChatProviderSelect,
    handleChatPromptChange,
    handleClearChatHistory,
    handleClearChatPrompt,
    isChatting,
    lemonadeStatus,
    openAiReasoningEffort,
    chatSystemPromptProvider,
    chatSystemPromptSendContext,
    setChatOptionsMode,
    setChatModel: handleChatModelSelect,
    setChatTemperature,
    setOpenAiReasoningEffort,
    showChatCloudActions,
  };
}
