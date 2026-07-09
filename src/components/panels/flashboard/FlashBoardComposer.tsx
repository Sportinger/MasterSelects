import { useState, useMemo, useRef, useEffect } from 'react';
import { useFlashBoardStore } from '../../../stores/flashboardStore';
import { useHasFlashBoardActiveGenerationBoard } from '../../../stores/flashboardStore/activeGenerationRecords';
import { DEFAULT_FLASHBOARD_MODEL_VERSION } from '../../../stores/flashboardStore/defaults';
import { useMediaStore } from '../../../stores/mediaStore';
import { SUNO_PROVIDER_ID } from '../../../services/sunoService';
import { RUNWAY_VIDEO_PROVIDER_ID } from '../../../services/kieAi/config';
import { isProjectPromptStorageAvailable } from '../../../services/aiPromptLibrary';
import { FLASHBOARD_CHAT_SYSTEM_PROMPT } from '../../../services/flashboard/FlashBoardChatService';
import type { CatalogEntry } from '../../../services/flashboard/types';
import { buildFlashBoardGenerationActionState } from './FlashBoardGenerationActionStatePlanner';
import {
  buildFlashBoardModelEntryOptions,
  buildFlashBoardModelCatalogState,
  buildFlashBoardModelOptionsState,
  getFlashBoardModelCategory,
  type FlashBoardModelCategoryId,
} from './FlashBoardModelOptionsPlanner';
import { MAX_MULTI_SHOTS } from './FlashBoardMultishotPlanner';
import { buildFlashBoardParameterOptions } from './FlashBoardParameterOptionsPlanner';
import { FlashBoardComposerControlBar } from './FlashBoardComposerControlBar';
import { FlashBoardComposerMainSection } from './FlashBoardComposerMainSection';
import { FlashBoardComposerWarnings } from './FlashBoardComposerWarnings';
import { FlashBoardPromptBook } from './FlashBoardPromptBook';
import { useAIChatPromptLibrary } from '../aiChat/useAIChatPromptLibrary';
import { useFlashBoardComposerAccessState } from './useFlashBoardComposerAccessState';
import { useFlashBoardMultishotController } from './useFlashBoardMultishotController';
import { useFlashBoardComposerPopovers } from './useFlashBoardComposerPopovers';
import { useFlashBoardPromptAutosize } from './useFlashBoardPromptAutosize';
import { useFlashBoardChatHistoryScroll } from './useFlashBoardChatHistoryScroll';
import { useFlashBoardInitialEntrySync } from './useFlashBoardInitialEntrySync';
import { useFlashBoardElevenLabsController } from './useFlashBoardElevenLabsController';
import { useFlashBoardChatController } from './useFlashBoardChatController';
import { useFlashBoardPromptRefineController } from './useFlashBoardPromptRefineController';
import { useFlashBoardGenerationFlowController } from './useFlashBoardGenerationFlowController';
import { useFlashBoardPromptSunoController } from './useFlashBoardPromptSunoController';
import {
  useFlashBoardReferenceController,
  useFlashBoardReferenceValidationController,
} from './useFlashBoardReferenceController';

type FlashBoardComposerProps = { initialProviderId?: string; initialService?: CatalogEntry['service']; initialVersion?: string; initialMode?: 'generate' | 'chat'; allowedServices?: CatalogEntry['service'][]; serviceScope?: CatalogEntry['service']; };

