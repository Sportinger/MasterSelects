import type {
  FlashBoardComposerState,
  FlashBoardMultiShotPrompt,
  FlashBoardOutputType,
  FlashBoardSunoVocalGender,
  FlashBoardVoiceSettings,
} from '../../../stores/flashboardStore/types';

interface FlashBoardComposerSyncEntry {
  outputType?: FlashBoardOutputType;
  supportsImageToVideo?: boolean;
}

interface BuildFlashBoardComposerSyncPatchInput {
  composer: FlashBoardComposerState;
  effectiveGenerateAudio: boolean;
  effectiveReferenceMediaFileIds: string[];
  isAudioMode: boolean;
  isElevenLabsMode: boolean;
  isSunoMode: boolean;
  languageCode: string;
  languageOverride: boolean;
  maxReferenceMedia?: number;
  multiShots: boolean;
  normalizedMultiPrompt: FlashBoardMultiShotPrompt[];
  outputFormat: string;
  providerId: string;
  selectedEntry: FlashBoardComposerSyncEntry;
  service: FlashBoardComposerState['service'];
  sunoAudioWeight: number;
  sunoCustomMode: boolean;
  sunoInstrumental: boolean;
  sunoNegativeTags: string;
  sunoStyle: string;
  sunoStyleWeight: number;
  sunoTitle: string;
  sunoVocalGender: FlashBoardSunoVocalGender | '';
  sunoWeirdnessConstraint: number;
  version: string;
  voiceId: string;
  voiceName: string;
  voiceSettings: FlashBoardVoiceSettings;
  areVoiceSettingsEqual: (
    left: FlashBoardVoiceSettings | undefined,
    right: FlashBoardVoiceSettings | undefined,
  ) => boolean;
}

function areMultiPromptsEqual(
  left: FlashBoardMultiShotPrompt[],
  right: FlashBoardMultiShotPrompt[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((shot, index) => (
    shot.index === right[index]?.index
    && shot.prompt === right[index]?.prompt
    && shot.duration === right[index]?.duration
  ));
}

export function buildFlashBoardComposerSyncPatch({
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
  areVoiceSettingsEqual,
}: BuildFlashBoardComposerSyncPatchInput): Partial<FlashBoardComposerState> {
  const nextOutputType = selectedEntry.outputType ?? 'video';
  const nextPatch: Partial<FlashBoardComposerState> = {};
  const nextComposerMultiPrompt = multiShots ? normalizedMultiPrompt : [];

  if (composer.service !== service) nextPatch.service = service;
  if (composer.providerId !== providerId) nextPatch.providerId = providerId;
  if (composer.version !== version) nextPatch.version = version;
  if (composer.outputType !== nextOutputType) nextPatch.outputType = nextOutputType;
  if (composer.generateAudio !== effectiveGenerateAudio) nextPatch.generateAudio = effectiveGenerateAudio;
  if (composer.multiShots !== multiShots) nextPatch.multiShots = multiShots;
  if (!areMultiPromptsEqual(composer.multiPrompt, nextComposerMultiPrompt)) {
    nextPatch.multiPrompt = nextComposerMultiPrompt;
  }

  if (isElevenLabsMode) {
    const trimmedVoiceId = voiceId.trim();
    const trimmedVoiceName = voiceName.trim();
    const trimmedLanguageCode = languageCode.trim();
    if (composer.voiceId !== trimmedVoiceId) nextPatch.voiceId = trimmedVoiceId;
    if (composer.voiceName !== trimmedVoiceName) nextPatch.voiceName = trimmedVoiceName;
    if (composer.languageOverride !== languageOverride) nextPatch.languageOverride = languageOverride;
    if (composer.languageCode !== trimmedLanguageCode) nextPatch.languageCode = trimmedLanguageCode;
    if (composer.outputFormat !== outputFormat) nextPatch.outputFormat = outputFormat;
    if (!areVoiceSettingsEqual(composer.voiceSettings, voiceSettings)) {
      nextPatch.voiceSettings = { ...voiceSettings };
    }
  }

  if (isSunoMode) {
    const trimmedStyle = sunoStyle.trim();
    const trimmedTitle = sunoTitle.trim();
    const trimmedNegativeTags = sunoNegativeTags.trim();
    if (composer.sunoCustomMode !== sunoCustomMode) nextPatch.sunoCustomMode = sunoCustomMode;
    if (composer.sunoInstrumental !== sunoInstrumental) nextPatch.sunoInstrumental = sunoInstrumental;
    if (composer.sunoStyle !== trimmedStyle) nextPatch.sunoStyle = trimmedStyle;
    if (composer.sunoTitle !== trimmedTitle) nextPatch.sunoTitle = trimmedTitle;
    if (composer.sunoNegativeTags !== trimmedNegativeTags) nextPatch.sunoNegativeTags = trimmedNegativeTags;
    if (composer.sunoVocalGender !== (sunoVocalGender || undefined)) {
      nextPatch.sunoVocalGender = sunoVocalGender || undefined;
    }
    if (composer.sunoStyleWeight !== sunoStyleWeight) nextPatch.sunoStyleWeight = sunoStyleWeight;
    if (composer.sunoWeirdnessConstraint !== sunoWeirdnessConstraint) {
      nextPatch.sunoWeirdnessConstraint = sunoWeirdnessConstraint;
    }
    if (composer.sunoAudioWeight !== sunoAudioWeight) nextPatch.sunoAudioWeight = sunoAudioWeight;
  }

  if (isAudioMode) {
    if (composer.startMediaFileId !== undefined) nextPatch.startMediaFileId = undefined;
    if (composer.endMediaFileId !== undefined) nextPatch.endMediaFileId = undefined;
  }

  if (!isAudioMode && !selectedEntry.supportsImageToVideo) {
    if (composer.startMediaFileId !== undefined) nextPatch.startMediaFileId = undefined;
    if (composer.endMediaFileId !== undefined) nextPatch.endMediaFileId = undefined;
  }

  if (!isAudioMode && multiShots && composer.endMediaFileId !== undefined) {
    nextPatch.endMediaFileId = undefined;
  }

  if (
    typeof maxReferenceMedia === 'number'
    && composer.referenceMediaFileIds !== effectiveReferenceMediaFileIds
  ) {
    nextPatch.referenceMediaFileIds = effectiveReferenceMediaFileIds;
  }

  return nextPatch;
}
