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
  DEFAULT_FLASHBOARD_DECISION_POLICY,
  DEFAULT_FLASHBOARD_KERNEL_MODEL,
  DEFAULT_FLASHBOARD_OPENAI_REASONING_EFFORT,
  sendFlashBoardChatMessage,
  type AgentActivityEvent,
  type FlashBoardExecutedToolCall,
  type FlashBoardChatModelClass,
  type FlashBoardChatProvider,
  type FlashBoardOpenAiReasoningEffort,
  type DecisionPolicy,
  type KernelRunReport,
} from '../../../services/flashboard/FlashBoardChatService';
import { createAgentActivityEvent } from '../../../services/flashboard/FlashBoardChatActivity';
import {
  getHostedAgentModelClassAvailability,
  resumeHostedKieAgentChat,
} from '../../../services/flashboard/FlashBoardHostedAgentTransport';
import { prepareFlashBoardChatVisualReferences } from '../../../services/flashboard/FlashBoardChatVisualReferences';
import { hasHostedAgentReloadSnapshot } from '../../../services/kernelClient/hostedAgent';
import { useFlashBoardStore } from '../../../stores/flashboardStore';
import { useMediaStore } from '../../../stores/mediaStore';
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
  normalizeFlashBoardSubmittedPrompt,
} from './FlashBoardChatSendPlanner';
import {
  cancelFlashBoardBridgeChatMessage,
  registerFlashBoardBridgeChatHandler,
  registerFlashBoardBridgeChatModelClassHandler,
  reportFlashBoardBridgeChatModelClass,
  type FlashBoardBridgeChatResult,
} from '../../../services/flashboard/FlashBoardChatBridgeControl';

interface UseFlashBoardChatControllerInput {
  closePopover: () => void;
  hasHostedSession: boolean;
  hostedAIEnabled: boolean;
  initialChatPrompt?: string;
  initialMode: 'generate' | 'chat';
  openAuthDialog: () => void;
  openPricingDialog: () => void;
}

interface SubmitChatPromptOptions {
  activeDecision?: KernelActiveDecision;
  decisionSelection?: StoryboardDecisionSelection;
  forceSend?: boolean;
  prompt?: string;
  requestedModelClass?: FlashBoardChatModelClass;
}

