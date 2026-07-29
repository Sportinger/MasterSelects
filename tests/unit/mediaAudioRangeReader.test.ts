import { Blob as NodeBlob, File as NodeFile } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';

import { encodeAudioBufferToWavBytes } from '../../src/engine/audio/AudioFileEncoder';
import { MediaAudioRangeReader } from '../../src/engine/audio/exportPipeline/MediaAudioRangeReader';

describe('MediaAudioRangeReader', () => {
  it('decodes only the requested source interval from a media File', async () => {
    const sampleRate = 8;
    const left = Float32Array.from([
      0, 0.1, 0.2, 0.3,
      0.4, 0.5, 0.6, 0.7,
      0.8, 0.9, -1, -0.9,
      -0.8, -0.7, -0.6, -0.5,
    ]);
    const right = Float32Array.from([
      1, 0.9, 0.8, 0.7,
      0.6, 0.5, 0.4, 0.3,
      0.2, 0.1, 0, -0.1,
      -0.2, -0.3, -0.4, -0.5,
    ]);
    const wav = encodeAudioBufferToWavBytes({
      sampleRate,
      numberOfChannels: 2,
      length: left.length,
      getChannelData: channel => channel === 0 ? left : right,
    });
    vi.stubGlobal('Blob', NodeBlob);
    vi.stubGlobal('File', NodeFile);
    const reader = new MediaAudioRangeReader(
      new File([wav], 'source.wav', { type: 'audio/wav' }),
    );

    try {
      const buffer = await reader.read(0.5, 1.5);

      expect(buffer.sampleRate).toBe(sampleRate);
      expect(buffer.numberOfChannels).toBe(2);
      expect(buffer.length).toBe(8);
      expect(Array.from(buffer.getChannelData(0))).toEqual([
        expect.closeTo(0.4, 3),
        expect.closeTo(0.5, 3),
        expect.closeTo(0.6, 3),
        expect.closeTo(0.7, 3),
        expect.closeTo(0.8, 3),
        expect.closeTo(0.9, 3),
        expect.closeTo(-1, 3),
        expect.closeTo(-0.9, 3),
      ]);
      expect(Array.from(buffer.getChannelData(1))).toEqual([
        expect.closeTo(0.6, 3),
        expect.closeTo(0.5, 3),
        expect.closeTo(0.4, 3),
        expect.closeTo(0.3, 3),
        expect.closeTo(0.2, 3),
        expect.closeTo(0.1, 3),
        expect.closeTo(0, 3),
        expect.closeTo(-0.1, 3),
      ]);
    } finally {
      reader.dispose();
      vi.unstubAllGlobals();
    }
  });
});
