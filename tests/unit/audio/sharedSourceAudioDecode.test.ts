import { afterEach, describe, expect, it, vi } from 'vitest';

const logs = vi.hoisted(() => ({ entries: [] as Array<{ module: string; level: string; message: string }> }));
vi.mock('../../../src/services/logger', () => ({
  Logger: {
    create: (module: string) => Object.fromEntries(['debug', 'info', 'warn', 'error'].map(level => [
      level,
      (message: string) => { logs.entries.push({ module, level, message }); },
    ])),
  },
}));

import { AudioDecodeService } from '../../../src/services/audio/AudioDecodeService';
import { isUndecodableAudioSourceError } from '../../../src/services/audio/decode/errors';
import type { SourceAudioDecodeAttempt } from '../../../src/services/audio/decode/sourceAudioFallbackDecode';
import { isSourceAudioMissingError } from '../../../src/services/audio/decode/sourceAudioDecodeFailures';
import {
  clearSharedSourceAudioDecodeState,
  decodeSourceAudioShared,
  SHARED_SOURCE_DECODE_HANDOFF_TTL_MS,
} from '../../../src/services/audio/decode/sharedSourceAudioDecode';

const LAST_MODIFIED = 1_700_000_000_000;

function sourceFile(bytes: number[], name = 'broken_audio.wma'): File {
  const content = new Uint8Array(bytes);
  const file = new File([content], name, { type: 'audio/x-ms-wma', lastModified: LAST_MODIFIED });
  // jsdom's File has no arrayBuffer(); the decode service reads through it.
  Object.defineProperty(file, 'arrayBuffer', { value: async () => content.slice().buffer });
  return file;
}

const decodedBuffer = {
  sampleRate: 48_000, numberOfChannels: 1, length: 48_000, duration: 1,
  getChannelData: () => new Float32Array(48_000),
} as unknown as AudioBuffer;

function serviceWith(decodeAudioData: () => Promise<AudioBuffer>): AudioDecodeService {
  return new AudioDecodeService({
    limits: { maxSourceBytes: Number.MAX_SAFE_INTEGER, maxDecodedPcmBytes: Number.MAX_SAFE_INTEGER },
    createAudioContext: () => ({ decodeAudioData, close: async () => {} }) as unknown as AudioContext,
  });
}

function fallback(id: string, decode: SourceAudioDecodeAttempt['decode']): SourceAudioDecodeAttempt {
  return { id, decode: vi.fn(decode) };
}

/** The audio proxy: file source through the app decode service. */
function proxyDecode(
  file: File,
  service: AudioDecodeService,
  fallbacks: SourceAudioDecodeAttempt[],
  options: { signal?: AbortSignal; force?: boolean } = {},
) {
  return decodeSourceAudioShared(file, {
    browserAttempt: {
      id: 'browser.decodeAudioData',
      decode: () => service.decodeAudioBuffer({ kind: 'file', file }, { signal: options.signal }),
    },
    fallbackAttempts: fallbacks,
    signal: options.signal,
    retryRememberedFailure: options.force,
  });
}

/** The source waveform: array-buffer source through its per-job decode service. */
async function waveformDecode(file: File, service: AudioDecodeService, fallbacks: SourceAudioDecodeAttempt[]) {
  const arrayBuffer = await file.arrayBuffer();
  return decodeSourceAudioShared(file, {
    browserAttempt: {
      id: 'browser.decodeAudioData',
      decode: () => service.decodeAudioBuffer({ kind: 'array-buffer', arrayBuffer, name: file.name, mimeType: file.type }),
    },
    fallbackAttempts: fallbacks,
  });
}

const encodingError = () => new DOMException('Unable to decode audio data', 'EncodingError');

afterEach(() => {
  clearSharedSourceAudioDecodeState();
  logs.entries.length = 0;
  vi.useRealTimers();
});

