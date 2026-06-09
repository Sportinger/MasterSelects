import { useState, useCallback, useMemo, useEffect, type CSSProperties } from 'react';
import { useFlashBoardStore } from '../../../stores/flashboardStore';
import {
  submitFlashBoardActiveGenerationRequest,
  useHasFlashBoardActiveGenerationBoard,
} from '../../../stores/flashboardStore/activeGenerationRecords';
import type {
  FlashBoardSunoVocalGender,
} from '../../../stores/flashboardStore';
import {
  DEFAULT_FLASHBOARD_MODEL_VERSION,
} from '../../../stores/flashboardStore/defaults';
import { useMediaStore } from '../../../stores/mediaStore';
import { useSettingsStore } from '../../../stores/settingsStore';
import { useAccountStore } from '../../../stores/accountStore';
import {
  DEFAULT_SUNO_AUDIO_WEIGHT,
  DEFAULT_SUNO_CUSTOM_MODE,
  DEFAULT_SUNO_INSTRUMENTAL,
  DEFAULT_SUNO_STYLE_WEIGHT,
  DEFAULT_SUNO_WEIRDNESS_CONSTRAINT,
  SUNO_PROVIDER_ID,
} from '../../../services/sunoService';
import {
  getSeedanceReferenceValidationError,
  isSeedance2ProviderId,
} from '../../../services/flashboard/seedanceReferenceRules';
import type { CatalogEntry } from '../../../services/flashboard/types';
import { FlashBoardActionStack } from './FlashBoardActionStack';
import { FlashBoardChatControls } from './FlashBoardChatControls';
import { FlashBoardChatOutput } from './FlashBoardChatOutput';
import { FlashBoardElevenLabsSettingsPopovers } from './FlashBoardElevenLabsSettingsPopovers';
import { FlashBoardElevenLabsVoicePopover } from './FlashBoardElevenLabsVoicePopover';
import { buildFlashBoardGenerationActionState, getSunoStyleLimit } from './FlashBoardGenerationActionStatePlanner';
import { buildFlashBoardGenerationRequest } from './FlashBoardGenerationRequestPlanner';
import { FlashBoardGenerationControls } from './FlashBoardGenerationControls';
import { FlashBoardModelPopover } from './FlashBoardModelPopover';
import {
  buildFlashBoardModelEntryOptions,
  buildFlashBoardModelCatalogState,
  buildFlashBoardModelOptionsState,
  getFlashBoardModelCategory,
  type FlashBoardModelCategoryId,
} from './FlashBoardModelOptionsPlanner';
import { FlashBoardMultishotPanel } from './FlashBoardMultishotPanel';
import {
  buildFallbackPrompt,
  MAX_MULTI_SHOTS,
} from './FlashBoardMultishotPlanner';
import { buildFlashBoardParameterOptions } from './FlashBoardParameterOptionsPlanner';
import { FlashBoardParameterPopovers } from './FlashBoardParameterPopovers';
import { FlashBoardPromptEditor } from './FlashBoardPromptEditor';
import { buildFlashBoardComposerSyncPatch } from './FlashBoardComposerSyncPlanner';
import { buildFlashBoardProviderTransition } from './FlashBoardProviderTransitionPlanner';
import { buildFlashBoardReferenceBadges } from './FlashBoardReferenceBadgePlanner';
import {
  appendReferenceMediaFileIds,
  clampReferenceMediaFileIds,
  isReferenceableMediaType,
} from './FlashBoardReferenceMediaPlanner';
import { FlashBoardReferenceStrip } from './FlashBoardReferenceStrip';
import { FlashBoardSunoPopovers } from './FlashBoardSunoPopovers';
import {
  buildFlashBoardSunoOptionsState,
  buildFlashBoardSunoTuningResetState,
} from './FlashBoardSunoOptionsPlanner';
import { useFlashBoardReferenceCommands } from './useFlashBoardReferenceCommands';
import { useFlashBoardReferenceFocus } from './useFlashBoardReferenceFocus';
import { useFlashBoardReferenceDrop } from './useFlashBoardReferenceDrop';
import { useFlashBoardMultishotController } from './useFlashBoardMultishotController';
import { useFlashBoardComposerPopovers } from './useFlashBoardComposerPopovers';
import { useFlashBoardPromptAutosize } from './useFlashBoardPromptAutosize';
import { useFlashBoardChatHistoryScroll } from './useFlashBoardChatHistoryScroll';
import { useFlashBoardInitialEntrySync } from './useFlashBoardInitialEntrySync';
import { useFlashBoardElevenLabsController } from './useFlashBoardElevenLabsController';
import { useFlashBoardChatController } from './useFlashBoardChatController';
import { useFlashBoardPromptRefineController } from './useFlashBoardPromptRefineController';
import {
  areFlashBoardVoiceSettingsEqual,
} from './FlashBoardVoiceSettingsPlanner';

function normalizeApiKeyValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

