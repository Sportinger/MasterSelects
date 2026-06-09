import type { ElevenLabsModelRates } from '../../../services/elevenLabsService';
import { getFlashBoardPriceEstimate, type FlashBoardPriceEstimate } from '../../../services/flashboard/FlashBoardPricing';
import type {
  FlashBoardMultiShotPrompt,
  FlashBoardOutputType,
  FlashBoardService,
} from '../../../stores/flashboardStore/types';

interface GenerationActionStateEntry {
  outputType?: FlashBoardOutputType;
}

interface BuildFlashBoardGenerationActionStateInput {
  accountAuthenticated: boolean;
  duration: number;
  effectiveGenerateAudio: boolean;
  effectivePrompt: string;
  hasElevenLabsKey: boolean;
  hasEvolinkKey: boolean;
  hasGenerationBoard: boolean;
  hasHostedSession: boolean;
  hasKieAiKey: boolean;
  hasVideoReferenceInput: boolean;
  hostedAIEnabled: boolean;
  imageSize: string;
  isAudioMode: boolean;
  isHostedAudioMode: boolean;
  isSunoMode: boolean;
  languageCode: string;
  languageOverride: boolean;
  mode: string;
  maxMultiShots: number;
  modelRates?: ElevenLabsModelRates;
  multiShotDurationTotal: number;
  multiShots: boolean;
  normalizedMultiPrompt: FlashBoardMultiShotPrompt[];
  providerId: string;
  selectedElevenLabsCharacterLimit: number | null;
  selectedEntry: GenerationActionStateEntry | null | undefined;
  seedanceReferenceValidationError: string | null;
  service: FlashBoardService;
  sunoCustomMode: boolean;
  sunoStyle: string;
  supportsMultiShot: boolean;
  usePiApiKeyByDefault: boolean;
  version: string;
  voiceId: string;
}

export interface FlashBoardGenerationActionState {
  audioValidationError: string | null;
  backendValidationError: string | null;
  canGenerate: boolean;
  currentPrice: FlashBoardPriceEstimate | null;
  generateActionLabel: string;
  generateButtonLabel: string;
  generateButtonTitle: string;
  multiShotValidationError: string | null;
}

export function getSunoPromptLimit(version: string, customMode: boolean): number {
  if (!customMode) {
    return 500;
  }

  return version === 'V4' ? 3000 : 5000;
}

export function getSunoStyleLimit(version: string): number {
  return version === 'V4' ? 200 : 1000;
}

function buildMultiShotValidationError({
  duration,
  maxMultiShots,
  multiShotDurationTotal,
  multiShots,
  normalizedMultiPrompt,
  supportsMultiShot,
}: Pick<
  BuildFlashBoardGenerationActionStateInput,
  'duration' | 'maxMultiShots' | 'multiShotDurationTotal' | 'multiShots' | 'normalizedMultiPrompt' | 'supportsMultiShot'
>): string | null {
  if (!multiShots) {
    return null;
  }

  if (!supportsMultiShot) {
    return 'Multishot is not available for this model.';
  }

  const maxShots = Math.min(maxMultiShots, Math.max(1, duration));

  if (normalizedMultiPrompt.length < 2) {
    return 'Add at least 2 shots.';
  }

  if (normalizedMultiPrompt.length > maxShots) {
    return `Use at most ${maxShots} shots for ${duration}s.`;
  }

  if (multiShotDurationTotal !== duration) {
    return `Shot durations must add up to ${duration}s.`;
  }

  const emptyShot = normalizedMultiPrompt.find((shot) => shot.prompt.trim().length === 0);
  if (emptyShot) {
    return `Shot ${emptyShot.index} needs a prompt.`;
  }

  return null;
}

