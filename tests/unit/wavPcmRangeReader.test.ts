import { describe, expect, it, vi } from 'vitest';

import { encodeAudioBufferToWavBytes } from '../../src/engine/audio/AudioFileEncoder';
import {
  createUrlAudioByteRangeSource,
  readWavPcmAudioRange,
  type AudioByteRangeSource,
} from '../../src/engine/audio/exportPipeline/WavPcmRangeReader';

function createTestWav(): Uint8Array {
  const left = Float32Array.from([0, 0.25, 0.5, 0.75, -1, -0.5, 0.1, 0.2]);
  const right = Float32Array.from([1, 0.5, 0, -0.5, -1, -0.25, 0.3, 0.4]);
  return encodeAudioBufferToWavBytes({
    sampleRate: 4,
    numberOfChannels: 2,
    length: left.length,
    getChannelData: channel => channel === 0 ? left : right,
  });
}

describe('WavPcmRangeReader', () => {
  it('reads and decodes only the requested PCM frames', async () => {
    const wav = createTestWav();
    const reads: Array<[number, number]> = [];
    const source: AudioByteRangeSource = {
      size: wav.byteLength,
      async read(start, endExclusive) {
        reads.push([start, endExclusive]);
        return wav.slice(start, endExclusive).buffer;
      },
    };

    const buffer = await readWavPcmAudioRange(source, 0.5, 1.5);

    expect(buffer.sampleRate).toBe(4);
    expect(buffer.numberOfChannels).toBe(2);
    expect(buffer.length).toBe(4);
    expect(Array.from(buffer.getChannelData(0))).toEqual([
      expect.closeTo(0.5, 4),
      expect.closeTo(0.75, 4),
      expect.closeTo(-1, 4),
      expect.closeTo(-0.5, 4),
    ]);
    expect(Array.from(buffer.getChannelData(1))).toEqual([
      expect.closeTo(0, 4),
      expect.closeTo(-0.5, 4),
      expect.closeTo(-1, 4),
      expect.closeTo(-0.25, 4),
    ]);
    expect(reads).toEqual([
      [0, wav.byteLength],
      [52, 68],
    ]);
  });

  it('rejects a large URL response when the server ignores Range', async () => {
    const cancel = vi.fn(async () => undefined);
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(256 * 1024 * 1024));
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Headers({
        'content-length': String(256 * 1024 * 1024),
      }),
      body: { cancel },
      arrayBuffer,
    })));

    const source = createUrlAudioByteRangeSource('blob:test-proxy');

    await expect(source.read(0, 64 * 1024)).rejects.toThrow(
      /does not support safe byte-range reads/,
    );
    expect(cancel).toHaveBeenCalledOnce();
    expect(arrayBuffer).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});
