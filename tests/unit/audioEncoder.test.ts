import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AudioEncoderWrapper,
  DEFAULT_AUDIO_BITRATE,
  getChromiumCompatibleAACBitrate,
} from '../../src/engine/audio/AudioEncoder';

interface MockAudioEncoderRuntime {
  configured: AudioEncoderConfig[];
  isConfigSupported: ReturnType<typeof vi.fn>;
}

function installAudioEncoderMock(
  supports: (config: AudioEncoderConfig) => boolean,
): MockAudioEncoderRuntime {
  const configured: AudioEncoderConfig[] = [];
  const isConfigSupported = vi.fn(async (config: AudioEncoderConfig) => ({
    supported: supports(config),
    config,
  }));

  class MockAudioEncoder {
    static isConfigSupported = isConfigSupported;

    constructor(_init: AudioEncoderInit) {}

    configure(config: AudioEncoderConfig): void {
      configured.push(config);
    }

    encode(): void {}
    close(): void {}
    reset(): void {}
    flush(): Promise<void> {
      return Promise.resolve();
    }
  }

  vi.stubGlobal('AudioEncoder', MockAudioEncoder);
  return { configured, isConfigSupported };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AudioEncoderWrapper AAC defaults', () => {
  it('detects AAC with the Chrome-compatible 192 kbps default before Opus', async () => {
    const runtime = installAudioEncoderMock((config) => (
      config.codec === 'mp4a.40.2' && config.bitrate === DEFAULT_AUDIO_BITRATE
    ));

    await expect(AudioEncoderWrapper.detectSupportedCodec()).resolves.toEqual({
      codec: 'aac',
      codecString: 'mp4a.40.2',
    });
    expect(runtime.isConfigSupported).toHaveBeenCalledWith(expect.objectContaining({
      codec: 'mp4a.40.2',
      bitrate: 192_000,
      sampleRate: 48_000,
      numberOfChannels: 2,
    }));
    expect(runtime.isConfigSupported).not.toHaveBeenCalledWith(expect.objectContaining({ codec: 'opus' }));
  });

  it('falls back from an unsupported requested AAC bitrate to 192 kbps', async () => {
    const runtime = installAudioEncoderMock((config) => (
      config.codec === 'mp4a.40.2' && config.bitrate === 192_000
    ));
    const encoder = new AudioEncoderWrapper({
      sampleRate: 48_000,
      numberOfChannels: 2,
      bitrate: 320_000,
      codec: 'aac',
    });

    await expect(encoder.init()).resolves.toBe(true);
    expect(runtime.configured.at(-1)).toEqual(expect.objectContaining({
      codec: 'mp4a.40.2',
      bitrate: 192_000,
    }));
    expect(encoder.getSettings()).toEqual(expect.objectContaining({
      codec: 'aac',
      bitrate: 192_000,
    }));
  });

  it('maps arbitrary AAC requests to a bitrate accepted by Chromium', () => {
    expect(getChromiumCompatibleAACBitrate(320_000)).toBe(192_000);
    expect(getChromiumCompatibleAACBitrate(160_000)).toBe(160_000);
    expect(getChromiumCompatibleAACBitrate(110_000)).toBe(96_000);
  });
});
