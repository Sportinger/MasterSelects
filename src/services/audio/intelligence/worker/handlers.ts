// Runtime-worker handlers for the audio-intelligence worker. PCM is retained
// behind short-lived tokens so every feature can share one transferred buffer.

import type { RuntimeJobHandlerRegistration } from '../../../../runtime/worker/types';
import { refineWordTimings } from '../alignment/acousticRefineAlignment';
import {
  AUDIO_INTELLIGENCE_ALIGNMENT_HANDLER_ID,
  AUDIO_INTELLIGENCE_ANALYSIS_SAMPLE_RATE,
  AUDIO_INTELLIGENCE_INIT_HANDLER_ID,
  AUDIO_INTELLIGENCE_LOAD_PCM_HANDLER_ID,
  AUDIO_INTELLIGENCE_PROSODY_HANDLER_ID,
  AUDIO_INTELLIGENCE_RELEASE_PCM_HANDLER_ID,
  AUDIO_INTELLIGENCE_ROOM_TONE_HANDLER_ID,
  AUDIO_INTELLIGENCE_SPEECH_MARKERS_HANDLER_ID,
  AUDIO_INTELLIGENCE_VAD_HANDLER_ID,
  type AudioIntelligenceAlignmentJobInput,
  type AudioIntelligenceAlignmentJobOutput,
  type AudioIntelligenceInitJobInput,
  type AudioIntelligenceInitJobOutput,
  type AudioIntelligenceLoadPcmJobInput,
  type AudioIntelligenceLoadPcmJobOutput,
  type AudioIntelligenceProsodyJobInput,
  type AudioIntelligenceProsodyJobOutput,
  type AudioIntelligenceReleasePcmJobInput,
  type AudioIntelligenceReleasePcmJobOutput,
  type AudioIntelligenceRoomToneJobInput,
  type AudioIntelligenceRoomToneJobOutput,
  type AudioIntelligenceSpeechMarkersJobInput,
  type AudioIntelligenceSpeechMarkersJobOutput,
  type AudioIntelligenceVadJobInput,
  type AudioIntelligenceVadJobOutput,
} from '../audioIntelligenceTypes';
import { analyzeProsody } from '../prosody/prosodyAnalysis';
import { profileRoomTone } from '../roomTone/roomToneProfiler';
import { detectBreaths } from '../speechMarkers/breathDetection';
import { detectFillerMarkers } from '../speechMarkers/fillerDetection';
import { segmentSpeechProbabilities } from '../vad/vadSegmentation';

export interface VadSessionLike {
  process(
    pcm: Float32Array,
    options?: {
      checkAborted?: () => void;
      onProgress?: (processedFrames: number, totalFrames: number) => void;
    },
  ): Promise<Float32Array>;
  release?(): Promise<void> | void;
}

export type VadSessionFactory = (modelBytes: ArrayBuffer) => Promise<VadSessionLike>;

export interface AudioIntelligenceWorkerHandlerOptions {
  createSession: VadSessionFactory;
  refineWordTimings?: typeof refineWordTimings;
  detectBreaths?: typeof detectBreaths;
  detectFillerMarkers?: typeof detectFillerMarkers;
  analyzeProsody?: typeof analyzeProsody;
  profileRoomTone?: typeof profileRoomTone;
}

interface CachedPcm {
  pcm: Float32Array;
  sampleRate: number;
  offsetSeconds: number;
  energy: { values: Float32Array; hopSeconds: number; startSeconds: number };
}

const MAX_PCM_TOKENS = 2;
const ENERGY_HOP_SECONDS = 0.01;
const pcmCache = new Map<string, CachedPcm>();
let tokenCounter = 0;

