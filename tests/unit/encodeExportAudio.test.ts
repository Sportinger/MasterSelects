import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeExportAudio, type EncodeExportAudioOptions } from '../../src/engine/audio/exportPipeline/encodeHandOff';
import type { AudioEncoderWrapper } from '../../src/engine/audio/AudioEncoder';

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function setup() {
  const flushing = deferred();
  const flushStarted = deferred();
  const support = vi.fn(async (config: AudioEncoderConfig) => ({ supported: true, config }));
  let isFlushing = false;
  const close = vi.fn(() => {
    if (isFlushing) flushing.reject(new DOMException('Aborted due to close()', 'AbortError'));
  });
  class Encoder {
    static isConfigSupported = support;
    configure() {}
    encode() {}
    close = close;
    flush() { isFlushing = true; flushStarted.resolve(); return flushing.promise; }
  }
  vi.stubGlobal('AudioEncoder', Encoder);
  vi.stubGlobal('AudioData', class { close() {} });
  let cancelled = false;
  let encoder: AudioEncoderWrapper;
  const options: EncodeExportAudioOptions = {
    buffer: { numberOfChannels: 2, sampleRate: 48000, length: 1024,
      duration: 1024 / 48000, getChannelData: () => new Float32Array(1024) } as unknown as AudioBuffer,
    settings: { sampleRate: 48000, bitrate: 192000, normalize: false, codec: 'aac' },
    extractor: {} as EncodeExportAudioOptions['extractor'],
    shouldCancel: () => cancelled,
    setEncoder: value => { encoder = value; },
  };
  return { options, close, support, flushing, flushStarted,
    cancel() { cancelled = true; encoder.cancel(); } };
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('export audio encoder lifetime', () => {
  it('settles an interrupted flush and closes the encoder only once', async () => {
    const run = setup();
    const result = encodeExportAudio(run.options);
    const assertion = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    await run.flushStarted.promise;
    run.cancel();
    await assertion;
    expect(run.close).toHaveBeenCalledTimes(1);
  });

  it('closes an encoder initialized after cancellation without encoding or flushing', async () => {
    const run = setup();
    const initializing = deferred();
    run.support.mockImplementationOnce(async config => {
      await initializing.promise;
      return { supported: true, config };
    });
    const result = encodeExportAudio(run.options);
    run.cancel();
    initializing.resolve();
    await expect(result).resolves.toBeNull();
    expect(run.close).toHaveBeenCalledTimes(1);
  });

  it('preserves an unexpected flush failure and releases the encoder', async () => {
    const run = setup();
    const failure = new DOMException('Codec aborted unexpectedly', 'AbortError');
    const result = encodeExportAudio(run.options);
    const assertion = expect(result).rejects.toBe(failure);
    await run.flushStarted.promise;
    run.flushing.reject(failure);
    await assertion;
    expect(run.close).toHaveBeenCalledTimes(1);
  });

  it('returns successful audio and does not close an already finalized encoder again', async () => {
    const run = setup();
    const result = encodeExportAudio(run.options);
    await run.flushStarted.promise;
    run.flushing.resolve();
    await expect(result).resolves.toMatchObject({ codec: 'aac', duration: 1024 / 48000 });
    expect(run.close).toHaveBeenCalledTimes(1);
  });
});
