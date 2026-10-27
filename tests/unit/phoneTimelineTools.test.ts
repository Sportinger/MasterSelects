// G1 timeline tools: phone snapping (move and trim honour the editor's snapping toggle and beat
// grid), the in/out range marks with honest messages, Cancel restoring the timeline preferences,
// the beat marks of the phone ruler, track focus lane heights, and the clip details commands
// (rename support, track-parent loop check, parenting refusals shown as sentences).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildPhoneLanes } from '../../src/components/mobileSkin/timeline/phoneLaneLayout';
import { phoneBeatMarks } from '../../src/components/mobileSkin/timeline/phoneBeatMarks';
import { snapPhoneMoveStart, snapPhoneTrimEdge, type PhoneSnapContext } from '../../src/components/mobileSkin/timeline/phoneTimelineSnap';
import {
  phoneParentCandidates, phoneRenameSupport, phoneTrackParentWouldLoop, setPhoneClipParent, setPhoneTrackParent,
} from '../../src/components/mobileSkin/timelineTools/phoneClipDetailsCommands';
import {
  phoneRangeSpan, readPhoneTimelinePrefs, restorePhoneTimelinePrefs, setPhoneBeatGrid, setPhoneRangeMark,
} from '../../src/components/mobileSkin/timelineTools/phoneTimelinePrefs';
import { hasOpenPhoneVariantSet } from '../../src/components/mobileSkin/timelineTools/phoneTimelineToolsModel';
import { useTimelineStore } from '../../src/stores/timeline';
import type { TimelineTrack } from '../../src/types/timeline';
import { createMockClip } from '../helpers/mockData';

const TEMPO_120 = { events: [{ id: 'tempo-project', time: 0, bpm: 120, numerator: 4, denominator: 4 }] };

function context(overrides: Partial<PhoneSnapContext> = {}): PhoneSnapContext {
  return {
    enabled: true,
    clips: [
      { id: 'a', startTime: 0, duration: 2 },
      { id: 'b', startTime: 5, duration: 3, linkedClipId: undefined },
    ],
    playhead: 10,
    markers: [],
    zoom: 60,
    grid: null,
    ...overrides,
  };
}

describe('phone snapping', () => {
  it('snaps a moved clip start exactly to another clip end inside the pixel radius', () => {
    // 2.1 s is 6 px from the end of clip a at 60 px/s (radius 12 px).
    expect(snapPhoneMoveStart(context(), { id: 'b', duration: 3 }, 2.1)).toEqual({ startTime: 2, snappedTo: 2 });
  });

  it('snaps by the end edge when that one is closer', () => {
    // Clip a (2 s) dropped so its end lands 0.1 s before clip b at 5 s.
    expect(snapPhoneMoveStart(context(), { id: 'a', duration: 2 }, 2.9)).toEqual({ startTime: 3, snappedTo: 5 });
  });

  it('moves freely when snapping is off or nothing is near', () => {
    expect(snapPhoneMoveStart(context({ enabled: false }), { id: 'b', duration: 3 }, 2.1)).toEqual({ startTime: 2.1, snappedTo: null });
    expect(snapPhoneMoveStart(context(), { id: 'b', duration: 1 }, 3.3)).toEqual({ startTime: 3.3, snappedTo: null });
  });

  it('uses the phone zoom for the radius: zoomed far out a bigger time distance still snaps', () => {
    expect(snapPhoneMoveStart(context({ zoom: 6 }), { id: 'b', duration: 3 }, 3).snappedTo).toBe(2);
  });

  it('snaps to beats only while the beat grid exists (the editor rule)', () => {
    const grid = { tempoMap: TEMPO_120, subdivision: 'beat' as const };
    // At 120 BPM beats are 0.5 s apart; 7.04 s is 2.4 px from the beat at 7 s at 60 px/s.
    const withGrid = snapPhoneTrimEdge(context({ grid, clips: [] , playhead: 100 }), 'x', 7.04);
    expect(withGrid.edge).toBeCloseTo(7, 9);
    const withoutGrid = snapPhoneTrimEdge(context({ clips: [], playhead: 100 }), 'x', 7.04);
    expect(withoutGrid).toEqual({ edge: 7.04, snappedTo: null });
  });

  it('never snaps a clip to its own linked partner', () => {
    const linked = context({ clips: [{ id: 'v', startTime: 0, duration: 2, linkedClipId: 'au' }, { id: 'au', startTime: 0, duration: 2, linkedClipId: 'v' }], playhead: 50 });
    expect(snapPhoneMoveStart(linked, { id: 'v', duration: 2 }, 0.1).snappedTo).toBe(0); // timeline start, not the partner
    expect(snapPhoneTrimEdge(linked, 'v', 2.05)).toEqual({ edge: 2.05, snappedTo: null });
  });
});

describe('phone ruler and lanes', () => {
  it('lists bars and beats in the window and thins beats when they crowd', () => {
    const marks = phoneBeatMarks(TEMPO_120, { start: 0, end: 2 }, 60);
    expect(marks.map((mark) => mark.time)).toEqual([0, 0.5, 1, 1.5, 2]);
    expect(marks.filter((mark) => mark.downbeat).map((mark) => mark.time)).toEqual([0, 2]);
    expect(phoneBeatMarks(TEMPO_120, { start: 0, end: 4 }, 4).every((mark) => mark.downbeat)).toBe(true);
  });

  it('gives the focused kind of track the room', () => {
    const tracks = [
      { id: 'v', name: 'Video', type: 'video' }, { id: 'a', name: 'Audio', type: 'audio' },
    ] as TimelineTrack[];
    const height = (focus: 'balanced' | 'video' | 'audio', id: string) => buildPhoneLanes(tracks, focus).lanes.find((lane) => lane.trackId === id)!.height;
    expect(height('video', 'v')).toBeGreaterThan(height('balanced', 'v'));
    expect(height('audio', 'a')).toBeGreaterThan(height('balanced', 'a'));
    expect(height('video', 'a')).toBeLessThan(height('audio', 'a'));
  });
});

