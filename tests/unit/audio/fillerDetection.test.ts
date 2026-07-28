import { describe, expect, it } from 'vitest';
import { detectFillerMarkers } from '../../../src/services/audio/intelligence/speechMarkers/fillerDetection';
import type { TranscriptWord } from '../../../src/types/clipMetadata';

function word(id: string, text: string, start: number, end: number): TranscriptWord {
  return { id, text, start, end };
}

describe('detectFillerMarkers', () => {
  it('finds German fillers, repetition, false start, and a VAD-confirmed long pause', () => {
    const words = [
      word('w1', 'Heute', 0, 0.3),
      word('w2', 'ähm', 0.6, 0.8),
      word('w3', 'gehen', 1.1, 1.4),
      word('w4', 'wir', 1.45, 1.6),
      word('w5', 'ähm', 1.62, 1.8),
      word('w6', 'das', 1.82, 2),
      word('w7', 'das', 2.02, 2.2),
      word('w8', 'i-', 2.3, 2.4),
      word('w9', 'ich', 2.8, 3),
      word('w10', 'weiter', 4.5, 4.8),
    ];
    const markers = detectFillerMarkers({
      words,
      language: 'de',
      vadSegments: [
        { start: 0, end: 3.05, confidence: 1 },
        { start: 4.45, end: 5, confidence: 1 },
      ],
    });

    const fillers = markers.filter((marker) => marker.type === 'filler');
    expect(fillers.map((marker) => marker.confidence)).toEqual([0.85, 0.7]);
    expect(markers.find((marker) => marker.type === 'repetition')?.wordIds).toEqual(['w6']);
    expect(markers.find((marker) => marker.type === 'false-start')?.wordIds).toEqual(['w8']);
    expect(markers.find((marker) => marker.type === 'long-pause')).toMatchObject({
      start: 3,
      end: 4.5,
      confidence: 0.9,
    });
  });

  it('finds an English filler', () => {
    const markers = detectFillerMarkers({
      words: [word('en-1', 'um', 0.2, 0.4)],
      language: 'en-US',
    });
    expect(markers).toEqual([
      expect.objectContaining({ type: 'filler', text: 'um', confidence: 0.85 }),
    ]);
  });
});
