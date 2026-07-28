import type { AudioSpan, VoiceActivityConfig } from './audioIntelligencePayloadTypes';

export const AUDIO_INTELLIGENCE_FEATURES = [
  'vad',
  'alignment',
  'speech-markers',
  'prosody',
  'room-tone',
] as const;

export type AudioIntelligenceFeature = typeof AUDIO_INTELLIGENCE_FEATURES[number];

export const AUDIO_INTELLIGENCE_ANALYSIS_SAMPLE_RATE = 16_000 as const;
export const AUDIO_INTELLIGENCE_PROVIDER_ID = 'masterselects.audio-intelligence';
export const AUDIO_INTELLIGENCE_INIT_HANDLER_ID = 'audio-intel.init';
export const AUDIO_INTELLIGENCE_VAD_HANDLER_ID = 'audio-intel.vad';

export const DEFAULT_VOICE_ACTIVITY_CONFIG: VoiceActivityConfig = {
  threshold: 0.5,
  negThreshold: 0.35,
  minSpeechMs: 250,
  minSilenceMs: 100,
  padMs: 30,
  frameSamples: 512,
};

export interface AudioIntelligenceStageProgress {
  stage: string;
  progress: number;
  feature?: AudioIntelligenceFeature;
  message?: string;
}

export interface AudioIntelligenceInitJobInput {
  modelId: string;
  modelVersion: string;
  modelBytes: ArrayBuffer;
}

export interface AudioIntelligenceInitJobOutput {
  backend: 'wasm';
  modelId: string;
  modelVersion: string;
}

export interface AudioIntelligenceVadJobInput {
  pcm: Float32Array;
  sampleRate: typeof AUDIO_INTELLIGENCE_ANALYSIS_SAMPLE_RATE;
  offsetSeconds: number;
  config: VoiceActivityConfig;
}

export interface AudioIntelligenceVadJobOutput {
  segments: AudioSpan[];
  probabilityHop: number;
  probabilities?: Float32Array;
}

export type AudioIntelligenceErrorCode =
  | 'cancelled'
  | 'model-unavailable'
  | 'worker-unavailable'
  | 'session-contract-mismatch'
  | 'invalid-input'
  | 'invalid-audio-buffer'
  | 'artifact-store-failed';

export class AudioIntelligenceError extends Error {
  readonly code: AudioIntelligenceErrorCode;
  readonly recoverable: boolean;

  constructor(
    message: string,
    options: {
      code: AudioIntelligenceErrorCode;
      recoverable?: boolean;
      cause?: unknown;
    },
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = options.code === 'cancelled'
      ? 'AudioIntelligenceCancelledError'
      : 'AudioIntelligenceError';
    this.code = options.code;
    this.recoverable = options.recoverable
      ?? (options.code !== 'invalid-input' && options.code !== 'invalid-audio-buffer');
  }
}

export function isAudioIntelligenceCancellation(error: unknown): boolean {
  return error instanceof AudioIntelligenceError && error.code === 'cancelled';
}
