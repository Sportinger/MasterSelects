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
  DEFAULT_FLASHBOARD_CHAT_PROVIDER,
  DEFAULT_FLASHBOARD_CHAT_TEMPERATURE,
  DEFAULT_FLASHBOARD_OPENAI_REASONING_EFFORT,
  sendFlashBoardChatMessage,
  type FlashBoardChatProvider,
  type FlashBoardOpenAiReasoningEffort,
} from '../../../services/flashboard/FlashBoardChatService';
import { appendFlashBoardPromptHistoryEntry } from '../../../stores/flashboardStore/activeGenerationRecords';
import {
  checkLemonadeHealth,
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
  buildFlashBoardChatCompletionMessages,
  buildFlashBoardChatErrorMessages,
  buildFlashBoardChatOptimisticMessages,
  buildFlashBoardChatSendPlan,
} from './FlashBoardChatSendPlanner';

interface UseFlashBoardChatControllerInput {
  anthropicApiKey: string;
  closePopover: () => void;
  hasAnthropicKey: boolean;
  hasHostedSession: boolean;
  hasOpenAiKey: boolean;
  hostedAIEnabled: boolean;
  initialMode: 'generate' | 'chat';
  lemonadeEndpoint: string;
  openAiApiKey: string;
  openAuthDialog: () => void;
  openPricingDialog: () => void;
  openSettings: () => void;
  useHostedProductionProviders: boolean;
  useOpenAiKeyByDefault: boolean;
}

function createFlashBoardChatMessageId(role: FlashBoardChatMessage['role']): string {
  return `${role}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function useFlashBoardChatController({
  anthropicApiKey,
  closePopover,
  hasAnthropicKey,
  hasHostedSession,
  hasOpenAiKey,
  hostedAIEnabled,
  initialMode,
  lemonadeEndpoint,
  openAiApiKey,
  openAuthDialog,
  openPricingDialog,
  openSettings,
  useHostedProductionProviders,
  useOpenAiKeyByDefault,
}: UseFlashBoardChatControllerInput) {
  const chatAbortRef = useRef<AbortController | null>(null);
  const copiedChatResetTimeoutRef = useRef<number | null>(null);
  const [chatPanelOpen, setChatPanelOpen] = useState(initialMode === 'chat');
  const [chatPrompt, setChatPrompt] = useState('');
  const [chatProvider, setChatProvider] = useState<FlashBoardChatProvider>(DEFAULT_FLASHBOARD_CHAT_PROVIDER);
  const [chatModel, setChatModel] = useState(DEFAULT_FLASHBOARD_CHAT_MODEL);
  const [chatTemperature, setChatTemperature] = useState(DEFAULT_FLASHBOARD_CHAT_TEMPERATURE);
  const [openAiReasoningEffort, setOpenAiReasoningEffort] = useState<FlashBoardOpenAiReasoningEffort>(
    DEFAULT_FLASHBOARD_OPENAI_REASONING_EFFORT,
  );
  const [chatMessages, setChatMessages] = useState<FlashBoardChatMessage[]>([]);
  const [copiedChatMessageId, setCopiedChatMessageId] = useState<string | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);
  const [isChatting, setIsChatting] = useState(false);
  const [lemonadeStatus, setLemonadeStatus] = useState<'idle' | 'checking' | 'online' | 'offline'>('idle');
  const [lemonadeModels, setLemonadeModels] = useState<LemonadeModelInfo[]>([]);

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
    if (fallbackModel) setChatModel(fallbackModel);
  }, [chatModel, chatModelOptions]);

  useEffect(() => {
    setChatPanelOpen(initialMode === 'chat');
    setChatError(null);
  }, [initialMode]);

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
    setChatError(null);

    const nextDefaultModel = buildFlashBoardChatProviderDefaultModel(provider, lemonadeModels);

    if (nextDefaultModel) {
      setChatModel(nextDefaultModel);
    }
  }, [lemonadeModels]);

  useEffect(() => {
    const fallbackProvider = buildFlashBoardChatProviderFallback({ chatProvider, chatProviderOptions });
    if (fallbackProvider) {
      handleChatProviderSelect(fallbackProvider);
    }
  }, [chatProvider, chatProviderOptions, handleChatProviderSelect]);

  const handleChatButtonClick = useCallback(async () => {
    closePopover();

    const effectiveChatPrompt = chatPrompt.trim();
    const chatSendPlan = buildFlashBoardChatSendPlan({
      activeChatModelId,
      anthropicApiKey,
      canUseByoChat,
      canUseHostedChat,
      chatMessages,
      chatPanelOpen,
      chatProvider,
      chatTemperature,
      effectiveChatPrompt,
      hasAnthropicKey,
      hasHostedSession,
      hostedAIEnabled,
      isChatting,
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
      userPrompt: effectiveChatPrompt,
    });

    setIsChatting(true);
    setChatError(null);
    setChatPrompt('');
    setChatMessages((current) => [
      ...current,
      ...optimisticMessages,
    ]);
    appendFlashBoardPromptHistoryEntry({ kind: 'chat', prompt: effectiveChatPrompt });

    try {
      const response = await sendFlashBoardChatMessage({
        ...chatSendPlan.request,
        signal: abortController.signal,
      });
      setChatMessages((current) => buildFlashBoardChatCompletionMessages(current, assistantMessageId, response));
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
    lemonadeEndpoint,
    openAiApiKey,
    openAiReasoningEffort,
    openAuthDialog,
    openPricingDialog,
    openSettings,
    shouldUseHostedChat,
    useHostedProductionProviders,
  ]);

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
  }, [closePopover]);

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
    chatPanelOpen,
    chatPrompt,
    chatProvider,
    chatTemperature,
    clearChatError,
    copiedChatMessageId,
    handleChatButtonClick,
    handleChatInputKeyDown,
    handleChatMessageDoubleClick,
    handleChatProviderSelect,
    handleChatPromptChange,
    handleClearChatHistory,
    handleClearChatPrompt,
    isChatting,
    lemonadeStatus,
    openAiReasoningEffort,
    setChatModel,
    setChatTemperature,
    setOpenAiReasoningEffort,
    showChatCloudActions,
  };
}