describe('decodeSourceAudioShared', () => {
  it('runs the decode chain once for an undecodable file, remembers it, and retries on a forced regeneration', async () => {
    const file = sourceFile([1, 2, 3, 4, 5, 6, 7, 8]);
    const decodeAudioData = vi.fn(async () => { throw encodingError(); });
    const ffmpeg = fallback('ffmpeg.wasm', async () => { throw new Error('FFmpeg exited with code 1'); });
    const service = serviceWith(decodeAudioData);

    const [proxy, waveform] = await Promise.allSettled([
      proxyDecode(file, service, [ffmpeg]),
      waveformDecode(file, serviceWith(decodeAudioData), [ffmpeg]),
    ]);
    const later = await Promise.allSettled([waveformDecode(file, service, [ffmpeg])]);

    expect(decodeAudioData).toHaveBeenCalledTimes(1);
    expect(ffmpeg.decode).toHaveBeenCalledTimes(1);
    expect([proxy.status, waveform.status, later[0].status]).toEqual(['rejected', 'rejected', 'rejected']);
    const proxyError = (proxy as PromiseRejectedResult).reason as Error;
    expect((waveform as PromiseRejectedResult).reason).toBe(proxyError);
    expect(isUndecodableAudioSourceError(proxyError)).toBe(true);
    // A video proxy still reports 'none' through the browser's EncodingError.
    expect(isSourceAudioMissingError(proxyError)).toBe(true);
    expect(logs.entries.filter(entry => entry.level === 'warn' || entry.level === 'error')).toEqual([]);

    await expect(proxyDecode(file, service, [ffmpeg], { force: true })).rejects.toBeTruthy();
    expect(decodeAudioData).toHaveBeenCalledTimes(2);
    expect(ffmpeg.decode).toHaveBeenCalledTimes(2);
  });

  it('gives the proxy the FFmpeg fallback buffer of a source the browser cannot decode and hands it to the waveform', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const file = sourceFile([9, 9, 9, 9], 'speech.wma');
    const decodeAudioData = vi.fn(async () => { throw encodingError(); });
    const container = fallback('webcodecs.container-demux', async () => { throw new Error('Unsupported container'); });
    const ffmpeg = fallback('ffmpeg.wasm', async () => decodedBuffer);
    const service = serviceWith(decodeAudioData);

    const proxy = await proxyDecode(file, service, [container, ffmpeg]);
    expect(proxy).toMatchObject({ buffer: decodedBuffer, decoderId: 'ffmpeg.wasm' });
    // The waveform job leaves the background queue after the proxy finished.
    const waveform = await waveformDecode(file, service, [container, ffmpeg]);
    expect(waveform.buffer).toBe(decodedBuffer);
    expect(decodeAudioData).toHaveBeenCalledTimes(1);
    expect(ffmpeg.decode).toHaveBeenCalledTimes(1);

    // The handoff is short-lived: a much later decode runs the chain again.
    vi.advanceTimersByTime(SHARED_SOURCE_DECODE_HANDOFF_TTL_MS + 1);
    await proxyDecode(file, service, [container, ffmpeg]);
    expect(ffmpeg.decode).toHaveBeenCalledTimes(2);
  });

  it('hands concurrent callers the same decoded buffer from one decodeAudioData call', async () => {
    const file = sourceFile([1, 2, 3]);
    let resolveDecode!: (buffer: AudioBuffer) => void;
    const decodeAudioData = vi.fn(() => new Promise<AudioBuffer>(resolve => { resolveDecode = resolve; }));
    const service = serviceWith(decodeAudioData);

    const both = Promise.all([proxyDecode(file, service, []), waveformDecode(file, service, [])]);
    await vi.waitFor(() => expect(decodeAudioData).toHaveBeenCalled());
    resolveDecode(decodedBuffer);
    const [proxy, waveform] = await both;

    expect(decodeAudioData).toHaveBeenCalledTimes(1);
    expect(proxy.buffer).toBe(waveform.buffer);
  });

  it('lets a joined caller decode itself when the owning caller is cancelled', async () => {
    const file = sourceFile([4, 5, 6]);
    const decodeAudioData = vi.fn()
      .mockImplementationOnce(() => new Promise<AudioBuffer>(() => {}))
      .mockResolvedValueOnce(decodedBuffer);
    const service = serviceWith(decodeAudioData);
    const owner = new AbortController();

    const cancelled = proxyDecode(file, service, [], { signal: owner.signal });
    await vi.waitFor(() => expect(decodeAudioData).toHaveBeenCalledTimes(1));
    const joined = waveformDecode(file, service, []);
    owner.abort('media removed');

    await expect(cancelled).rejects.toMatchObject({ code: 'cancelled' });
    await expect(joined).resolves.toMatchObject({ buffer: decodedBuffer });
    expect(decodeAudioData).toHaveBeenCalledTimes(2);
  });

  it('does not remember a failure caused by the environment', async () => {
    const file = sourceFile([7, 7, 7]);
    const decodeAudioData = vi.fn(async () => { throw encodingError(); });
    const ffmpeg = fallback('ffmpeg.wasm', async () => {
      throw new DOMException('The file could not be read', 'NotReadableError');
    });
    const service = serviceWith(decodeAudioData);

    await expect(proxyDecode(file, service, [ffmpeg])).rejects.toBeTruthy();
    await expect(proxyDecode(file, service, [ffmpeg])).rejects.toBeTruthy();
    expect(ffmpeg.decode).toHaveBeenCalledTimes(2);
  });

  it('never serves a remembered failure to a replaced file with the same name, size and modification time', async () => {
    const original = sourceFile([1, 1, 1, 1]);
    const replaced = sourceFile([2, 2, 2, 2]);
    expect([replaced.name, replaced.size, replaced.lastModified]).toEqual([original.name, original.size, original.lastModified]);
    const decodeAudioData = vi.fn()
      .mockRejectedValueOnce(encodingError())
      .mockResolvedValueOnce(decodedBuffer);
    const service = serviceWith(decodeAudioData);

    await expect(proxyDecode(original, service, [])).rejects.toBeTruthy();
    await expect(proxyDecode(replaced, service, [])).resolves.toMatchObject({ buffer: decodedBuffer });
    expect(decodeAudioData).toHaveBeenCalledTimes(2);
  });
});