export function FlashBoardComposer({
  initialProviderId,
  initialService,
  initialVersion,
  initialMode = 'generate',
  allowedServices,
  serviceScope,
}: FlashBoardComposerProps) {
  const hasGenerationBoard = useHasFlashBoardActiveGenerationBoard();
  const composer = useFlashBoardStore((s) => s.composer);
  const promptHistory = useFlashBoardStore((s) => s.promptHistory);
  const activeGenerationRecords = useFlashBoardStore((s) => s.activeGenerationRecords);
  const updateComposer = useFlashBoardStore((s) => s.updateComposer);
  const setHoveredComposerReference = useFlashBoardStore((s) => s.setHoveredComposerReference);
  const mediaFiles = useMediaStore((s) => s.files);
  const {
    accountSession, aiApprovalMode, aiProvider, anthropicApiKey, canUseByoPromptRefiner,
    aiSystemPromptOverrides, canUseHostedPromptRefiner, elevenLabsApiKey, hasAnthropicKey,
    hasElevenLabsKey, hasEvolinkKey, hasHostedAudioAccess, hasHostedSession,
    hasKieAiKey, hasOpenAiKey, hostedAIEnabled, lemonadeEndpoint, lemonadeModel,
    openAiApiKey, openAuthDialog, openPricingDialog, openSettings, setAiApprovalMode,
    setAiProvider, setAiSystemPromptOverride, setLemonadeModel,
    useElevenLabsKeyByDefault, useEvolinkKeyByDefault, useHostedProductionProviders,
    useKieAiKeyByDefault, useOpenAiKeyByDefault, usePiApiKeyByDefault,
  } = useFlashBoardComposerAccessState();

  const modelCatalogState = useMemo(() => buildFlashBoardModelCatalogState({
    allowedServices,
    hasHostedSession,
    initialProviderId,
    initialService,
    serviceScope,
    useElevenLabsKeyByDefault,
    useEvolinkKeyByDefault,
    useHostedProductionProviders,
    useKieAiKeyByDefault,
    usePiApiKeyByDefault,
  }), [
    allowedServices,
    hasHostedSession,
    initialProviderId,
    initialService,
    serviceScope,
    useElevenLabsKeyByDefault,
    useEvolinkKeyByDefault,
    useHostedProductionProviders,
    useKieAiKeyByDefault,
    usePiApiKeyByDefault,
  ]);
  const {
    emptyCatalogFallbackService,
    initialEntry,
    visibleCatalog,
  } = modelCatalogState;
  const initialModelSettings = initialEntry
    ? composer.modelSettingsByKey?.[`${initialEntry.service}:${initialEntry.providerId}`]
    : undefined;

  const [activeModelCategory, setActiveModelCategory] = useState<FlashBoardModelCategoryId>(() => (
    getFlashBoardModelCategory(initialEntry)
  ));
  const {
    closePopover,
    inlineSubmenuStateClassName,
    popover,
    popoverHostClassName,
    popoverRef,
    renderedPopover,
    togglePopover,
  } = useFlashBoardComposerPopovers();
  const promptRefineCallbacksRef = useRef<{
    clearPromptRefineError: () => void;
    clearPromptRefineState: () => void;
  }>({
    clearPromptRefineError: () => {},
    clearPromptRefineState: () => {},
  });

  const [service, setService] = useState<CatalogEntry['service']>(
    initialEntry?.service ?? visibleCatalog[0]?.service ?? emptyCatalogFallbackService,
  );
  const [providerId, setProviderId] = useState(initialEntry?.providerId ?? visibleCatalog[0]?.providerId ?? initialProviderId ?? '');
  const [version, setVersion] = useState(
    initialVersion ?? initialModelSettings?.version ?? initialEntry?.versions[0] ?? DEFAULT_FLASHBOARD_MODEL_VERSION,
  );
  const [mode, setMode] = useState(initialModelSettings?.mode ?? composer.mode ?? 'std');
  const [promptBookOpen, setPromptBookOpen] = useState(false);
  const [promptBookInitialKind, setPromptBookInitialKind] = useState<'generation' | 'chat' | 'system'>('generation');
  const [copiedPromptBookEntryId, setCopiedPromptBookEntryId] = useState<string | null>(null);
  const copiedPromptBookResetRef = useRef<number | null>(null);
  const {
    activeChatModel, activeChatModelId, chatButtonLabel, chatChargeTitle, chatError,
    chatMessages, chatModelOptions, chatOptionsMode, chatOptionsModeEnabled, chatPanelOpen, chatPrompt, chatProvider,
    chatProviderLabel, chatProviderOptions, chatReasoningEffortOptions,
    chatReasoningSupported, chatTemperature, chatTemperatureSupported, clearChatError,
    copiedChatMessageId, handleChatButtonClick, handleChatInputKeyDown,
    handleChatMessageDoubleClick, handleChatProviderSelect, handleChatPromptChange, handleEditOptionSelect,
    handleClearChatHistory, handleClearChatPrompt, isChatting, lemonadeStatus,
    openAiReasoningEffort, chatSystemPromptProvider, setChatModel, setChatTemperature,
    setChatOptionsMode, setOpenAiReasoningEffort, showChatCloudActions,
  } = useFlashBoardChatController({
    aiProvider,
    aiSystemPromptOverrides,
    anthropicApiKey,
    closePopover,
    hasAnthropicKey,
    hasHostedSession,
    hasOpenAiKey,
    hostedAIEnabled,
    initialMode,
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
  });
  const activeChatSystemPromptOverride = aiSystemPromptOverrides[chatSystemPromptProvider]?.trim()
    ? aiSystemPromptOverrides[chatSystemPromptProvider]!
    : '';
  const chatPromptHasOverride = Boolean(activeChatSystemPromptOverride);
  const activeChatSystemPrompt = activeChatSystemPromptOverride || FLASHBOARD_CHAT_SYSTEM_PROMPT;
  const projectPromptStorageReady = isProjectPromptStorageAvailable();
  const {
    applyPromptDraft,
    deleteSelectedProjectPrompt,
    isPromptLibraryLoading,
    loadSelectedProjectPrompt,
    overwriteSelectedProjectPrompt,
    preparePromptDraft,
    promptDialogError,
    promptDialogStatus,
    promptDraft,
    promptNameDraft,
    refreshSavedPromptFiles,
    resetPromptDraft,
    savePromptDialog,
    savedPromptFiles,
    selectedPromptFile,
    setPromptDraft,
    setPromptNameDraft,
    setSelectedPromptFile,
  } = useAIChatPromptLibrary({
    activeSystemPrompt: activeChatSystemPrompt,
    aiProvider: chatSystemPromptProvider,
    defaultSystemPrompt: FLASHBOARD_CHAT_SYSTEM_PROMPT,
    setAiSystemPromptOverride,
  });
  const openPromptBook = (kind: 'generation' | 'chat' | 'system') => {
    setPromptBookInitialKind(kind);
    setPromptBookOpen(true);
    if (kind === 'system') preparePromptDraft();
    void refreshSavedPromptFiles();
  };
  const [duration, setDuration] = useState(initialModelSettings?.duration ?? composer.duration ?? 5);
  const [aspectRatio, setAspectRatio] = useState(initialModelSettings?.aspectRatio ?? composer.aspectRatio ?? '16:9');
  const [imageSize, setImageSize] = useState(initialModelSettings?.imageSize ?? composer.imageSize ?? '1K');
  const [generateAudio, setGenerateAudio] = useState(initialModelSettings?.generateAudio ?? composer.generateAudio ?? false);
  useFlashBoardInitialEntrySync({
    initialEntry,
    initialAspectRatio: initialModelSettings?.aspectRatio ?? composer.aspectRatio,
    initialDuration: initialModelSettings?.duration ?? composer.duration,
    initialGenerateAudio: initialModelSettings?.generateAudio ?? composer.generateAudio,
    initialImageSize: initialModelSettings?.imageSize ?? composer.imageSize,
    initialMode: initialModelSettings?.mode ?? composer.mode,
    initialVersion,
    setAspectRatio,
    setDuration,
    setGenerateAudio,
    setImageSize,
    setMode,
    setProviderId,
    setService,
    setVersion,
  });
  const chatHistoryRef = useFlashBoardChatHistoryScroll({
    chatError,
    chatMessages,
  });

  const modelOptionsState = useMemo(() => buildFlashBoardModelOptionsState({
    activeModelCategory,
    providerId,
    service,
    visibleCatalog,
  }), [
    activeModelCategory,
    providerId,
    service,
    visibleCatalog,
  ]);
  const {
    activeModelEntries,
    availableModelCategories,
    effectiveModelCategory,
    modelButtonLabel,
    selectedEntry,
    selectedModelCategory,
  } = modelOptionsState;
  const isAudioMode = selectedEntry?.outputType === 'audio' || service === 'elevenlabs' || service === 'suno';
  const isSunoMode = selectedEntry?.providerId === SUNO_PROVIDER_ID || providerId === SUNO_PROVIDER_ID;
  const isElevenLabsMode = isAudioMode && (
    service === 'elevenlabs'
    || selectedEntry?.providerId === 'cloud-elevenlabs-tts'
  );
  const isHostedAudioMode = isElevenLabsMode && service === 'cloud';
  const modeLabel = selectedEntry?.modeLabels?.[mode] ?? mode;
  const {
    hasAudioReferenceInput, hasImageReferenceInput, hasVideoReferenceInput, hasVisualReferenceInput,
    seedanceReferenceModeActive, seedanceReferenceValidationError,
  } = useFlashBoardReferenceValidationController({
    composer,
    mediaFiles,
    providerId,
  });
  const {
    audioModelButtonLabel, audioOutputButtonLabel,
    elevenLabsVoicesError, handleOutputFormatChange, handlePreviewVoice,
    handleRefreshVoices, handleSelectVoice, handleSpeakerBoostChange,
    handleVoiceSettingNumberChange, isLoadingElevenLabsVoices, languageCode,
    languageOverride, modelMetaText: elevenLabsModelMetaText,
    modelOptions: elevenLabsModelOptions, outputFormat,
    outputOptions: elevenLabsOutputOptions, resetVoiceSettings,
    selectedModel: selectedElevenLabsModel,
    selectedModelCharacterLimit: selectedElevenLabsCharacterLimit,
    setLanguageCode, setLanguageOverride, setVoiceId, setVoiceName,
    setVoiceSearch, voiceId, voiceName, voiceOptions: elevenLabsVoiceOptions,
    voiceSearch, voiceSettings, voiceSettingsChanged,
  } = useFlashBoardElevenLabsController({
    elevenLabsApiKey,
    hasElevenLabsKey,
    hasHostedAudioAccess,
    initialLanguageCode: composer.languageCode,
    initialLanguageOverride: composer.languageOverride,
    initialOutputFormat: composer.outputFormat,
    initialVoiceId: composer.voiceId,
    initialVoiceName: composer.voiceName,
    initialVoiceSettings: composer.voiceSettings,
    isElevenLabsMode,
    isHostedAudioMode,
    setVersion,
    version,
  });
  const supportsAudio = !isAudioMode && selectedEntry?.supportsGenerateAudio === true;
  useEffect(() => {
    if (providerId === RUNWAY_VIDEO_PROVIDER_ID && duration === 10 && mode === '1080p') {
      setMode('720p');
    }
  }, [duration, mode, providerId]);
  useEffect(() => {
    if (seedanceReferenceModeActive && hasAudioReferenceInput) {
      setGenerateAudio(true);
    }
  }, [hasAudioReferenceInput, seedanceReferenceModeActive]);
  const supportsMultiShot = !isAudioMode && selectedEntry?.supportsMultiShot === true;
  const {
    canAddShot, handleAddShot, handleMultiShotToggle, handleRemoveShot,
    handleShotDurationChange, handleShotPromptChange, isMultiShotPanelClosing,
    multiShotDurationTotal, multiShots, normalizedMultiPrompt, renderMultiShotPanel,
  } = useFlashBoardMultishotController({
    duration,
    generateAudio,
    isAudioMode,
    selectedEntryOutputType: selectedEntry?.outputType,
    setGenerateAudio,
    supportsAudio,
    supportsMultiShot,
  });
  const {
    currentSunoModelId, effectivePrompt, handleClearPrompt, handlePromptChange,
    handleSunoNegativeTagsChange, handleSunoStyleChange, handleSunoVocalGenderChange,
    prompt, resetSunoTuning, setPrompt, setSunoAudioWeight, setSunoCustomMode,
    setSunoInstrumental, setSunoNegativeTags, setSunoStyle, setSunoStyleWeight,
    setSunoWeirdnessConstraint, sunoAudioWeight, sunoCustomMode, sunoInstrumental,
    sunoModelButtonLabel, sunoModeButtonLabel, sunoModelOptions, sunoNegativeTags,
    sunoStyle, sunoStyleLimit, sunoStyleWeight, sunoTitle,
    sunoVocalGender, sunoVocalGenderOptions, sunoWeirdnessConstraint,
  } = useFlashBoardPromptSunoController({
    composer,
    isSunoMode,
    multiShots,
    normalizedMultiPrompt,
    promptRefineCallbacksRef,
    version,
  });
  const {
    chatInputRef,
    promptInputRef,
    resizePromptInput,
  } = useFlashBoardPromptAutosize({
    chatPanelOpen,
    chatPrompt,
    isAudioMode,
    multiShots,
    prompt,
  });
  const effectiveGenerateAudio = !isAudioMode && supportsAudio && (generateAudio || multiShots);
  const modelEntryOptions = useMemo(() => buildFlashBoardModelEntryOptions({
    activeModelEntries,
    duration,
    effectiveGenerateAudio,
    hasVideoReferenceInput,
    imageSize,
    mode,
    multiShots,
    providerId,
    service,
  }), [
    activeModelEntries,
    duration,
    effectiveGenerateAudio,
    hasVideoReferenceInput,
    imageSize,
    mode,
    multiShots,
    providerId,
    service,
  ]);
  const {
    audioValidationError,
    backendValidationError,
    canGenerate,
    generateButtonLabel,
    generateButtonTitle,
    multiShotValidationError,
  } = useMemo(() => buildFlashBoardGenerationActionState({
    accountAuthenticated: accountSession?.authenticated === true,
    duration,
    effectiveGenerateAudio,
    effectivePrompt,
    hasElevenLabsKey,
    hasEvolinkKey,
    hasGenerationBoard,
    hasHostedSession,
    hasImageReferenceInput,
    hasKieAiKey,
    hasReferenceMediaInput: hasVisualReferenceInput,
    hasVideoReferenceInput,
    hostedAIEnabled,
    imageSize,
    isAudioMode,
    isHostedAudioMode,
    isSunoMode,
    languageCode,
    languageOverride,
    mode,
    maxMultiShots: MAX_MULTI_SHOTS,
    modelRates: selectedElevenLabsModel?.modelRates,
    multiShotDurationTotal,
    multiShots,
    normalizedMultiPrompt,
    providerId,
    selectedElevenLabsCharacterLimit,
    selectedEntry,
    seedanceReferenceValidationError,
    service,
    sunoCustomMode,
    sunoStyle,
    supportsMultiShot,
    usePiApiKeyByDefault,
    version,
    voiceId,
  }), [
    accountSession?.authenticated,
    duration,
    effectiveGenerateAudio,
    effectivePrompt,
    hasElevenLabsKey,
    hasEvolinkKey,
    hasGenerationBoard,
    hasHostedSession,
    hasImageReferenceInput,
    hasKieAiKey,
    hasVisualReferenceInput,
    hasVideoReferenceInput,
    hostedAIEnabled,
    imageSize,
    isAudioMode,
    isHostedAudioMode,
    isSunoMode,
    languageCode,
    languageOverride,
    mode,
    multiShotDurationTotal,
    multiShots,
    normalizedMultiPrompt,
    providerId,
    selectedElevenLabsCharacterLimit,
    selectedElevenLabsModel?.modelRates,
    selectedEntry,
    seedanceReferenceValidationError,
    service,
    sunoCustomMode,
    sunoStyle,
    supportsMultiShot,
    usePiApiKeyByDefault,
    version,
    voiceId,
  ]);
  const parameterOptions = useMemo(() => buildFlashBoardParameterOptions({
    activePopover: renderedPopover,
    aspectRatio,
    duration,
    effectiveGenerateAudio,
    hasVideoReferenceInput,
    imageSize,
    mode,
    multiShots,
    providerId,
    selectedEntry,
    service,
  }), [
    aspectRatio,
    duration,
    effectiveGenerateAudio,
    hasVideoReferenceInput,
    imageSize,
    mode,
    multiShots,
    providerId,
    renderedPopover,
    selectedEntry,
    service,
  ]);
  const {
    composerReferenceBadges, composerReferenceSlots, composerStyle, effectiveReferenceMediaFileIds,
    getPromptRefineMediaFile, handleComposerReferenceRoleChange,
    handleReferenceDragLeave, handleReferenceDragOver, handleReferenceDrop,
    handleReferenceRootDragLeaveCapture, handleReferenceRootDragOverCapture,
    handleReferenceRootDropCapture,
    handleReferenceSlotDragOver, handleReferenceSlotDrop,
    handleReferenceStripPointerLeave, handleRemoveComposerReference, isReferenceDragOver,
    maxReferenceMedia, referenceStripRef, showComposerReferences, supportsEndFrameReference,
    supportsTimelineReferenceRoles, updateReferenceCardFocus, activeReferenceSlotKey,
  } = useFlashBoardReferenceController({
    composer,
    isAudioMode,
    mediaFiles,
    multiShots,
    selectedEntry,
    setHoveredComposerReference,
    updateComposer,
  });
  const {
    canRestorePrompt, clearPromptRefineError, clearPromptRefineState, handleRefinePrompt,
    handleDismissPromptBeforeAiRewrite, handleRestorePromptBeforeAiRewrite, isRefiningPrompt,
    promptBeforeAiRewrite, promptRefineError, promptRefineTitle,
  } = useFlashBoardPromptRefineController({
    aspectRatio,
    canUseByoPromptRefiner,
    canUseHostedPromptRefiner,
    closePopover,
    duration,
    effectiveGenerateAudio,
    getMediaFile: getPromptRefineMediaFile,
    hasHostedSession,
    hostedAIEnabled,
    imageSize,
    isAudioMode,
    isSunoMode,
    mode,
    multiShots,
    openAiApiKey,
    openAuthDialog,
    openPricingDialog,
    openSettings,
    prompt,
    providerId,
    referenceBadges: composerReferenceBadges,
    selectedEntry,
    service,
    setPrompt,
    setSunoCustomMode,
    setSunoNegativeTags,
    setSunoStyle,
    sunoAudioWeight,
    sunoCustomMode,
    sunoInstrumental,
    sunoNegativeTags,
    sunoStyle,
    sunoStyleWeight,
    sunoVocalGender,
    sunoWeirdnessConstraint,
    version,
  });
  useEffect(() => {
    promptRefineCallbacksRef.current.clearPromptRefineError = clearPromptRefineError;
    promptRefineCallbacksRef.current.clearPromptRefineState = clearPromptRefineState;
  }, [clearPromptRefineError, clearPromptRefineState]);
  useEffect(() => () => {
    if (copiedPromptBookResetRef.current !== null) {
      window.clearTimeout(copiedPromptBookResetRef.current);
    }
  }, []);

  const handlePromptBookCopy = (prompt: string, pageId: string) => {
    if (!navigator.clipboard?.writeText) return;
    void navigator.clipboard.writeText(prompt).then(() => {
      setCopiedPromptBookEntryId(pageId);
      if (copiedPromptBookResetRef.current !== null) {
        window.clearTimeout(copiedPromptBookResetRef.current);
      }
      copiedPromptBookResetRef.current = window.setTimeout(() => {
        setCopiedPromptBookEntryId(null);
        copiedPromptBookResetRef.current = null;
      }, 1200);
    }).catch(() => {
      setCopiedPromptBookEntryId(null);
    });
  };

  const {
    handleAudioToggle, handleGenerate, handleKeyDown, handleProviderChange,
  } = useFlashBoardGenerationFlowController({
    aspectRatio,
    canGenerate,
    chatPanelOpen,
    closePopover,
    composer,
    duration,
    effectiveGenerateAudio,
    effectivePrompt,
    effectiveReferenceMediaFileIds,
    imageSize,
    isAudioMode,
    isElevenLabsMode,
    isSunoMode,
    languageCode,
    languageOverride,
    maxReferenceMedia,
    mode,
    multiShots,
    normalizedMultiPrompt,
    originalPrompt: promptBeforeAiRewrite,
    outputFormat,
    providerId,
    selectedEntry,
    service,
    setAspectRatio,
    setDuration,
    setGenerateAudio,
    setImageSize,
    setMode,
    setProviderId,
    setService,
    setVersion,
    sunoAudioWeight,
    sunoCustomMode,
    sunoInstrumental,
    sunoNegativeTags,
    sunoStyle,
    sunoStyleWeight,
    sunoTitle,
    sunoVocalGender,
    sunoWeirdnessConstraint,
    supportsAudio,
    updateComposer,
    version,
    visibleCatalog,
    voiceId,
    voiceName,
    voiceSettings,
  });

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled && popover === 'model') {
        setActiveModelCategory(selectedModelCategory);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [popover, selectedModelCategory]);

  if (!hasGenerationBoard) return null;

  return (
    <div
      className={`fb-bubble ${showComposerReferences ? 'has-references' : ''} ${chatPanelOpen ? 'has-chat-panel' : ''} ${isReferenceDragOver ? 'reference-drop-active' : ''} ${isRefiningPrompt ? 'is-refining-prompt' : ''}`}
      style={composerStyle}
      onKeyDown={handleKeyDown}
      onMouseDown={(e) => e.stopPropagation()}
      onDragOverCapture={handleReferenceRootDragOverCapture}
      onDragLeaveCapture={handleReferenceRootDragLeaveCapture}
      onDropCapture={handleReferenceRootDropCapture}
      onDragOver={handleReferenceDragOver}
      onDragLeave={handleReferenceDragLeave}
      onDrop={handleReferenceDrop}
    >
      <FlashBoardComposerMainSection
        chatPanelOpen={chatPanelOpen}
        showComposerReferences={showComposerReferences}
        showMultiShotPanel={Boolean(!chatPanelOpen && !isAudioMode && renderMultiShotPanel)}
        chatOutput={{
          chatError, chatHistoryRef, copiedChatMessageId, messages: chatMessages,
          showChatCloudActions, onAuthClick: openAuthDialog,
          onEditOptionSelect: handleEditOptionSelect,
          onMessageDoubleClick: handleChatMessageDoubleClick, onPricingClick: openPricingDialog,
        }}
        referenceStrip={{
          activeSlotKey: activeReferenceSlotKey, badges: composerReferenceBadges, slots: composerReferenceSlots,
          referenceStripRef, supportsEndFrameReference,
          supportsTimelineReferenceRoles, onHoverReference: setHoveredComposerReference,
          onPointerLeave: handleReferenceStripPointerLeave, onPointerMove: updateReferenceCardFocus,
          onReferenceRoleChange: handleComposerReferenceRoleChange, onRemoveReference: handleRemoveComposerReference,
          onSlotDragOver: handleReferenceSlotDragOver, onSlotDrop: handleReferenceSlotDrop,
        }}
        promptEditor={{
          canRestorePrompt, chatInputRef, chatPanelOpen, chatPrompt,
          elevenLabsVoicePanel: {
            emptyMessage: isHostedAudioMode
              ? hasHostedAudioAccess ? 'No voices found.' : 'Sign in for Cloud voices.'
              : hasElevenLabsKey ? 'No voices found.' : 'Configure ElevenLabs key.',
            error: elevenLabsVoicesError,
            isLoading: isLoadingElevenLabsVoices,
            search: voiceSearch,
            selectedVoiceId: voiceId,
            voiceId,
            voiceName,
            voices: elevenLabsVoiceOptions,
            onPreviewVoice: handlePreviewVoice,
            onRefresh: handleRefreshVoices,
            onSearchChange: setVoiceSearch,
            onSelectVoice: handleSelectVoice,
            onVoiceIdChange: setVoiceId,
            onVoiceNameChange: setVoiceName,
          },
          isAudioMode, isElevenLabsMode,
          isRefiningPrompt, isSunoMode, maxReferenceMedia, multiShots, prompt, promptBeforeAiRewrite,
          promptInputRef, promptRefineTitle, referenceMediaCount: effectiveReferenceMediaFileIds.length,
          sunoAudioReferenceActive: hasAudioReferenceInput, sunoAudioWeight,
          sunoNegativeTags, sunoStyle, sunoStyleLimit, sunoStyleWeight,
          sunoWeirdnessConstraint,
          onAutosizeInput: resizePromptInput,
          onChatInputKeyDown: handleChatInputKeyDown, onChatPromptChange: handleChatPromptChange,
          onClearChatPrompt: handleClearChatPrompt, onClearPrompt: handleClearPrompt,
          onDismissPromptBeforeAiRewrite: handleDismissPromptBeforeAiRewrite,
          onPromptChange: handlePromptChange, onRefinePrompt: handleRefinePrompt,
          onRestorePromptBeforeAiRewrite: handleRestorePromptBeforeAiRewrite,
          onSunoAudioWeightChange: setSunoAudioWeight, onSunoNegativeTagsChange: handleSunoNegativeTagsChange,
          onSunoResetTuning: resetSunoTuning, onSunoStyleChange: handleSunoStyleChange,
          onSunoStyleWeightChange: setSunoStyleWeight, onSunoWeirdnessConstraintChange: setSunoWeirdnessConstraint,
        }}
        multishotPanel={{
          canAddShot, duration, isClosing: isMultiShotPanelClosing,
          shots: normalizedMultiPrompt, totalDuration: multiShotDurationTotal,
          validationError: multiShotValidationError, onAddShot: handleAddShot,
          onRemoveShot: handleRemoveShot, onShotDurationChange: handleShotDurationChange,
          onShotPromptChange: handleShotPromptChange,
        }}
      />

      <FlashBoardComposerWarnings
        audioValidationError={isAudioMode ? audioValidationError : null}
        backendValidationError={backendValidationError}
        chatPanelOpen={chatPanelOpen}
        promptRefineError={promptRefineError}
        seedanceReferenceValidationError={seedanceReferenceValidationError}
        service={service}
        onAuthClick={openAuthDialog}
        onPricingClick={openPricingDialog}
      />

      <FlashBoardComposerControlBar
        chatPanelOpen={chatPanelOpen}
        inlineSubmenuStateClassName={inlineSubmenuStateClassName}
        generationControls={{
          activePopover: popover, aspectRatioLabel: aspectRatio, audioModelButtonLabel,
          audioOutputButtonLabel, durationLabel: `${duration}s`,
          effectiveGenerateAudio, imageSizeLabel: imageSize, isAudioMode, isElevenLabsMode,
          isSunoMode, modeLabel, modelButtonLabel, multiShots,
          popoverHostClassName, popoverRef,
          selectedEntryHasAspectRatios: Boolean(selectedEntry && selectedEntry.aspectRatios.length > 0),
          selectedEntryHasDurations: Boolean(selectedEntry && selectedEntry.durations.length > 0),
          selectedEntryHasImageSizes: Boolean(selectedEntry?.supportsTextToImage && selectedEntry.imageSizes?.length),
          selectedEntryHasMultipleModes: Boolean(selectedEntry && selectedEntry.modes.length > 1),
          sunoModelButtonLabel, sunoModeButtonLabel, sunoVocalGender,
          sunoVocalGenderOptions, supportsAudio,
          supportsMultiShot, voiceSettingsChanged, onAudioToggle: handleAudioToggle,
          onMultiShotToggle: handleMultiShotToggle, onOpenPopover: togglePopover,
          onOpenPromptBook: () => openPromptBook('generation'),
          onSunoVocalGenderChange: handleSunoVocalGenderChange,
        }}
        modelPopover={{
          activeCategoryId: effectiveModelCategory, activePopover: renderedPopover,
          categories: availableModelCategories, entries: modelEntryOptions,
          onCategoryChange: setActiveModelCategory,
          onEntrySelect: (entryId) => {
            const selectedProvider = modelEntryOptions.find((entry) => entry.id === entryId);
            if (selectedProvider) {
              handleProviderChange(selectedProvider.service, selectedProvider.providerId);
            }
          },
        }}
        sunoPopovers={{
          activePopover: renderedPopover, currentModelId: currentSunoModelId, customMode: sunoCustomMode,
          instrumental: sunoInstrumental, isSunoMode, modelOptions: sunoModelOptions,
          onClosePopover: closePopover,
          onModeChange: (nextCustomMode, nextInstrumental) => {
            setSunoCustomMode(nextCustomMode);
            setSunoInstrumental(nextInstrumental);
          },
          onModelChange: setVersion,
        }}
        elevenLabsSettingsPopovers={{
          activePopover: renderedPopover, isElevenLabsMode, languageCode, languageOverride,
          modelId: version, modelMetaText: elevenLabsModelMetaText, modelOptions: elevenLabsModelOptions,
          outputFormat, outputOptions: elevenLabsOutputOptions, voiceSettings,
          onLanguageCodeChange: setLanguageCode, onLanguageOverrideChange: setLanguageOverride,
          onModelChange: setVersion, onOutputFormatChange: handleOutputFormatChange,
          onResetVoiceSettings: resetVoiceSettings, onSpeakerBoostChange: handleSpeakerBoostChange,
          onVoiceSettingNumberChange: handleVoiceSettingNumberChange,
        }}
        elevenLabsVoicePopover={{
          activePopover: renderedPopover,
          emptyMessage: isHostedAudioMode
            ? hasHostedAudioAccess ? 'No voices found.' : 'Sign in for Cloud voices.'
            : hasElevenLabsKey ? 'No voices found.' : 'Configure ElevenLabs key.',
          error: elevenLabsVoicesError, isElevenLabsMode, isLoading: isLoadingElevenLabsVoices,
          search: voiceSearch, selectedVoiceId: voiceId, voiceId, voiceName,
          voices: elevenLabsVoiceOptions, onPreviewVoice: handlePreviewVoice,
          onRefresh: handleRefreshVoices, onSearchChange: setVoiceSearch,
          onSelectVoice: handleSelectVoice, onVoiceIdChange: setVoiceId,
          onVoiceNameChange: setVoiceName,
        }}
        parameterPopovers={{
          activePopover: renderedPopover, aspectOptions: parameterOptions.aspectOptions,
          durationOptions: parameterOptions.durationOptions, imageSizeOptions: parameterOptions.imageSizeOptions,
          modeOptions: parameterOptions.modeOptions, modeTitle: selectedEntry?.modeControlLabel,
          onAspectRatioChange: setAspectRatio,
          onClosePopover: closePopover, onDurationChange: setDuration,
          onImageSizeChange: setImageSize, onModeChange: setMode,
        }}
        chatControls={{
          activeChatModel, activeChatModelId, activePopover: popover, aiApprovalMode,
          chatError, chatModelOptions, chatPrompt, chatProvider, chatProviderLabel,
          chatProviderOptions, editOptionsMode: chatOptionsMode, editOptionsModeEnabled: chatOptionsModeEnabled,
          chatReasoningEffortOptions, chatReasoningSupported,
          chatTemperature, chatTemperatureSupported, hasChatMessages: chatMessages.length > 0,
          isChatting, lemonadeStatus, openAiReasoningEffort, popoverHostClassName,
          popoverRef, renderedPopover,
          onAiApprovalModeChange: setAiApprovalMode,
          onChatErrorClear: clearChatError, onChatModelChange: setChatModel,
          onChatProviderSelect: handleChatProviderSelect, onChatTemperatureChange: setChatTemperature,
          onClearChatHistory: handleClearChatHistory, onClosePopover: closePopover,
          onEditOptionsModeToggle: () => setChatOptionsMode(!chatOptionsMode),
          onOpenPopover: togglePopover, onOpenPromptBook: () => openPromptBook('chat'),
          onReasoningEffortChange: setOpenAiReasoningEffort,
        }}
        actionStack={{
          canGenerate, chatButtonLabel, chatButtonTitle: chatChargeTitle ?? 'Send chat prompt',
          chatPanelOpen, generateButtonLabel, generateButtonTitle,
          onChatButtonClick: handleChatButtonClick, onGenerate: handleGenerate,
        }}
      />

      {promptBookOpen && (
        <FlashBoardPromptBook
          activeSystemPrompt={activeChatSystemPrompt}
          activeSystemPromptProvider={chatSystemPromptProvider}
          chatMessages={chatMessages}
          copiedEntryId={copiedPromptBookEntryId}
          entries={promptHistory}
          generationRecords={activeGenerationRecords}
          initialKind={promptBookInitialKind}
          isPromptLibraryLoading={isPromptLibraryLoading}
          mediaFiles={mediaFiles}
          projectPromptStorageReady={projectPromptStorageReady}
          promptDialogError={promptDialogError}
          promptDialogStatus={promptDialogStatus}
          promptDraft={promptDraft}
          promptHasOverride={chatPromptHasOverride}
          promptNameDraft={promptNameDraft}
          savedSystemPrompts={savedPromptFiles}
          selectedPromptFile={selectedPromptFile}
          onClose={() => setPromptBookOpen(false)}
          onCopy={handlePromptBookCopy}
          onApplySystemPromptDraft={applyPromptDraft}
          onDeleteSystemPrompt={deleteSelectedProjectPrompt}
          onLoadSystemPrompt={loadSelectedProjectPrompt}
          onOverwriteSystemPrompt={overwriteSelectedProjectPrompt}
          onRefreshSystemPrompts={refreshSavedPromptFiles}
          onResetSystemPromptDraft={resetPromptDraft}
          onSaveSystemPrompt={savePromptDialog}
          onSetPromptDraft={setPromptDraft}
          onSetPromptName={setPromptNameDraft}
          onSetSelectedPromptFile={setSelectedPromptFile}
        />
      )}
    </div>
  );
}
