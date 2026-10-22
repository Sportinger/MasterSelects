// Whole-source audio decode with ordered fallbacks for the waveform and the audio proxy.
//
// Browser decodeAudioData rejects some sources other decoders handle (Safari
// with Ogg/Opus/WebM audio, files with odd headers). Before a clip is left
// without a waveform, the existing decode paths are tried in order:
//   1. browser decodeAudioData (AudioDecodeService, supplied by the caller)
//   2. container demux + WebCodecs AudioDecoder (MediaAudioRangeReader)
//   3. FFmpeg WASM (shared FFmpegBridge) decoding to float WAV
// No decoder is created per request: the FFmpeg bridge is the app singleton
// and the container reader is the same one export uses for source ranges.

import { readBlobAsArrayBuffer } from '../../../importers/fileIdentity';
import { Logger } from '../../logger';
import { AudioDecodeServiceError, errorMessage, isCancellationError } from './errors';
import {
  isTransientSourceAudioDecodeError,
  SourceAudioDecodeChainError,
  SourceAudioDecoderUnavailableError,
  SourceAudioHasNoTrackError,
  type SourceAudioDecodeFailure,
} from './sourceAudioDecodeFailures';

export type { SourceAudioDecodeFailure } from './sourceAudioDecodeFailures';

const log = Logger.create('SourceAudioFallbackDecode');

export const CONTAINER_AUDIO_DECODER_ID = 'webcodecs.container-demux';
export const FFMPEG_AUDIO_DECODER_ID = 'ffmpeg.wasm';
/** The whole source is copied into the WASM heap; larger files would not fit next to the decoded PCM. */
export const FFMPEG_AUDIO_DECODE_MAX_SOURCE_BYTES = 512 * 1024 * 1024;

export interface SourceAudioDecodeAttempt {
  id: string;
  decode: (file: File, signal?: AbortSignal) => Promise<AudioBuffer>;
}

export interface SourceAudioDecodeResult {
  buffer: AudioBuffer;
  decoderId: string;
  /** Paths that failed before `decoderId` succeeded, in the order they ran. */
  failures: SourceAudioDecodeFailure[];
}

function isAbort(error: unknown, signal: AbortSignal | undefined): boolean {
  if (signal?.aborted || isCancellationError(error)) return true;
  return Boolean(error) && typeof error === 'object' && (error as { name?: unknown }).name === 'AbortError';
}

/**
 * Runs the attempts in order and returns the first decoded buffer. Cancellation
 * stops the chain immediately, and so does a path that proves the source has no
 * audio track. When every path fails, one SourceAudioDecodeChainError
 * (`decode-failed`) names each path and its reason, with the first error as cause.
 */
export async function decodeSourceAudioWithFallbacks(
  file: File,
  attempts: readonly SourceAudioDecodeAttempt[],
  signal?: AbortSignal,
): Promise<SourceAudioDecodeResult> {
  const failures: SourceAudioDecodeFailure[] = [];
  const errors: unknown[] = [];
  for (const attempt of attempts) {
    signal?.throwIfAborted();
    try {
      const buffer = await attempt.decode(file, signal);
      if (failures.length > 0) {
        log.info('Decoded source audio with a fallback decoder', {
          file: file.name,
          decoderId: attempt.id,
          failedDecoders: failures,
        });
      }
      return { buffer, decoderId: attempt.id, failures };
    } catch (error) {
      if (isAbort(error, signal)) throw error;
      errors.push(error);
      failures.push({
        decoderId: attempt.id,
        message: errorMessage(error),
        transient: isTransientSourceAudioDecodeError(error),
      });
      log.debug('Source audio decode path failed', { file: file.name, decoderId: attempt.id, error });
      if (error instanceof SourceAudioHasNoTrackError) break;
    }
  }

  const firstError = errors[0];
  const jobId = firstError instanceof AudioDecodeServiceError ? firstError.jobId : 'source-audio-fallback';
  throw new SourceAudioDecodeChainError(
    `No audio decode path could decode ${file.name || 'the source'}: ${
      failures.map(failure => `${failure.decoderId}: ${failure.message}`).join('; ') || 'no decoder was tried'
    }`,
    { jobId, failures, errors },
  );
}

