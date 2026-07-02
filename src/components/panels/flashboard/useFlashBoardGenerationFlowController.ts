import {
  useCallback,
  useEffect,
  type Dispatch,
  type KeyboardEvent,
  type SetStateAction,
} from 'react';
import { submitFlashBoardActiveGenerationRequest } from '../../../stores/flashboardStore/activeGenerationRecords';
import type {
  FlashBoardComposerState,
  FlashBoardMultiShotPrompt,
  FlashBoardSunoVocalGender,
  FlashBoardVoiceSettings,
} from '../../../stores/flashboardStore/types';
import { SUNO_PROVIDER_ID } from '../../../services/sunoService';
import type { CatalogEntry } from '../../../services/flashboard/types';
import { buildFlashBoardGenerationRequest } from './FlashBoardGenerationRequestPlanner';
import { buildFlashBoardComposerSyncPatch } from './FlashBoardComposerSyncPlanner';
import { buildFlashBoardProviderTransition } from './FlashBoardProviderTransitionPlanner';
import { clampReferenceMediaFileIds } from './FlashBoardReferenceMediaPlanner';
import { areFlashBoardVoiceSettingsEqual } from './FlashBoardVoiceSettingsPlanner';

interface UseFlashBoardGenerationFlowControllerInput {
  aspectRatio: string;
  canGenerate: boolean;
  chatPanelOpen: boolean;
  closePopover: () => void;
  composer: FlashBoardComposerState;
  duration: number;
  effectiveGenerateAudio: boolean;
  effectivePrompt: string;
  effectiveReferenceMediaFileIds: string[];
  imageSize: string;
  isAudioMode: boolean;
  isElevenLabsMode: boolean;
  isSunoMode: boolean;
  languageCode: string;
  languageOverride: boolean;
  maxReferenceMedia?: number;
  mode: string;
  multiShots: boolean;
  normalizedMultiPrompt: FlashBoardMultiShotPrompt[];
  originalPrompt?: string | null;
  outputFormat: string;
  providerId: string;
  selectedEntry?: CatalogEntry;
  service: CatalogEntry['service'];
  setAspectRatio: Dispatch<SetStateAction<string>>;
  setDuration: Dispatch<SetStateAction<number>>;
  setGenerateAudio: Dispatch<SetStateAction<boolean>>;
  setImageSize: Dispatch<SetStateAction<string>>;
  setMode: Dispatch<SetStateAction<string>>;
  setProviderId: Dispatch<SetStateAction<string>>;
  setService: Dispatch<SetStateAction<CatalogEntry['service']>>;
  setVersion: Dispatch<SetStateAction<string>>;
  sunoAudioWeight: number;
  sunoCustomMode: boolean;
  sunoInstrumental: boolean;
  sunoNegativeTags: string;
  sunoStyle: string;
  sunoStyleWeight: number;
  sunoTitle: string;
  sunoVocalGender: FlashBoardSunoVocalGender | '';
  sunoWeirdnessConstraint: number;
  supportsAudio: boolean;
  updateComposer: (patch: Partial<FlashBoardComposerState>) => void;
  version: string;
  visibleCatalog: CatalogEntry[];
  voiceId: string;
  voiceName: string;
  voiceSettings: FlashBoardVoiceSettings;
}

export function useFlashBoardGenerationFlowController({
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
  originalPrompt,
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
}: UseFlashBoardGenerationFlowControllerInput) {
  useEffect(() => {
    if (!selectedEntry) {
      return;
    }

    const nextPatch = buildFlashBoardComposerSyncPatch({
      aspectRatio,
      composer,
      duration,
      effectiveGenerateAudio,
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
    aspectRatio,
    composer,
    duration,
    effectiveGenerateAudio,
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

  const handleProviderChange = useCallback((newService: CatalogEntry['service'], newId: string) => {
    setService(newService);
    setProviderId(newId);
    const entry = visibleCatalog.find((candidate) => (
      candidate.service === newService && candidate.providerId === newId
    ));

    if (entry) {
      const savedSettings = composer.modelSettingsByKey?.[`${newService}:${newId}`];
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
      const savedVersion = savedSettings?.version && entry.versions.includes(savedSettings.version)
        ? savedSettings.version
        : undefined;
      const savedMode = savedSettings?.mode && entry.modes.includes(savedSettings.mode)
        ? savedSettings.mode
        : undefined;
      const savedDuration = typeof savedSettings?.duration === 'number' && entry.durations.includes(savedSettings.duration)
        ? savedSettings.duration
        : undefined;
      const savedAspectRatio = savedSettings?.aspectRatio && entry.aspectRatios.includes(savedSettings.aspectRatio)
        ? savedSettings.aspectRatio
        : undefined;
      const savedImageSize = savedSettings?.imageSize && entry.imageSizes?.includes(savedSettings.imageSize)
        ? savedSettings.imageSize
        : undefined;
      const savedGenerateAudio = typeof savedSettings?.generateAudio === 'boolean'
        && !transition.isAudio
        && entry.supportsGenerateAudio
        ? savedSettings.generateAudio
        : undefined;
      const nextVersion = savedVersion ?? transition.nextVersion;
      const nextMode = savedMode ?? transition.nextMode;
      const nextDuration = savedDuration ?? transition.nextDuration;
      const nextAspectRatio = savedAspectRatio ?? transition.nextAspectRatio;
      const nextImageSize = savedImageSize ?? transition.nextImageSize;

      setVersion(nextVersion);
      if (nextMode !== undefined) setMode(nextMode);
      if (nextDuration !== undefined) setDuration(nextDuration);
      if (nextAspectRatio !== undefined) setAspectRatio(nextAspectRatio);
      if (nextImageSize !== undefined) setImageSize(nextImageSize);
      if (savedGenerateAudio !== undefined) setGenerateAudio(savedGenerateAudio);

      updateComposer({
        ...transition.composerPatch,
        version: nextVersion,
        mode: nextMode ?? mode,
        duration: nextDuration ?? duration,
        aspectRatio: nextAspectRatio ?? aspectRatio,
        imageSize: nextImageSize ?? imageSize,
        generateAudio: savedGenerateAudio ?? transition.composerPatch.generateAudio,
      });
    }

    closePopover();
  }, [
    aspectRatio,
    closePopover,
    composer.endMediaFileId,
    composer.modelSettingsByKey,
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
    updateComposer,
    visibleCatalog,
    voiceId,
    voiceName,
    voiceSettings,
  ]);

  const handleGenerate = useCallback(() => {
    if (!canGenerate || !selectedEntry) return;

    const requestIsAudio = selectedEntry.outputType === 'audio' || service === 'elevenlabs' || service === 'suno';
    const requestIsSuno = providerId === SUNO_PROVIDER_ID;
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
      originalPrompt,
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
    originalPrompt,
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

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (chatPanelOpen) {
      return;
    }

    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      handleGenerate();
    }
  }, [chatPanelOpen, handleGenerate]);

  const handleAudioToggle = useCallback(() => {
    if (!supportsAudio || multiShots) {
      return;
    }

    setGenerateAudio((current) => !current);
  }, [multiShots, setGenerateAudio, supportsAudio]);

  return {
    handleAudioToggle,
    handleGenerate,
    handleKeyDown,
    handleProviderChange,
  };
}
