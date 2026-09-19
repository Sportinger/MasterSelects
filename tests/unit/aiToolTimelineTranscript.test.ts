import { describe, expect, it } from 'vitest';

import { handleGetTimelineTranscript } from '../../src/services/aiTools/handlers/timeline';
import type { TimelineClip, TimelineTrack } from '../../src/types/timeline';

const audioTrack: TimelineTrack = {
  height: 64,
  id: 'audio-track',
  muted: false,
  name: 'Audio 1',
  solo: false,
  type: 'audio',
  visible: true,
};

const audioClip = {
  duration: 4,
  id: 'audio-clip',
  inPoint: 0,
  name: 'Interview',
  outPoint: 4,
  startTime: 10,
  trackId: audioTrack.id,
  transcript: [
    { end: 1, id: 'one', start: 0, text: 'First' },
    { end: 2, id: 'two', start: 1, text: 'page.' },
    { end: 3, id: 'three', start: 2, text: 'Second' },
  ],
} as TimelineClip;

describe('getTimelineTranscript', () => {
  it('returns revision-bound pages in timeline time', async () => {
    const store = {
      clips: [audioClip],
      timelineRevision: 17,
      tracks: [audioTrack],
    } as Parameters<typeof handleGetTimelineTranscript>[1];

    const first = await handleGetTimelineTranscript({ detail: 'words', limit: 2 }, store);
    expect(first).toMatchObject({
      success: true,
      data: {
        complete: false,
        cursor: 0,
        nextCursor: 2,
        returned: 2,
        text: 'First page.',
        timelineRevision: 17,
        totalWordCount: 3,
        words: [
          { text: 'First', timelineStart: 10 },
          { text: 'page.', timelineStart: 11 },
        ],
      },
    });

    const second = await handleGetTimelineTranscript({
      cursor: 2,
      detail: 'segments',
      limit: 2,
      timelineRevision: 17,
    }, store);
    expect(second).toMatchObject({
      success: true,
      data: {
        complete: true,
        nextCursor: null,
        segments: [{ text: 'Second', wordCount: 1 }],
        text: 'Second',
      },
    });
  });

  it('rejects invalid pagination instead of silently widening it', async () => {
    const store = {
      clips: [audioClip],
      timelineRevision: 17,
      tracks: [audioTrack],
    } as Parameters<typeof handleGetTimelineTranscript>[1];

    await expect(handleGetTimelineTranscript({ limit: 5_001 }, store))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining('5000') });
    await expect(handleGetTimelineTranscript({ cursor: 4 }, store))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining('available') });
    await expect(handleGetTimelineTranscript({ cursor: 2, timelineRevision: 16 }, store))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining('cursor 0') });
  });
});