/** Container demux + WebCodecs AudioDecoder over byte-range reads of the file. */
export const containerAudioDecodeAttempt: SourceAudioDecodeAttempt = {
  id: CONTAINER_AUDIO_DECODER_ID,
  decode: async (file, signal) => {
    const { MediaAudioRangeReader } = await import('../../../engine/audio/exportPipeline/MediaAudioRangeReader');
    const reader = new MediaAudioRangeReader(file);
    try {
      return await reader.readAll(signal);
    } catch (error) {
      // FFmpeg would copy the whole file into WASM only to find the same empty track list.
      if ((error as { code?: unknown } | null)?.code === 'no-audio-track') {
        throw new SourceAudioHasNoTrackError(errorMessage(error), { cause: error });
      }
      throw error;
    } finally {
      reader.dispose();
    }
  },
};

function ffmpegInputPath(fileName: string): string {
  const extension = fileName.split('.').pop() ?? '';
  return /^[a-z0-9]{1,8}$/i.test(extension) && extension !== fileName
    ? `/input/waveform-source.${extension.toLowerCase()}`
    : '/input/waveform-source';
}

/** FFmpeg WASM decode of the first audio stream to 32-bit float WAV, parsed without the browser decoder. */
export const ffmpegAudioDecodeAttempt: SourceAudioDecodeAttempt = {
  id: FFMPEG_AUDIO_DECODER_ID,
  decode: async (file, signal) => {
    if (file.size > FFMPEG_AUDIO_DECODE_MAX_SOURCE_BYTES) {
      throw new Error(`source is ${file.size} bytes; the FFmpeg audio fallback is limited to ${FFMPEG_AUDIO_DECODE_MAX_SOURCE_BYTES} bytes`);
    }
    const [{ FFmpegBridge, getFFmpegBridge }, { createBytesAudioByteRangeSource, readWavPcmAudioRange }] = await Promise.all([
      import('../../../engine/ffmpeg'),
      import('../../../engine/audio/exportPipeline/WavPcmRangeReader'),
    ]);
    if (!FFmpegBridge.isSupported()) throw new SourceAudioDecoderUnavailableError('WebAssembly is not available');
    const bridge = getFFmpegBridge();
    try {
      await bridge.load();
    } catch (error) {
      throw new SourceAudioDecoderUnavailableError(`FFmpeg could not be loaded: ${errorMessage(error)}`, { cause: error });
    }
    signal?.throwIfAborted();
    const inputPath = ffmpegInputPath(file.name);
    const outputPath = '/output/waveform-source.wav';
    const outputs = await bridge.runVirtualCommand({
      inputFiles: { [inputPath]: new Uint8Array(await readBlobAsArrayBuffer(file)) },
      args: ['-i', inputPath, '-map', '0:a:0', '-vn', '-sn', '-dn', '-c:a', 'pcm_f32le', '-f', 'wav', outputPath],
      outputPaths: [outputPath],
    });
    signal?.throwIfAborted();
    const wav = outputs[outputPath];
    if (!wav || wav.byteLength <= 44) throw new Error('FFmpeg produced no audio samples');
    return readWavPcmAudioRange(createBytesAudioByteRangeSource(wav), 0, Number.MAX_SAFE_INTEGER);
  },
};

/** Fallback paths tried after browser decodeAudioData, in order. */
export const SOURCE_AUDIO_FALLBACK_DECODE_ATTEMPTS: readonly SourceAudioDecodeAttempt[] = [
  containerAudioDecodeAttempt,
  ffmpegAudioDecodeAttempt,
];
