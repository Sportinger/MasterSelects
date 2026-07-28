// Runtime-worker handlers for the audio-intelligence worker. Kept separate
// from the worker bootstrap so tests can drive them through WorkerRuntimeHost
// with an injected session factory. Later packets register the alignment,
// speech-marker, prosody, and room-tone handlers here as well.

import type { RuntimeJobHandlerRegistration } from '../../../../runtime/worker/types';
import {
  AUDIO_INTELLIGENCE_ANALYSIS_SAMPLE_RATE,
  AUDIO_INTELLIGENCE_INIT_HANDLER_ID,
  AUDIO_INTELLIGENCE_VAD_HANDLER_ID,
  type AudioIntelligenceInitJobInput,
  type AudioIntelligenceInitJobOutput,
  type AudioIntelligenceVadJobInput,
  type AudioIntelligenceVadJobOutput,
} from '../audioIntelligenceTypes';
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
}

function abortError(message = 'Audio intelligence job was cancelled.'): Error {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

export function createAudioIntelligenceWorkerHandlers(
  options: AudioIntelligenceWorkerHandlerOptions,
): RuntimeJobHandlerRegistration[] {
  let session: VadSessionLike | null = null;
  let modelId: string | null = null;
  let modelVersion: string | null = null;

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
      return {
        backend: 'wasm',
        modelId: input.modelId,
        modelVersion: input.modelVersion,
      };
    },
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
      if (input.sampleRate !== AUDIO_INTELLIGENCE_ANALYSIS_SAMPLE_RATE) {
        throw new Error(
          `Audio intelligence VAD requires ${AUDIO_INTELLIGENCE_ANALYSIS_SAMPLE_RATE} Hz PCM, got ${input.sampleRate}.`,
        );
      }
      if (!(input.pcm instanceof Float32Array)) {
        throw new Error('Audio intelligence VAD requires Float32Array PCM input.');
      }
      if (input.config.frameSamples !== 512) {
        throw new Error(
          `Audio intelligence VAD requires frameSamples=512 for Silero inference, got ${input.config.frameSamples}.`,
        );
      }

      context.log('debug', 'Running Silero VAD', {
        samples: input.pcm.length,
        modelId,
        modelVersion,
      });
      const probabilities = await session.process(input.pcm, {
        checkAborted: () => {
          if (context.signal.aborted) {
            throw abortError();
          }
        },
        onProgress: (processedFrames, totalFrames) => {
          context.progress({
            value: totalFrames > 0 ? 0.05 + 0.9 * (processedFrames / totalFrames) : 1,
            stage: 'vad-inference',
          });
        },
      });
      if (context.signal.aborted) {
        throw abortError();
      }

      const frameDurationSeconds = input.config.frameSamples / input.sampleRate;
      const segments = segmentSpeechProbabilities(
        probabilities,
        frameDurationSeconds,
        input.config,
        input.pcm.length / input.sampleRate,
        input.offsetSeconds,
      );
      context.progress({ value: 1, stage: 'vad-segmentation' });

      return {
        output: {
          segments,
          probabilityHop: frameDurationSeconds,
          probabilities,
        },
        transfer: [probabilities.buffer],
      };
    },
  };

  return [
    initRegistration as RuntimeJobHandlerRegistration,
    vadRegistration as RuntimeJobHandlerRegistration,
  ];
}
