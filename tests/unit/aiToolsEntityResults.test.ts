import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  handleCutRangesFromClip,
  handleDeleteClips,
} from '../../src/services/aiTools/handlers/clips/delete';
import { handleTrimClip } from '../../src/services/aiTools/handlers/clips/edit';
import { handleSplitClipAtTimes } from '../../src/services/aiTools/handlers/clips/split';
import { audioExtractor } from '../../src/engine/audio/AudioExtractor';
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
    vi.restoreAllMocks();
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

  it('refines requested speech boundaries against all decoded audio channels', async () => {
    const left = new Float32Array(10_001).fill(0.5);
    const right = new Float32Array(10_001).fill(-0.5);
    left[3_004] = 0.005;
    right[3_004] = -0.005;
    left[7_006] = -0.004;
    right[7_006] = 0.004;
    vi.spyOn(audioExtractor, 'extractAudio').mockResolvedValue({
      sampleRate: 1_000,
      numberOfChannels: 2,
      length: left.length,
      duration: left.length / 1_000,
      getChannelData: (channel: number) => channel === 0 ? left : right,
    } as unknown as AudioBuffer);

    const result = await handleSplitClipAtTimes(
      {
        clipId: 'video-1',
        times: [3, 7],
        withLinked: true,
        snapToAudioZeroCrossing: true,
      },
      useTimelineStore.getState(),
    );

    expect(result.success).toBe(true);
    expect((result.data as { splitTimes: number[] }).splitTimes).toEqual([3.004, 7.006]);
    expect((result.data as { audioBoundaryResolution: { appliedCount: number } })
      .audioBoundaryResolution.appliedCount).toBe(2);
  });

  it('adds six-millisecond de-click fades to exposed linked-audio edges', async () => {
    const split = await handleSplitClipAtTimes(
      { clipId: 'video-1', times: [3, 7], withLinked: true },
      useTimelineStore.getState(),
    );
    expect(split.success).toBe(true);
    const videoIds = (split.data as { segments: { videoClipIds: string[] } })
      .segments.videoClipIds;

    const result = await handleDeleteClips(
      {
        clipIds: [videoIds[1]],
        withLinked: true,
        deClickFadeSeconds: 0.006,
      },
      useTimelineStore.getState(),
    );

    expect(result.success).toBe(true);
    expect((result.data as { deClickFadesApplied: number }).deClickFadesApplied).toBe(2);
    const audio = useTimelineStore.getState().clips
      .filter((clip) => clip.trackId === 'audio-1')
      .toSorted((leftClip, rightClip) => leftClip.startTime - rightClip.startTime);
    expect(audio).toHaveLength(2);
    expect(audio[0].audioState?.editStack?.at(-1)).toMatchObject({
      type: 'gain',
      params: {
        label: 'Automatic cut de-click',
        gainDb: -120,
        fadeInSeconds: 0.006,
        fadeOutSeconds: 0,
      },
      timeRange: { start: 2.994, end: 3 },
    });
    expect(audio[1].audioState?.editStack?.at(-1)).toMatchObject({
      type: 'gain',
      params: {
        label: 'Automatic cut de-click',
        gainDb: -120,
        fadeInSeconds: 0,
        fadeOutSeconds: 0.006,
      },
      timeRange: { start: 7, end: 7.006 },
    });
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
