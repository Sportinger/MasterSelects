import { describe, expect, it } from 'vitest';
import { profileRoomTone } from '../../../src/services/audio/intelligence/roomTone/roomToneProfiler';
import { roomToneProfileToFillParams } from '../../../src/services/audio/intelligence/roomTone/roomToneFillParams';
import type { AudioSpan } from '../../../src/services/audio/voiceActivityManifest';

const SAMPLE_RATE = 16_000;
const DURATION = 8;
const VAD_SEGMENTS: AudioSpan[] = [
  { start: 0, end: 1, confidence: 0.99 },
  { start: 2.4, end: 3, confidence: 0.99 },
  { start: 4.4, end: 5, confidence: 0.99 },
  { start: 6.4, end: 8, confidence: 0.99 },
];

function fillRange(
  pcm: Float32Array,
  startSeconds: number,
  endSeconds: number,
  sample: (index: number) => number,
): void {
  const start = Math.round(startSeconds * SAMPLE_RATE);
  const end = Math.round(endSeconds * SAMPLE_RATE);
  for (let index = start; index < end; index += 1) pcm[index] = sample(index);
}

function createSignal(): Float32Array {
  const pcm = new Float32Array(SAMPLE_RATE * DURATION);
  for (const speech of VAD_SEGMENTS) {
    fillRange(pcm, speech.start, speech.end, index =>
      0.2 * Math.sin(2 * Math.PI * 230 * index / SAMPLE_RATE));
  }
  const steadyNoise = (index: number) => 0.003 * (
    Math.sin(2 * Math.PI * 173 * index / SAMPLE_RATE)
    + 0.5 * Math.sin(2 * Math.PI * 431 * index / SAMPLE_RATE)
  );
  fillRange(pcm, 1, 2.4, steadyNoise);
  fillRange(pcm, 3, 4.4, steadyNoise);
  pcm[Math.round(3.7 * SAMPLE_RATE)] = 1;
  fillRange(pcm, 5, 6.4, index =>
    0.018 * Math.sin(2 * Math.PI * 125 * index / SAMPLE_RATE));
  return pcm;
}

describe('profileRoomTone', () => {
  it('ranks steady quiet VAD-negative audio and produces compatible fill ranges', () => {
    const result = profileRoomTone({
      pcm: createSignal(),
      sampleRate: SAMPLE_RATE,
      vadSegments: VAD_SEGMENTS,
    });

    expect(result.candidates).toHaveLength(3);
    expect(result.candidates[0]).toMatchObject({ start: 1, end: 2.4 });
    expect(result.candidates.findIndex(candidate => candidate.start === 3))
      .toBeLessThan(result.candidates.findIndex(candidate => candidate.start === 5));
    for (const candidate of result.candidates) {
      expect(VAD_SEGMENTS.every(
        speech => candidate.end <= speech.start || candidate.start >= speech.end,
      )).toBe(true);
    }
    expect(result.noiseFloor.rmsDbP10).toBeLessThanOrEqual(result.noiseFloor.rmsDbMedian);
    expect(result.noiseFloor.rmsDbMedian).toBeLessThanOrEqual(result.noiseFloor.rmsDbP90);
    expect(result.bandCentersHz.length).toBeGreaterThan(0);
    expect(result.bandAverageDb).toHaveLength(result.bandCentersHz.length);

    const params = roomToneProfileToFillParams(result, 2);
    const parsed = JSON.parse(params.roomToneSourceRanges) as unknown;
    const parserCompatible = Array.isArray(parsed)
      ? parsed
        .map(range => {
          if (!range || typeof range !== 'object') return null;
          const current = range as { start?: unknown; end?: unknown };
          if (typeof current.start !== 'number' || typeof current.end !== 'number') return null;
          return {
            start: Math.min(current.start, current.end),
            end: Math.max(current.start, current.end),
          };
        })
        .filter((range): range is { start: number; end: number } =>
          Boolean(range && range.end > range.start))
      : [];
    expect(parserCompatible).toEqual(result.candidates.slice(0, 2).map(
      candidate => ({ start: candidate.start, end: candidate.end }),
    ));
  });
});
