import {
  DEFAULT_ELEVENLABS_OUTPUT_FORMAT,
  DEFAULT_ELEVENLABS_VOICE_SETTINGS,
} from '../../../stores/flashboardStore/defaults';
import type {
  FlashBoardComposerState,
  FlashBoardGenerationRequest,
} from '../../../stores/flashboardStore/types';
import {
  DEFAULT_SUNO_AUDIO_WEIGHT,
  DEFAULT_SUNO_CUSTOM_MODE,
  DEFAULT_SUNO_INSTRUMENTAL,
  DEFAULT_SUNO_STYLE_WEIGHT,
  DEFAULT_SUNO_WEIRDNESS_CONSTRAINT,
  SUNO_PROVIDER_ID,
} from '../../../services/sunoContracts';
import type { CatalogEntry } from '../../../services/flashboard/types';
import { buildFlashBoardGenerationRequest } from '../flashboard/FlashBoardGenerationRequestPlanner';

export interface AIStudioGenerationRequestPlan {
  error?: string;
  request?: FlashBoardGenerationRequest;
}

export function buildAIStudioGenerationRequest(
  composer: FlashBoardComposerState,
  entry: CatalogEntry | undefined,
): AIStudioGenerationRequestPlan {
  if (!entry) return { error: 'Choose a model first.' };

  const isAudioRequest = entry.outputType === 'audio';
  const isSunoRequest = entry.providerId === SUNO_PROVIDER_ID;
  const sunoCustomMode = composer.sunoCustomMode ?? DEFAULT_SUNO_CUSTOM_MODE;
  const sunoInstrumental = composer.sunoInstrumental ?? DEFAULT_SUNO_INSTRUMENTAL;
  const prompt = composer.draftPrompt?.trim() ?? '';
  const promptOptional = entry.requiresPrompt === false
    || (isSunoRequest && sunoCustomMode && sunoInstrumental);
  if (!prompt && !promptOptional) return { error: 'Enter a prompt first.' };

  const referenceMediaFileIds = composer.referenceMediaFileIds
    .slice(0, entry.maxReferenceMedia ?? entry.maxReferenceImages ?? Number.POSITIVE_INFINITY);
  const hasReference = referenceMediaFileIds.length > 0
    || Boolean(composer.startMediaFileId || composer.endMediaFileId);
  if (entry.requiresReferenceMedia && !hasReference) {
    const kind = entry.requiredReferenceMediaType === 'video'
      ? 'video'
      : entry.requiredReferenceMediaType === 'image' ? 'image' : 'visual';
    return { error: `Add a reference ${kind} for this model.` };
  }

  const multiShots = entry.supportsMultiShot === true && composer.multiShots;
  const generateAudio = !isAudioRequest
    && entry.supportsGenerateAudio === true
    && (composer.generateAudio || multiShots);
  const version = composer.version && entry.versions.includes(composer.version)
    ? composer.version
    : entry.versions[0] ?? composer.version ?? 'latest';

  return {
    request: buildFlashBoardGenerationRequest({
      aspectRatio: composer.aspectRatio ?? entry.aspectRatios[0] ?? '16:9',
      duration: composer.duration ?? entry.durations[0] ?? 5,
      effectiveGenerateAudio: generateAudio,
      effectivePrompt: prompt,
      effectiveReferenceMediaFileIds: referenceMediaFileIds,
      endMediaFileId: composer.endMediaFileId,
      imageSize: composer.imageSize ?? entry.imageSizes?.[0] ?? '1K',
      isAudioRequest,
      isSunoRequest,
      languageCode: composer.languageCode ?? '',
      languageOverride: composer.languageOverride ?? false,
      mode: composer.mode ?? entry.modes[0] ?? '',
      multiShots,
      normalizedMultiPrompt: multiShots ? composer.multiPrompt : [],
      outputFormat: composer.outputFormat ?? DEFAULT_ELEVENLABS_OUTPUT_FORMAT,
      providerId: entry.providerId,
      returnLastFrame: composer.returnLastFrame ?? false,
      selectedEntry: entry,
      service: entry.service,
      startMediaFileId: composer.startMediaFileId,
      sunoAudioWeight: composer.sunoAudioWeight ?? DEFAULT_SUNO_AUDIO_WEIGHT,
      sunoCustomMode,
      sunoInstrumental,
      sunoNegativeTags: composer.sunoNegativeTags ?? '',
      sunoStyle: composer.sunoStyle ?? '',
      sunoStyleWeight: composer.sunoStyleWeight ?? DEFAULT_SUNO_STYLE_WEIGHT,
      sunoTitle: composer.sunoTitle ?? '',
      sunoVocalGender: composer.sunoVocalGender ?? '',
      sunoWeirdnessConstraint: composer.sunoWeirdnessConstraint ?? DEFAULT_SUNO_WEIRDNESS_CONSTRAINT,
      version,
      videoOutputFormat: composer.videoOutputFormat ?? 'mp4',
      voiceId: composer.voiceId ?? '',
      voiceName: composer.voiceName ?? '',
      voiceSettings: {
        ...DEFAULT_ELEVENLABS_VOICE_SETTINGS,
        ...composer.voiceSettings,
      },
      webSearch: composer.webSearch ?? false,
    }),
  };
}
