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
  DEFAULT_FLASHBOARD_KERNEL_MODEL,
  DEFAULT_FLASHBOARD_OPENAI_REASONING_EFFORT,
  sendFlashBoardChatMessage,
  type AgentActivityEvent,
  type FlashBoardExecutedToolCall,
  type FlashBoardChatProvider,
  type FlashBoardOpenAiReasoningEffort,
  type DecisionPolicy,
  type KernelRunReport,
} from '../../../services/flashboard/FlashBoardChatService';
import { createAgentActivityEvent } from '../../../services/flashboard/FlashBoardChatActivity';
import { resumeHostedKieAgentChat } from '../../../services/flashboard/FlashBoardHostedAgentTransport';
import { hasHostedAgentReloadSnapshot } from '../../../services/kernelClient/hostedAgent';
import { useFlashBoardStore } from '../../../stores/flashboardStore';
import { useStoryboardStore } from '../../../stores/storyboardStore';
import { appendFlashBoardPromptHistoryEntry } from '../../../stores/flashboardStore/activeGenerationRecords';
import {
  buildStoryboardDecisionContinuationPrompt,
  createStoryboardDecisionRecord,
  validateStoryboardDecisionSelection,
  type StoryboardDecisionSelection,
} from '../../../services/storyboard/decisions';
import type {
  KernelActiveDecision,
  KernelDecisionPrompt,
} from '../../../services/storyboard/contracts';
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
import { canCopyFlashBoardChatMessage } from './FlashBoardChatMessageCopy';
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
  closePopover: () => void;
  hasHostedSession: boolean;
  hasKieAiKey: boolean;
  hostedAIEnabled: boolean;
  initialChatPrompt?: string;
  initialMode: 'generate' | 'chat';
  lemonadeContextSize: number;
  lemonadeEndpoint: string;
  lemonadeModel: string;
  kieAiApiKey: string;
  openAuthDialog: () => void;
  openPricingDialog: () => void;
  openSettings: () => void;
  setAiProvider: (provider: AIProvider) => void;
  setLemonadeModel: (model: string) => void;
  useHostedProductionProviders: boolean;
  useKieAiKeyByDefault: boolean;
}

interface SubmitChatPromptOptions {
  activeDecision?: KernelActiveDecision;
  decisionSelection?: StoryboardDecisionSelection;
  prompt?: string;
}

