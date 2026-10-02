import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadMp4ForWebCodecs } from '../../src/engine/webcodecs/mp4DemuxLoader';

afterEach(() => vi.unstubAllGlobals());

describe('MP4 decoder selection', () => {
  it.each([undefined, 'prefer-software', 'prefer-hardware'] as const)(
    'checks the requested %s acceleration without requiring unavailable hardware by default',
    async (hardwareAcceleration) => {
      const isConfigSupported = vi.fn(async (config: VideoDecoderConfig) => ({
        config,
        supported: config.hardwareAcceleration !== 'prefer-hardware',
      }));
      vi.stubGlobal('VideoDecoder', { isConfigSupported });
      const file = await readFile('public/masterselects_github.mp4');
      const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
      const onTrackReady = vi.fn();
      const onConfigSupported = vi.fn();
      const onSamples = vi.fn();
      const loading = loadMp4ForWebCodecs(buffer, {
        hardwareAcceleration,
        log: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), time: () => vi.fn() },
        onMp4FileCreated: vi.fn(),
        onTrackReady,
        onConfigSupported,
        onSamples,
        onError: vi.fn(),
      });
      if (hardwareAcceleration === 'prefer-hardware') {
        await expect(loading).rejects.toThrow(/Codec .* not supported/);
        expect(onConfigSupported).not.toHaveBeenCalled();
      } else {
        await expect(loading).resolves.toBeUndefined();
        expect(onConfigSupported).toHaveBeenCalledOnce();
      }
      expect(isConfigSupported).toHaveBeenCalledWith(expect.objectContaining({
        hardwareAcceleration: hardwareAcceleration ?? 'no-preference',
      }));
      expect(onTrackReady).toHaveBeenCalledOnce();
      expect(onSamples).toHaveBeenCalled();
    },
  );
});
