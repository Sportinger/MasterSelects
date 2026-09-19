import type {
  FlashBoardGenerationRequest,
  FlashBoardMultiShotPrompt,
  FlashBoardOutputType,
  FlashBoardService,
  FlashBoardSunoVocalGender,
  FlashBoardVoiceSettings,
} from '../../../stores/flashboardStore/types';

interface FlashBoardGenerationRequestEntry {
  modes: string[];
  outputType?: FlashBoardOutputType;
  supportsImageToVideo?: boolean;
  supportsTextToImage?: boolean;
}

interface BuildFlashBoardGenerationRequestInput {
  aspectRatio: string;
  duration: number;
  effectiveGenerateAudio: boolean;
  effectivePrompt: string;
  effectiveReferenceMediaFileIds: string[];
  endMediaFileId?: string;
  imageSize: string;
  isAudioRequest: boolean;
  isSunoRequest: boolean;
  languageCode: string;
  languageOverride: boolean;
  mode: string;
  multiShots: boolean;
  normalizedMultiPrompt: FlashBoardMultiShotPrompt[];
  originalPrompt?: string | null;
  outputFormat: string;
  returnLastFrame: boolean;
  providerId: string;
  selectedEntry: FlashBoardGenerationRequestEntry;
  service: FlashBoardService;
  startMediaFileId?: string;
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
  videoOutputFormat: 'mov' | 'mp4';
  webSearch: boolean;
  voiceId: string;
  voiceName: string;
  voiceSettings: FlashBoardVoiceSettings;
}

function deriveSunoTitle(prompt: string): string {
  const firstLine = prompt
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  const candidate = firstLine || prompt.trim() || 'Untitled song';
  return candidate.replace(/\s+/g, ' ').slice(0, 80);
}

export function buildFlashBoardGenerationRequest({
  aspectRatio,
  duration,
  effectiveGenerateAudio,
  effectivePrompt,
  effectiveReferenceMediaFileIds,
  endMediaFileId,
  imageSize,
  isAudioRequest,
  isSunoRequest,
  languageCode,
  languageOverride,
  mode,
  multiShots,
  normalizedMultiPrompt,
  originalPrompt,
  outputFormat,
  returnLastFrame,
  providerId,
  selectedEntry,
  service,
  startMediaFileId,
  sunoAudioWeight,
  sunoCustomMode,
  sunoInstrumental,
  sunoNegativeTags,
  sunoStyle,
  sunoStyleWeight,
  sunoVocalGender,
  sunoWeirdnessConstraint,
  version,
  videoOutputFormat,
  webSearch,
  voiceId,
  voiceName,
  voiceSettings,
}: BuildFlashBoardGenerationRequestInput): FlashBoardGenerationRequest {
  const requestIsElevenLabs = isAudioRequest && providerId === 'cloud-elevenlabs-tts';
  const requestIsSeedance25 = !isAudioRequest && providerId === 'bytedance/seedance-2-5';
  const requestUsesSeedance25ExactFrames = requestIsSeedance25
    && Boolean(startMediaFileId || endMediaFileId);
  const modeSupportedForAudio = isAudioRequest && selectedEntry.modes.length > 0;
  const trimmedOriginalPrompt = originalPrompt?.trim();
  const requestOriginalPrompt = trimmedOriginalPrompt && trimmedOriginalPrompt !== effectivePrompt.trim()
    ? trimmedOriginalPrompt
    : undefined;

  return {
    service,
    providerId,
    version,
    outputType: selectedEntry.outputType ?? 'video',
    mode: isAudioRequest && !modeSupportedForAudio ? undefined : mode,
    originalPrompt: requestOriginalPrompt,
    prompt: isSunoRequest && sunoInstrumental ? '' : effectivePrompt,
    duration: isSunoRequest && sunoCustomMode && version === 'V5_5'
      ? duration
      : isAudioRequest ? undefined : duration,
    aspectRatio: isAudioRequest
      ? undefined
      : requestUsesSeedance25ExactFrames ? 'adaptive' : aspectRatio,
    imageSize: !isAudioRequest && selectedEntry.supportsTextToImage ? imageSize : undefined,
    generateAudio: isAudioRequest ? false : effectiveGenerateAudio,
    multiShots: isAudioRequest ? false : multiShots,
    multiPrompt: !isAudioRequest && multiShots ? normalizedMultiPrompt : undefined,
    voiceId: requestIsElevenLabs ? voiceId.trim() : undefined,
    voiceName: requestIsElevenLabs ? voiceName.trim() || undefined : undefined,
    languageOverride: requestIsElevenLabs ? languageOverride : undefined,
    languageCode: requestIsElevenLabs && languageOverride ? languageCode.trim() : undefined,
    outputFormat: requestIsElevenLabs ? outputFormat : requestIsSeedance25 ? videoOutputFormat : undefined,
    returnLastFrame: requestIsSeedance25 ? returnLastFrame : undefined,
    webSearch: requestIsSeedance25 ? webSearch : undefined,
    voiceSettings: requestIsElevenLabs ? { ...voiceSettings } : undefined,
    sunoCustomMode: isSunoRequest ? sunoCustomMode : undefined,
    sunoInstrumental: isSunoRequest ? sunoInstrumental : undefined,
    sunoStyle: isSunoRequest && sunoCustomMode ? sunoStyle.trim() : undefined,
    sunoTitle: isSunoRequest && sunoCustomMode
      ? deriveSunoTitle(sunoInstrumental ? sunoStyle : effectivePrompt || sunoStyle)
      : undefined,
    sunoNegativeTags: isSunoRequest && sunoCustomMode ? sunoNegativeTags.trim() || undefined : undefined,
    sunoVocalGender: isSunoRequest && sunoCustomMode && !sunoInstrumental
      ? sunoVocalGender || undefined
      : undefined,
    sunoStyleWeight: isSunoRequest && sunoCustomMode ? sunoStyleWeight : undefined,
    sunoWeirdnessConstraint: isSunoRequest && sunoCustomMode ? sunoWeirdnessConstraint : undefined,
    sunoAudioWeight: isSunoRequest && sunoCustomMode ? sunoAudioWeight : undefined,
    startMediaFileId: !isAudioRequest && selectedEntry.supportsImageToVideo ? startMediaFileId : undefined,
    endMediaFileId: !isAudioRequest && selectedEntry.supportsImageToVideo && !multiShots ? endMediaFileId : undefined,
    referenceMediaFileIds: isAudioRequest && !isSunoRequest ? [] : effectiveReferenceMediaFileIds,
  };
}