function createFlashBoardChatMessageId(role: FlashBoardChatMessage['role']): string {
  return `${role}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function useFlashBoardChatController({
  closePopover,
  hasHostedSession,
  hostedAIEnabled,
  initialChatPrompt,
  initialMode,
  openAuthDialog,
  openPricingDialog,
}: UseFlashBoardChatControllerInput) {
  const chatAbortRef = useRef<AbortController | null>(null);
  const resumedHostedTurnIdsRef = useRef(new Set<string>());
  const copiedChatResetTimeoutRef = useRef<number | null>(null);
  const [chatPanelOpen, setChatPanelOpen] = useState(initialMode === 'chat');
  const [chatPrompt, setChatPrompt] = useState(initialChatPrompt ?? '');
  const [chatProvider, setChatProvider] = useState<FlashBoardChatProvider>('kie');
  const [chatModelClass, setChatModelClass] = useState<FlashBoardChatModelClass>('fast');
  const [availableChatModelClasses, setAvailableChatModelClasses] = useState<
    readonly FlashBoardChatModelClass[]
  >([]);
  const [chatModelClassAvailabilityStatus, setChatModelClassAvailabilityStatus] = useState<
    'idle' | 'loading' | 'ready' | 'unavailable'
  >('idle');
  const [chatModelClassAvailabilityRetry, setChatModelClassAvailabilityRetry] = useState(0);
  const [chatModel, setChatModelState] = useState(DEFAULT_FLASHBOARD_CHAT_MODEL);
  const [chatTemperature, setChatTemperature] = useState(DEFAULT_FLASHBOARD_CHAT_TEMPERATURE);
  const [openAiReasoningEffort, setOpenAiReasoningEffort] = useState<FlashBoardOpenAiReasoningEffort>(
    DEFAULT_FLASHBOARD_OPENAI_REASONING_EFFORT,
  );
  const chatIntent = 'execute' as const;
  const [decisionPolicy, setDecisionPolicy] = useState<DecisionPolicy>(
    DEFAULT_FLASHBOARD_DECISION_POLICY,
  );
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
  const chatOptionsState = useMemo(() => buildFlashBoardChatOptionsState({
    chatModel,
    chatProvider,
    isChatting,
  }), [chatModel, chatProvider, isChatting]);
  const {
    activeChatModelId,
    chatModelOptions,
    chatProviderOptions,
    chatReasoningEffortOptions,
    chatReasoningSupported,
  } = chatOptionsState;
  const canUseHostedChat = Boolean(chatProvider === 'kie' && hasHostedSession && hostedAIEnabled);
  const showChatCloudActions = Boolean(chatError && !hasHostedSession && /sign in/i.test(chatError));

  useEffect(() => {
    if (!chatPanelOpen || !canUseHostedChat) {
      setAvailableChatModelClasses([]);
      setChatModelClassAvailabilityStatus('idle');
      return;
    }

    const abortController = new AbortController();
    let cancelled = false;
    let retryTimer: number | null = null;
    setChatModelClassAvailabilityStatus('loading');
    void getHostedAgentModelClassAvailability({ signal: abortController.signal }).then(
      (modelClasses) => {
        if (cancelled) return;
        setAvailableChatModelClasses(modelClasses);
        setChatModelClassAvailabilityStatus(modelClasses.length > 0 ? 'ready' : 'unavailable');
        setChatModelClass((modelClass) => (
          modelClasses.includes(modelClass) ? modelClass : 'fast'
        ));
        if (modelClasses.length === 0) {
          retryTimer = window.setTimeout(() => {
            if (!cancelled) setChatModelClassAvailabilityRetry((value) => value + 1);
          }, 2_000);
        }
      },
      (error: unknown) => {
        if (cancelled || (error instanceof DOMException && error.name === 'AbortError')) return;
        setAvailableChatModelClasses([]);
        setChatModelClassAvailabilityStatus('unavailable');
        retryTimer = window.setTimeout(() => {
          if (!cancelled) setChatModelClassAvailabilityRetry((value) => value + 1);
        }, 2_000);
      },
    );
    return () => {
      cancelled = true;
      abortController.abort();
      if (retryTimer !== null) window.clearTimeout(retryTimer);
    };
  }, [canUseHostedChat, chatModelClassAvailabilityRetry, chatPanelOpen]);

  useEffect(() => {
    const fallbackModel = buildFlashBoardChatModelFallback({ chatModel, chatModelOptions });
    if (fallbackModel) {
      setChatModelState(fallbackModel);
    }
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

  const handleChatProviderSelect = useCallback((provider: FlashBoardChatProvider) => {
    setChatProvider(provider);
    setChatError(null);

    const nextDefaultModel = buildFlashBoardChatProviderDefaultModel(provider);

    if (nextDefaultModel) {
      setChatModelState(nextDefaultModel);
    }
  }, []);

  const handleChatModelSelect = useCallback((model: string) => {
    setChatModelState(model);
  }, []);

  const handleChatModelClassSelect = useCallback((modelClass: FlashBoardChatModelClass) => {
    if (isChatting) return;
    if (!availableChatModelClasses.includes(modelClass)) {
      setChatError('Fast V2 model switching is currently unavailable.');
      return;
    }
    setChatModelClass(modelClass);
    setChatError(null);
  }, [availableChatModelClasses, isChatting]);

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

  const submitChatPrompt = useCallback(async (
    options?: SubmitChatPromptOptions,
  ): Promise<FlashBoardBridgeChatResult> => {
    closePopover();

    const effectiveChatPrompt = normalizeFlashBoardSubmittedPrompt(options?.prompt ?? chatPrompt);
    const effectiveChatProvider = options?.activeDecision ? 'kernel' : chatProvider;
    const effectiveChatModelClass = options?.requestedModelClass ?? chatModelClass;
    if (
      effectiveChatProvider === 'kie'
      && effectiveChatModelClass !== 'fast'
      && !availableChatModelClasses.includes(effectiveChatModelClass)
    ) {
      const error = `${effectiveChatModelClass === 'slow' ? 'Slow' : 'Very Fast'} is reconnecting to Fast V2. Please retry in a moment.`;
      setChatError(error);
      return { status: 'rejected', success: false, error };
    }
    const chatSendPlan = buildFlashBoardChatSendPlan({
      activeChatModelId: options?.activeDecision
        ? DEFAULT_FLASHBOARD_KERNEL_MODEL
        : activeChatModelId,
      canUseHostedChat,
      // Forward the class only once the availability probe confirmed Fast V2;
      // a K2-selected account must not carry a model class at all.
      chatModelClass: availableChatModelClasses.includes(effectiveChatModelClass)
        ? effectiveChatModelClass
        : undefined,
      chatMessages,
      chatPanelOpen: options?.forceSend ? true : chatPanelOpen,
      planThreeEnabled: false,
      chatProvider: effectiveChatProvider,
      chatTemperature,
      chatIntent,
      decisionPolicy,
      effectiveChatPrompt,
      hasHostedSession,
      hostedAIEnabled,
      isChatting,
      openAiReasoningEffort,
    });

    if (chatSendPlan.action === 'openPanel') {
      setChatPanelOpen(true);
      setChatError(null);
      return { status: 'rejected', success: false, error: 'The chat panel was opened.' };
    }

    if (chatSendPlan.action === 'abort') {
      chatAbortRef.current?.abort();
      return { status: 'stopped', success: false, error: 'Chat stopped.' };
    }

    if (chatSendPlan.action === 'error') {
      setChatError(chatSendPlan.errorMessage);
      if (chatSendPlan.dialogTarget === 'auth') openAuthDialog();
      if (chatSendPlan.dialogTarget === 'pricing') openPricingDialog();
      return { status: 'rejected', success: false, error: chatSendPlan.errorMessage };
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
      let streamedResponse = '';
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
      const visualReferences = chatSendPlan.request.provider === 'kie'
        ? await prepareFlashBoardChatVisualReferences({
            composer: useFlashBoardStore.getState().composer,
            mediaFiles: useMediaStore.getState().files,
            signal: abortController.signal,
          })
        : [];
      const response = await sendFlashBoardChatMessage({
        ...chatSendPlan.request,
        ...(visualReferences.length === 0 ? {} : { visualReferences }),
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
        onTextDelta: (delta) => {
          if (!delta) return;
          streamedResponse += delta;
          updatePending({
            isStreaming: true,
            kernelProgress: undefined,
            text: streamedResponse,
          });
        },
        signal: abortController.signal,
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
      return {
        assistantMessageId,
        ...(kernelReport?.outcome === undefined ? {} : { kernelOutcome: kernelReport.outcome }),
        status: 'completed',
        success: true,
      };
    } catch (error) {
      const errorMessage = abortController.signal.aborted
        ? 'Chat stopped.'
        : error instanceof Error ? error.message : 'Chat request failed.';
      setChatMessages((current) => buildFlashBoardChatErrorMessages(current, assistantMessageId, errorMessage));
      return {
        assistantMessageId,
        error: errorMessage,
        status: abortController.signal.aborted ? 'stopped' : 'rejected',
        success: false,
      };
    } finally {
      if (chatAbortRef.current === abortController) {
        chatAbortRef.current = null;
        setIsChatting(false);
      }
    }
  }, [
    activeChatModelId,
    chatMessages,
    chatPanelOpen,
    chatPrompt,
    chatProvider,
    chatTemperature,
    chatIntent,
    decisionPolicy,
    closePopover,
    canUseHostedChat,
    availableChatModelClasses,
    chatModelClass,
    hostedAIEnabled,
    hasHostedSession,
    isChatting,
    markStoryboardDecisionStale,
    openAiReasoningEffort,
    openAuthDialog,
    openPricingDialog,
    putStoryboardDecision,
    resolveStoryboardDecision,
    setChatMessages,
  ]);

  useEffect(() => registerFlashBoardBridgeChatHandler(({ prompt, requestedModelClass }) => {
    setChatPanelOpen(true);
    if (requestedModelClass !== undefined) {
      setChatProvider('kie');
      setChatModelClass(requestedModelClass);
    }
    return submitChatPrompt({
      forceSend: true,
      prompt,
      ...(requestedModelClass === undefined ? {} : { requestedModelClass }),
    });
  }), [submitChatPrompt]);

  useEffect(() => registerFlashBoardBridgeChatModelClassHandler(async (modelClass) => {
    setChatPanelOpen(true);
    setChatProvider('kie');
    setChatModelClass(modelClass);
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    return { modelClass, success: true };
  }), []);

  useEffect(() => {
    reportFlashBoardBridgeChatModelClass(chatModelClass);
  }, [chatModelClass]);

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
    let streamedResponse = pendingMessage.isStreaming ? pendingMessage.text : '';
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

    if (streamedResponse) {
      updatePending({ isStreaming: true, text: streamedResponse });
    }

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
          if (streamedResponse) return;
          updatePending({
            kernelProgress: undefined,
            text: phase === 'kernel' ? 'Reconnecting to kernel…' : 'AI thinking…',
          });
        },
        onTextDelta: (delta) => {
          if (!delta) return;
          streamedResponse += delta;
          updatePending({
            isStreaming: true,
            kernelProgress: undefined,
            text: streamedResponse,
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
        setIsChatting(false);
      }
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
    if (cancelFlashBoardBridgeChatMessage()) return;
    await submitChatPrompt();
  }, [submitChatPrompt]);

  const handleClearChatHistory = useCallback(() => {
    closePopover();
    cancelFlashBoardBridgeChatMessage();
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
    chatModelClass,
    chatModelClassAvailabilityStatus,
    chatMessages,
    chatPanelOpen,
    chatPrompt,
    chatProvider,
    chatTemperature,
    availableChatModelClasses,
    clearChatError,
    copiedChatMessageId,
    handleChatButtonClick,
    handleChatModelClassSelect,
    handleChatInputKeyDown,
    handleChatMessageDoubleClick,
    handleDecisionPolicyChange,
    handleChatProviderSelect,
    handleChatPromptChange,
    handleStoryboardDecisionSubmit,
    handleClearChatHistory,
    handleClearChatPrompt,
    isChatting,
    openAiReasoningEffort,
    decisionPolicy,
    setChatModel: handleChatModelSelect,
    setChatTemperature,
    setOpenAiReasoningEffort,
    showChatCloudActions,
  };
}
