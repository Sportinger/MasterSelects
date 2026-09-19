import { describe, expect, it } from 'vitest';
import { handleGetMediaTranscript } from '../../src/services/aiTools/handlers/media/library';

function storeWithTranscript() {
  return {
    files: [{
      id: 'media-a',
      name: 'Source A.mp4',
      type: 'video',
      transcriptStatus: 'ready',
      transcriptCoverage: 1,
      transcript: [
        { id: 'w2', text: 'world', start: 0.4, end: 0.8, speaker: 'Speaker 1' },
        { id: 'w1', text: 'Hello', start: 0, end: 0.3, confidence: 0.99 },
        { id: 'w3', text: 'again', start: 0.9, end: 1.2 },
      ],
    }],
  } as never;
}

describe('getMediaTranscript', () => {
  it('returns deterministic word pages for media outside the timeline', async () => {
    const first = await handleGetMediaTranscript({
      mediaFileId: 'media-a',
      cursor: 0,
      limit: 2,
    }, storeWithTranscript());
    expect(first).toEqual({
      success: true,
      data: {
        mediaFileId: 'media-a',
        mediaName: 'Source A.mp4',
        status: 'ready',
        transcriptCoverage: 1,
        totalWordCount: 3,
        cursor: 0,
        limit: 2,
        nextCursor: 2,
        complete: false,
        words: [
          { id: 'w1', text: 'Hello', start: 0, end: 0.3, confidence: 0.99 },
          { id: 'w2', text: 'world', start: 0.4, end: 0.8, speaker: 'Speaker 1' },
        ],
      },
    });

    const last = await handleGetMediaTranscript({
      mediaFileId: 'media-a',
      cursor: 2,
      limit: 2,
    }, storeWithTranscript());
    expect(last.success).toBe(true);
    expect(last.data).toEqual(expect.objectContaining({ complete: true, nextCursor: null }));
  });

  it('reports non-ready state without inventing transcript content', async () => {
    const result = await handleGetMediaTranscript({ mediaFileId: 'media-a' }, {
      files: [{ id: 'media-a', name: 'Source A.mp4', type: 'video', transcriptStatus: 'transcribing' }],
    } as never);
    expect(result.success).toBe(false);
    expect(result.data).toEqual(expect.objectContaining({ status: 'transcribing' }));
  });
});