function buildAudioValidationError({
  accountAuthenticated,
  effectivePrompt,
  hasElevenLabsKey,
  hasKieAiKey,
  hostedAIEnabled,
  isAudioMode,
  isHostedAudioMode,
  isSunoMode,
  languageCode,
  languageOverride,
  selectedElevenLabsCharacterLimit,
  service,
  sunoCustomMode,
  sunoStyle,
  version,
  voiceId,
}: BuildFlashBoardGenerationActionStateInput): string | null {
  if (!isAudioMode) {
    return null;
  }

  if (isSunoMode) {
    if (service === 'cloud') {
      if (!accountAuthenticated) {
        return 'Sign in to use MasterSelects Cloud music.';
      }

      if (!hostedAIEnabled) {
        return 'Enable hosted credits to generate cloud music.';
      }
    } else if (!hasKieAiKey) {
      return 'Add a Kie.ai API key in Settings to generate Suno music.';
    }

    const promptLimit = getSunoPromptLimit(version, sunoCustomMode);
    const styleLimit = getSunoStyleLimit(version);

    if (effectivePrompt.length > promptLimit) {
      return `Prompt exceeds the selected Suno limit of ${promptLimit.toLocaleString()} characters.`;
    }

    if (sunoCustomMode) {
      if (!sunoStyle.trim()) {
        return 'Add a Suno style.';
      }

      if (sunoStyle.length > styleLimit) {
        return `Style exceeds the selected Suno limit of ${styleLimit.toLocaleString()} characters.`;
      }
    }

    return null;
  }

  if (isHostedAudioMode) {
    if (!accountAuthenticated) {
      return 'Sign in to use MasterSelects Cloud speech.';
    }

    if (!hostedAIEnabled) {
      return 'Enable hosted credits to generate cloud speech.';
    }
  } else if (!hasElevenLabsKey) {
    return 'Add an ElevenLabs API key in Settings to generate speech.';
  }

  if (!voiceId.trim()) {
    return 'Add an ElevenLabs voice ID.';
  }

  if (!version.trim()) {
    return 'Choose an ElevenLabs model.';
  }

  if (languageOverride && !languageCode.trim()) {
    return 'Add a language code or turn language override off.';
  }

  if (
    selectedElevenLabsCharacterLimit !== null
    && effectivePrompt.length > selectedElevenLabsCharacterLimit
  ) {
    return `Text exceeds the selected model limit of ${selectedElevenLabsCharacterLimit.toLocaleString()} characters.`;
  }

  return null;
}

function buildBackendValidationError({
  hasEvolinkKey,
  hasHostedSession,
  hasKieAiKey,
  isHostedAudioMode,
  service,
  usePiApiKeyByDefault,
}: BuildFlashBoardGenerationActionStateInput): string | null {
  if (service === 'piapi' && !usePiApiKeyByDefault) {
    return 'Enable a PiAPI key as default in Settings to generate with PiAPI.';
  }

  if (service === 'kieai' && !hasKieAiKey) {
    return 'Enable a Kie.ai key as default in Settings to generate with Kie.ai.';
  }

  if (service === 'evolink' && !hasEvolinkKey) {
    return 'Enable an EvoLink key as default in Settings to generate with EvoLink.';
  }

  if (service === 'suno' && !hasKieAiKey) {
    return 'Enable a Kie.ai key as default in Settings to generate with Suno.';
  }

  if (service === 'cloud' && !isHostedAudioMode && !hasHostedSession) {
    return 'Sign in to use MasterSelects Cloud generation.';
  }

  return null;
}

export function buildFlashBoardGenerationActionState(input: BuildFlashBoardGenerationActionStateInput): FlashBoardGenerationActionState {
  const multiShotValidationError = buildMultiShotValidationError(input);
  const audioValidationError = buildAudioValidationError(input);
  const backendValidationError = buildBackendValidationError(input);
  const currentPrice = input.selectedEntry
    ? getFlashBoardPriceEstimate({
      service: input.service,
      providerId: input.providerId,
      outputType: input.selectedEntry.outputType,
      mode: input.mode,
      duration: input.duration,
      imageSize: input.imageSize,
      modelId: input.version,
      modelRates: input.modelRates,
      text: input.effectivePrompt,
      generateAudio: input.effectiveGenerateAudio,
      multiShots: input.multiShots,
      hasVideoInput: input.hasVideoReferenceInput,
    })
    : null;
  const generateActionLabel = input.isSunoMode ? 'Compose' : input.isAudioMode ? 'Speak' : 'Generate';
  const generateButtonLabel = currentPrice
    ? `${generateActionLabel} - ${currentPrice.compactLabel}`
    : generateActionLabel;
  const generateButtonTitle = currentPrice
    ? `${currentPrice.fullLabel} (Ctrl+Enter)`
    : `${generateActionLabel} (Ctrl+Enter)`;
  const canGenerate = Boolean(input.hasGenerationBoard && input.selectedEntry && input.effectivePrompt)
    && !multiShotValidationError
    && !audioValidationError
    && !input.seedanceReferenceValidationError
    && !backendValidationError;

  return {
    audioValidationError,
    backendValidationError,
    canGenerate,
    currentPrice,
    generateActionLabel,
    generateButtonLabel,
    generateButtonTitle,
    multiShotValidationError,
  };
}