function createFlashBoardChatMessageId(role: FlashBoardChatMessage['role']): string {
  return `${role}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function useFlashBoardChatController({
  aiProvider,
  aiSystemPromptSendContext,
  aiSystemPromptOverrides,
  closePopover,
  hasHostedSession,
  hasKieAiKey,
  hostedAIEnabled,
  initialChatPrompt,
  initialMode,
  lemonadeContextSize,
  lemonadeEndpoint,
  lemonadeModel,
  kieAiApiKey,
  openAuthDialog,
  openPricingDialog,
  openSettings,
  setAiProvider,
  setLemonadeModel,
  useHostedProductionProviders,
  useKieAiKeyByDefault,
}: UseFlashBoardChatControllerInput) {
  const chatAbortRef = useRef<AbortController | null>(null);
  const resumedHostedTurnIdsRef = useRef(new Set<string>());
  const copiedChatResetTimeoutRef = useRef<number | null>(null);
  const [chatPanelOpen, setChatPanelOpen] = useState(initialMode === 'chat');
  const [chatPrompt, setChatPrompt] = useState(initialChatPrompt ?? '');
  const [chatProvider, setChatProvider] = useState<FlashBoardChatProvider>(
    aiProvider === 'lemonade' ? 'lemonade' : 'kie',
  );
  const [chatModel, setChatModelState] = useState(
    aiProvider === 'lemonade' ? (lemonadeModel.trim() || DEFAULT_LEMONADE_MODEL) : DEFAULT_FLASHBOARD_CHAT_MODEL,
  );
  const [chatTemperature, setChatTemperature] = useState(DEFAULT_FLASHBOARD_CHAT_TEMPERATURE);
  const [openAiReasoningEffort, setOpenAiReasoningEffort] = useState<FlashBoardOpenAiReasoningEffort>(
    DEFAULT_FLASHBOARD_OPENAI_REASONING_EFFORT,
  );
  const [planThreeEnabled, setPlanThreeEnabled] = useState(false);
  const chatIntent = 'execute' as const;
  const [decisionPolicy, setDecisionPolicy] = useState<DecisionPolicy>('milestones');
  const chatMessages = useFlashBoardStore((state) => state.chatMessages);
  const storyboardDecisions = useStoryboardStore((state) => state.decisions);
  const markStoryboardDecisionStale = useStoryboardStore(
    (state) => state.markDecisionStale,
  );
  const putStoryboardDecision = useStoryboardStore((state) => state.putDecision);
  const resolveStoryboardDecision = useStoryboardStore(
    (state) => state.resolveDecision,
  );
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
  const [lemonadeStatus, setLemonadeStatus] = useState<'idle' | 'checking' | 'online' | 'offline'>('idle');
  const [lemonadeModels, setLemonadeModels] = useState<LemonadeModelInfo[]>([]);
  const chatSystemPromptProvider: AIProvider = chatProvider === 'lemonade' ? 'lemonade' : 'openai';
  const chatSystemPromptSendContext = aiSystemPromptSendContext[chatSystemPromptProvider] !== false;
  const chatSystemPromptOverride = aiSystemPromptOverrides[chatSystemPromptProvider]?.trim()
    ? aiSystemPromptOverrides[chatSystemPromptProvider]
    : undefined;

  const chatOptionsState = useMemo(() => buildFlashBoardChatOptionsState({
    chatModel,
    chatProvider,
    isChatting,
    lemonadeModels,
    useHostedProductionProviders,
    useKieAiKeyByDefault,
  }), [chatModel, chatProvider, isChatting, lemonadeModels, useHostedProductionProviders, useKieAiKeyByDefault]);
  const {
    activeChatModelId,
    chatModelOptions,
    chatProviderOptions,
    chatReasoningEffortOptions,
    chatReasoningSupported,
  } = chatOptionsState;
  const canUseHostedChat = Boolean(chatProvider === 'kie' && hasHostedSession && hostedAIEnabled);
  const canUseByoChat = Boolean(chatProvider === 'kie' && !useHostedProductionProviders && hasKieAiKey);
  const shouldUseHostedChat = Boolean(canUseHostedChat && (useHostedProductionProviders || !useKieAiKeyByDefault));
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
    const settingsChatProvider: FlashBoardChatProvider = aiProvider === 'lemonade' ? 'lemonade' : 'kie';
    if (isChatting || chatProvider === 'kernel' || chatProvider === settingsChatProvider) {
      return;
    }

    setChatProvider(settingsChatProvider);
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
    if (provider !== 'kernel') {
      setAiProvider(provider === 'lemonade' ? 'lemonade' : 'openai');
    }
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

  const handlePlanThreeToggle = useCallback(() => {
    if (isChatting) return;
    closePopover();
    setPlanThreeEnabled((enabled) => !enabled);
    setChatError(null);
  }, [closePopover, isChatting]);

  const handleDecisionPolicyChange = useCallback((policy: DecisionPolicy) => {
    if (isChatting) return;
    setDecisionPolicy(policy);
    setChatError(null);
  }, [isChatting]);

  useEffect(() => {
    const fallbackProvider = buildFlashBoardChatProviderFallback({ chatProvider, chatProviderOptions });
    if (fallbackProvider) {
      handleChatProviderSelect(fallbackProvider);
    }
  }, [chatProvider, chatProviderOptions, handleChatProviderSelect]);

  const submitChatPrompt = useCallback(async (options?: SubmitChatPromptOptions) => {
    closePopover();

    const effectiveChatPrompt = options?.prompt?.trim() ?? chatPrompt.trim();
    const effectiveChatProvider = options?.activeDecision ? 'kernel' : chatProvider;
    const chatSendPlan = buildFlashBoardChatSendPlan({
      activeChatModelId: options?.activeDecision
        ? DEFAULT_FLASHBOARD_KERNEL_MODEL
        : activeChatModelId,
      canUseByoChat,
      canUseHostedChat,
      chatMessages,
      chatPanelOpen,
      planThreeEnabled,
      chatProvider: effectiveChatProvider,
      chatTemperature,
      chatIntent,
      decisionPolicy,
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
      const executedToolCalls: FlashBoardExecutedToolCall[] = [];
      let kernelReport: KernelRunReport | undefined;
      let kernelDecision: KernelDecisionPrompt | undefined;
      const updatePending = (patch: Partial<FlashBoardChatMessage>) => {
        setChatMessages((current) => current.map((message) => (
          message.id === assistantMessageId && message.isPending
            ? { ...message, ...patch }
            : message
        )));
      };
      const appendActivity = (event: AgentActivityEvent | null) => {
        if (!event) return;
        setChatMessages((current) => current.map((message) => (
          message.id === assistantMessageId && message.isPending
            ? {
                ...message,
                activityEvents: [
                  ...(message.activityEvents ?? []).filter((candidate) => candidate.id !== event.id),
                  event,
                ].slice(-100),
              }
            : message
        )));
      };
      const response = await sendFlashBoardChatMessage({
        ...chatSendPlan.request,
        ...(chatSendPlan.request.provider === 'kie' && chatSendPlan.request.hostedAvailable
          ? {
              idempotencyKey: `flashboard-chat-turn:${assistantMessageId}`,
              resumeMessageId: assistantMessageId,
            }
          : {}),
        ...(options?.activeDecision === undefined
          ? {}
          : { activeDecision: options.activeDecision }),
        onActivityEvent: appendActivity,
        onExecutedToolCalls: (toolCalls) => {
          executedToolCalls.push(...toolCalls);
          updatePending({ toolCalls: [...executedToolCalls] });
        },
        onKernelProgress: (progress) => {
          updatePending({ kernelProgress: progress, text: progress.label });
          appendActivity(createAgentActivityEvent(assistantMessageId, {
            kind: 'progress',
            label: progress.detail
              ? `${progress.label}: ${progress.detail}`
              : progress.label,
            ...(progress.current === undefined ? {} : { current: progress.current }),
            ...(progress.total === undefined ? {} : { total: progress.total }),
          }));
        },
        onKernelReport: (report) => {
          kernelReport = report;
        },
        onKernelDecision: (decision) => {
          kernelDecision = decision;
        },
        onPhase: (phase) => {
          updatePending(phase === 'kernel'
            ? { text: 'Starting kernel…' }
            : { text: 'AI thinking…', kernelProgress: undefined });
        },
        signal: abortController.signal,
        systemPromptIncludeContext: chatSystemPromptSendContext,
        systemPromptOverride: chatSystemPromptOverride,
      });
      if (options?.decisionSelection) {
        if (kernelReport?.decline?.reason === 'staleDecision') {
          markStoryboardDecisionStale(
            options.decisionSelection.decisionId,
          );
        } else if (
          kernelReport?.outcome !== 'declined'
          && kernelReport?.outcome !== 'failed'
        ) {
          try {
            resolveStoryboardDecision(options.decisionSelection);
          } catch {
            markStoryboardDecisionStale(
              options.decisionSelection.decisionId,
            );
          }
        }
      }
      let decisionId: string | undefined;
      if (kernelDecision) {
        const decision = createStoryboardDecisionRecord(kernelDecision, {
          ...(options?.decisionSelection === undefined
            ? {}
            : { parentDecisionId: options.decisionSelection.decisionId }),
        });
        putStoryboardDecision(decision);
        decisionId = decision.id;
      }
      setChatMessages((current) => buildFlashBoardChatCompletionMessages(
        current,
        assistantMessageId,
        response,
        undefined,
        executedToolCalls,
        kernelReport,
        decisionId,
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
    chatSystemPromptOverride,
    chatSystemPromptSendContext,
    chatMessages,
    chatPanelOpen,
    chatPrompt,
    planThreeEnabled,
    chatProvider,
    chatTemperature,
    chatIntent,
    decisionPolicy,
    closePopover,
    canUseByoChat,
    canUseHostedChat,
    kieAiApiKey,
    hostedAIEnabled,
    hasHostedSession,
    isChatting,
    lemonadeContextSize,
    lemonadeEndpoint,
    markStoryboardDecisionStale,
    openAiReasoningEffort,
    openAuthDialog,
    openPricingDialog,
    openSettings,
    putStoryboardDecision,
    resolveStoryboardDecision,
    shouldUseHostedChat,
    setChatMessages,
    useHostedProductionProviders,
  ]);

  useEffect(() => {
    if (isChatting || !canUseHostedChat) return;
    const pendingMessage = chatMessages.find((message) => (
      message.role === 'assistant'
      && message.isPending === true
      && hasHostedAgentReloadSnapshot(message.id)
      && !resumedHostedTurnIdsRef.current.has(message.id)
    ));
    if (!pendingMessage) return;

    resumedHostedTurnIdsRef.current.add(pendingMessage.id);
    const abortController = new AbortController();
    chatAbortRef.current = abortController;
    const executedToolCalls: FlashBoardExecutedToolCall[] = [
      ...(pendingMessage.toolCalls ?? []),
    ];
    const updatePending = (patch: Partial<FlashBoardChatMessage>) => {
      setChatMessages((current) => current.map((message) => (
        message.id === pendingMessage.id && message.isPending
          ? { ...message, ...patch }
          : message
      )));
    };
    const appendActivity = (event: AgentActivityEvent | null) => {
      if (!event) return;
      setChatMessages((current) => current.map((message) => (
        message.id === pendingMessage.id && message.isPending
          ? {
              ...message,
              activityEvents: [
                ...(message.activityEvents ?? []).filter((candidate) => candidate.id !== event.id),
                event,
              ].slice(-100),
            }
          : message
      )));
    };

    setIsChatting(true);
    setChatError(null);
    updatePending({ isError: undefined, text: 'Reconnecting to kernel…' });

    void resumeHostedKieAgentChat({
      assistantMessageId: pendingMessage.id,
      request: {
        activityRunId: pendingMessage.id,
        hostedAvailable: true,
        model: activeChatModelId,
        onActivityEvent: appendActivity,
        onExecutedToolCalls: (toolCalls) => {
          executedToolCalls.push(...toolCalls);
          updatePending({ toolCalls: [...executedToolCalls] });
        },
        onPhase: (phase) => {
          updatePending({
            kernelProgress: undefined,
            text: phase === 'kernel' ? 'Reconnecting to kernel…' : 'AI thinking…',
          });
        },
        prompt: 'Resume the active hosted-agent turn.',
        provider: 'kie',
        resumeMessageId: pendingMessage.id,
        signal: abortController.signal,
        temperature: chatTemperature,
        toolExecutionMode: 'normal',
      },
    }).then((response) => {
      if (response === null) {
        throw new Error('The hosted-agent turn can no longer be resumed.');
      }
      setChatMessages((current) => buildFlashBoardChatCompletionMessages(
        current,
        pendingMessage.id,
        response,
        undefined,
        executedToolCalls,
      ));
    }).catch((error) => {
      const errorMessage = abortController.signal.aborted
        ? 'Chat stopped.'
        : error instanceof Error ? error.message : 'Chat resume failed.';
      setChatMessages((current) => buildFlashBoardChatErrorMessages(
        current,
        pendingMessage.id,
        errorMessage,
      ));
    }).finally(() => {
      if (chatAbortRef.current === abortController) {
        chatAbortRef.current = null;
      }
      setIsChatting(false);
    });
  }, [
    activeChatModelId,
    canUseHostedChat,
    chatMessages,
    chatTemperature,
    isChatting,
    setChatMessages,
  ]);

  const handleStoryboardDecisionSubmit = useCallback((
    selection: StoryboardDecisionSelection,
  ) => {
    if (isChatting) return;
    const decision = storyboardDecisions[selection.decisionId];
    if (!decision) {
      setChatError('This decision is no longer available.');
      return;
    }
    const validation = validateStoryboardDecisionSelection(decision, selection);
    if (!validation.ok) {
      if (validation.stale) {
        markStoryboardDecisionStale(decision.id);
      }
      setChatError(validation.reason);
      return;
    }

    setChatError(null);
    void submitChatPrompt({
      activeDecision: {
        decisionId: validation.selection.decisionId,
        optionIds: validation.selection.optionIds,
        ...(validation.selection.freeform === undefined
          ? {}
          : { freeform: validation.selection.freeform }),
      },
      decisionSelection: validation.selection,
      prompt: buildStoryboardDecisionContinuationPrompt(
        decision,
        validation.selection,
      ),
    });
  }, [
    isChatting,
    markStoryboardDecisionStale,
    storyboardDecisions,
    submitChatPrompt,
  ]);

  const handleChatButtonClick = useCallback(async () => {
    await submitChatPrompt();
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
    if (!canCopyFlashBoardChatMessage(message)) {
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
      setChatError('Could not copy message.');
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
    handlePlanThreeToggle,
    handleDecisionPolicyChange,
    handleChatProviderSelect,
    handleChatPromptChange,
    handleStoryboardDecisionSubmit,
    handleClearChatHistory,
    handleClearChatPrompt,
    isChatting,
    lemonadeStatus,
    openAiReasoningEffort,
    planThreeEnabled,
    decisionPolicy,
    chatSystemPromptProvider,
    chatSystemPromptSendContext,
    setChatModel: handleChatModelSelect,
    setChatTemperature,
    setOpenAiReasoningEffort,
    showChatCloudActions,
  };
}
