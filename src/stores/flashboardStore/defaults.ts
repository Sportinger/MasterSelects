import type {
  CreateFlashBoardAIWorkspaceInput,
  FlashBoardAIWorkspace,
  FlashBoardComposerState,
  FlashBoardOutputType,
  FlashBoardVoiceSettings,
} from './types';
import {
  DEFAULT_SUNO_AUDIO_WEIGHT,
  DEFAULT_SUNO_CUSTOM_MODE,
  DEFAULT_SUNO_INSTRUMENTAL,
  DEFAULT_SUNO_STYLE_WEIGHT,
  DEFAULT_SUNO_WEIRDNESS_CONSTRAINT,
  SUNO_PROVIDER_ID,
} from '../../services/sunoContracts';

export const DEFAULT_ELEVENLABS_MODEL_ID = 'eleven_multilingual_v2';
export const DEFAULT_ELEVENLABS_OUTPUT_FORMAT = 'mp3_44100_128';
export const DEFAULT_FLASHBOARD_SERVICE = 'cloud';
export const DEFAULT_FLASHBOARD_PROVIDER_ID = 'nano-banana-2';
export const DEFAULT_FLASHBOARD_MODEL_VERSION = 'latest';

const DEFAULT_PROVIDER_BY_OUTPUT: Record<FlashBoardOutputType, string> = {
  image: DEFAULT_FLASHBOARD_PROVIDER_ID,
  video: 'cloud-kling',
  audio: SUNO_PROVIDER_ID,
};

export const DEFAULT_ELEVENLABS_VOICE_SETTINGS: Required<FlashBoardVoiceSettings> = {
  speed: 1,
  stability: 0.5,
  similarityBoost: 0.75,
  style: 0,
  useSpeakerBoost: true,
};

export function createDefaultFlashBoardComposer(): FlashBoardComposerState {
  return {
    isOpen: false,
    draftPrompt: '',
    service: DEFAULT_FLASHBOARD_SERVICE,
    providerId: DEFAULT_FLASHBOARD_PROVIDER_ID,
    version: DEFAULT_FLASHBOARD_MODEL_VERSION,
    outputType: 'image',
    mode: 'std',
    duration: 5,
    aspectRatio: '16:9',
    imageSize: '1K',
    generateAudio: false,
    multiShots: false,
    multiPrompt: [],
    languageOverride: false,
    outputFormat: DEFAULT_ELEVENLABS_OUTPUT_FORMAT,
    videoOutputFormat: 'mp4',
    webSearch: false,
    returnLastFrame: false,
    voiceSettings: { ...DEFAULT_ELEVENLABS_VOICE_SETTINGS },
    sunoCustomMode: DEFAULT_SUNO_CUSTOM_MODE,
    sunoInstrumental: DEFAULT_SUNO_INSTRUMENTAL,
    sunoStyleWeight: DEFAULT_SUNO_STYLE_WEIGHT,
    sunoWeirdnessConstraint: DEFAULT_SUNO_WEIRDNESS_CONSTRAINT,
    sunoAudioWeight: DEFAULT_SUNO_AUDIO_WEIGHT,
    referenceMediaFileIds: [],
    modelSettingsByKey: {},
  };
}

export function createFlashBoardAIWorkspace(
  input: CreateFlashBoardAIWorkspaceInput,
  fallbackTitle = 'Image 1',
): FlashBoardAIWorkspace {
  const now = Date.now();
  const outputType = input.outputType ?? input.composer?.outputType ?? 'image';
  const composer = {
    ...createDefaultFlashBoardComposer(),
    ...input.composer,
    isOpen: true,
    draftPrompt: input.draftPrompt ?? input.composer?.draftPrompt ?? '',
    outputType,
    providerId: input.providerId
      ?? input.composer?.providerId
      ?? DEFAULT_PROVIDER_BY_OUTPUT[outputType],
    referenceMediaFileIds: [...(input.composer?.referenceMediaFileIds ?? [])],
    modelSettingsByKey: { ...(input.composer?.modelSettingsByKey ?? {}) },
  };

  return {
    id: crypto.randomUUID(),
    title: input.title?.trim() || fallbackTitle,
    kind: input.kind,
    createdAt: now,
    updatedAt: now,
    chatConversationRef: input.chatConversationRef ?? crypto.randomUUID(),
    composer,
    chatMessages: [...(input.chatMessages ?? [])],
  };
}

export function createDefaultFlashBoardAIWorkspace(): FlashBoardAIWorkspace {
  return createFlashBoardAIWorkspace({ kind: 'chat' }, 'Chat');
}
