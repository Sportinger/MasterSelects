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
        sourceRange: { startSeconds: 10, endSeconds: 10.4 },
        evidence: { transcript: 'Ein' },
        confidence: 1,
        indexVersion: TRANSCRIPT_MOMENT_INDEX_VERSION,
        analysisSources: ['transcript'],
      },
      {
        schemaVersion: 1,
        handle: '$m2',
        source: { mediaId: 'media-1' },
        sourceRange: { startSeconds: 10.4, endSeconds: 10.9 },
        evidence: { transcript: 'guter Moment.' },
        confidence: 1,
        indexVersion: TRANSCRIPT_MOMENT_INDEX_VERSION,
        analysisSources: ['transcript'],
      },
      {
        schemaVersion: 1,
        handle: '$m3',
        source: { mediaId: 'media-1' },
        sourceRange: { startSeconds: 12, endSeconds: 12.5 },
        evidence: { transcript: 'Weiter.' },
        confidence: 1,
        indexVersion: TRANSCRIPT_MOMENT_INDEX_VERSION,
        analysisSources: ['transcript'],
      },
    ]);
    expect(executor).toHaveBeenCalledTimes(2);
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

    expect(moments).toHaveLength(TRANSCRIPT_MOMENT_WORD_CAP);
    expect(moments.at(-1)).toMatchObject({
      handle: '$m400',
      evidence: { transcript: 'word-400' },
    });
    expect(executor).toHaveBeenCalledTimes(4);
    expect(executor.mock.calls.at(-1)?.[0]?.[0]?.args).toMatchObject({
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
