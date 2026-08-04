import { describe, expect, it } from 'vitest';

import {
  resolveClipTranscriptWindow,
  resolveClipTranscriptWords,
} from '../../src/services/transcription/clipTranscriptResolver';
import type { TimelineClip } from '../../src/types/timeline';

const transcript = [
  { id: 'before', text: 'before', start: 0, end: 0.5 },
  { id: 'inside-a', text: 'inside', start: 10, end: 10.4 },
  { id: 'inside-b', text: 'window', start: 11, end: 11.5 },
  { id: 'after', text: 'after', start: 20, end: 20.5 },
];

describe('clip transcript resolver', () => {
  it('keeps source ownership while projecting only the current clip window', () => {
    const clip = {
      inPoint: 9.5,
      outPoint: 12,
      transcript,
      mediaFileId: 'media-1',
      source: { type: 'video', mediaFileId: 'media-1' },
    } as TimelineClip;

    expect(resolveClipTranscriptWords(clip)).toBe(transcript);
    expect(resolveClipTranscriptWindow(clip)?.map((word) => word.id)).toEqual([
      'inside-a',
      'inside-b',
    ]);
  });
});
