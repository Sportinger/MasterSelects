import { describe, expect, it } from 'vitest';
import { detectBreaths } from '../../../src/services/audio/intelligence/speechMarkers/breathDetection';
import type { AudioSpan } from '../../../src/services/audio/voiceActivityManifest';

const SAMPLE_RATE = 16_000;

function noise(index: number): number {
  let value = (index + 1) * 0x9e3779b1;
  value ^= value >>> 16;
  value = Math.imul(value, 0x85ebca6b);
  value ^= value >>> 13;
  return ((value >>> 0) / 0xffffffff) * 2 - 1;
}

function fillNoise(pcm: Float32Array, start: number, end: number, amplitude: number): void {
  const first = Math.round(start * SAMPLE_RATE);
  const last = Math.round(end * SAMPLE_RATE);
  for (let index = first; index < last; index += 1) {
    const progress = (index - first) / Math.max(1, last - first - 1);
    const envelope = Math.sin(Math.PI * progress) ** 0.35;
    pcm[index] = noise(index) * amplitude * envelope;
  }
}

// Breaths are band-limited, not white: a one-pole low-pass keeps the spectral
// centroid inside the detector's 400-4000 Hz acceptance band.
function fillBreathNoise(pcm: Float32Array, start: number, end: number, amplitude: number): void {
  const first = Math.round(start * SAMPLE_RATE);
  const last = Math.round(end * SAMPLE_RATE);
  let filtered = 0;
  for (let index = first; index < last; index += 1) {
    const progress = (index - first) / Math.max(1, last - first - 1);
    const envelope = Math.sin(Math.PI * progress) ** 0.35;
    filtered = 0.6 * filtered + 0.4 * noise(index);
    pcm[index] = filtered * amplitude * envelope;
  }
}

describe('detectBreaths', () => {
  it('detects broadband gap energy but rejects pitched and empty gaps', () => {
    const pcm = new Float32Array(SAMPLE_RATE * 5);
    const vadSegments: AudioSpan[] = [
      { start: 0.2, end: 1, confidence: 1 },
      { start: 1.5, end: 2.2, confidence: 1 },
      { start: 2.7, end: 3.4, confidence: 1 },
      { start: 3.9, end: 4.7, confidence: 1 },
    ];
    for (const segment of vadSegments) fillNoise(pcm, segment.start, segment.end, 0.3);
    fillBreathNoise(pcm, 1.12, 1.38, 0.07);
    for (let index = Math.round(2.3 * SAMPLE_RATE); index < Math.round(2.6 * SAMPLE_RATE); index += 1) {
      pcm[index] = 0.035 * Math.sin(2 * Math.PI * 220 * index / SAMPLE_RATE);
    }

    const markers = detectBreaths({ pcm, sampleRate: SAMPLE_RATE, vadSegments });

    expect(markers).toHaveLength(1);
    expect(markers[0]?.type).toBe('breath');
    expect(markers[0]?.start).toBeGreaterThanOrEqual(1.1);
    expect(markers[0]?.end).toBeLessThanOrEqual(1.4);
    expect(markers[0]?.evidence?.spectralFlatness).toBeGreaterThan(0.35);
  });
});
