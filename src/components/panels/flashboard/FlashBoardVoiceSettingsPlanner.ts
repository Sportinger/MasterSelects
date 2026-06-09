import type { FlashBoardVoiceSettings } from '../../../stores/flashboardStore';
import {
  DEFAULT_ELEVENLABS_OUTPUT_FORMAT,
  DEFAULT_ELEVENLABS_VOICE_SETTINGS,
} from '../../../stores/flashboardStore/defaults';

export type FlashBoardVoiceSettingNumberKey = 'speed' | 'stability' | 'similarityBoost' | 'style';

const FLASHBOARD_ELEVENLABS_MP3_OUTPUT_FORMATS = [
  'mp3_44100_128',
  'mp3_44100_192',
  'mp3_22050_32',
] as const;

type FlashBoardElevenLabsMp3OutputFormat = typeof FLASHBOARD_ELEVENLABS_MP3_OUTPUT_FORMATS[number];

interface FlashBoardVoiceSelectionInput {
  name: string;
  voiceId: string;
}

function isFlashBoardElevenLabsMp3OutputFormat(
  value: string,
): value is FlashBoardElevenLabsMp3OutputFormat {
  return FLASHBOARD_ELEVENLABS_MP3_OUTPUT_FORMATS.includes(value as FlashBoardElevenLabsMp3OutputFormat);
}

export function normalizeFlashBoardVoiceSettings(
  settings: FlashBoardVoiceSettings | undefined,
): Required<FlashBoardVoiceSettings> {
  return {
    ...DEFAULT_ELEVENLABS_VOICE_SETTINGS,
    ...settings,
  };
}

export function areFlashBoardVoiceSettingsEqual(
  left: FlashBoardVoiceSettings | undefined,
  right: FlashBoardVoiceSettings | undefined,
): boolean {
  const normalizedLeft = normalizeFlashBoardVoiceSettings(left);
  const normalizedRight = normalizeFlashBoardVoiceSettings(right);

  return normalizedLeft.speed === normalizedRight.speed
    && normalizedLeft.stability === normalizedRight.stability
    && normalizedLeft.similarityBoost === normalizedRight.similarityBoost
    && normalizedLeft.style === normalizedRight.style
    && normalizedLeft.useSpeakerBoost === normalizedRight.useSpeakerBoost;
}

export function normalizeFlashBoardElevenLabsOutputFormat(
  value: string | undefined,
): FlashBoardElevenLabsMp3OutputFormat {
  return value && isFlashBoardElevenLabsMp3OutputFormat(value)
    ? value
    : DEFAULT_ELEVENLABS_OUTPUT_FORMAT;
}

export function buildDefaultFlashBoardVoiceSettings(): Required<FlashBoardVoiceSettings> {
  return { ...DEFAULT_ELEVENLABS_VOICE_SETTINGS };
}

export function buildFlashBoardVoiceSelection(
  voice: FlashBoardVoiceSelectionInput,
): FlashBoardVoiceSelectionInput {
  return {
    name: voice.name,
    voiceId: voice.voiceId,
  };
}

export function buildFlashBoardVoiceSettingNumberPatch(
  key: FlashBoardVoiceSettingNumberKey,
  value: string,
): Partial<Required<FlashBoardVoiceSettings>> | null {
  const nextValue = Number(value);
  if (!Number.isFinite(nextValue)) {
    return null;
  }

  return { [key]: nextValue };
}

export function buildFlashBoardVoiceSettingsPatch(
  current: Required<FlashBoardVoiceSettings>,
  patch: Partial<Required<FlashBoardVoiceSettings>>,
): Required<FlashBoardVoiceSettings> {
  return {
    ...current,
    ...patch,
  };
}
