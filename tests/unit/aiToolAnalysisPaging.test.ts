import { describe, expect, it } from 'vitest';

import {
  handleGetClipAnalysis,
  handleGetClipTranscript,
} from '../../src/services/aiTools/handlers/analysis';

function createTimelineStore() {
  const frames = Array.from({ length: 300 }, (_, index) => ({
    brightness: 0.5,
    faceCount: index % 2,
    focus: 0.8,
    globalMotion: 0.2,
    localMotion: 0.3,
    motion: index / 300,
    timestamp: index * 0.5,
  }));
  const transcript = Array.from({ length: 300 }, (_, index) => ({
    end: index * 0.5 + 0.4,
    id: `word-${index}`,
    start: index * 0.5,
    text: `word${index}`,
  }));
  return {
    clips: [{
      analysis: { frames, sampleInterval: 500 },
      analysisStatus: 'ready',
      duration: 150,
      id: 'clip-1',
      inPoint: 0,
      outPoint: 150,
      startTime: 0,
      transcript,
    }],
  } as never;
}

describe('AI analysis tools compact paging', () => {
  it('returns analysis summaries without hundreds of frames by default', async () => {
    const result = await handleGetClipAnalysis({ clipId: 'clip-1' }, createTimelineStore());

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      frameCount: 300,
      matchingFrameCount: 300,
      frames: undefined,
      pagination: {
        detailIncluded: false,
        returned: 0,
      },
    });
  });

  it('returns a bounded analysis frame page for a source range', async () => {
    const result = await handleGetClipAnalysis({
      clipId: 'clip-1',
      includeFrames: true,
      limit: 5,
      offset: 2,
      sourceEnd: 20,
      sourceStart: 10,
    }, createTimelineStore());
    const data = result.data as {
      frames: Array<{ time: number }>;
      pagination: {
        detailIncluded: boolean;
        hasMore: boolean;
        nextOffset: number | null;
        returned: number;
      };
    };

    expect(data.frames).toHaveLength(5);
    expect(data.frames[0].time).toBe(11);
    expect(data.pagination).toMatchObject({
      detailIncluded: true,
      hasMore: true,
      nextOffset: 7,
      returned: 5,
    });
  });

  it('pages long transcripts and exposes continuation metadata', async () => {
    const first = await handleGetClipTranscript({
      clipId: 'clip-1',
      limit: 40,
    }, createTimelineStore());
    const firstData = first.data as {
      fullText: string;
      hasMore: boolean;
      nextOffset: number;
      segmentCount: number;
      segments: Array<{ text: string }>;
    };

    expect(firstData.segmentCount).toBe(300);
    expect(firstData.segments).toHaveLength(40);
    expect(firstData.hasMore).toBe(true);
    expect(firstData.nextOffset).toBe(40);
    expect(firstData.fullText).toContain('word0');
    expect(firstData.fullText).not.toContain('word100');

    const second = await handleGetClipTranscript({
      clipId: 'clip-1',
      limit: 40,
      offset: firstData.nextOffset,
    }, createTimelineStore());
    expect((second.data as { segments: Array<{ text: string }> }).segments[0]?.text).toBe('word40');
  });
});
