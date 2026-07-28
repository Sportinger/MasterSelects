import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { handleCutRangesFromClip } from '../../src/services/aiTools/handlers/clips/delete';
import { handleTrimClip } from '../../src/services/aiTools/handlers/clips/edit';
import { handleSplitClipAtTimes } from '../../src/services/aiTools/handlers/clips/split';
import type { ToolResult } from '../../src/services/aiTools/types';
import { useTimelineStore } from '../../src/stores/timeline';
import { createMockClip, createMockTrack } from '../helpers/mockData';

const initialTimelineState = useTimelineStore.getState();

interface ClipEntityResultData {
  stateRevisionBefore: number;
  stateRevisionAfter: number;
  entities: {
    created: Array<{ kind: 'clip'; id: string }>;
    updated: Array<{ kind: 'clip'; id: string }>;
    deleted: Array<{ kind: 'clip'; id: string }>;
  };
}

describe('AI tool clip entity results', () => {
  beforeEach(() => {
    useTimelineStore.setState(initialTimelineState);
    seedLinkedClips();
  });

  afterEach(() => {
    useTimelineStore.setState(initialTimelineState);
  });

  it('returns every created linked clip part and increasing revisions for multi-split', async () => {
    const result = await handleSplitClipAtTimes(
      { clipId: 'video-1', times: [3, 7], withLinked: true },
      useTimelineStore.getState(),
    );
    const data = getEntityResultData(result);

    expect(data.entities.created.length).toBeGreaterThanOrEqual(4);
    expect(data.entities.created.every((entity) => entity.kind === 'clip')).toBe(true);
    expect(data.entities.deleted).toHaveLength(0);
    expect(data.stateRevisionAfter).toBeGreaterThan(data.stateRevisionBefore);
  });

  it('reports the identity-changed trim target without creating clips', async () => {
    const result = await handleTrimClip(
      { clipId: 'video-1', inPoint: 1, outPoint: 9 },
      useTimelineStore.getState(),
    );
    const data = getEntityResultData(result);

    expect(data.entities.updated).toContainEqual({ kind: 'clip', id: 'video-1' });
    expect(data.entities.created).toHaveLength(0);
    expect(data.entities.deleted).toHaveLength(0);
    expect(data.stateRevisionAfter).toBeGreaterThan(data.stateRevisionBefore);
  });

  it('reports the net linked clip entities after cutting one interior range', async () => {
    const result = await handleCutRangesFromClip(
      {
        clipId: 'video-1',
        ranges: [{ timelineStart: 3, timelineEnd: 7 }],
      },
      useTimelineStore.getState(),
    );
    const data = getEntityResultData(result);

    expect(data.entities.created).toHaveLength(4);
    expect(data.entities.updated).toHaveLength(0);
    expect(data.entities.deleted).toHaveLength(2);
    expect(data.stateRevisionAfter).toBeGreaterThan(data.stateRevisionBefore);
  });

  it('ripples linked clips after cutting an interior range when requested', async () => {
    const result = await handleCutRangesFromClip(
      {
        clipId: 'video-1',
        ranges: [
          { timelineStart: 2, timelineEnd: 3 },
          { timelineStart: 6, timelineEnd: 8 },
        ],
        ripple: true,
      },
      useTimelineStore.getState(),
    );

    expect(result.success).toBe(true);
    expect(
      useTimelineStore.getState().clips
        .filter((clip) => clip.trackId === 'video-1')
        .toSorted((a, b) => a.startTime - b.startTime)
        .map((clip) => [clip.startTime, clip.duration, clip.inPoint]),
    ).toEqual([
      [0, 2, 0],
      [2, 3, 3],
      [5, 2, 8],
    ]);
    expect(
      useTimelineStore.getState().clips
        .filter((clip) => clip.trackId === 'audio-1')
        .toSorted((a, b) => a.startTime - b.startTime)
        .map((clip) => [clip.startTime, clip.duration, clip.inPoint]),
    ).toEqual([
      [0, 2, 0],
      [2, 3, 3],
      [5, 2, 8],
    ]);
  });
});

function seedLinkedClips(): void {
  useTimelineStore.setState({
    tracks: [
      createMockTrack({ id: 'video-1', type: 'video' }),
      createMockTrack({ id: 'audio-1', type: 'audio' }),
    ],
    clips: [
      createMockClip({
        id: 'video-1',
        trackId: 'video-1',
        startTime: 0,
        duration: 10,
        inPoint: 0,
        outPoint: 10,
        linkedClipId: 'audio-1',
        source: { type: 'video' },
      }),
      createMockClip({
        id: 'audio-1',
        trackId: 'audio-1',
        startTime: 0,
        duration: 10,
        inPoint: 0,
        outPoint: 10,
        linkedClipId: 'video-1',
        source: { type: 'audio' },
      }),
    ],
    selectedClipIds: new Set(),
    primarySelectedClipId: null,
    isExporting: false,
  });
}

function getEntityResultData(result: ToolResult): ClipEntityResultData {
  expect(result.success).toBe(true);
  return result.data as ClipEntityResultData;
}
