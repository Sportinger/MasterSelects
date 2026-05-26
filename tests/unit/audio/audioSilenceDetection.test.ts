import { describe, expect, it, vi } from 'vitest';
import { detectAudioSilenceRanges, detectClipSilenceRanges } from '../../../src/services/audio/audioSilenceDetection';
import { createMockClip } from '../../helpers/mockData';

function createMockAudioBuffer(samples: number[], sampleRate = 10): AudioBuffer {
  const data = Float32Array.from(samples);
  return {
    numberOfChannels: 1,
    sampleRate,
    length: data.length,
    duration: data.length / sampleRate,
    getChannelData: vi.fn(() => data),
  } as unknown as AudioBuffer;
}

describe('audio silence detection', () => {
  it('detects contiguous quiet ranges with threshold and minimum duration controls', () => {
    const buffer = createMockAudioBuffer([
      0.5, 0.5,
      0, 0, 0, 0,
      0.4, 0.4,
      0, 0, 0, 0,
      0.5, 0.5,
    ], 10);

    const ranges = detectAudioSilenceRanges(buffer, {
      thresholdDb: -50,
      minSilenceSeconds: 0.25,
      windowSeconds: 0.1,
      hopSeconds: 0.1,
      paddingSeconds: 0,
      mergeGapSeconds: 0,
    });

    expect(ranges).toHaveLength(2);
    expect(ranges[0].start).toBeCloseTo(0.2);
    expect(ranges[0].end).toBeCloseTo(0.6);
    expect(ranges[0].duration).toBeCloseTo(0.4);
    expect(ranges[1].start).toBeCloseTo(0.8);
    expect(ranges[1].end).toBeCloseTo(1.2);
    expect(ranges[1].duration).toBeCloseTo(0.4);
  });

  it('returns clip source-time ranges after trimming to the clip source span', async () => {
    const sourceBuffer = createMockAudioBuffer([
      0.5, 0.5,
      0, 0, 0, 0,
      0.5, 0.5,
    ], 10);
    const trimmedBuffer = createMockAudioBuffer([0, 0, 0, 0], 10);
    const clip = createMockClip({
      id: 'audio-clip',
      inPoint: 0.2,
      outPoint: 0.6,
      file: new File([], 'dialog.wav', { type: 'audio/wav' }),
      source: { type: 'audio', naturalDuration: 0.8, mediaFileId: 'media-a' },
    });

    const ranges = await detectClipSilenceRanges(clip, {
      thresholdDb: -50,
      minSilenceSeconds: 0.25,
      windowSeconds: 0.1,
      hopSeconds: 0.1,
      paddingSeconds: 0,
    }, {
      extractAudio: vi.fn(async () => sourceBuffer),
      trimBuffer: vi.fn(() => trimmedBuffer),
    });

    expect(ranges).toHaveLength(1);
    expect(ranges[0].start).toBeCloseTo(0.2);
    expect(ranges[0].end).toBeCloseTo(0.6);
    expect(ranges[0].duration).toBeCloseTo(0.4);
  });
});
