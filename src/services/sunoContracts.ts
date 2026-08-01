import type { HostedAiRefundInfo, TaskStatus } from './aiGenerationContracts';

export const SUNO_PROVIDER_ID = 'suno-music';
export const SUNO_SOUNDS_PROVIDER_ID = 'suno-sounds';
export const SUNO_MODEL_IDS = ['V5_5', 'V5', 'V4_5PLUS', 'V4_5', 'V4'] as const;
export const DEFAULT_SUNO_MODEL_ID = 'V5_5';
export const DEFAULT_SUNO_CUSTOM_MODE = false;
export const DEFAULT_SUNO_INSTRUMENTAL = true;
export const DEFAULT_SUNO_STYLE_WEIGHT = 0.65;
export const DEFAULT_SUNO_WEIRDNESS_CONSTRAINT = 0.65;
export const DEFAULT_SUNO_AUDIO_WEIGHT = 0.65;
export const DEFAULT_SUNO_DURATION = 20;
export const MIN_SUNO_DURATION = 10;
export const MAX_SUNO_DURATION = 360;

export type SunoModelId = typeof SUNO_MODEL_IDS[number];
export type SunoVocalGender = 'm' | 'f';

export interface SunoCreateMusicParams {
  audioWeight?: number;
  callBackUrl?: string;
  customMode?: boolean;
  duration?: number;
  instrumental?: boolean;
  model?: string;
  negativeTags?: string;
  prompt?: string;
  style?: string;
  styleWeight?: number;
  title?: string;
  vocalGender?: SunoVocalGender;
  weirdnessConstraint?: number;
}

export interface SunoCreateSoundsParams {
  callBackUrl?: string;
  grabLyrics?: boolean;
  model?: string;
  prompt: string;
  soundKey?: string;
  soundLoop?: boolean;
  soundTempo?: number;
}

export interface SunoMusicResult {
  audioUrl?: string;
  duration?: number;
  id?: string;
  imageUrl?: string;
  prompt?: string;
  streamAudioUrl?: string;
  tags?: string;
  title?: string;
}

export interface SunoMusicTask {
  completedAt?: Date;
  createdAt: Date;
  error?: string;
  id: string;
  progress?: number;
  refund?: HostedAiRefundInfo;
  results?: SunoMusicResult[];
  status: TaskStatus;
}
