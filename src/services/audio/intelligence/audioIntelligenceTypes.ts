import type { TranscriptWord } from '../../../types/clipMetadata';
import type { EnergyEnvelope } from './alignment/acousticRefineAlignment';
import type { ProsodyAnalysisResult } from './prosody/prosodyAnalysis';
import type { RoomToneProfileResult } from './roomTone/roomToneProfiler';
import type {
  AlignedWordTiming,
  AudioSpan,
  SpeechMarker,
  VoiceActivityConfig,
} from './audioIntelligencePayloadTypes';

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
export const AUDIO_INTELLIGENCE_LOAD_PCM_HANDLER_ID = 'audio-intel.load-pcm';
export const AUDIO_INTELLIGENCE_RELEASE_PCM_HANDLER_ID = 'audio-intel.release-pcm';
export const AUDIO_INTELLIGENCE_VAD_HANDLER_ID = 'audio-intel.vad';
export const AUDIO_INTELLIGENCE_ALIGNMENT_HANDLER_ID = 'audio-intel.align';
export const AUDIO_INTELLIGENCE_SPEECH_MARKERS_HANDLER_ID = 'audio-intel.speech-markers';
export const AUDIO_INTELLIGENCE_PROSODY_HANDLER_ID = 'audio-intel.prosody';
export const AUDIO_INTELLIGENCE_ROOM_TONE_HANDLER_ID = 'audio-intel.room-tone';

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
  pcm?: Float32Array;
  token?: string;
  sampleRate: typeof AUDIO_INTELLIGENCE_ANALYSIS_SAMPLE_RATE;
  offsetSeconds: number;
  config: VoiceActivityConfig;
}

export interface AudioIntelligenceVadJobOutput {
  segments: AudioSpan[];
  probabilityHop: number;
  probabilities?: Float32Array;
}

export interface AudioIntelligenceLoadPcmJobInput {
  pcm: Float32Array;
  sampleRate: number;
  offsetSeconds: number;
}

export interface AudioIntelligenceLoadPcmJobOutput {
  token: string;
  energy: EnergyEnvelope;
}

export interface AudioIntelligenceReleasePcmJobInput {
  token: string;
}

export interface AudioIntelligenceReleasePcmJobOutput {
  released: boolean;
}

export interface AudioIntelligenceAlignmentJobInput {
  token: string;
  words: readonly Pick<TranscriptWord, 'id' | 'text' | 'start' | 'end'>[];
  wordSource: 'synthetic' | 'provider';
  vadSegments: readonly AudioSpan[];
  onsets?: readonly number[];
}

export type AudioIntelligenceAlignmentJobOutput = AlignedWordTiming[];

export interface AudioIntelligenceSpeechMarkersJobInput {
  token: string;
  vadSegments: readonly AudioSpan[];
  words?: readonly TranscriptWord[];
  language?: string;
}

export type AudioIntelligenceSpeechMarkersJobOutput = SpeechMarker[];

export interface AudioIntelligenceProsodyJobInput {
  token: string;
  hopSeconds: number;
  vadSegments?: readonly AudioSpan[];
  alignedWords?: readonly AlignedWordTiming[];
}

export type AudioIntelligenceProsodyJobOutput = ProsodyAnalysisResult;

export interface AudioIntelligenceRoomToneJobInput {
  token: string;
  vadSegments: readonly AudioSpan[];
}

export type AudioIntelligenceRoomToneJobOutput = RoomToneProfileResult;

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