function abortError(message = 'Audio intelligence job was cancelled.'): Error {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

function checkAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

function computeEnergyEnvelope(
  pcm: Float32Array,
  sampleRate: number,
  offsetSeconds: number,
): CachedPcm['energy'] {
  const hopSamples = Math.max(1, Math.round(sampleRate * ENERGY_HOP_SECONDS));
  const values = new Float32Array(pcm.length === 0 ? 0 : Math.ceil(pcm.length / hopSamples));
  for (let frame = 0; frame < values.length; frame += 1) {
    const start = frame * hopSamples;
    const end = Math.min(pcm.length, start + hopSamples);
    let sumSquares = 0;
    for (let index = start; index < end; index += 1) sumSquares += (pcm[index] ?? 0) ** 2;
    values[frame] = Math.sqrt(sumSquares / Math.max(1, end - start));
  }
  return { values, hopSeconds: ENERGY_HOP_SECONDS, startSeconds: offsetSeconds };
}

export function createAudioIntelligenceWorkerHandlers(
  options: AudioIntelligenceWorkerHandlerOptions,
): RuntimeJobHandlerRegistration[] {
  let session: VadSessionLike | null = null;
  let modelId: string | null = null;
  let modelVersion: string | null = null;
  const align = options.refineWordTimings ?? refineWordTimings;
  const breaths = options.detectBreaths ?? detectBreaths;
  const fillers = options.detectFillerMarkers ?? detectFillerMarkers;
  const prosody = options.analyzeProsody ?? analyzeProsody;
  const roomTone = options.profileRoomTone ?? profileRoomTone;

  const requirePcm = (token: string): CachedPcm => {
    const cached = pcmCache.get(token);
    if (!cached) throw new Error(`Audio intelligence PCM token is unavailable: ${token}`);
    return cached;
  };

  const initRegistration: RuntimeJobHandlerRegistration<
    AudioIntelligenceInitJobInput,
    AudioIntelligenceInitJobOutput
  > = {
    handlerId: AUDIO_INTELLIGENCE_INIT_HANDLER_ID,
    handler: async (input, context) => {
      if (!(input.modelBytes instanceof ArrayBuffer) || input.modelBytes.byteLength === 0) {
        throw new Error('Audio intelligence init requires non-empty model bytes.');
      }
      await session?.release?.();
      session = null;
      context.progress({ value: 0.1, stage: 'creating-session' });
      session = await options.createSession(input.modelBytes);
      if (context.signal.aborted) {
        await session.release?.();
        session = null;
        throw abortError();
      }
      modelId = input.modelId;
      modelVersion = input.modelVersion;
      context.progress({ value: 1, stage: 'session-ready' });
      return { backend: 'wasm', modelId: input.modelId, modelVersion: input.modelVersion };
    },
  };

  const loadRegistration: RuntimeJobHandlerRegistration<
    AudioIntelligenceLoadPcmJobInput,
    AudioIntelligenceLoadPcmJobOutput
  > = {
    handlerId: AUDIO_INTELLIGENCE_LOAD_PCM_HANDLER_ID,
    handler: (input, context) => {
      if (!(input.pcm instanceof Float32Array)) {
        throw new Error('Audio intelligence PCM load requires Float32Array PCM input.');
      }
      if (!Number.isFinite(input.sampleRate) || input.sampleRate <= 0) {
        throw new Error('Audio intelligence PCM load requires a positive sample rate.');
      }
      checkAborted(context.signal);
      const energy = computeEnergyEnvelope(input.pcm, input.sampleRate, input.offsetSeconds);
      const token = `pcm-${++tokenCounter}`;
      if (pcmCache.size >= MAX_PCM_TOKENS) {
        const oldest = pcmCache.keys().next().value as string | undefined;
        if (oldest) {
          pcmCache.delete(oldest);
          context.log('warn', 'Evicting oldest audio intelligence PCM token', { token: oldest });
        }
      }
      pcmCache.set(token, { ...input, energy });
      context.progress({ value: 1, stage: 'pcm-loaded' });
      const returnedValues = energy.values.slice();
      return {
        output: { token, energy: { ...energy, values: returnedValues } },
        transfer: [returnedValues.buffer],
      };
    },
  };

  const releaseRegistration: RuntimeJobHandlerRegistration<
    AudioIntelligenceReleasePcmJobInput,
    AudioIntelligenceReleasePcmJobOutput
  > = {
    handlerId: AUDIO_INTELLIGENCE_RELEASE_PCM_HANDLER_ID,
    handler: (input) => ({ released: pcmCache.delete(input.token) }),
  };

  const vadRegistration: RuntimeJobHandlerRegistration<
    AudioIntelligenceVadJobInput,
    AudioIntelligenceVadJobOutput
  > = {
    handlerId: AUDIO_INTELLIGENCE_VAD_HANDLER_ID,
    handler: async (input, context) => {
      if (!session) {
        throw new Error('Audio intelligence VAD session is not initialized. Run audio-intel.init first.');
      }
      const cached = input.token ? requirePcm(input.token) : null;
      const pcm = cached?.pcm ?? input.pcm;
      const sampleRate = cached?.sampleRate ?? input.sampleRate;
      const offsetSeconds = cached?.offsetSeconds ?? input.offsetSeconds;
      if (sampleRate !== AUDIO_INTELLIGENCE_ANALYSIS_SAMPLE_RATE) {
        throw new Error(
          `Audio intelligence VAD requires ${AUDIO_INTELLIGENCE_ANALYSIS_SAMPLE_RATE} Hz PCM, got ${sampleRate}.`,
        );
      }
      if (!(pcm instanceof Float32Array)) {
        throw new Error('Audio intelligence VAD requires direct PCM or a valid PCM token.');
      }
      if (input.config.frameSamples !== 512) {
        throw new Error(
          `Audio intelligence VAD requires frameSamples=512 for Silero inference, got ${input.config.frameSamples}.`,
        );
      }
      context.log('debug', 'Running Silero VAD', { samples: pcm.length, modelId, modelVersion });
      const probabilities = await session.process(pcm, {
        checkAborted: () => checkAborted(context.signal),
        onProgress: (processedFrames, totalFrames) => context.progress({
          value: totalFrames > 0 ? 0.05 + 0.9 * (processedFrames / totalFrames) : 1,
          stage: 'vad-inference',
        }),
      });
      checkAborted(context.signal);
      const frameDurationSeconds = input.config.frameSamples / sampleRate;
      const segments = segmentSpeechProbabilities(
        probabilities,
        frameDurationSeconds,
        input.config,
        pcm.length / sampleRate,
        offsetSeconds,
      );
      context.progress({ value: 1, stage: 'vad-segmentation' });
      return {
        output: { segments, probabilityHop: frameDurationSeconds, probabilities },
        transfer: [probabilities.buffer],
      };
    },
  };

  const alignmentRegistration: RuntimeJobHandlerRegistration<
    AudioIntelligenceAlignmentJobInput,
    AudioIntelligenceAlignmentJobOutput
  > = {
    handlerId: AUDIO_INTELLIGENCE_ALIGNMENT_HANDLER_ID,
    handler: (input, context) => {
      const cached = requirePcm(input.token);
      checkAborted(context.signal);
      context.progress({ value: 0.1, stage: 'alignment-refine' });
      const output = align({ ...input, energy: cached.energy });
      checkAborted(context.signal);
      context.progress({ value: 1, stage: 'alignment-complete' });
      return output;
    },
  };

  const markersRegistration: RuntimeJobHandlerRegistration<
    AudioIntelligenceSpeechMarkersJobInput,
    AudioIntelligenceSpeechMarkersJobOutput
  > = {
    handlerId: AUDIO_INTELLIGENCE_SPEECH_MARKERS_HANDLER_ID,
    handler: (input, context) => {
      const cached = requirePcm(input.token);
      checkAborted(context.signal);
      context.progress({ value: 0.1, stage: 'breath-detection' });
      const detectedBreaths = breaths({
        pcm: cached.pcm,
        sampleRate: cached.sampleRate,
        offsetSeconds: cached.offsetSeconds,
        vadSegments: input.vadSegments,
      });
      checkAborted(context.signal);
      const detectedFillers = input.words
        ? fillers({ words: input.words, vadSegments: input.vadSegments, language: input.language })
        : [];
      const output = [...detectedBreaths, ...detectedFillers]
        .toSorted((left, right) => left.start - right.start || left.type.localeCompare(right.type));
      checkAborted(context.signal);
      context.progress({ value: 1, stage: 'speech-markers-complete' });
      return output;
    },
  };

  const prosodyRegistration: RuntimeJobHandlerRegistration<
    AudioIntelligenceProsodyJobInput,
    AudioIntelligenceProsodyJobOutput
  > = {
    handlerId: AUDIO_INTELLIGENCE_PROSODY_HANDLER_ID,
    handler: (input, context) => {
      const cached = requirePcm(input.token);
      checkAborted(context.signal);
      context.progress({ value: 0.1, stage: 'prosody-analysis' });
      const output = prosody({
        pcm: cached.pcm,
        sampleRate: cached.sampleRate,
        offsetSeconds: cached.offsetSeconds,
        hopSeconds: input.hopSeconds,
        vadSegments: input.vadSegments,
        alignedWords: input.alignedWords,
      });
      checkAborted(context.signal);
      context.progress({ value: 1, stage: 'prosody-complete' });
      return {
        output,
        transfer: [
          output.f0Hz.buffer,
          output.voicing.buffer,
          output.energyRmsDb.buffer,
          output.speechRateSps.buffer,
        ],
      };
    },
  };

  const roomToneRegistration: RuntimeJobHandlerRegistration<
    AudioIntelligenceRoomToneJobInput,
    AudioIntelligenceRoomToneJobOutput
  > = {
    handlerId: AUDIO_INTELLIGENCE_ROOM_TONE_HANDLER_ID,
    handler: (input, context) => {
      const cached = requirePcm(input.token);
      checkAborted(context.signal);
      context.progress({ value: 0.1, stage: 'room-tone-profile' });
      const output = roomTone({
        pcm: cached.pcm,
        sampleRate: cached.sampleRate,
        offsetSeconds: cached.offsetSeconds,
        vadSegments: input.vadSegments,
      });
      checkAborted(context.signal);
      context.progress({ value: 1, stage: 'room-tone-complete' });
      return output;
    },
  };

  return [
    initRegistration,
    loadRegistration,
    releaseRegistration,
    vadRegistration,
    alignmentRegistration,
    markersRegistration,
    prosodyRegistration,
    roomToneRegistration,
  ] as RuntimeJobHandlerRegistration[];
}
