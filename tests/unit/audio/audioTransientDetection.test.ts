import { describe, expect, it, vi } from 'vitest';
import {
  detectAudioTransientRanges,
  detectClipTransientRanges,
} from '../../../src/services/audio/audioTransientDetection';
import { createMockClip } from '../../helpers/mockData';

function createMockAudioBuffer(channels: number[][], sampleRate = 1000): AudioBuffer {
  const channelData = channels.map(samples => Float32Array.from(samples));
  const length = channelData[0]?.length ?? 0;
  return {
    numberOfChannels: channelData.length,
    sampleRate,
    length,
    duration: length / sampleRate,
    getChannelData: vi.fn((channelIndex: number) => channelData[channelIndex]),
  } as unknown as AudioBuffer;
}

describe('audioTransientDetection', () => {
  it('detects isolated high-crest transients without flagging steady tone', () => {
    const samples = Array.from({ length: 1000 }, (_, index) => Math.sin(index / 8) * 0.05);
    samples[250] = 1;
    samples[700] = -0.9;

    const ranges = detectAudioTransientRanges(createMockAudioBuffer([samples]), {
      crestThresholdDb: 16,
      minPeakDb: -6,
      windowSeconds: 0.012,
      hopSeconds: 0.004,
      paddingSeconds: 0.01,
    });

    expect(ranges).toHaveLength(2);
    expect(ranges[0]).toMatchObject({
      start: expect.closeTo(0.24, 3),
      end: expect.closeTo(0.261, 3),
    });
    expect(ranges[0].crestDb).toBeGreaterThan(16);
    expect(ranges[1].start).toBeGreaterThan(0.68);
  });

  it('maps clip-local transient ranges back into source time', async () => {
    const sourceBuffer = createMockAudioBuffer([[0, 0, 0, 0, 1, 0, 0, 0]], 4);
    const clipBuffer = createMockAudioBuffer([[0, 0, 1, 0]], 4);
    const extractor = {
      extractAudio: vi.fn(async () => sourceBuffer),
      trimBuffer: vi.fn(() => clipBuffer),
    };
    const clip = createMockClip({
      id: 'clip-transient',
      file: new File([], 'dialog.wav', { type: 'audio/wav' }),
      source: { type: 'audio', naturalDuration: 2 },
      duration: 1,
      inPoint: 1,
      outPoint: 2,
    });

    const ranges = await detectClipTransientRanges(clip, {
      crestThresholdDb: 6,
      minPeakDb: -3,
      windowSeconds: 0.5,
      hopSeconds: 0.25,
      paddingSeconds: 0.25,
    }, extractor);

    expect(extractor.trimBuffer).toHaveBeenCalledWith(sourceBuffer, 1, 2);
    expect(ranges[0]?.start).toBeGreaterThanOrEqual(1);
    expect(ranges[0]?.end).toBeLessThanOrEqual(2);
  });
});