describe('phone timeline preferences', () => {
  const initial = readPhoneTimelinePrefs();
  beforeEach(() => {
    useTimelineStore.setState({ duration: 10, inPoint: null, outPoint: null, playheadPosition: 0, rulerLanes: [] });
  });
  afterEach(() => restorePhoneTimelinePrefs(initial));

  it('sets in and out with the editor actions and says when the editor moved a mark', () => {
    expect(setPhoneRangeMark('in', 2, 30)).toMatchObject({ inPoint: 2, message: 'In set at 0:02.00.' });
    expect(setPhoneRangeMark('out', 3, 30)).toMatchObject({ outPoint: 3 });
    const late = setPhoneRangeMark('in', 5, 30);
    expect(late.inPoint).toBe(3);
    expect(late.message).toMatch(/In cannot be after Out/);
    expect(phoneRangeSpan(3, 3, 10)).toBeNull();
    expect(phoneRangeSpan(null, 4, 10)).toEqual({ start: 0, end: 4 });
  });

  it('restores every preference exactly (Cancel)', () => {
    const before = readPhoneTimelinePrefs();
    const store = useTimelineStore.getState();
    store.toggleSnapping();
    setPhoneBeatGrid(true);
    store.setTimelineGridSubdivision('1/16');
    store.toggleMetronome();
    store.setMetronomeVolume(0.2);
    store.setMetronomeMode(before.metronomeMode === 'beats' ? 'bars' : 'beats');
    store.setInPoint(1);
    store.setOutPoint(4);
    store.setLoopPlayback(!before.loopPlayback);
    store.setThumbnailsEnabled(!before.thumbnailsEnabled);
    store.setWaveformsEnabled(!before.waveformsEnabled);
    store.setTrackFocusMode('audio');
    expect(readPhoneTimelinePrefs()).not.toEqual(before);
    restorePhoneTimelinePrefs(before);
    expect(readPhoneTimelinePrefs()).toEqual(before);
  });
});

describe('clip details commands', () => {
  const tracks = [
    { id: 'v1', name: 'V1', type: 'video', height: 40, muted: false, visible: true, solo: false },
    { id: 'v2', name: 'V2', type: 'video', height: 40, muted: false, visible: true, solo: false },
    { id: 'a1', name: 'A1', type: 'audio', height: 40, muted: false, visible: true, solo: false },
  ] as TimelineTrack[];

  afterEach(() => useTimelineStore.setState({ clips: [], tracks: [] }));

  it('renames only the clip types the editor renames', () => {
    expect(phoneRenameSupport({ source: { type: 'midi' } } as never)).toBe('midi');
    expect(phoneRenameSupport({ source: { type: 'storyboard' }, storyboardProperties: { sceneId: 's1' } } as never)).toBe('storyboard');
    expect(phoneRenameSupport({ source: { type: 'video' } } as never)).toBeNull();
  });

  it('offers clips on video tracks as parents, never the clip itself or audio', () => {
    const clips = [
      createMockClip({ id: 'c1', trackId: 'v1', startTime: 0, duration: 2 }),
      createMockClip({ id: 'c2', trackId: 'v2', startTime: 1, duration: 2 }),
      createMockClip({ id: 'c3', trackId: 'a1', startTime: 0, duration: 2 }),
    ];
    expect(phoneParentCandidates({ clips, tracks }, 'c1').map((clip) => clip.id)).toEqual(['c2']);
  });

  it('refuses parenting an audio clip with a sentence instead of silence', () => {
    useTimelineStore.setState({ tracks, clips: [createMockClip({ id: 'c3', trackId: 'a1', startTime: 0, duration: 2 })] });
    expect(setPhoneClipParent('c3', null)).toEqual({ ok: false, message: 'Only clips on video tracks have a position to parent.' });
  });

  it('detects and refuses track parent loops', () => {
    const chained = tracks.map((track) => (track.id === 'v2' ? { ...track, parentTrackId: 'v1' } : track));
    expect(phoneTrackParentWouldLoop(chained, 'v1', 'v2')).toBe(true);
    expect(phoneTrackParentWouldLoop(chained, 'v2', 'v1')).toBe(false);
    useTimelineStore.setState({ tracks: chained, clips: [] });
    expect(setPhoneTrackParent('v1', 'v2').ok).toBe(false);
    expect(setPhoneTrackParent('v2', null)).toEqual({ ok: true, message: 'The track has no parent now.' });
    expect(useTimelineStore.getState().tracks.find((track) => track.id === 'v2')?.parentTrackId).toBeUndefined();
  });

  it('knows when a variant set is open for comparison', () => {
    expect(hasOpenPhoneVariantSet({})).toBe(false);
    expect(hasOpenPhoneVariantSet({ s: { status: 'review', optionIds: ['a'] } })).toBe(true);
    expect(hasOpenPhoneVariantSet({ s: { status: 'accepted', optionIds: ['a'] } })).toBe(false);
  });
});
