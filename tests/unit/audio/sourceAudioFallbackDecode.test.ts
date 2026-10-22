import { describe, expect, it, vi } from 'vitest';

const { runVirtualCommand, load } = vi.hoisted(() => ({ runVirtualCommand: vi.fn(), load: vi.fn(async () => {}) }));
vi.mock('../../../src/engine/ffmpeg', () => ({
  FFmpegBridge: { isSupported: () => true },
  getFFmpegBridge: () => ({ load, runVirtualCommand }),
}));
const readAll = vi.hoisted(() => vi.fn());
vi.mock('../../../src/engine/audio/exportPipeline/MediaAudioRangeReader', () => ({
  MediaAudioRangeReader: class MediaAudioRangeReader {
    readAll = readAll;
    dispose = () => {};
  },
}));

import {
  containerAudioDecodeAttempt,
  decodeSourceAudioWithFallbacks,
  ffmpegAudioDecodeAttempt,
  type SourceAudioDecodeAttempt,
} from '../../../src/services/audio/decode/sourceAudioFallbackDecode';
import {
  isDurableSourceAudioDecodeFailure,
  isSourceAudioMissingError,
  SourceAudioDecodeChainError,
} from '../../../src/services/audio/decode/sourceAudioDecodeFailures';
import { AudioDecodeServiceError } from '../../../src/services/audio/decode/errors';

const file = new File([new Uint8Array(16)], 'clip.ogg', { type: 'audio/ogg' });
const buffer = { duration: 1 } as AudioBuffer;

function attempt(id: string, calls: string[], result: AudioBuffer | Error): SourceAudioDecodeAttempt {
  return {
    id,
    decode: async () => {
      calls.push(id);
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

/** Mono 32-bit float WAV with a WAVE_FORMAT_EXTENSIBLE fmt chunk, as FFmpeg writes it. */
function extensibleFloatWav(samples: number[], sampleRate = 8000): Uint8Array {
  const bytes = new Uint8Array(12 + 48 + 8 + samples.length * 4);
  const view = new DataView(bytes.buffer);
  const ascii = (at: number, text: string) => [...text].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  ascii(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); ascii(8, 'WAVE');
  ascii(12, 'fmt '); view.setUint32(16, 40, true);
  view.setUint16(20, 0xfffe, true); view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 4, true); view.setUint16(32, 4, true); view.setUint16(34, 32, true);
  view.setUint16(36, 22, true); view.setUint16(38, 32, true); view.setUint32(40, 4, true);
  view.setUint16(44, 3, true); // sub-format GUID starts with IEEE float
  ascii(60, 'data'); view.setUint32(64, samples.length * 4, true);
  samples.forEach((sample, i) => view.setFloat32(68 + i * 4, sample, true));
  return bytes;
}

describe('decodeSourceAudioWithFallbacks', () => {
  it('does not run fallbacks when the browser decode succeeds', async () => {
    const calls: string[] = [];
    const result = await decodeSourceAudioWithFallbacks(file, [
      attempt('browser', calls, buffer),
      attempt('container', calls, buffer),
    ]);
    expect(calls).toEqual(['browser']);
    expect(result).toMatchObject({ decoderId: 'browser', failures: [] });
  });

  it('tries the paths in order and returns the first decoded buffer', async () => {
    const calls: string[] = [];
    const result = await decodeSourceAudioWithFallbacks(file, [
      attempt('browser', calls, new Error('Unable to decode audio data')),
      attempt('container', calls, new Error('no AudioDecoder')),
      attempt('ffmpeg', calls, buffer),
      attempt('never', calls, buffer),
    ]);
    expect(calls).toEqual(['browser', 'container', 'ffmpeg']);
    expect(result.buffer).toBe(buffer);
    expect(result.failures.map(failure => failure.decoderId)).toEqual(['browser', 'container']);
  });

  it('reports every failed path as one undecodable-audio error', async () => {
    const browserError = new AudioDecodeServiceError('Unable to decode audio data', { code: 'decode-failed', jobId: 'job-1' });
    const error = await decodeSourceAudioWithFallbacks(file, [
      attempt('browser', [], browserError),
      attempt('ffmpeg', [], new Error('FFmpeg exited with code 1')),
    ]).catch(caught => caught);
    expect(error).toBeInstanceOf(AudioDecodeServiceError);
    expect(error).toMatchObject({ name: 'AudioDecodeServiceError', code: 'decode-failed', jobId: 'job-1', cause: browserError });
    expect(error.message).toContain('browser: Unable to decode audio data');
    expect(error.message).toContain('ffmpeg: FFmpeg exited with code 1');
  });

  it('stops the chain when the container holds no audio track, so FFmpeg never copies the file', async () => {
    const noTrack = Object.assign(new Error('Media source has no audio track'), { name: 'MediaAudioRangeError', code: 'no-audio-track' });
    readAll.mockRejectedValueOnce(noTrack);
    const calls: string[] = [];
    const error = await decodeSourceAudioWithFallbacks(file, [
      {
        id: 'browser',
        decode: async () => { calls.push('browser'); throw new DOMException('Unable to decode audio data', 'EncodingError'); },
      },
      containerAudioDecodeAttempt,
      attempt('ffmpeg', calls, buffer),
    ]).catch(caught => caught);
    expect(calls).toEqual(['browser']);
    expect(error).toBeInstanceOf(SourceAudioDecodeChainError);
    expect(isSourceAudioMissingError(error)).toBe(true);
    expect(isDurableSourceAudioDecodeFailure(error)).toBe(true);
  });

  it('marks read errors and an unloadable FFmpeg as transient, so the failure is not remembered', async () => {
    load.mockRejectedValueOnce(new Error('Failed to fetch ffmpeg-core.wasm'));
    const error = await decodeSourceAudioWithFallbacks(file, [
      attempt('browser', [], new Error('Unable to decode audio data')),
      ffmpegAudioDecodeAttempt,
    ]).catch(caught => caught) as SourceAudioDecodeChainError;
    expect(error.failures.map(failure => [failure.decoderId, failure.transient])).toEqual([
      ['browser', false],
      ['ffmpeg.wasm', true],
    ]);
    expect(error.failures[1].message).toContain('FFmpeg could not be loaded');
    expect(isDurableSourceAudioDecodeFailure(error)).toBe(false);
  });

  it('stops the chain on cancellation', async () => {
    const calls: string[] = [];
    const controller = new AbortController();
    const cancelling: SourceAudioDecodeAttempt = {
      id: 'browser',
      decode: async () => {
        calls.push('browser');
        controller.abort();
        throw new DOMException('aborted', 'AbortError');
      },
    };
    await expect(decodeSourceAudioWithFallbacks(file, [cancelling, attempt('ffmpeg', calls, buffer)], controller.signal))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(calls).toEqual(['browser']);
  });
});

describe('ffmpegAudioDecodeAttempt', () => {
  it('decodes the first audio stream to float WAV and parses the extensible header', async () => {
    runVirtualCommand.mockImplementation(async (input: { args: string[]; outputPaths: string[] }) => {
      expect(input.args).toEqual(expect.arrayContaining(['-map', '0:a:0', '-c:a', 'pcm_f32le', '-i', '/input/waveform-source.ogg']));
      return { [input.outputPaths[0]]: extensibleFloatWav([0.5, -0.25, 1]) };
    });
    const decoded = await ffmpegAudioDecodeAttempt.decode(file);
    expect(decoded.numberOfChannels).toBe(1);
    expect(decoded.sampleRate).toBe(8000);
    expect(Array.from(decoded.getChannelData(0))).toEqual([0.5, -0.25, 1]);
  });
});
