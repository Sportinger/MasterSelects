import type { FlashBoardComposerState, FlashBoardVoiceSettings } from './types';
import {
  DEFAULT_SUNO_AUDIO_WEIGHT,
  DEFAULT_SUNO_CUSTOM_MODE,
  DEFAULT_SUNO_INSTRUMENTAL,
  DEFAULT_SUNO_STYLE_WEIGHT,
  DEFAULT_SUNO_WEIRDNESS_CONSTRAINT,
} from '../../services/sunoService';

export const DEFAULT_ELEVENLABS_MODEL_ID = 'eleven_multilingual_v2';
export const DEFAULT_ELEVENLABS_OUTPUT_FORMAT = 'mp3_44100_128';
export const DEFAULT_FLASHBOARD_SERVICE = 'kieai';
export const DEFAULT_FLASHBOARD_PROVIDER_ID = 'nano-banana-2';
export const DEFAULT_FLASHBOARD_MODEL_VERSION = '3.1';

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
