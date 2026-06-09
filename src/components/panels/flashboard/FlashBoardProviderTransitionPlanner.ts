import type {
  FlashBoardComposerState,
  FlashBoardMultiShotPrompt,
  FlashBoardOutputType,
  FlashBoardService,
  FlashBoardSunoVocalGender,
  FlashBoardVoiceSettings,
} from '../../../stores/flashboardStore/types';

interface FlashBoardProviderTransitionEntry {
  aspectRatios: string[];
  durations: number[];
  imageSizes?: string[];
  maxReferenceImages?: number;
  maxReferenceMedia?: number;
  modes: string[];
  outputType?: FlashBoardOutputType;
  providerId: string;
  service: FlashBoardService;
  supportsImageToVideo: boolean;
  versions: string[];
}

interface BuildFlashBoardProviderTransitionInput {
  currentAspectRatio: string;
  currentDuration: number;
  currentImageSize: string;
  currentMode: string;
  effectiveGenerateAudio: boolean;
  endMediaFileId?: string;
  entry: FlashBoardProviderTransitionEntry;
  languageCode: string;
  languageOverride: boolean;
  multiShots: boolean;
  normalizedMultiPrompt: FlashBoardMultiShotPrompt[];
  outputFormat: string;
  referenceMediaFileIds: string[];
  startMediaFileId?: string;
  sunoAudioWeight: number;
  sunoCustomMode: boolean;
  sunoInstrumental: boolean;
  sunoNegativeTags: string;
  sunoProviderId: string;
  sunoStyle: string;
  sunoStyleWeight: number;
  sunoTitle: string;
  sunoVocalGender: FlashBoardSunoVocalGender | '';
  sunoWeirdnessConstraint: number;
  voiceId: string;
  voiceName: string;
  voiceSettings: FlashBoardVoiceSettings;
  clampReferenceMediaFileIds: (referenceMediaFileIds: string[], maxReferenceImages?: number) => string[];
}

export interface FlashBoardProviderTransitionPlan {
  composerPatch: Partial<FlashBoardComposerState>;
  isAudio: boolean;
  isElevenLabs: boolean;
  isSuno: boolean;
  nextAspectRatio?: string;
  nextDuration?: number;
  nextImageSize?: string;
  nextMode?: string;
  nextVersion: string;
}

export function buildFlashBoardProviderTransition({
  currentAspectRatio,
  currentDuration,
  currentImageSize,
  currentMode,
  effectiveGenerateAudio,
  endMediaFileId,
  entry,
  languageCode,
  languageOverride,
  multiShots,
  normalizedMultiPrompt,
  outputFormat,
  referenceMediaFileIds,
  startMediaFileId,
  sunoAudioWeight,
  sunoCustomMode,
  sunoInstrumental,
  sunoNegativeTags,
  sunoProviderId,
  sunoStyle,
  sunoStyleWeight,
  sunoTitle,
  sunoVocalGender,
  sunoWeirdnessConstraint,
  voiceId,
  voiceName,
  voiceSettings,
  clampReferenceMediaFileIds,
}: BuildFlashBoardProviderTransitionInput): FlashBoardProviderTransitionPlan {
  const nextVersion = entry.versions[0] ?? '';
  const isAudio = entry.outputType === 'audio' || entry.service === 'elevenlabs' || entry.service === 'suno';
  const isSuno = entry.service === 'suno' || entry.providerId === sunoProviderId;
  const isElevenLabs = isAudio && !isSuno;
  const nextMode = entry.modes.includes(currentMode) ? undefined : entry.modes[0] ?? 'std';
  const nextDuration = entry.durations.length > 0 && !entry.durations.includes(currentDuration)
    ? entry.durations[0] ?? 5
    : undefined;
  const nextAspectRatio = entry.aspectRatios.length > 0 && !entry.aspectRatios.includes(currentAspectRatio)
    ? entry.aspectRatios[0] ?? '16:9'
    : undefined;
  const nextImageSize = entry.imageSizes?.length && !entry.imageSizes.includes(currentImageSize)
    ? entry.imageSizes[0] ?? '1K'
    : undefined;

  return {
    composerPatch: {
      service: entry.service,
      providerId: entry.providerId,
      version: nextVersion,
      outputType: entry.outputType ?? 'video',
      generateAudio: isAudio ? false : effectiveGenerateAudio,
      multiShots: isAudio ? false : multiShots,
      multiPrompt: isAudio ? [] : normalizedMultiPrompt,
      startMediaFileId: !isAudio && entry.supportsImageToVideo ? startMediaFileId : undefined,
      endMediaFileId: !isAudio && entry.supportsImageToVideo && !multiShots ? endMediaFileId : undefined,
      referenceMediaFileIds: clampReferenceMediaFileIds(
        referenceMediaFileIds,
        entry.maxReferenceMedia ?? entry.maxReferenceImages,
      ),
      voiceId: isElevenLabs ? voiceId.trim() : undefined,
      voiceName: isElevenLabs ? voiceName.trim() : undefined,
      languageOverride: isElevenLabs ? languageOverride : undefined,
      languageCode: isElevenLabs ? languageCode.trim() : undefined,
      outputFormat: isElevenLabs ? outputFormat : undefined,
      voiceSettings: isElevenLabs ? { ...voiceSettings } : undefined,
      sunoCustomMode: isSuno ? sunoCustomMode : undefined,
      sunoInstrumental: isSuno ? sunoInstrumental : undefined,
      sunoStyle: isSuno ? sunoStyle.trim() : undefined,
      sunoTitle: isSuno ? sunoTitle.trim() : undefined,
      sunoNegativeTags: isSuno ? sunoNegativeTags.trim() : undefined,
      sunoVocalGender: isSuno ? sunoVocalGender || undefined : undefined,
      sunoStyleWeight: isSuno ? sunoStyleWeight : undefined,
      sunoWeirdnessConstraint: isSuno ? sunoWeirdnessConstraint : undefined,
      sunoAudioWeight: isSuno ? sunoAudioWeight : undefined,
    },
    isAudio,
    isElevenLabs,
    isSuno,
    nextAspectRatio,
    nextDuration,
    nextImageSize,
    nextMode,
    nextVersion,
  };
}