interface FlashBoardComposerProps {
  initialProviderId?: string;
  initialService?: CatalogEntry['service'];
  initialVersion?: string;
  initialMode?: 'generate' | 'chat';
  allowedServices?: CatalogEntry['service'][];
  serviceScope?: CatalogEntry['service'];
}

function clampSunoWeight(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(0, Math.min(1, value));
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
  const openAiApiKey = normalizeApiKeyValue(useSettingsStore((s) => s.apiKeys.openai));
  const anthropicApiKey = normalizeApiKeyValue(useSettingsStore((s) => s.apiKeys.anthropic));
  const piApiKey = normalizeApiKeyValue(useSettingsStore((s) => s.apiKeys.piapi));
  const kieAiApiKey = normalizeApiKeyValue(useSettingsStore((s) => s.apiKeys.kieai));
  const evolinkApiKey = normalizeApiKeyValue(useSettingsStore((s) => s.apiKeys.evolink));
  const elevenLabsApiKey = normalizeApiKeyValue(useSettingsStore((s) => s.apiKeys.elevenlabs));
  const apiKeysUnlocked = useSettingsStore((s) => s.apiKeysUnlocked);
  const apiKeyDefaults = useSettingsStore((s) => s.apiKeyDefaults);
  const lemonadeEndpoint = useSettingsStore((s) => s.lemonadeEndpoint);
  const openSettings = useSettingsStore((s) => s.openSettings);
  const aiApprovalMode = useSettingsStore((s) => s.aiApprovalMode);
  const setAiApprovalMode = useSettingsStore((s) => s.setAiApprovalMode);
  const useOpenAiKeyByDefault = Boolean(apiKeysUnlocked && apiKeyDefaults.openai && openAiApiKey.trim());
  const useAnthropicKeyByDefault = Boolean(apiKeysUnlocked && apiKeyDefaults.anthropic && anthropicApiKey.trim());
  const usePiApiKeyByDefault = Boolean(apiKeysUnlocked && apiKeyDefaults.piapi && piApiKey.trim());
  const useKieAiKeyByDefault = Boolean(apiKeysUnlocked && apiKeyDefaults.kieai && kieAiApiKey.trim());
  const useEvolinkKeyByDefault = Boolean(apiKeysUnlocked && apiKeyDefaults.evolink && evolinkApiKey.trim());
  const useElevenLabsKeyByDefault = Boolean(apiKeysUnlocked && apiKeyDefaults.elevenlabs && elevenLabsApiKey.trim());
  const useHostedProductionProviders = import.meta.env.PROD;
  const hasOpenAiKey = useOpenAiKeyByDefault;
  const hasAnthropicKey = useAnthropicKeyByDefault;
  const hasKieAiKey = useKieAiKeyByDefault;
  const hasEvolinkKey = useEvolinkKeyByDefault;
  const hasElevenLabsKey = useElevenLabsKeyByDefault;
  const accountSession = useAccountStore((s) => s.session);
  const hostedAIEnabled = useAccountStore((s) => s.hostedAIEnabled);
  const openAuthDialog = useAccountStore((s) => s.openAuthDialog);
  const openPricingDialog = useAccountStore((s) => s.openPricingDialog);
  const hasHostedSession = accountSession?.authenticated === true;
  const hasHostedAudioAccess = Boolean(accountSession?.authenticated && hostedAIEnabled);
  const canUseHostedPromptRefiner = Boolean(accountSession?.authenticated && hostedAIEnabled);
  const canUseByoPromptRefiner = !useHostedProductionProviders && hasOpenAiKey;

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
  const {
    handleReferenceStripPointerLeave,
    referenceStripRef,
    updateReferenceCardFocus,
  } = useFlashBoardReferenceFocus();

  const [service, setService] = useState<CatalogEntry['service']>(
    initialEntry?.service ?? visibleCatalog[0]?.service ?? emptyCatalogFallbackService,
  );
  const [providerId, setProviderId] = useState(initialEntry?.providerId ?? visibleCatalog[0]?.providerId ?? initialProviderId ?? '');
  const [version, setVersion] = useState(initialVersion ?? initialEntry?.versions[0] ?? DEFAULT_FLASHBOARD_MODEL_VERSION);
  const [mode, setMode] = useState('std');
  const [prompt, setPrompt] = useState('');
  const {
    activeChatModel,
    activeChatModelId,
    chatButtonLabel,
    chatChargeTitle,
    chatError,
    chatMessages,
    chatModelOptions,
    chatPanelOpen,
    chatPrompt,
    chatProvider,
    chatProviderLabel,
    chatProviderOptions,
    chatReasoningEffortOptions,
    chatReasoningSupported,
    chatTemperature,
    chatTemperatureSupported,
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
  const [sunoCustomMode, setSunoCustomMode] = useState(composer.sunoCustomMode ?? DEFAULT_SUNO_CUSTOM_MODE);
  const [sunoInstrumental, setSunoInstrumental] = useState(composer.sunoInstrumental ?? DEFAULT_SUNO_INSTRUMENTAL);
  const [sunoStyle, setSunoStyle] = useState(composer.sunoStyle ?? '');
  const [sunoTitle] = useState(composer.sunoTitle ?? '');
  const [sunoNegativeTags, setSunoNegativeTags] = useState(composer.sunoNegativeTags ?? '');
  const [sunoVocalGender, setSunoVocalGender] = useState<FlashBoardSunoVocalGender | ''>(
    composer.sunoVocalGender ?? '',
  );
  const [sunoStyleWeight, setSunoStyleWeight] = useState(
    clampSunoWeight(composer.sunoStyleWeight, DEFAULT_SUNO_STYLE_WEIGHT),
  );
  const [sunoWeirdnessConstraint, setSunoWeirdnessConstraint] = useState(
    clampSunoWeight(composer.sunoWeirdnessConstraint, DEFAULT_SUNO_WEIRDNESS_CONSTRAINT),
  );
  const [sunoAudioWeight, setSunoAudioWeight] = useState(
    clampSunoWeight(composer.sunoAudioWeight, DEFAULT_SUNO_AUDIO_WEIGHT),
  );
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
  const isSunoMode = selectedEntry?.providerId === SUNO_PROVIDER_ID || service === 'suno';
  const isElevenLabsMode = isAudioMode && !isSunoMode;
  const isHostedAudioMode = isElevenLabsMode && service === 'cloud';
  const {
    audioModelButtonLabel,
    audioOutputButtonLabel,
    audioVoiceButtonLabel,
    elevenLabsVoicesError,
    handleOutputFormatChange,
    handlePreviewVoice,
    handleRefreshVoices,
    handleSelectVoice,
    handleSpeakerBoostChange,
    handleVoiceSettingNumberChange,
    isLoadingElevenLabsVoices,
    languageCode,
    languageOverride,
    modelMetaText: elevenLabsModelMetaText,
    modelOptions: elevenLabsModelOptions,
    outputFormat,
    outputOptions: elevenLabsOutputOptions,
    resetVoiceSettings,
    selectedModel: selectedElevenLabsModel,
    selectedModelCharacterLimit: selectedElevenLabsCharacterLimit,
    setLanguageCode,
    setLanguageOverride,
    setVoiceId,
    setVoiceName,
    setVoiceSearch,
    voiceId,
    voiceName,
    voiceOptions: elevenLabsVoiceOptions,
    voiceSearch,
    voiceSettings,
    voiceSettingsChanged,
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
  const sunoOptionsState = useMemo(() => buildFlashBoardSunoOptionsState({
    audioWeight: sunoAudioWeight,
    customMode: sunoCustomMode,
    instrumental: sunoInstrumental,
    modelId: version,
    styleWeight: sunoStyleWeight,
    vocalGender: sunoVocalGender,
    weirdnessConstraint: sunoWeirdnessConstraint,
  }), [
    sunoAudioWeight,
    sunoCustomMode,
    sunoInstrumental,
    sunoStyleWeight,
    sunoVocalGender,
    sunoWeirdnessConstraint,
    version,
  ]);
  const {
    currentModelId: currentSunoModelId,
    modelButtonLabel: sunoModelButtonLabel,
    modeButtonLabel: sunoModeButtonLabel,
    modelOptions: sunoModelOptions,
    tuningChanged: sunoTuningChanged,
    vocalGenderOptions: sunoVocalGenderOptions,
  } = sunoOptionsState;
  const hasSeedanceAudioReferenceInput = useMemo(
    () => (composer.referenceMediaFileIds ?? []).some((mediaFileId) => (
      mediaFiles.find((file) => file.id === mediaFileId)?.type === 'audio'
    )),
    [composer.referenceMediaFileIds, mediaFiles],
  );
  const hasSeedanceVisualReferenceInput = useMemo(
    () => Boolean(composer.startMediaFileId || composer.endMediaFileId)
      || (composer.referenceMediaFileIds ?? []).some((mediaFileId) => {
        const mediaType = mediaFiles.find((file) => file.id === mediaFileId)?.type;
        return mediaType === 'image' || mediaType === 'video';
      }),
    [composer.endMediaFileId, composer.referenceMediaFileIds, composer.startMediaFileId, mediaFiles],
  );
  const seedanceReferenceModeActive = isSeedance2ProviderId(providerId)
    && (composer.referenceMediaFileIds ?? []).length > 0;
  const seedanceReferenceValidationError = getSeedanceReferenceValidationError({
    hasAudioReference: hasSeedanceAudioReferenceInput,
    hasVisualReference: hasSeedanceVisualReferenceInput,
    providerId,
  });
  const supportsAudio = !isAudioMode
    && selectedEntry?.supportsGenerateAudio === true
    && !seedanceReferenceModeActive;
  const supportsMultiShot = !isAudioMode && selectedEntry?.supportsMultiShot === true;
  const {
    canAddShot,
    handleAddShot,
    handleMultiShotToggle,
    handleRemoveShot,
    handleShotDurationChange,
    handleShotPromptChange,
    isMultiShotPanelClosing,
    multiShotDurationTotal,
    multiShots,
    normalizedMultiPrompt,
    renderMultiShotPanel,
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
  const effectivePrompt = useMemo(() => {
    const trimmedPrompt = prompt.trim();

    if (trimmedPrompt) {
      return trimmedPrompt;
    }

    if (multiShots) {
      return buildFallbackPrompt(normalizedMultiPrompt);
    }

    return '';
  }, [multiShots, normalizedMultiPrompt, prompt]);
  const hasVideoReferenceInput = useMemo(
    () => (composer.referenceMediaFileIds ?? []).some((mediaFileId) => (
      mediaFiles.find((file) => file.id === mediaFileId)?.type === 'video'
    )),
    [composer.referenceMediaFileIds, mediaFiles],
  );
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
    hasKieAiKey,
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
    hasKieAiKey,
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
  const maxReferenceMedia = selectedEntry?.maxReferenceMedia ?? selectedEntry?.maxReferenceImages;
  const effectiveReferenceMediaFileIds = useMemo(
    () => clampReferenceMediaFileIds(composer.referenceMediaFileIds ?? [], maxReferenceMedia),
    [composer.referenceMediaFileIds, maxReferenceMedia],
  );
  const supportsTimelineReferenceRoles = !isAudioMode && selectedEntry?.supportsImageToVideo === true;
  const supportsEndFrameReference = supportsTimelineReferenceRoles && !multiShots;
  const mediaFilesById = useMemo(
    () => new Map(mediaFiles.map((file) => [file.id, file])),
    [mediaFiles],
  );
  const getCurrentReferenceMediaFileIds = useCallback(
    () => useFlashBoardStore.getState().composer.referenceMediaFileIds ?? [],
    [],
  );
  const updateReferenceMediaFileIds = useCallback((referenceMediaFileIds: string[]) => {
    updateComposer({ referenceMediaFileIds });
  }, [updateComposer]);
  const {
    handleReferenceDragLeave,
    handleReferenceDragOver,
    handleReferenceDrop,
    isReferenceDragOver,
  } = useFlashBoardReferenceDrop({
    appendReferenceMediaFileIds,
    clampReferenceMediaFileIds,
    getCurrentReferenceMediaFileIds,
    isReferenceableMediaType,
    maxReferenceMedia,
    mediaFilesById,
    updateReferenceMediaFileIds,
  });
  const {
    handleComposerReferenceRoleChange,
    handleRemoveComposerReference,
  } = useFlashBoardReferenceCommands({
    clampReferenceMediaFileIds,
    composerEndMediaFileId: composer.endMediaFileId,
    composerStartMediaFileId: composer.startMediaFileId,
    effectiveReferenceMediaFileIds,
    maxReferenceMedia,
    setHoveredComposerReference,
    supportsEndFrameReference,
    supportsTimelineReferenceRoles,
    updateComposer,
  });
  const composerReferenceBadges = useMemo(() => buildFlashBoardReferenceBadges({
    endMediaFileId: composer.endMediaFileId,
    isReferenceableMediaType,
    mediaFilesById,
    referenceMediaFileIds: effectiveReferenceMediaFileIds,
    startMediaFileId: composer.startMediaFileId,
  }), [
    composer.endMediaFileId,
    composer.startMediaFileId,
    effectiveReferenceMediaFileIds,
    mediaFilesById,
    isReferenceableMediaType,
  ]);
  const getPromptRefineMediaFile = useCallback(
    (mediaFileId: string) => mediaFilesById.get(mediaFileId),
    [mediaFilesById],
  );
  const {
    canRestorePrompt,
    clearPromptRefineError,
    clearPromptRefineState,
    handleRefinePrompt,
    handleRestorePromptBeforeAiRewrite,
    isRefiningPrompt,
    promptRefineError,
    promptRefineTitle,
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
    if (!selectedEntry) {
      return;
    }

    const nextPatch = buildFlashBoardComposerSyncPatch({
      composer,
      effectiveGenerateAudio,
      effectiveReferenceMediaFileIds,
      isAudioMode,
      isElevenLabsMode,
      isSunoMode,
      languageCode,
      languageOverride,
      maxReferenceMedia,
      multiShots,
      normalizedMultiPrompt,
      outputFormat,
      providerId,
      selectedEntry,
      service,
      sunoAudioWeight,
      sunoCustomMode,
      sunoInstrumental,
      sunoNegativeTags,
      sunoStyle,
      sunoStyleWeight,
      sunoTitle,
      sunoVocalGender,
      sunoWeirdnessConstraint,
      version,
      voiceId,
      voiceName,
      voiceSettings,
      areVoiceSettingsEqual: areFlashBoardVoiceSettingsEqual,
    });

    if (Object.keys(nextPatch).length > 0) {
      updateComposer(nextPatch);
    }
  }, [
    composer.endMediaFileId,
    composer.generateAudio,
    composer.languageCode,
    composer.languageOverride,
    composer.multiPrompt,
    composer.multiShots,
    composer.outputFormat,
    composer.outputType,
    composer.providerId,
    composer.referenceMediaFileIds,
    composer.service,
    composer.startMediaFileId,
    composer.sunoAudioWeight,
    composer.sunoCustomMode,
    composer.sunoInstrumental,
    composer.sunoNegativeTags,
    composer.sunoStyle,
    composer.sunoStyleWeight,
    composer.sunoTitle,
    composer.sunoVocalGender,
    composer.sunoWeirdnessConstraint,
    composer.version,
    composer.voiceId,
    composer.voiceName,
    composer.voiceSettings,
    effectiveGenerateAudio,
    effectiveReferenceMediaFileIds,
    isAudioMode,
    isElevenLabsMode,
    isSunoMode,
    languageCode,
    languageOverride,
    maxReferenceMedia,
    multiShots,
    normalizedMultiPrompt,
    outputFormat,
    providerId,
    selectedEntry,
    service,
    sunoAudioWeight,
    sunoCustomMode,
    sunoInstrumental,
    sunoNegativeTags,
    sunoStyle,
    sunoStyleWeight,
    sunoTitle,
    sunoVocalGender,
    sunoWeirdnessConstraint,
    updateComposer,
    version,
    voiceId,
    voiceName,
    voiceSettings,
  ]);

  useEffect(() => {
    if (popover === 'model') {
      setActiveModelCategory(selectedModelCategory);
    }
  }, [popover, selectedModelCategory]);

  const handleProviderChange = useCallback((newService: CatalogEntry['service'], newId: string) => {
    setService(newService);
    setProviderId(newId);
    const entry = visibleCatalog.find((e) => e.service === newService && e.providerId === newId);
    if (entry) {
      const transition = buildFlashBoardProviderTransition({
        currentAspectRatio: aspectRatio,
        currentDuration: duration,
        currentImageSize: imageSize,
        currentMode: mode,
        effectiveGenerateAudio,
        endMediaFileId: composer.endMediaFileId,
        entry,
        languageCode,
        languageOverride,
        multiShots,
        normalizedMultiPrompt,
        outputFormat,
        referenceMediaFileIds: composer.referenceMediaFileIds,
        startMediaFileId: composer.startMediaFileId,
        sunoAudioWeight,
        sunoCustomMode,
        sunoInstrumental,
        sunoNegativeTags,
        sunoProviderId: SUNO_PROVIDER_ID,
        sunoStyle,
        sunoStyleWeight,
        sunoTitle,
        sunoVocalGender,
        sunoWeirdnessConstraint,
        voiceId,
        voiceName,
        voiceSettings,
        clampReferenceMediaFileIds,
      });

      setVersion(transition.nextVersion);
      if (transition.nextMode !== undefined) setMode(transition.nextMode);
      if (transition.nextDuration !== undefined) setDuration(transition.nextDuration);
      if (transition.nextAspectRatio !== undefined) setAspectRatio(transition.nextAspectRatio);
      if (transition.nextImageSize !== undefined) setImageSize(transition.nextImageSize);

      updateComposer(transition.composerPatch);
    }
    closePopover();
  }, [
    aspectRatio,
    closePopover,
    composer.endMediaFileId,
    composer.referenceMediaFileIds,
    composer.startMediaFileId,
    duration,
    effectiveGenerateAudio,
    imageSize,
    languageCode,
    languageOverride,
    mode,
    multiShots,
    normalizedMultiPrompt,
    outputFormat,
    updateComposer,
    visibleCatalog,
    sunoAudioWeight,
    sunoCustomMode,
    sunoInstrumental,
    sunoNegativeTags,
    sunoStyle,
    sunoStyleWeight,
    sunoTitle,
    sunoVocalGender,
    sunoWeirdnessConstraint,
    voiceId,
    voiceName,
    voiceSettings,
  ]);

  const handleGenerate = useCallback(() => {
    if (!canGenerate || !selectedEntry) return;

    const requestIsAudio = selectedEntry.outputType === 'audio' || service === 'elevenlabs' || service === 'suno';
    const requestIsSuno = service === 'suno' || providerId === SUNO_PROVIDER_ID;
    submitFlashBoardActiveGenerationRequest(buildFlashBoardGenerationRequest({
      aspectRatio,
      duration,
      effectiveGenerateAudio,
      effectivePrompt,
      effectiveReferenceMediaFileIds,
      endMediaFileId: composer.endMediaFileId,
      imageSize,
      isAudioRequest: requestIsAudio,
      isSunoRequest: requestIsSuno,
      languageCode,
      languageOverride,
      mode,
      multiShots,
      normalizedMultiPrompt,
      outputFormat,
      providerId,
      selectedEntry,
      service,
      startMediaFileId: composer.startMediaFileId,
      sunoAudioWeight,
      sunoCustomMode,
      sunoInstrumental,
      sunoNegativeTags,
      sunoStyle,
      sunoStyleWeight,
      sunoTitle,
      sunoVocalGender,
      sunoWeirdnessConstraint,
      version,
      voiceId,
      voiceName,
      voiceSettings,
    }));
  }, [
    aspectRatio,
    canGenerate,
    composer.endMediaFileId,
    composer.startMediaFileId,
    duration,
    effectiveGenerateAudio,
    effectivePrompt,
    effectiveReferenceMediaFileIds,
    imageSize,
    languageCode,
    languageOverride,
    mode,
    multiShots,
    normalizedMultiPrompt,
    outputFormat,
    providerId,
    selectedEntry,
    service,
    sunoAudioWeight,
    sunoCustomMode,
    sunoInstrumental,
    sunoNegativeTags,
    sunoStyle,
    sunoStyleWeight,
    sunoTitle,
    sunoVocalGender,
    sunoWeirdnessConstraint,
    version,
    voiceId,
    voiceName,
    voiceSettings,
  ]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (chatPanelOpen) {
      return;
    }

    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      handleGenerate();
    }
  }, [chatPanelOpen, handleGenerate]);

  const handleAudioToggle = useCallback(() => {
    if (!supportsAudio || multiShots) {
      return;
    }

    setGenerateAudio((current) => !current);
  }, [multiShots, supportsAudio]);

  const handlePromptChange = useCallback((value: string) => {
    setPrompt(value);
    clearPromptRefineError();
  }, [clearPromptRefineError]);

  const handleSunoStyleChange = useCallback((value: string) => {
    setSunoStyle(value);
    clearPromptRefineError();
    if (value.trim()) {
      setSunoCustomMode(true);
    }
  }, [clearPromptRefineError]);

  const handleSunoNegativeTagsChange = useCallback((value: string) => {
    setSunoNegativeTags(value);
    clearPromptRefineError();
  }, [clearPromptRefineError]);

  const handleClearPrompt = useCallback(() => {
    setPrompt('');
    if (isSunoMode) {
      setSunoStyle('');
      setSunoNegativeTags('');
    }
    clearPromptRefineState();
  }, [clearPromptRefineState, isSunoMode]);

  const resetSunoTuning = useCallback(() => {
    const resetState = buildFlashBoardSunoTuningResetState();
    setSunoVocalGender(resetState.vocalGender);
    setSunoStyleWeight(resetState.styleWeight);
    setSunoWeirdnessConstraint(resetState.weirdnessConstraint);
    setSunoAudioWeight(resetState.audioWeight);
  }, []);

  if (!hasGenerationBoard) return null;

  const showComposerReferences = composerReferenceBadges.length > 0;
  const composerStyle = showComposerReferences
    ? ({ '--fb-reference-strip-width': `${Math.max(80, composerReferenceBadges.length * 80 + 4)}px` } as CSSProperties)
    : undefined;
  const showGenerationCloudActions = Boolean(backendValidationError && service === 'cloud' && /sign in/i.test(backendValidationError));

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
      {chatPanelOpen && (
        <FlashBoardChatOutput
          chatError={chatError}
          chatHistoryRef={chatHistoryRef}
          copiedChatMessageId={copiedChatMessageId}
          messages={chatMessages}
          showChatCloudActions={showChatCloudActions}
          onAuthClick={openAuthDialog}
          onMessageDoubleClick={handleChatMessageDoubleClick}
          onPricingClick={openPricingDialog}
        />
      )}

      <div className={`fb-bubble-main ${showComposerReferences ? 'has-references' : ''}`}>
        {showComposerReferences && (
          <FlashBoardReferenceStrip
            badges={composerReferenceBadges}
            referenceStripRef={referenceStripRef}
            supportsEndFrameReference={supportsEndFrameReference}
            supportsTimelineReferenceRoles={supportsTimelineReferenceRoles}
            onHoverReference={setHoveredComposerReference}
            onPointerLeave={handleReferenceStripPointerLeave}
            onPointerMove={updateReferenceCardFocus}
            onReferenceRoleChange={handleComposerReferenceRoleChange}
            onRemoveReference={handleRemoveComposerReference}
          />
        )}

        <FlashBoardPromptEditor
          canRestorePrompt={canRestorePrompt}
          chatInputRef={chatInputRef}
          chatPanelOpen={chatPanelOpen}
          chatPrompt={chatPrompt}
          isAudioMode={isAudioMode}
          isRefiningPrompt={isRefiningPrompt}
          isSunoMode={isSunoMode}
          maxReferenceMedia={maxReferenceMedia}
          multiShots={multiShots}
          prompt={prompt}
          promptInputRef={promptInputRef}
          referenceMediaCount={effectiveReferenceMediaFileIds.length}
          sunoNegativeTags={sunoNegativeTags}
          sunoStyle={sunoStyle}
          sunoStyleLimit={getSunoStyleLimit(version)}
          onAutosizeInput={resizePromptInput}
          onChatInputKeyDown={handleChatInputKeyDown}
          onChatPromptChange={handleChatPromptChange}
          onClearChatPrompt={handleClearChatPrompt}
          onClearPrompt={handleClearPrompt}
          onPromptChange={handlePromptChange}
          onRestorePromptBeforeAiRewrite={handleRestorePromptBeforeAiRewrite}
          onSunoNegativeTagsChange={handleSunoNegativeTagsChange}
          onSunoStyleChange={handleSunoStyleChange}
        />
      </div>

      {!chatPanelOpen && !isAudioMode && renderMultiShotPanel && (
        <FlashBoardMultishotPanel
          canAddShot={canAddShot}
          duration={duration}
          isClosing={isMultiShotPanelClosing}
          shots={normalizedMultiPrompt}
          totalDuration={multiShotDurationTotal}
          validationError={multiShotValidationError}
          onAddShot={handleAddShot}
          onRemoveShot={handleRemoveShot}
          onShotDurationChange={handleShotDurationChange}
          onShotPromptChange={handleShotPromptChange}
        />
      )}

      {!chatPanelOpen && isAudioMode && audioValidationError && (
        <div className="fb-audio-warning compact">{audioValidationError}</div>
      )}

      {!chatPanelOpen && seedanceReferenceValidationError && (
        <div className="fb-audio-warning compact">{seedanceReferenceValidationError}</div>
      )}

      {!chatPanelOpen && backendValidationError && (
        <div className={`fb-audio-warning compact ${showGenerationCloudActions ? 'has-cloud-actions' : ''}`}>
          <span>{backendValidationError}</span>
          {showGenerationCloudActions && (
            <div className="fb-cloud-warning-actions">
              <button type="button" onClick={openPricingDialog}>
                Prices
              </button>
              <button type="button" onClick={openAuthDialog}>
                Sign in
              </button>
            </div>
          )}
        </div>
      )}

      {!chatPanelOpen && promptRefineError && (
        <div className="fb-audio-warning compact">{promptRefineError}</div>
      )}

      <div className={`fb-bubble-bar ${inlineSubmenuStateClassName}`}>
        {!chatPanelOpen && (
          <FlashBoardGenerationControls
            activePopover={popover}
            aspectRatioLabel={aspectRatio}
            audioModelButtonLabel={audioModelButtonLabel}
            audioOutputButtonLabel={audioOutputButtonLabel}
            audioVoiceButtonLabel={audioVoiceButtonLabel}
            durationLabel={`${duration}s`}
            effectiveGenerateAudio={effectiveGenerateAudio}
            imageSizeLabel={imageSize}
            isAudioMode={isAudioMode}
            isElevenLabsMode={isElevenLabsMode}
            isRefiningPrompt={isRefiningPrompt}
            isSunoMode={isSunoMode}
            modeLabel={mode}
            modelButtonLabel={modelButtonLabel}
            multiShots={multiShots}
            popoverHostClassName={popoverHostClassName}
            popoverRef={popoverRef}
            promptRefineTitle={promptRefineTitle}
            selectedEntryHasAspectRatios={Boolean(selectedEntry && selectedEntry.aspectRatios.length > 0)}
            selectedEntryHasDurations={Boolean(selectedEntry && selectedEntry.durations.length > 0)}
            selectedEntryHasImageSizes={Boolean(selectedEntry?.supportsTextToImage && selectedEntry.imageSizes?.length)}
            selectedEntryHasMultipleModes={Boolean(selectedEntry && selectedEntry.modes.length > 1)}
            sunoModelButtonLabel={sunoModelButtonLabel}
            sunoModeButtonLabel={sunoModeButtonLabel}
            sunoTuningChanged={sunoTuningChanged}
            supportsAudio={supportsAudio}
            supportsMultiShot={supportsMultiShot}
            voiceSettingsChanged={voiceSettingsChanged}
            onAudioToggle={handleAudioToggle}
            onMultiShotToggle={handleMultiShotToggle}
            onOpenPopover={togglePopover}
            onRefinePrompt={handleRefinePrompt}
          >

          <FlashBoardModelPopover
            activeCategoryId={effectiveModelCategory}
            activePopover={renderedPopover}
            categories={availableModelCategories}
            entries={modelEntryOptions}
            onCategoryChange={setActiveModelCategory}
            onEntrySelect={(entryId) => {
              const selectedProvider = modelEntryOptions.find((entry) => entry.id === entryId);
              if (selectedProvider) {
                handleProviderChange(selectedProvider.service, selectedProvider.providerId);
              }
            }}
          />

          <FlashBoardSunoPopovers
            activePopover={renderedPopover}
            audioWeight={sunoAudioWeight}
            currentModelId={currentSunoModelId}
            customMode={sunoCustomMode}
            instrumental={sunoInstrumental}
            isSunoMode={isSunoMode}
            modelOptions={sunoModelOptions}
            styleWeight={sunoStyleWeight}
            vocalGender={sunoVocalGender}
            vocalGenderOptions={sunoVocalGenderOptions}
            weirdnessConstraint={sunoWeirdnessConstraint}
            onAudioWeightChange={setSunoAudioWeight}
            onClosePopover={closePopover}
            onModeChange={(nextCustomMode, nextInstrumental) => {
              setSunoCustomMode(nextCustomMode);
              setSunoInstrumental(nextInstrumental);
            }}
            onModelChange={setVersion}
            onResetTuning={resetSunoTuning}
            onStyleWeightChange={setSunoStyleWeight}
            onVocalGenderChange={(value) => setSunoVocalGender(value as FlashBoardSunoVocalGender | '')}
            onWeirdnessConstraintChange={setSunoWeirdnessConstraint}
          />

          <FlashBoardElevenLabsSettingsPopovers
            activePopover={renderedPopover}
            isElevenLabsMode={isElevenLabsMode}
            languageCode={languageCode}
            languageOverride={languageOverride}
            modelId={version}
            modelMetaText={elevenLabsModelMetaText}
            modelOptions={elevenLabsModelOptions}
            outputFormat={outputFormat}
            outputOptions={elevenLabsOutputOptions}
            voiceSettings={voiceSettings}
            onLanguageCodeChange={setLanguageCode}
            onLanguageOverrideChange={setLanguageOverride}
            onModelChange={setVersion}
            onOutputFormatChange={handleOutputFormatChange}
            onResetVoiceSettings={resetVoiceSettings}
            onSpeakerBoostChange={handleSpeakerBoostChange}
            onVoiceSettingNumberChange={handleVoiceSettingNumberChange}
          />

          <FlashBoardElevenLabsVoicePopover
            activePopover={renderedPopover}
            emptyMessage={
              isHostedAudioMode
                ? hasHostedAudioAccess ? 'No voices found.' : 'Sign in for Cloud voices.'
                : hasElevenLabsKey ? 'No voices found.' : 'Configure ElevenLabs key.'
            }
            error={elevenLabsVoicesError}
            isElevenLabsMode={isElevenLabsMode}
            isLoading={isLoadingElevenLabsVoices}
            search={voiceSearch}
            selectedVoiceId={voiceId}
            voiceId={voiceId}
            voiceName={voiceName}
            voices={elevenLabsVoiceOptions}
            onPreviewVoice={handlePreviewVoice}
            onRefresh={handleRefreshVoices}
            onSearchChange={setVoiceSearch}
            onSelectVoice={handleSelectVoice}
            onVoiceIdChange={setVoiceId}
            onVoiceNameChange={setVoiceName}
          />

          <FlashBoardParameterPopovers
            activePopover={renderedPopover}
            aspectOptions={parameterOptions.aspectOptions}
            durationOptions={parameterOptions.durationOptions}
            imageSizeOptions={parameterOptions.imageSizeOptions}
            modeOptions={parameterOptions.modeOptions}
            onAspectRatioChange={setAspectRatio}
            onClosePopover={closePopover}
            onDurationChange={setDuration}
            onImageSizeChange={setImageSize}
            onModeChange={setMode}
          />
          </FlashBoardGenerationControls>
        )}

        {chatPanelOpen && (
          <FlashBoardChatControls
            activeChatModel={activeChatModel}
            activeChatModelId={activeChatModelId}
            activePopover={popover}
            aiApprovalMode={aiApprovalMode}
            chatError={chatError}
            chatModelOptions={chatModelOptions}
            chatPrompt={chatPrompt}
            chatProvider={chatProvider}
            chatProviderLabel={chatProviderLabel}
            chatProviderOptions={chatProviderOptions}
            chatReasoningEffortOptions={chatReasoningEffortOptions}
            chatReasoningSupported={chatReasoningSupported}
            chatTemperature={chatTemperature}
            chatTemperatureSupported={chatTemperatureSupported}
            hasChatMessages={chatMessages.length > 0}
            isChatting={isChatting}
            lemonadeStatus={lemonadeStatus}
            openAiReasoningEffort={openAiReasoningEffort}
            popoverHostClassName={popoverHostClassName}
            popoverRef={popoverRef}
            renderedPopover={renderedPopover}
            onAiApprovalModeChange={setAiApprovalMode}
            onChatErrorClear={clearChatError}
            onChatModelChange={setChatModel}
            onChatProviderSelect={handleChatProviderSelect}
            onChatTemperatureChange={setChatTemperature}
            onClearChatHistory={handleClearChatHistory}
            onClosePopover={closePopover}
            onOpenPopover={togglePopover}
            onReasoningEffortChange={setOpenAiReasoningEffort}
          />
        )}

        <FlashBoardActionStack
          canGenerate={canGenerate}
          chatButtonLabel={chatButtonLabel}
          chatButtonTitle={chatChargeTitle ?? 'Send chat prompt'}
          chatPanelOpen={chatPanelOpen}
          generateButtonLabel={generateButtonLabel}
          generateButtonTitle={generateButtonTitle}
          onChatButtonClick={handleChatButtonClick}
          onGenerate={handleGenerate}
        />
      </div>
    </div>
  );
}
