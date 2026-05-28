import { beforeEach, describe, expect, it } from 'vitest';

import { useTimelineStore } from '../../src/stores/timeline';
import { DEFAULT_TRACKS } from '../../src/stores/timeline/constants';
import { createMockClip, createMockTrack } from '../helpers/mockData';

describe('timeline edit operations kernel', () => {
  beforeEach(() => {
    useTimelineStore.setState({
      tracks: DEFAULT_TRACKS,
      clips: [],
      selectedClipIds: new Set(),
      primarySelectedClipId: null,
      playheadPosition: 0,
      isExporting: false,
      duration: 60,
    });
  });

  it('blocks mutating operations while export is active', () => {
    useTimelineStore.setState({
      isExporting: true,
      clips: [createMockClip({ id: 'clip-1', startTime: 0, duration: 10, outPoint: 10 })],
    });

    const result = useTimelineStore.getState().applyTimelineEditOperation({
      id: 'split-export-test',
      type: 'split-at-time',
      clipIds: ['clip-1'],
      time: 5,
    }, { source: 'ui' });

    expect(result.success).toBe(false);
    expect(result.warnings[0]?.code).toBe('export-locked');
    expect(useTimelineStore.getState().clips).toHaveLength(1);
  });

  it('routes split at playhead through one operation result and avoids linked duplicates', () => {
    const video = createMockClip({
      id: 'video-1',
      trackId: 'video-1',
      startTime: 0,
      duration: 10,
      inPoint: 0,
      outPoint: 10,
      linkedClipId: 'audio-1',
    });
    const audio = createMockClip({
      id: 'audio-1',
      trackId: 'audio-1',
      startTime: 0,
      duration: 10,
      inPoint: 0,
      outPoint: 10,
      linkedClipId: 'video-1',
      source: { type: 'audio' },
    });
    useTimelineStore.setState({
      tracks: [
        createMockTrack({ id: 'video-1', type: 'video' }),
        createMockTrack({ id: 'audio-1', type: 'audio' }),
      ],
      clips: [video, audio],
      selectedClipIds: new Set(['video-1', 'audio-1']),
      playheadPosition: 4,
    });

    useTimelineStore.getState().splitClipAtPlayhead();

    const clips = useTimelineStore.getState().clips;
    expect(clips).toHaveLength(4);
    expect(clips.filter((clip) => clip.trackId === 'video-1')).toHaveLength(2);
    expect(clips.filter((clip) => clip.trackId === 'audio-1')).toHaveLength(2);
  });

  it('bulk splits one linked clip through the operation kernel', () => {
    const video = createMockClip({
      id: 'video-1',
      trackId: 'video-1',
      startTime: 0,
      duration: 12,
      inPoint: 0,
      outPoint: 12,
      linkedClipId: 'audio-1',
    });
    const audio = createMockClip({
      id: 'audio-1',
      trackId: 'audio-1',
      startTime: 0,
      duration: 12,
      inPoint: 0,
      outPoint: 12,
      linkedClipId: 'video-1',
      source: { type: 'audio' },
    });
    useTimelineStore.setState({
      tracks: [
        createMockTrack({ id: 'video-1', type: 'video' }),
        createMockTrack({ id: 'audio-1', type: 'audio' }),
      ],
      clips: [video, audio],
    });

    const result = useTimelineStore.getState().applyTimelineEditOperation({
      id: 'bulk-split',
      type: 'split-at-times',
      clipId: 'video-1',
      times: [4, 8],
      includeLinked: true,
    }, { source: 'ai-tool', historyLabel: 'AI: split clip at times' });

    const clips = useTimelineStore.getState().clips;
    expect(result.success).toBe(true);
    expect(clips.filter((clip) => clip.trackId === 'video-1')).toHaveLength(3);
    expect(clips.filter((clip) => clip.trackId === 'audio-1')).toHaveLength(3);
    expect(clips.filter((clip) => clip.trackId === 'video-1').map((clip) => [clip.startTime, clip.duration])).toEqual([
      [0, 4],
      [4, 4],
      [8, 4],
    ]);
    expect([...useTimelineStore.getState().selectedClipIds]).toHaveLength(1);
  });

  it('splits only the requested audio clip and clears the stale video link', () => {
    const video = createMockClip({
      id: 'video-1',
      trackId: 'video-1',
      startTime: 0,
      duration: 10,
      inPoint: 0,
      outPoint: 10,
      linkedClipId: 'audio-1',
    });
    const audio = createMockClip({
      id: 'audio-1',
      trackId: 'audio-1',
      startTime: 0,
      duration: 10,
      inPoint: 0,
      outPoint: 10,
      linkedClipId: 'video-1',
      source: { type: 'audio' },
    });
    useTimelineStore.setState({
      tracks: [
        createMockTrack({ id: 'video-1', type: 'video' }),
        createMockTrack({ id: 'audio-1', type: 'audio' }),
      ],
      clips: [video, audio],
    });

    const result = useTimelineStore.getState().applyTimelineEditOperation({
      id: 'split-audio-only',
      type: 'split-at-times',
      clipId: 'audio-1',
      times: [3, 7],
      includeLinked: false,
    }, { source: 'ui', historyLabel: 'Split audio region' });

    const clips = useTimelineStore.getState().clips;
    expect(result.success).toBe(true);
    expect(clips.filter((clip) => clip.trackId === 'video-1')).toHaveLength(1);
    expect(clips.find((clip) => clip.id === 'video-1')?.linkedClipId).toBeUndefined();
    expect(clips.filter((clip) => clip.trackId === 'audio-1').map((clip) => [clip.startTime, clip.duration])).toEqual([
      [0, 3],
      [3, 4],
      [7, 3],
    ]);
  });

  it('selects clips from time across unlocked visible tracks', () => {
    useTimelineStore.setState({
      tracks: [
        createMockTrack({ id: 'video-1', type: 'video' }),
        createMockTrack({ id: 'video-2', type: 'video', locked: true }),
      ],
      clips: [
        createMockClip({ id: 'before', trackId: 'video-1', startTime: 0, duration: 2 }),
        createMockClip({ id: 'after', trackId: 'video-1', startTime: 5, duration: 2 }),
        createMockClip({ id: 'locked', trackId: 'video-2', startTime: 5, duration: 2 }),
      ],
    });

    const result = useTimelineStore.getState().selectClipsFromTime(3);

    expect(result.success).toBe(true);
    expect([...useTimelineStore.getState().selectedClipIds]).toEqual(['after']);
  });

  it('ripple deletes selected clips on their tracks', () => {
    useTimelineStore.setState({
      tracks: [createMockTrack({ id: 'video-1', type: 'video' })],
      clips: [
        createMockClip({ id: 'a', trackId: 'video-1', startTime: 0, duration: 2 }),
        createMockClip({ id: 'b', trackId: 'video-1', startTime: 2, duration: 2 }),
        createMockClip({ id: 'c', trackId: 'video-1', startTime: 4, duration: 2 }),
      ],
      selectedClipIds: new Set(['b']),
    });

    const result = useTimelineStore.getState().rippleDeleteSelection();

    expect(result.success).toBe(true);
    expect(useTimelineStore.getState().clips.map((clip) => [clip.id, clip.startTime])).toEqual([
      ['a', 0],
      ['c', 2],
    ]);
  });

  it('deletes linked clips without relying on selection side effects', () => {
    const video = createMockClip({
      id: 'video-1',
      trackId: 'video-1',
      startTime: 0,
      duration: 4,
      linkedClipId: 'audio-1',
    });
    const audio = createMockClip({
      id: 'audio-1',
      trackId: 'audio-1',
      startTime: 0,
      duration: 4,
      linkedClipId: 'video-1',
      source: { type: 'audio' },
    });
    useTimelineStore.setState({
      tracks: [
        createMockTrack({ id: 'video-1', type: 'video' }),
        createMockTrack({ id: 'audio-1', type: 'audio' }),
      ],
      clips: [video, audio],
      selectedClipIds: new Set(),
    });

    const result = useTimelineStore.getState().applyTimelineEditOperation({
      id: 'delete-linked',
      type: 'delete-clips',
      clipIds: ['video-1'],
      includeLinked: true,
    }, { source: 'ai-tool', historyLabel: 'AI: delete clip' });

    expect(result.success).toBe(true);
    expect(useTimelineStore.getState().clips).toEqual([]);
  });

  it('deletes a gap at time by shifting following clips left', () => {
    useTimelineStore.setState({
      tracks: [createMockTrack({ id: 'video-1', type: 'video' })],
      clips: [
        createMockClip({ id: 'a', trackId: 'video-1', startTime: 0, duration: 2 }),
        createMockClip({ id: 'b', trackId: 'video-1', startTime: 5, duration: 2 }),
      ],
    });

    const result = useTimelineStore.getState().deleteGapAtTime(3);

    expect(result.success).toBe(true);
    expect(useTimelineStore.getState().clips.map((clip) => [clip.id, clip.startTime])).toEqual([
      ['a', 0],
      ['b', 2],
    ]);
  });

  it('moves linked clips through the operation kernel', () => {
    const video = createMockClip({
      id: 'video-1',
      trackId: 'video-1',
      startTime: 1,
      duration: 4,
      linkedClipId: 'audio-1',
    });
    const audio = createMockClip({
      id: 'audio-1',
      trackId: 'audio-1',
      startTime: 1,
      duration: 4,
      linkedClipId: 'video-1',
      source: { type: 'audio' },
    });
    useTimelineStore.setState({
      tracks: [
        createMockTrack({ id: 'video-1', type: 'video' }),
        createMockTrack({ id: 'audio-1', type: 'audio' }),
      ],
      clips: [video, audio],
    });

    const result = useTimelineStore.getState().applyTimelineEditOperation({
      id: 'move-linked',
      type: 'move-clips',
      moves: [{ clipId: 'video-1', startTime: 6 }],
      includeLinked: true,
    }, { source: 'ai-tool', historyLabel: 'AI: move clip' });

    expect(result.success).toBe(true);
    expect(useTimelineStore.getState().clips.map((clip) => [clip.id, clip.startTime])).toEqual([
      ['video-1', 6],
      ['audio-1', 6],
    ]);
  });

  it('trims linked clips through the operation kernel', () => {
    const video = createMockClip({
      id: 'video-1',
      trackId: 'video-1',
      startTime: 0,
      duration: 8,
      inPoint: 0,
      outPoint: 8,
      linkedClipId: 'audio-1',
    });
    const audio = createMockClip({
      id: 'audio-1',
      trackId: 'audio-1',
      startTime: 0,
      duration: 8,
      inPoint: 0,
      outPoint: 8,
      linkedClipId: 'video-1',
      source: { type: 'audio' },
    });
    useTimelineStore.setState({
      tracks: [
        createMockTrack({ id: 'video-1', type: 'video' }),
        createMockTrack({ id: 'audio-1', type: 'audio' }),
      ],
      clips: [video, audio],
    });

    const result = useTimelineStore.getState().applyTimelineEditOperation({
      id: 'trim-linked',
      type: 'trim-clip',
      clipId: 'video-1',
      inPoint: 1,
      outPoint: 6,
      includeLinked: true,
    }, { source: 'ai-tool', historyLabel: 'AI: trim clip' });

    expect(result.success).toBe(true);
    expect(useTimelineStore.getState().clips.map((clip) => [clip.id, clip.inPoint, clip.outPoint, clip.duration])).toEqual([
      ['video-1', 1, 6, 5],
      ['audio-1', 1, 6, 5],
    ]);
  });

  it('preserves linked clip duration differences when trimming again after an independent trim', () => {
    const video = createMockClip({
      id: 'video-1',
      trackId: 'video-1',
      startTime: 0,
      duration: 8,
      inPoint: 0,
      outPoint: 8,
      linkedClipId: 'audio-1',
    });
    const audio = createMockClip({
      id: 'audio-1',
      trackId: 'audio-1',
      startTime: 0,
      duration: 5,
      inPoint: 0,
      outPoint: 5,
      linkedClipId: 'video-1',
      source: { type: 'audio' },
    });
    useTimelineStore.setState({
      tracks: [
        createMockTrack({ id: 'video-1', type: 'video' }),
        createMockTrack({ id: 'audio-1', type: 'audio' }),
      ],
      clips: [video, audio],
    });

    const result = useTimelineStore.getState().applyTimelineEditOperation({
      id: 'trim-linked-after-independent-trim',
      type: 'trim-clip',
      clipId: 'video-1',
      inPoint: 0,
      outPoint: 10,
      includeLinked: true,
    }, { source: 'ui', historyLabel: 'Trim linked clips' });

    expect(result.success).toBe(true);
    expect(useTimelineStore.getState().clips.map((clip) => [clip.id, clip.inPoint, clip.outPoint, clip.duration])).toEqual([
      ['video-1', 0, 10, 10],
      ['audio-1', 0, 7, 7],
    ]);
  });

  it('trims selected clip start to the playhead and keeps linked audio aligned', () => {
    const video = createMockClip({
      id: 'video-1',
      trackId: 'video-1',
      startTime: 0,
      duration: 8,
      inPoint: 0,
      outPoint: 8,
      linkedClipId: 'audio-1',
    });
    const audio = createMockClip({
      id: 'audio-1',
      trackId: 'audio-1',
      startTime: 0,
      duration: 8,
      inPoint: 0,
      outPoint: 8,
      linkedClipId: 'video-1',
      source: { type: 'audio' },
    });
    useTimelineStore.setState({
      tracks: [
        createMockTrack({ id: 'video-1', type: 'video' }),
        createMockTrack({ id: 'audio-1', type: 'audio' }),
      ],
      clips: [video, audio],
      selectedClipIds: new Set(['video-1']),
      playheadPosition: 3,
    });

    const result = useTimelineStore.getState().trimSelectedClipEdgeToPlayhead('start');

    expect(result.success).toBe(true);
    expect(useTimelineStore.getState().clips.map((clip) => [clip.id, clip.startTime, clip.inPoint, clip.outPoint, clip.duration])).toEqual([
      ['video-1', 3, 3, 8, 5],
      ['audio-1', 3, 3, 8, 5],
    ]);
  });

  it('ripple trims a linked clip head and shifts following linked tracks together', () => {
    useTimelineStore.setState({
      tracks: [
        createMockTrack({ id: 'video-1', type: 'video' }),
        createMockTrack({ id: 'audio-1', type: 'audio' }),
      ],
      clips: [
        createMockClip({ id: 'video-1', trackId: 'video-1', startTime: 0, duration: 6, inPoint: 0, outPoint: 6, linkedClipId: 'audio-1' }),
        createMockClip({ id: 'audio-1', trackId: 'audio-1', startTime: 0, duration: 6, inPoint: 0, outPoint: 6, linkedClipId: 'video-1', source: { type: 'audio' } }),
        createMockClip({ id: 'video-2', trackId: 'video-1', startTime: 6, duration: 2, inPoint: 0, outPoint: 2, linkedClipId: 'audio-2' }),
        createMockClip({ id: 'audio-2', trackId: 'audio-1', startTime: 6, duration: 2, inPoint: 0, outPoint: 2, linkedClipId: 'video-2', source: { type: 'audio' } }),
      ],
    });

    const result = useTimelineStore.getState().applyTimelineEditOperation({
      id: 'ripple-trim-linked-head',
      type: 'ripple-trim-edge-to-time',
      edge: 'start',
      time: 2,
      clipIds: ['video-1'],
      includeLinked: true,
    }, { source: 'ui', historyLabel: 'Ripple trim linked head' });

    expect(result.success).toBe(true);
    expect(useTimelineStore.getState().clips.map((clip) => [clip.id, clip.startTime, clip.inPoint, clip.outPoint, clip.duration])).toEqual([
      ['video-1', 0, 2, 6, 4],
      ['audio-1', 0, 2, 6, 4],
      ['video-2', 4, 0, 2, 2],
      ['audio-2', 4, 0, 2, 2],
    ]);
  });

  it('rolls an edit point across linked video and audio pairs', () => {
    useTimelineStore.setState({
      tracks: [
        createMockTrack({ id: 'video-1', type: 'video' }),
        createMockTrack({ id: 'audio-1', type: 'audio' }),
      ],
      clips: [
        createMockClip({ id: 'video-a', trackId: 'video-1', startTime: 0, duration: 5, inPoint: 0, outPoint: 5, linkedClipId: 'audio-a' }),
        createMockClip({ id: 'video-b', trackId: 'video-1', startTime: 5, duration: 5, inPoint: 0, outPoint: 5, linkedClipId: 'audio-b' }),
        createMockClip({ id: 'audio-a', trackId: 'audio-1', startTime: 0, duration: 5, inPoint: 0, outPoint: 5, linkedClipId: 'video-a', source: { type: 'audio' } }),
        createMockClip({ id: 'audio-b', trackId: 'audio-1', startTime: 5, duration: 5, inPoint: 0, outPoint: 5, linkedClipId: 'video-b', source: { type: 'audio' } }),
      ],
    });

    const result = useTimelineStore.getState().applyTimelineEditOperation({
      id: 'roll-linked',
      type: 'rolling-edit',
      clipId: 'video-a',
      edge: 'end',
      time: 6,
      includeLinked: true,
    }, { source: 'ui', historyLabel: 'Rolling edit linked' });

    expect(result.success).toBe(true);
    expect(useTimelineStore.getState().clips.map((clip) => [clip.id, clip.startTime, clip.inPoint, clip.outPoint, clip.duration])).toEqual([
      ['video-a', 0, 0, 6, 6],
      ['video-b', 6, 1, 5, 4],
      ['audio-a', 0, 0, 6, 6],
      ['audio-b', 6, 1, 5, 4],
    ]);
  });

  it('slips source timing without moving the clip on the timeline', () => {
    useTimelineStore.setState({
      tracks: [createMockTrack({ id: 'video-1', type: 'video' })],
      clips: [
        createMockClip({
          id: 'clip-1',
          trackId: 'video-1',
          startTime: 5,
          duration: 4,
          inPoint: 2,
          outPoint: 6,
          source: { type: 'video', naturalDuration: 12 },
        }),
      ],
    });

    const result = useTimelineStore.getState().applyTimelineEditOperation({
      id: 'slip-source',
      type: 'slip-clip',
      clipId: 'clip-1',
      sourceDelta: 3,
    }, { source: 'ui', historyLabel: 'Slip clip' });

    expect(result.success).toBe(true);
    expect(useTimelineStore.getState().clips.map((clip) => [clip.id, clip.startTime, clip.inPoint, clip.outPoint, clip.duration])).toEqual([
      ['clip-1', 5, 5, 9, 4],
    ]);
  });

  it('slides a clip by counter-trimming adjacent clips', () => {
    useTimelineStore.setState({
      tracks: [createMockTrack({ id: 'video-1', type: 'video' })],
      clips: [
        createMockClip({ id: 'prev', trackId: 'video-1', startTime: 0, duration: 5, inPoint: 0, outPoint: 5 }),
        createMockClip({ id: 'mid', trackId: 'video-1', startTime: 5, duration: 2, inPoint: 0, outPoint: 2 }),
        createMockClip({ id: 'next', trackId: 'video-1', startTime: 7, duration: 5, inPoint: 0, outPoint: 5 }),
      ],
    });

    const result = useTimelineStore.getState().applyTimelineEditOperation({
      id: 'slide-mid',
      type: 'slide-clip',
      clipId: 'mid',
      timelineDelta: 2,
    }, { source: 'ui', historyLabel: 'Slide clip' });

    expect(result.success).toBe(true);
    expect(useTimelineStore.getState().clips.map((clip) => [clip.id, clip.startTime, clip.inPoint, clip.outPoint, clip.duration])).toEqual([
      ['prev', 0, 0, 7, 7],
      ['mid', 7, 0, 2, 2],
      ['next', 9, 2, 5, 3],
    ]);
  });

  it('rate-stretches a clip by changing duration and playback speed', () => {
    useTimelineStore.setState({
      tracks: [createMockTrack({ id: 'video-1', type: 'video' })],
      clips: [
        createMockClip({ id: 'clip-1', trackId: 'video-1', startTime: 0, duration: 5, inPoint: 0, outPoint: 5, speed: 1 }),
      ],
    });

    const result = useTimelineStore.getState().applyTimelineEditOperation({
      id: 'rate-stretch-end',
      type: 'rate-stretch-clip',
      clipId: 'clip-1',
      edge: 'end',
      time: 10,
      preservesPitch: true,
    }, { source: 'ui', historyLabel: 'Rate stretch clip' });

    expect(result.success).toBe(true);
    expect(useTimelineStore.getState().clips.map((clip) => [clip.id, clip.duration, clip.speed, clip.preservesPitch])).toEqual([
      ['clip-1', 10, 0.5, true],
    ]);
  });

  it('inserts a placement range by splitting crossing clips and shifting following clips', () => {
    useTimelineStore.setState({
      tracks: [createMockTrack({ id: 'video-1', type: 'video' })],
      clips: [
        createMockClip({ id: 'a', trackId: 'video-1', startTime: 0, duration: 10, inPoint: 0, outPoint: 10 }),
        createMockClip({ id: 'b', trackId: 'video-1', startTime: 12, duration: 2, inPoint: 0, outPoint: 2 }),
      ],
    });

    const result = useTimelineStore.getState().applyTimelineEditOperation({
      id: 'insert-placement-range',
      type: 'place-timeline-range',
      mode: 'insert',
      trackIds: ['video-1'],
      startTime: 5,
      duration: 3,
    }, { source: 'external-drop', historyLabel: 'Insert placement test' });

    const clips = useTimelineStore.getState().clips
      .filter((clip) => clip.trackId === 'video-1')
      .toSorted((left, right) => left.startTime - right.startTime);

    expect(result.success).toBe(true);
    expect(clips).toHaveLength(3);
    expect(clips.map((clip) => [clip.startTime, clip.duration, clip.inPoint, clip.outPoint])).toEqual([
      [0, 5, 0, 5],
      [8, 5, 5, 10],
      [15, 2, 0, 2],
    ]);
  });

  it('overwrites a placement range by trimming and deleting existing clips', () => {
    useTimelineStore.setState({
      tracks: [createMockTrack({ id: 'video-1', type: 'video' })],
      clips: [
        createMockClip({ id: 'a', trackId: 'video-1', startTime: 0, duration: 10, inPoint: 0, outPoint: 10 }),
        createMockClip({ id: 'b', trackId: 'video-1', startTime: 5, duration: 2, inPoint: 0, outPoint: 2 }),
        createMockClip({ id: 'c', trackId: 'video-1', startTime: 12, duration: 6, inPoint: 0, outPoint: 6 }),
      ],
    });

    const result = useTimelineStore.getState().applyTimelineEditOperation({
      id: 'overwrite-placement-range',
      type: 'place-timeline-range',
      mode: 'position-overwrite',
      trackIds: ['video-1'],
      startTime: 4,
      duration: 10,
    }, { source: 'external-drop', historyLabel: 'Overwrite placement test' });

    const clips = useTimelineStore.getState().clips
      .filter((clip) => clip.trackId === 'video-1')
      .toSorted((left, right) => left.startTime - right.startTime);

    expect(result.success).toBe(true);
    expect(clips.map((clip) => clip.id)).toEqual(['a', 'c']);
    expect(clips.map((clip) => [clip.startTime, clip.duration, clip.inPoint, clip.outPoint])).toEqual([
      [0, 4, 0, 4],
      [14, 4, 2, 6],
    ]);
  });

  it('keeps split linked placement parts linked across video and audio tracks', () => {
    const video = createMockClip({
      id: 'video-1',
      trackId: 'video-1',
      startTime: 0,
      duration: 10,
      inPoint: 0,
      outPoint: 10,
      linkedClipId: 'audio-1',
    });
    const audio = createMockClip({
      id: 'audio-1',
      trackId: 'audio-1',
      startTime: 0,
      duration: 10,
      inPoint: 0,
      outPoint: 10,
      linkedClipId: 'video-1',
      source: { type: 'audio' },
    });
    useTimelineStore.setState({
      tracks: [
        createMockTrack({ id: 'video-1', type: 'video' }),
        createMockTrack({ id: 'audio-1', type: 'audio' }),
      ],
      clips: [video, audio],
    });

    const result = useTimelineStore.getState().applyTimelineEditOperation({
      id: 'linked-insert-placement-range',
      type: 'place-timeline-range',
      mode: 'insert',
      trackIds: ['video-1', 'audio-1'],
      startTime: 4,
      duration: 2,
      includeLinked: true,
    }, { source: 'external-drop', historyLabel: 'Linked insert placement test' });

    const clips = useTimelineStore.getState().clips;
    const rightVideo = clips.find((clip) => clip.trackId === 'video-1' && clip.id !== 'video-1');
    const rightAudio = clips.find((clip) => clip.trackId === 'audio-1' && clip.id !== 'audio-1');

    expect(result.success).toBe(true);
    expect(rightVideo).toBeDefined();
    expect(rightAudio).toBeDefined();
    expect(rightVideo?.startTime).toBe(6);
    expect(rightAudio?.startTime).toBe(6);
    expect(rightVideo?.linkedClipId).toBe(rightAudio?.id);
    expect(rightAudio?.linkedClipId).toBe(rightVideo?.id);
    expect(clips.find((clip) => clip.id === 'video-1')?.linkedClipId).toBe('audio-1');
    expect(clips.find((clip) => clip.id === 'audio-1')?.linkedClipId).toBe('video-1');
  });

  it('lifts a timeline range by splitting boundaries and leaving the gap', () => {
    useTimelineStore.setState({
      tracks: [createMockTrack({ id: 'video-1', type: 'video' })],
      clips: [
        createMockClip({ id: 'a', trackId: 'video-1', startTime: 0, duration: 10, inPoint: 0, outPoint: 10 }),
      ],
      timelineRangeSelection: { startTime: 3, endTime: 7, trackIds: ['video-1'] },
    });

    const result = useTimelineStore.getState().liftTimelineRange();

    expect(result.success).toBe(true);
    expect(useTimelineStore.getState().timelineRangeSelection).toBeNull();
    expect(useTimelineStore.getState().clips.map((clip) => [clip.startTime, clip.duration, clip.inPoint, clip.outPoint])).toEqual([
      [0, 3, 0, 3],
      [7, 3, 7, 10],
    ]);
  });

  it('lifts an explicit audio region range without cutting the linked video clip', () => {
    const video = createMockClip({
      id: 'video-1',
      trackId: 'video-1',
      startTime: 0,
      duration: 10,
      inPoint: 0,
      outPoint: 10,
      linkedClipId: 'audio-1',
    });
    const audio = createMockClip({
      id: 'audio-1',
      trackId: 'audio-1',
      startTime: 0,
      duration: 10,
      inPoint: 0,
      outPoint: 10,
      linkedClipId: 'video-1',
      source: { type: 'audio' },
    });
    useTimelineStore.setState({
      tracks: [
        createMockTrack({ id: 'video-1', type: 'video' }),
        createMockTrack({ id: 'audio-1', type: 'audio' }),
      ],
      clips: [video, audio],
    });

    const result = useTimelineStore.getState().applyTimelineEditOperation({
      id: 'cut-audio-region-range',
      type: 'lift-range',
      range: { startTime: 3, endTime: 7, trackIds: ['audio-1'] },
      includeLinked: false,
    }, { source: 'ui', historyLabel: 'Cut audio region' });

    const clips = useTimelineStore.getState().clips;
    const videoClips = clips.filter((clip) => clip.trackId === 'video-1');
    const audioClips = clips
      .filter((clip) => clip.trackId === 'audio-1')
      .toSorted((a, b) => a.startTime - b.startTime);

    expect(result.success).toBe(true);
    expect(videoClips).toHaveLength(1);
    expect(videoClips[0]?.startTime).toBe(0);
    expect(videoClips[0]?.duration).toBe(10);
    expect(videoClips[0]?.linkedClipId).toBeUndefined();
    expect(audioClips.map((clip) => [clip.startTime, clip.duration, clip.inPoint, clip.outPoint])).toEqual([
      [0, 3, 0, 3],
      [7, 3, 7, 10],
    ]);
  });

  it('extracts a timeline range by splitting boundaries and closing the gap', () => {
    useTimelineStore.setState({
      tracks: [createMockTrack({ id: 'video-1', type: 'video' })],
      clips: [
        createMockClip({ id: 'a', trackId: 'video-1', startTime: 0, duration: 10, inPoint: 0, outPoint: 10 }),
        createMockClip({ id: 'b', trackId: 'video-1', startTime: 12, duration: 2, inPoint: 0, outPoint: 2 }),
      ],
      timelineRangeSelection: { startTime: 3, endTime: 7, trackIds: ['video-1'] },
    });

    const result = useTimelineStore.getState().extractTimelineRange();

    expect(result.success).toBe(true);
    expect(useTimelineStore.getState().clips.map((clip) => [clip.id.startsWith('a'), clip.startTime, clip.duration, clip.inPoint, clip.outPoint])).toEqual([
      [true, 0, 3, 0, 3],
      [true, 3, 3, 7, 10],
      [false, 8, 2, 0, 2],
    ]);
  });
});
