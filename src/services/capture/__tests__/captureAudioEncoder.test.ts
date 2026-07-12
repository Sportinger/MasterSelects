import { describe, expect, it, vi } from 'vitest';
import { CaptureAudioEncoder } from '../recording/captureAudioEncoder';

describe('CaptureAudioEncoder', () => {
  it('encodes incremental AudioData, closes inputs, and forwards chunks to the muxer', async () => {
    const addAudioChunk = vi.fn(async () => undefined);
    let init!: AudioEncoderInit;
    class FakeEncoder {
      static async isConfigSupported(config: AudioEncoderConfig) { return { supported: true, config }; }
      encodeQueueSize = 0;
      constructor(next: AudioEncoderInit) { init = next; }
      configure = vi.fn();
      encode = vi.fn(() => init.output({ timestamp: 0 } as EncodedAudioChunk, {}));
      flush = vi.fn(async () => undefined);
      close = vi.fn();
    }
    const encoder = new CaptureAudioEncoder({
      sampleRate: 48_000,
      numberOfChannels: 2,
      bitrate: 192_000,
      muxer: { addAudioChunk },
      Encoder: FakeEncoder,
      detectCodec: async () => ({ codec: 'aac', codecString: 'mp4a.40.2' }),
    });
    expect(await encoder.initialize()).toBe('aac');
    const data = { close: vi.fn() } as unknown as AudioData;
    await encoder.encode(data);
    await Promise.resolve();

    expect(data.close).toHaveBeenCalledOnce();
    expect(addAudioChunk).toHaveBeenCalledOnce();
  });

  it('falls back from an unsupported actual AAC config to Opus', async () => {
    const tested: string[] = [];
    class FakeEncoder {
      static async isConfigSupported(config: AudioEncoderConfig) {
        tested.push(config.codec);
        return { supported: config.codec === 'opus', config };
      }
      encodeQueueSize = 0;
      constructor(_init: AudioEncoderInit) {}
      configure = vi.fn();
      encode = vi.fn();
      flush = vi.fn(async () => undefined);
      close = vi.fn();
    }
    const encoder = new CaptureAudioEncoder({
      sampleRate: 44_100,
      numberOfChannels: 2,
      bitrate: 256_000,
      muxer: { addAudioChunk: async () => undefined },
      Encoder: FakeEncoder,
    });

    expect(await encoder.initialize()).toBe('opus');
    expect(tested).toEqual(['mp4a.40.2', 'opus', 'opus']);
  });

  it('surfaces a synchronous mux failure from the encoder output callback', async () => {
    let init!: AudioEncoderInit;
    class FakeEncoder {
      static async isConfigSupported(config: AudioEncoderConfig) { return { supported: true, config }; }
      encodeQueueSize = 0;
      constructor(next: AudioEncoderInit) { init = next; }
      configure() {}
      encode() { init.output({ timestamp: 0 } as EncodedAudioChunk, {}); }
      async flush() {}
      close() {}
    }
    const encoder = new CaptureAudioEncoder({
      sampleRate: 48_000,
      numberOfChannels: 2,
      bitrate: 192_000,
      muxer: { addAudioChunk: () => { throw new Error('mux failed'); } },
      Encoder: FakeEncoder,
      detectCodec: async () => ({ codec: 'aac', codecString: 'mp4a.40.2' }),
    });
    await encoder.initialize();
    await encoder.encode({ close: vi.fn() } as unknown as AudioData);
    await Promise.resolve();

    await expect(encoder.flush()).rejects.toThrow('mux failed');
  });
});
