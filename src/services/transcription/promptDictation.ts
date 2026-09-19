import type {
  AudioRecordingCapture,
  AudioRecordingChunkSink,
  AudioRecordingRecoveryChunkInput,
} from '../audio/AudioRecordingService';
import { AudioWorkletAudioCaptureBackend } from '../audio/AudioRecordingService';
import { resamplePcm } from '../audio/audioResample';
import { createLocalWhisperWorkerSession } from './workerClient';

const DICTATION_CHUNK_DURATION_MS = 5_000;
const MINIMUM_TRANSCRIPTION_DURATION_SECONDS = 0.35;
const WHISPER_SAMPLE_RATE = 16_000;

export interface PromptDictationProgress {
  message: string;
  progress: number;
}

export interface PromptDictationOptions {
  language?: string;
  onError?: (error: Error) => void;
  onProgress?: (progress: PromptDictationProgress) => void;
  onTranscript: (text: string) => void;
}

export interface PromptDictationSession {
  cancel: () => Promise<void>;
  stop: () => Promise<void>;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function buildRecoveryRef(input: AudioRecordingRecoveryChunkInput) {
  return {
    artifactId: `prompt-dictation:${input.chunkIndex}`,
    inputDeviceId: input.inputDeviceId,
    trackIds: [],
    chunkIndex: input.chunkIndex,
    kind: input.kind,
    mimeType: input.mimeType,
    startedAt: input.startedAt,
    startTime: input.startTime,
    timeStart: input.timeStart,
    duration: input.duration,
    sampleRate: input.sampleRate,
    channelCount: input.channelCount,
    frameCount: input.frameCount,
  };
}

async function decodePromptPcmChunk(input: AudioRecordingRecoveryChunkInput): Promise<Float32Array> {
  const channelCount = Math.max(1, input.channelCount ?? 1);
  const interleaved = new Float32Array(await input.blob.arrayBuffer());
  const frameCount = Math.min(
    input.frameCount ?? Math.floor(interleaved.length / channelCount),
    Math.floor(interleaved.length / channelCount),
  );
  const mono = new Float32Array(frameCount);

  for (let frame = 0; frame < frameCount; frame += 1) {
    let sample = 0;
    for (let channel = 0; channel < channelCount; channel += 1) {
      sample += interleaved[frame * channelCount + channel] ?? 0;
    }
    mono[frame] = sample / channelCount;
  }

  return resamplePcm(mono, input.sampleRate ?? WHISPER_SAMPLE_RATE, WHISPER_SAMPLE_RATE);
}

/**
 * Captures microphone PCM with the editor's AudioWorklet backend and sends
 * short, serialized windows through the existing local Whisper worker.
 */
export async function startPromptDictation(
  options: PromptDictationOptions,
): Promise<PromptDictationSession> {
  const language = options.language ?? 'auto';
  const whisper = createLocalWhisperWorkerSession();
  let capture: AudioRecordingCapture | null = null;
  let finalizing = false;
  let processingError: Error | null = null;
  let processingQueue = Promise.resolve();

  const handleProcessingError = (error: unknown): void => {
    if (processingError) return;
    processingError = toError(error);
    options.onError?.(processingError);
    void capture?.cancel();
    whisper.terminate();
  };

  const processChunk = async (input: AudioRecordingRecoveryChunkInput): Promise<void> => {
    if (processingError) return;
    const pcm = await decodePromptPcmChunk(input);
    const duration = pcm.length / WHISPER_SAMPLE_RATE;
    if (duration < MINIMUM_TRANSCRIPTION_DURATION_SECONDS) return;

    const words = await whisper.transcribe(pcm, language, duration, (progress, message) => {
      options.onProgress?.({ progress, message });
    });
    const text = words.map(word => word.text.trim()).filter(Boolean).join(' ').trim();
    if (text) options.onTranscript(text);
  };

  const chunkSink: AudioRecordingChunkSink = {
    writeChunk: async (input) => {
      processingQueue = processingQueue
        .then(() => processChunk(input))
        .catch((error: unknown) => {
          handleProcessingError(error);
        });
      return buildRecoveryRef(input);
    },
  };

  try {
    capture = await new AudioWorkletAudioCaptureBackend().start({
      chunkSink,
      mimeTypes: [],
      sessionId: `prompt-dictation-${Date.now()}`,
      startedAt: Date.now(),
      startTime: 0,
      timesliceMs: DICTATION_CHUNK_DURATION_MS,
      trackIds: [],
    });
    processingQueue = whisper.load(language, (progress, message) => {
      options.onProgress?.({ progress, message });
    }).catch(handleProcessingError);
  } catch (error) {
    whisper.terminate();
    throw toError(error);
  }

  return {
    cancel: async () => {
      if (finalizing) return;
      finalizing = true;
      await capture?.cancel();
      whisper.terminate();
    },
    stop: async () => {
      if (finalizing) return;
      finalizing = true;
      try {
        await capture?.stop();
        await processingQueue;
        if (processingError) throw processingError;
      } finally {
        whisper.terminate();
      }
    },
  };
}
