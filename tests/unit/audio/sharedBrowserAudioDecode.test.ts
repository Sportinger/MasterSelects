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
import { decodeSourceAudioWithFallbacks } from '../../../src/services/audio/decode/sourceAudioFallbackDecode';
import { isUndecodableAudioSourceError } from '../../../src/services/audio/decode/errors';
import {
  clearSharedBrowserAudioDecodeState,
  runSharedBrowserAudioDecode,
} from '../../../src/services/audio/decode/sharedBrowserAudioDecode';

const sourceBytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
const file = new File([sourceBytes], 'broken_audio.mp3', { type: 'audio/mpeg', lastModified: 1_700_000_000_000 });
// jsdom's File has no arrayBuffer(); the decode service and the waveform path both read through it.
Object.defineProperty(file, 'arrayBuffer', { value: async () => sourceBytes.slice().buffer });
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

/** The two paths an import starts: audio proxy (file source) and source waveform (array buffer + fallbacks). */
function proxyDecode(service: AudioDecodeService, signal?: AbortSignal): Promise<AudioBuffer> {
  return runSharedBrowserAudioDecode(file, () => service.decodeAudioBuffer({ kind: 'file', file }, { signal }), signal);
}

async function waveformDecode(service: AudioDecodeService): Promise<AudioBuffer> {
  const arrayBuffer = await file.arrayBuffer();
  const { buffer } = await decodeSourceAudioWithFallbacks(file, [
    {
      id: 'browser.decodeAudioData',
      decode: () => runSharedBrowserAudioDecode(file, () => service.decodeAudioBuffer({
        kind: 'array-buffer', arrayBuffer, name: file.name, mimeType: file.type,
      })),
    },
    { id: 'ffmpeg.wasm', decode: async () => { throw new Error('FFmpeg exited with code 1'); } },
  ]);
  return buffer;
}

afterEach(() => {
  clearSharedBrowserAudioDecodeState();
  logs.entries.length = 0;
});

describe('runSharedBrowserAudioDecode', () => {
  it('runs decodeAudioData once for an undecodable file and leaves the warning to the clip analysis', async () => {
    const decodeAudioData = vi.fn(async () => {
      throw new DOMException('Unable to decode audio data', 'EncodingError');
    });
    const proxyService = serviceWith(decodeAudioData);
    const waveformService = serviceWith(decodeAudioData);

    const [proxy, waveform] = await Promise.allSettled([proxyDecode(proxyService), waveformDecode(waveformService)]);
    // A later path (e.g. a regenerated waveform) reuses the remembered failure.
    const later = await Promise.allSettled([waveformDecode(waveformService)]);

    expect(decodeAudioData).toHaveBeenCalledTimes(1);
    expect(proxy.status).toBe('rejected');
    expect(waveform.status).toBe('rejected');
    expect(later[0].status).toBe('rejected');
    const proxyError = (proxy as PromiseRejectedResult).reason as Error;
    // The proxy keeps classifying the failure through the original EncodingError cause.
    expect(proxyError.cause).toBeInstanceOf(DOMException);
    // Every layer above sees the known undecodable case and logs it at debug.
    expect(isUndecodableAudioSourceError(proxyError)).toBe(true);
    expect(isUndecodableAudioSourceError((waveform as PromiseRejectedResult).reason)).toBe(true);
    expect(logs.entries.filter(entry => entry.level === 'warn' || entry.level === 'error')).toEqual([]);
    expect(logs.entries).toContainEqual(expect.objectContaining({
      module: 'AudioDecodeService', level: 'debug', message: 'Audio decode job failed',
    }));
  });

  it('hands concurrent callers the same decoded buffer from one decodeAudioData call', async () => {
    let resolveDecode!: (buffer: AudioBuffer) => void;
    const decodeAudioData = vi.fn(() => new Promise<AudioBuffer>(resolve => { resolveDecode = resolve; }));
    const service = serviceWith(decodeAudioData);

    const both = Promise.all([proxyDecode(service), waveformDecode(service)]);
    await vi.waitFor(() => expect(decodeAudioData).toHaveBeenCalled());
    resolveDecode(decodedBuffer);
    const [proxyBuffer, waveformBuffer] = await both;

    expect(decodeAudioData).toHaveBeenCalledTimes(1);
    expect(proxyBuffer).toBe(waveformBuffer);
    // Success is not remembered: the next import decodes again.
    decodeAudioData.mockResolvedValueOnce(decodedBuffer);
    await proxyDecode(service);
    expect(decodeAudioData).toHaveBeenCalledTimes(2);
  });

  it('lets a joined caller decode itself when the owning caller is cancelled', async () => {
    const decodeAudioData = vi.fn()
      .mockImplementationOnce(() => new Promise<AudioBuffer>(() => {}))
      .mockResolvedValueOnce(decodedBuffer);
    const service = serviceWith(decodeAudioData);
    const owner = new AbortController();

    const cancelled = proxyDecode(service, owner.signal);
    await vi.waitFor(() => expect(decodeAudioData).toHaveBeenCalledTimes(1));
    const joined = waveformDecode(service);
    owner.abort('media removed');

    await expect(cancelled).rejects.toMatchObject({ code: 'cancelled' });
    await expect(joined).resolves.toBe(decodedBuffer);
    expect(decodeAudioData).toHaveBeenCalledTimes(2);
  });
});
