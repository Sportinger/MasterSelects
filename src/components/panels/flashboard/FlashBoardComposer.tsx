import { useState, useMemo, useRef, useEffect } from 'react';
import { useFlashBoardStore } from '../../../stores/flashboardStore';
import {
  useHasFlashBoardActiveGenerationBoard,
} from '../../../stores/flashboardStore/activeGenerationRecords';
import {
  DEFAULT_FLASHBOARD_MODEL_VERSION,
} from '../../../stores/flashboardStore/defaults';
import { useMediaStore } from '../../../stores/mediaStore';
import {
  SUNO_PROVIDER_ID,
} from '../../../services/sunoService';
import type { CatalogEntry } from '../../../services/flashboard/types';
import { buildFlashBoardGenerationActionState } from './FlashBoardGenerationActionStatePlanner';
import {
  buildFlashBoardModelEntryOptions,
  buildFlashBoardModelCatalogState,
  buildFlashBoardModelOptionsState,
  getFlashBoardModelCategory,
  type FlashBoardModelCategoryId,
} from './FlashBoardModelOptionsPlanner';
import {
  MAX_MULTI_SHOTS,
} from './FlashBoardMultishotPlanner';
import { buildFlashBoardParameterOptions } from './FlashBoardParameterOptionsPlanner';
import { FlashBoardComposerControlBar } from './FlashBoardComposerControlBar';
import { FlashBoardComposerMainSection } from './FlashBoardComposerMainSection';
import { FlashBoardComposerWarnings } from './FlashBoardComposerWarnings';
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

