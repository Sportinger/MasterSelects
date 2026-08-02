import { useState, useMemo, useRef, useEffect } from 'react';
import { useFlashBoardStore } from '../../../stores/flashboardStore';
import { useHasFlashBoardActiveGenerationBoard } from '../../../stores/flashboardStore/activeGenerationRecords';
import { DEFAULT_FLASHBOARD_MODEL_VERSION } from '../../../stores/flashboardStore/defaults';
import { useMediaStore } from '../../../stores/mediaStore';
import {
  DEFAULT_SUNO_DURATION,
  MAX_SUNO_DURATION,
  MIN_SUNO_DURATION,
  SUNO_PROVIDER_ID,
} from '../../../services/sunoContracts';
import { RUNWAY_VIDEO_PROVIDER_ID } from '../../../services/kieAi/config';
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

type FlashBoardComposerProps = { initialProviderId?: string; initialService?: CatalogEntry['service']; initialVersion?: string; initialMode?: 'generate' | 'chat'; initialChatPrompt?: string; allowedServices?: CatalogEntry['service'][]; serviceScope?: CatalogEntry['service']; };

export function FlashBoardComposer({
  initialProviderId,
  initialService,
  initialVersion,
  initialMode = 'generate',
  initialChatPrompt,
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
    accountSession, canUseHostedPromptRefiner,
    hasHostedAudioAccess, hasHostedSession,
    hostedAIEnabled,
    openAuthDialog, openPricingDialog,
  } = useFlashBoardComposerAccessState();

  const modelCatalogState = useMemo(() => buildFlashBoardModelCatalogState({
    allowedServices,
    hasHostedSession,
    initialProviderId,
    initialService,
    serviceScope,
  }), [
    allowedServices,
    hasHostedSession,
    initialProviderId,
    initialService,
    serviceScope,
  ]);
  const {
    emptyCatalogFallbackService,
    initialEntry,
    visibleCatalog,
  } = modelCatalogState;
  const initialModelSettings = initialEntry
    ? composer.modelSettingsByKey?.[`${initialEntry.service}:${initialEntry.providerId}`]
    : undefined;
  const initialGenerateAudio = initialModelSettings?.generateAudio ?? false;

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
  const [promptBookInitialKind, setPromptBookInitialKind] = useState<'generation' | 'chat'>('generation');
  const [copiedPromptBookEntryId, setCopiedPromptBookEntryId] = useState<string | null>(null);
  const copiedPromptBookResetRef = useRef<number | null>(null);
  const {
    availableChatModelClasses, chatButtonLabel, chatChargeTitle, chatError,
    chatModelClass, chatModelClassAvailabilityStatus,
    chatMessages, chatPanelOpen, chatPrompt, chatProvider,
    chatProviderLabel, chatProviderOptions,
    copiedChatMessageId, handleChatButtonClick, handleChatModelClassSelect,
    handleChatInputKeyDown,
    handleChatMessageDoubleClick, handleChatProviderSelect, handleChatPromptChange,
    handleClearChatHistory, handleClearChatPrompt, isChatting,
    decisionPolicy,
    handleDecisionPolicyChange, handleStoryboardDecisionSubmit,
    showChatCloudActions,
  } = useFlashBoardChatController({
    closePopover,
    hasHostedSession,
    hostedAIEnabled,
    initialChatPrompt,
    initialMode,
    openAuthDialog,
    openPricingDialog,
  });
  const openPromptBook = (kind: 'generation' | 'chat') => {
    setPromptBookInitialKind(kind);
    setPromptBookOpen(true);
  };
  const [duration, setDuration] = useState(initialModelSettings?.duration ?? composer.duration ?? 5);
  const [aspectRatio, setAspectRatio] = useState(initialModelSettings?.aspectRatio ?? composer.aspectRatio ?? '16:9');
  const [imageSize, setImageSize] = useState(initialModelSettings?.imageSize ?? composer.imageSize ?? '1K');
  const [generateAudio, setGenerateAudio] = useState(initialGenerateAudio);
  useFlashBoardInitialEntrySync({
    initialEntry,
    initialAspectRatio: initialModelSettings?.aspectRatio ?? composer.aspectRatio,
    initialDuration: initialModelSettings?.duration ?? composer.duration,
    initialGenerateAudio,
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
  const isAudioMode = selectedEntry?.outputType === 'audio';
  const isSunoMode = selectedEntry?.providerId === SUNO_PROVIDER_ID || providerId === SUNO_PROVIDER_ID;
  const isElevenLabsMode = isAudioMode && selectedEntry?.providerId === 'cloud-elevenlabs-tts';
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
    hasHostedAudioAccess,
    initialLanguageCode: composer.languageCode,
    initialLanguageOverride: composer.languageOverride,
    initialOutputFormat: composer.outputFormat,
    initialVoiceId: composer.voiceId,
    initialVoiceName: composer.voiceName,
    initialVoiceSettings: composer.voiceSettings,
    isElevenLabsMode,
    setVersion,
    version,
  });
  const supportsAudio = !isAudioMode && selectedEntry?.supportsGenerateAudio === true;
  if (providerId === RUNWAY_VIDEO_PROVIDER_ID && duration === 10 && mode === '1080p') {
    setMode('720p');
  }
  if (seedanceReferenceModeActive && hasAudioReferenceInput && !generateAudio) {
    setGenerateAudio(true);
  }
  const supportsMultiShot = !isAudioMode && selectedEntry?.supportsMultiShot === true;
  const {
    canAddShot, handleAddShot, handleMultiShotToggle, handleRemoveShot,
    handleShotDurationChange, handleShotPromptChange, isMultiShotPanelClosing,
    multiShotDurationTotal, multiShots, normalizedMultiPrompt, renderMultiShotPanel,
  } = useFlashBoardMultishotController({
    duration,
    generateAudio,
    isAudioMode,
    selectionKey: `${service}:${providerId}`,
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
    sunoModelButtonLabel, sunoModelOptions, sunoNegativeTags,
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
  const sunoDurationSupported = isSunoMode && sunoCustomMode && currentSunoModelId === 'V5_5';
  useEffect(() => {
    const needsSunoDurationDefault =
      sunoDurationSupported
      && (duration < MIN_SUNO_DURATION || duration > MAX_SUNO_DURATION);
    if (!needsSunoDurationDefault) return undefined;

    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setDuration(DEFAULT_SUNO_DURATION);
    });
    return () => {
      cancelled = true;
    };
  }, [duration, sunoDurationSupported]);
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
    effectivePrompt: isSunoMode && sunoInstrumental ? '' : effectivePrompt,
    hasGenerationBoard,
    hasHostedSession,
    hasImageReferenceInput,
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
    sunoInstrumental,
    sunoStyle,
    supportsMultiShot,
    version,
    voiceId,
  }), [
    accountSession?.authenticated,
    duration,
    effectiveGenerateAudio,
    effectivePrompt,
    hasGenerationBoard,
    hasHostedSession,
    hasImageReferenceInput,
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
    sunoInstrumental,
    sunoStyle,
    supportsMultiShot,
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
    chatPanelOpen,
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
    openAuthDialog,
    openPricingDialog,
    prompt: isSunoMode && sunoInstrumental ? '' : prompt,
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
      id="flashboard-credit-activity-anchor"
      className={`fb-bubble ${isSunoMode ? 'is-suno-composer' : ''} ${showComposerReferences ? 'has-references' : ''} ${chatPanelOpen ? 'has-chat-panel' : ''} ${isReferenceDragOver ? 'reference-drop-active' : ''} ${isRefiningPrompt ? 'is-refining-prompt' : ''}`}
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
          isChatting, showChatCloudActions, onAuthClick: openAuthDialog,
          onDecisionSubmit: handleStoryboardDecisionSubmit,
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
            emptyMessage: hasHostedAudioAccess ? 'No voices found.' : 'Sign in for Cloud voices.',
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
          sunoCustomMode, sunoInstrumental, sunoNegativeTags, sunoStyle, sunoStyleLimit, sunoStyleWeight,
          sunoWeirdnessConstraint,
          onAutosizeInput: resizePromptInput,
          onChatInputKeyDown: handleChatInputKeyDown, onChatPromptChange: handleChatPromptChange,
          onClearChatPrompt: handleClearChatPrompt, onClearPrompt: handleClearPrompt,
          onDismissPromptBeforeAiRewrite: handleDismissPromptBeforeAiRewrite,
          onPromptChange: handlePromptChange, onRefinePrompt: handleRefinePrompt,
          onRestorePromptBeforeAiRewrite: handleRestorePromptBeforeAiRewrite,
          onSunoAudioWeightChange: setSunoAudioWeight, onSunoNegativeTagsChange: handleSunoNegativeTagsChange,
          onSunoResetTuning: resetSunoTuning, onSunoStyleChange: handleSunoStyleChange,
          onSunoCustomModeChange: setSunoCustomMode,
          onSunoInstrumentalChange: setSunoInstrumental,
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
          selectedEntryHasDurations: sunoDurationSupported
            || Boolean(selectedEntry && selectedEntry.durations.length > 0),
          selectedEntryHasImageSizes: Boolean(selectedEntry?.supportsTextToImage && selectedEntry.imageSizes?.length),
          selectedEntryHasMultipleModes: Boolean(selectedEntry && selectedEntry.modes.length > 1),
          sunoModelButtonLabel, sunoVocalGender,
          sunoVocalGenderOptions, sunoVoiceControlsDisabled: !sunoCustomMode || sunoInstrumental, supportsAudio,
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
          activePopover: renderedPopover, currentModelId: currentSunoModelId,
          isSunoMode, modelOptions: sunoModelOptions,
          onClosePopover: closePopover,
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
          emptyMessage: hasHostedAudioAccess ? 'No voices found.' : 'Sign in for Cloud voices.',
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
          durationRange: sunoDurationSupported
            ? { min: MIN_SUNO_DURATION, max: MAX_SUNO_DURATION, step: 1, value: duration }
            : undefined,
          modeOptions: parameterOptions.modeOptions, modeTitle: selectedEntry?.modeControlLabel,
          onAspectRatioChange: setAspectRatio,
          onClosePopover: closePopover, onDurationChange: setDuration,
          onImageSizeChange: setImageSize, onModeChange: setMode,
        }}
        chatControls={{
          activePopover: popover, availableChatModelClasses, chatError,
          chatModelClass, chatModelClassAvailabilityStatus, chatPrompt,
          chatProvider, chatProviderLabel, chatProviderOptions,
          hasChatMessages: chatMessages.length > 0,
          isChatting, popoverHostClassName, popoverRef, renderedPopover,
          onChatModelClassSelect: handleChatModelClassSelect,
          onChatProviderSelect: handleChatProviderSelect,
          onClearChatHistory: handleClearChatHistory, onClosePopover: closePopover,
          onOpenPopover: togglePopover, onOpenPromptBook: () => openPromptBook('chat'),
          showChatModelClass: Boolean(
            chatProvider === 'kie' && hasHostedSession && hostedAIEnabled,
          ),
        }}
        actionStack={{
          canGenerate, chatButtonLabel, chatButtonTitle: chatChargeTitle ?? 'Send chat prompt',
          chatPanelOpen, generateButtonLabel, generateButtonTitle,
          isChatting, decisionPolicy,
          onChatButtonClick: handleChatButtonClick, onGenerate: handleGenerate,
          onDecisionPolicyChange: handleDecisionPolicyChange,
        }}
      />

      {promptBookOpen && (
        <FlashBoardPromptBook
          chatMessages={chatMessages}
          copiedEntryId={copiedPromptBookEntryId}
          entries={promptHistory}
          generationRecords={activeGenerationRecords}
          initialKind={promptBookInitialKind}
          mediaFiles={mediaFiles}
          onClose={() => setPromptBookOpen(false)}
          onCopy={handlePromptBookCopy}
        />
      )}
    </div>
  );
}
