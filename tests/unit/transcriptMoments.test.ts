import { describe, expect, it, vi } from 'vitest';
import type {
  AIToolCallExecution,
  AIToolCallExecutionResult,
} from '../../src/services/aiTools';
import {
  buildTranscriptMoments,
  TRANSCRIPT_MOMENT_INDEX_VERSION,
  TRANSCRIPT_MOMENT_WORD_CAP,
} from '../../src/services/kernelClient/transcriptMoments';

function transcriptSnapshot(hasTranscript = true) {
  return {
    videoTracks: [{
      id: 'video-1',
      clips: [{
        id: 'clip-1',
        mediaId: 'media-1',
        inPoint: 10,
        outPoint: 30,
        hasTranscript,
      }],
    }],
    audioTracks: [],
  };
}

describe('transcript moments', () => {
  it('follows transcript pages and converts timed segments to source moments', async () => {
    const executor = vi.fn(async (
      calls: AIToolCallExecution[],
    ): Promise<AIToolCallExecutionResult[]> => {
      const tool = calls[0]?.tool;
      if (tool === 'getSpeechMarkers') {
        return [{
          id: calls[0]?.id,
          tool,
          result: {
            success: true,
            data: { hasMarkers: false, hasMore: false, markers: [] },
          },
        }];
      }
      const offset = calls[0]?.args.offset;
      return [{
        id: calls[0]?.id,
        tool: 'getClipTranscript',
        result: {
          success: true,
          data: offset === 0
            ? {
                hasTranscript: true,
                hasMore: true,
                nextOffset: 2,
                segments: [
                  { start: 10, end: 10.4, text: 'Ein' },
                  { start: 10.4, end: 10.9, text: 'guter Moment.' },
                ],
              }
            : {
                hasTranscript: true,
                hasMore: false,
                nextOffset: null,
                segments: [{ start: 12, end: 12.5, text: 'Weiter.' }],
              },
        },
      }];
    });

    await expect(buildTranscriptMoments(transcriptSnapshot(), executor)).resolves.toEqual([
      {
        schemaVersion: 1,
        handle: '$m1',
        source: { mediaId: 'media-1' },
        sourceRange: { startSeconds: 10, endSeconds: 10.9 },
        evidence: {
          transcript: 'Ein guter Moment.',
          words: [
            { text: 'Ein', startSeconds: 10, endSeconds: 10.4 },
            {
              text: 'guter',
              startSeconds: 10.4,
              endSeconds: 10.4 + (0.5 * 5) / 11,
            },
            {
              text: 'Moment.',
              startSeconds: 10.4 + (0.5 * 5) / 11,
              endSeconds: 10.9,
            },
          ],
        },
        confidence: 1,
        indexVersion: TRANSCRIPT_MOMENT_INDEX_VERSION,
        analysisSources: ['transcript'],
      },
      {
        schemaVersion: 1,
        handle: '$m2',
        source: { mediaId: 'media-1' },
        sourceRange: { startSeconds: 12, endSeconds: 12.5 },
        evidence: {
          transcript: 'Weiter.',
          words: [{ text: 'Weiter.', startSeconds: 12, endSeconds: 12.5 }],
        },
        confidence: 1,
        indexVersion: TRANSCRIPT_MOMENT_INDEX_VERSION,
        analysisSources: ['transcript'],
      },
    ]);
    // Two transcript pages plus the trailing speech-marker read (v2).
    expect(executor).toHaveBeenCalledTimes(3);
    expect(executor).toHaveBeenNthCalledWith(2, [{
      id: 'kernel-transcript-clip-1-2',
      tool: 'getClipTranscript',
      args: {
        clipId: 'clip-1',
        sourceStart: 10,
        sourceEnd: 30,
        offset: 2,
        limit: 120,
        includeSegments: true,
      },
    }], 'chat', {
      guidedReplay: false,
      suppressHistory: true,
    });
  });

  it('stops paging at the 400-word hard cap', async () => {
    const words = Array.from({ length: 450 }, (_, index) => ({
      start: index,
      end: index + 0.5,
      text: `word-${index + 1}`,
    }));
    const executor = vi.fn(async (
      calls: AIToolCallExecution[],
    ): Promise<AIToolCallExecutionResult[]> => {
      const tool = calls[0]?.tool;
      if (tool === 'getSpeechMarkers') {
        return [{
          id: calls[0]?.id,
          tool,
          result: {
            success: true,
            data: { hasMarkers: false, hasMore: false, markers: [] },
          },
        }];
      }
      const offset = calls[0]?.args.offset as number;
      const limit = calls[0]?.args.limit as number;
      const segments = words.slice(offset, offset + limit);
      const nextOffset = offset + segments.length;
      return [{
        id: calls[0]?.id,
        tool: 'getClipTranscript',
        result: {
          success: true,
          data: {
            hasTranscript: true,
            hasMore: nextOffset < words.length,
            nextOffset,
            segments,
          },
        },
      }];
    });

    const moments = await buildTranscriptMoments(transcriptSnapshot(), executor);
    const indexedWords = moments.flatMap(moment => moment.evidence.words ?? []);

    expect(moments).toHaveLength(50);
    expect(indexedWords).toHaveLength(TRANSCRIPT_MOMENT_WORD_CAP);
    expect(moments.at(-1)).toMatchObject({
      handle: '$m50',
      sourceRange: { startSeconds: 392, endSeconds: 399.5 },
      evidence: {
        transcript: [
          'word-393',
          'word-394',
          'word-395',
          'word-396',
          'word-397',
          'word-398',
          'word-399',
          'word-400',
        ].join(' '),
      },
    });
    expect(indexedWords.at(-1)).toEqual({
      text: 'word-400',
      startSeconds: 399,
      endSeconds: 399.5,
    });
    // Four transcript pages plus the trailing speech-marker read (v2).
    expect(executor).toHaveBeenCalledTimes(5);
    const transcriptCalls = executor.mock.calls.filter(
      call => call[0]?.[0]?.tool === 'getClipTranscript',
    );
    expect(transcriptCalls.at(-1)?.[0]?.[0]?.args).toMatchObject({
      offset: 360,
      limit: 40,
    });
  });

  it('returns no moments when the transcript handler reports an empty transcript', async () => {
    const executor = vi.fn(async (): Promise<AIToolCallExecutionResult[]> => [{
      tool: 'getClipTranscript',
      result: {
        success: true,
        data: { hasTranscript: false },
      },
    }]);

    await expect(buildTranscriptMoments(transcriptSnapshot(), executor)).resolves.toEqual([]);
    expect(executor).toHaveBeenCalledTimes(1);
  });
});