interface FlashBoardComposerProps {
  initialProviderId?: string;
  initialService?: CatalogEntry['service'];
  initialVersion?: string;
  initialMode?: 'generate' | 'chat';
  allowedServices?: CatalogEntry['service'][];
  serviceScope?: CatalogEntry['service'];
}

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
  const updateComposer = useFlashBoardStore((s) => s.updateComposer);
  const setHoveredComposerReference = useFlashBoardStore((s) => s.setHoveredComposerReference);
  const mediaFiles = useMediaStore((s) => s.files);
  const {
    accountSession, aiApprovalMode, anthropicApiKey, canUseByoPromptRefiner,
    canUseHostedPromptRefiner, elevenLabsApiKey, hasAnthropicKey,
    hasElevenLabsKey, hasEvolinkKey, hasHostedAudioAccess, hasHostedSession,
    hasKieAiKey, hasOpenAiKey, hostedAIEnabled, lemonadeEndpoint, openAiApiKey,
    openAuthDialog, openPricingDialog, openSettings, setAiApprovalMode,
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
  const [version, setVersion] = useState(initialVersion ?? initialEntry?.versions[0] ?? DEFAULT_FLASHBOARD_MODEL_VERSION);
  const [mode, setMode] = useState('std');
  const {
    activeChatModel, activeChatModelId, chatButtonLabel, chatChargeTitle, chatError,
    chatMessages, chatModelOptions, chatPanelOpen, chatPrompt, chatProvider,
    chatProviderLabel, chatProviderOptions, chatReasoningEffortOptions,
    chatReasoningSupported, chatTemperature, chatTemperatureSupported, clearChatError,
    copiedChatMessageId, handleChatButtonClick, handleChatInputKeyDown,
    handleChatMessageDoubleClick, handleChatProviderSelect, handleChatPromptChange,
    handleClearChatHistory, handleClearChatPrompt, isChatting, lemonadeStatus,
    openAiReasoningEffort, setChatModel, setChatTemperature,
    setOpenAiReasoningEffort, showChatCloudActions,
  } = useFlashBoardChatController({
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
  });
  const [duration, setDuration] = useState(5);
  const [aspectRatio, setAspectRatio] = useState('16:9');
  const [imageSize, setImageSize] = useState('1K');
  const [generateAudio, setGenerateAudio] = useState(false);
  useFlashBoardInitialEntrySync({
    initialEntry,
    initialVersion,
    setAspectRatio,
    setDuration,
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
  const supportsAudio = !isAudioMode
    && selectedEntry?.supportsGenerateAudio === true
    && !seedanceReferenceModeActive;
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
    composerReferenceBadges, composerStyle, effectiveReferenceMediaFileIds,
    getPromptRefineMediaFile, handleComposerReferenceRoleChange,
    handleReferenceDragLeave, handleReferenceDragOver, handleReferenceDrop,
    handleReferenceStripPointerLeave, handleRemoveComposerReference, isReferenceDragOver,
    maxReferenceMedia, referenceStripRef, showComposerReferences, supportsEndFrameReference,
    supportsTimelineReferenceRoles, updateReferenceCardFocus,
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
          onMessageDoubleClick: handleChatMessageDoubleClick, onPricingClick: openPricingDialog,
        }}
        referenceStrip={{
          badges: composerReferenceBadges, referenceStripRef, supportsEndFrameReference,
          supportsTimelineReferenceRoles, onHoverReference: setHoveredComposerReference,
          onPointerLeave: handleReferenceStripPointerLeave, onPointerMove: updateReferenceCardFocus,
          onReferenceRoleChange: handleComposerReferenceRoleChange, onRemoveReference: handleRemoveComposerReference,
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
          promptInputRef, referenceMediaCount: effectiveReferenceMediaFileIds.length,
          sunoAudioReferenceActive: hasAudioReferenceInput, sunoAudioWeight,
          sunoNegativeTags, sunoStyle, sunoStyleLimit, sunoStyleWeight,
          sunoWeirdnessConstraint,
          onAutosizeInput: resizePromptInput,
          onChatInputKeyDown: handleChatInputKeyDown, onChatPromptChange: handleChatPromptChange,
          onClearChatPrompt: handleClearChatPrompt, onClearPrompt: handleClearPrompt,
          onDismissPromptBeforeAiRewrite: handleDismissPromptBeforeAiRewrite,
          onPromptChange: handlePromptChange, onRestorePromptBeforeAiRewrite: handleRestorePromptBeforeAiRewrite,
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
          isRefiningPrompt, isSunoMode, modeLabel: mode, modelButtonLabel, multiShots,
          popoverHostClassName, popoverRef, promptRefineTitle,
          selectedEntryHasAspectRatios: Boolean(selectedEntry && selectedEntry.aspectRatios.length > 0),
          selectedEntryHasDurations: Boolean(selectedEntry && selectedEntry.durations.length > 0),
          selectedEntryHasImageSizes: Boolean(selectedEntry?.supportsTextToImage && selectedEntry.imageSizes?.length),
          selectedEntryHasMultipleModes: Boolean(selectedEntry && selectedEntry.modes.length > 1),
          sunoModelButtonLabel, sunoModeButtonLabel, sunoVocalGender,
          sunoVocalGenderOptions, supportsAudio,
          supportsMultiShot, voiceSettingsChanged, onAudioToggle: handleAudioToggle,
          onMultiShotToggle: handleMultiShotToggle, onOpenPopover: togglePopover,
          onRefinePrompt: handleRefinePrompt, onSunoVocalGenderChange: handleSunoVocalGenderChange,
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
          modeOptions: parameterOptions.modeOptions, onAspectRatioChange: setAspectRatio,
          onClosePopover: closePopover, onDurationChange: setDuration,
          onImageSizeChange: setImageSize, onModeChange: setMode,
        }}
        chatControls={{
          activeChatModel, activeChatModelId, activePopover: popover, aiApprovalMode,
          chatError, chatModelOptions, chatPrompt, chatProvider, chatProviderLabel,
          chatProviderOptions, chatReasoningEffortOptions, chatReasoningSupported,
          chatTemperature, chatTemperatureSupported, hasChatMessages: chatMessages.length > 0,
          isChatting, lemonadeStatus, openAiReasoningEffort, popoverHostClassName,
          popoverRef, renderedPopover, onAiApprovalModeChange: setAiApprovalMode,
          onChatErrorClear: clearChatError, onChatModelChange: setChatModel,
          onChatProviderSelect: handleChatProviderSelect, onChatTemperatureChange: setChatTemperature,
          onClearChatHistory: handleClearChatHistory, onClosePopover: closePopover,
          onOpenPopover: togglePopover, onReasoningEffortChange: setOpenAiReasoningEffort,
        }}
        actionStack={{
          canGenerate, chatButtonLabel, chatButtonTitle: chatChargeTitle ?? 'Send chat prompt',
          chatPanelOpen, generateButtonLabel, generateButtonTitle,
          onChatButtonClick: handleChatButtonClick, onGenerate: handleGenerate,
        }}
      />
    </div>
  );
}
