import { describe, expect, it } from 'vitest';
import type { TranscriptWord } from '../../src/types';
import {
  buildTranscriptSpeakerSegments,
  findActiveTranscriptWordIndex,
  findTranscriptTimelineOffset,
  formatTranscriptTimestamp,
  getTranscriptSpeakerTone,
} from '../../src/components/panels/properties/transcriptSegments';

function word(
  id: string,
  text: string,
  start: number,
  end: number,
  speaker?: string,
): TranscriptWord {
  return { id, text, start, end, speaker };
}

describe('transcriptSegments', () => {
  it('keeps chronological speaker turns and their ordered word indexes', () => {
    const segments = buildTranscriptSpeakerSegments([
      word('word-2', 'Later.', 2, 2.4, 'Speaker 1'),
      word('word-0', 'Hello', 0, 0.4, 'Speaker 1'),
      word('word-1', 'there.', 0.5, 0.9, 'Speaker 2'),
    ]);

    expect(segments.map(segment => ({
      speaker: segment.speaker,
      startWordIndex: segment.startWordIndex,
      endWordIndex: segment.endWordIndex,
      text: segment.words.map(item => item.text).join(' '),
    }))).toEqual([
      { speaker: 'Speaker 1', startWordIndex: 0, endWordIndex: 0, text: 'Hello' },
      { speaker: 'Speaker 2', startWordIndex: 1, endWordIndex: 1, text: 'there.' },
      { speaker: 'Speaker 1', startWordIndex: 2, endWordIndex: 2, text: 'Later.' },
    ]);
  });

  it('finds the active word by ordered index even when persisted IDs repeat', () => {
    const transcript = [
      word('word-0', 'First', 0, 0.4, 'Speaker 1'),
      word('word-0', 'Second', 5, 5.4, 'Speaker 1'),
    ];

    expect(findActiveTranscriptWordIndex(transcript, 0.2)).toBe(0);
    expect(findActiveTranscriptWordIndex(transcript, 5.2)).toBe(1);
    expect(findActiveTranscriptWordIndex(transcript, 3)).toBeNull();
  });

  it('prefers aligned timings for active-word lookup', () => {
    const transcript = [{
      ...word('word-0', 'Aligned', 0, 0.4),
      alignedStart: 1,
      alignedEnd: 1.4,
      alignmentConfidence: 0.9,
    }];

    expect(findActiveTranscriptWordIndex(transcript, 0.2)).toBeNull();
    expect(findActiveTranscriptWordIndex(transcript, 1.2)).toBe(0);
  });

  it('keeps provider-timing lookup unchanged without usable alignment', () => {
    const rawTranscript = [word('word-0', 'Raw', 0, 0.4)];
    const lowConfidenceTranscript = [{
      ...rawTranscript[0],
      alignedStart: 1,
      alignedEnd: 1.4,
      alignmentConfidence: 0.29,
    }];

    for (const sourceTime of [0, 0.2, 0.4, 0.5]) {
      expect(findActiveTranscriptWordIndex(lowConfidenceTranscript, sourceTime))
        .toBe(findActiveTranscriptWordIndex(rawTranscript, sourceTime));
    }
  });

  it('uses a stable visual tone for each speaker label', () => {
    expect(getTranscriptSpeakerTone('Speaker 1')).toBe(getTranscriptSpeakerTone('Speaker 1'));
    expect(getTranscriptSpeakerTone('Speaker 1')).toBeGreaterThanOrEqual(0);
    expect(getTranscriptSpeakerTone('Speaker 1')).toBeLessThan(6);
  });

  it('maps source timestamps back to timeline offsets at normal and reverse speed', () => {
    expect(findTranscriptTimelineOffset(14, 10, 5, timeline => timeline * 2)).toBeCloseTo(2, 5);
    expect(findTranscriptTimelineOffset(6, 10, 5, timeline => timeline * -2)).toBeCloseTo(2, 5);
  });

  it('finds the nearest position on a non-monotonic speed map', () => {
    const offset = findTranscriptTimelineOffset(
      3,
      0,
      4,
      timeline => 4 - ((timeline - 2) ** 2),
    );

    expect(Math.min(Math.abs(offset - 1), Math.abs(offset - 3))).toBeLessThan(0.001);
  });

  it('formats compact timestamps with tenths', () => {
    expect(formatTranscriptTimestamp(65.94)).toBe('01:05.9');
    expect(formatTranscriptTimestamp(3661.09)).toBe('01:01:01.0');
  });
});
