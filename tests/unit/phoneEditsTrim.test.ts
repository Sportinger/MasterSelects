import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  phoneCloseTrackGaps, phoneLink, phoneRippleTrim, phoneRollTo, phoneSlideTo, phoneSlipTo, phoneUnlink,
} from '../../src/components/mobileSkin/edits/phoneTrimCommands';
import {
  formatPhoneFrames, phoneLinkCandidate, phoneRippleTrimReason, phoneSlideRange, phoneSlipRange, phoneTrimNeighbours,
} from '../../src/components/mobileSkin/edits/phoneTrimPlans';
import { initHistoryStoreRefs, useHistoryStore } from '../../src/stores/historyStore';
import { useTimelineStore } from '../../src/stores/timeline';
import type { TimelineClip } from '../../src/types/timeline';
import { installFakeMediaStore } from '../helpers/fakeMediaStore';
import { createMockClip, createMockTrack } from '../helpers/mockData';

function videoClip(id: string, startTime: number, duration: number, extra: Partial<TimelineClip> = {}): TimelineClip {
  return createMockClip({
    id, trackId: 'video-1', startTime, duration, inPoint: 1, outPoint: 1 + duration,
    source: { type: 'video', naturalDuration: 20 }, ...extra,
  });
}

const clip = (id: string) => useTimelineStore.getState().clips.find((candidate) => candidate.id === id)!;

describe('phone trim modes', () => {
  beforeEach(() => {
    installFakeMediaStore();
    initHistoryStoreRefs({
      timeline: { getState: () => useTimelineStore.getState(), setState: (state) => useTimelineStore.setState(state) },
      media: { getState: () => ({ files: [], compositions: [], folders: [], selectedIds: [], expandedFolderIds: [], textItems: [], solidItems: [], mathSceneItems: [], motionShapeItems: [], signalAssets: [], signalArtifacts: [], signalGraphs: [], signalOperators: [] }), setState: vi.fn() },
      dock: { getState: () => ({ layout: null as never }), setState: vi.fn() },
    } as never);
    useHistoryStore.getState().clearHistory();
    useTimelineStore.setState({
      tracks: [createMockTrack({ id: 'video-1', type: 'video' }), createMockTrack({ id: 'audio-1', type: 'audio' })],
      clips: [videoClip('a', 0, 2), videoClip('b', 2, 3), videoClip('c', 5, 1), videoClip('d', 8, 1)],
      selectedClipIds: new Set(['b']),
      primarySelectedClipId: 'b',
      playheadPosition: 3,
      duration: 60,
      isPlaying: false,
      isExporting: false,
    });
  });

  afterEach(() => {
    useTimelineStore.setState({ clips: [], selectedClipIds: new Set() });
  });

  it('plans neighbours, slip room, slide room and the ripple reason', () => {
    const b = clip('b');
    const neighbours = phoneTrimNeighbours(useTimelineStore.getState().clips, b);
    expect(neighbours.previous?.id).toBe('a');
    expect(neighbours.next?.id).toBe('c');
    expect(phoneTrimNeighbours(useTimelineStore.getState().clips, clip('d'))).toEqual({ previous: null, next: null });
    expect(phoneSlipRange(b)).toEqual({ min: -1, max: 16 });
    expect(phoneSlideRange(neighbours)?.max).toBeCloseTo(0.96, 6);
    expect(phoneRippleTrimReason(b, 3)).toBeNull();
    expect(phoneRippleTrimReason(b, 6)).toMatch(/playhead inside/);
    expect(formatPhoneFrames(-3)).toBe('−3 f');
    expect(formatPhoneFrames(12)).toBe('+12 f');
  });

  it('ripple trims the end to the playhead and pulls later clips up', () => {
    expect(phoneRippleTrim('b', 'end').ok).toBe(true);
    expect(clip('b').duration).toBeCloseTo(1, 6);
    expect(clip('c').startTime).toBeCloseTo(3, 6);
  });

  it('refuses a ripple trim with the playhead outside the clip and says why', () => {
    useTimelineStore.setState({ playheadPosition: 7 });
    const result = phoneRippleTrim('b', 'start');
    expect(result.ok).toBe(false);
    expect(clip('b').startTime).toBe(2);
  });

  it('slips to an absolute offset from the baseline and reports the clamp at the source start', () => {
    const first = phoneSlipTo('b', 1, 0.5);
    expect(first.result.ok).toBe(true);
    expect(clip('b').inPoint).toBeCloseTo(1.5, 6);
    expect(clip('b').startTime).toBe(2);
    // Same target again is a no-op (absolute, not cumulative).
    phoneSlipTo('b', 1, 0.5);
    expect(clip('b').inPoint).toBeCloseTo(1.5, 6);
    const clamped = phoneSlipTo('b', 1, -5);
    expect(clamped.clamped).toBe(true);
    expect(clip('b').inPoint).toBeCloseTo(0, 6);
  });

  it('rolls the cut with the neighbour and leaves everything else in place', () => {
    const { result } = phoneRollTo('b', 'end', 5, -0.5);
    expect(result.ok).toBe(true);
    expect(clip('b').duration).toBeCloseTo(2.5, 6);
    expect(clip('c').startTime).toBeCloseTo(4.5, 6);
    expect(clip('c').startTime + clip('c').duration).toBeCloseTo(6, 6);
    expect(phoneRollTo('d', 'end', 9, 0.1).result.ok).toBe(false);
  });

  it('slides between the neighbours, clamping at the neighbour minimum length', () => {
    const { result, clamped } = phoneSlideTo('b', 2, 5);
    expect(result.ok).toBe(true);
    expect(clamped).toBe(true);
    // The editor snaps to composition frames: the clip stops within a frame of the limit.
    expect(clip('b').startTime).toBeGreaterThan(2.9);
    expect(clip('b').startTime).toBeLessThan(2.97);
    expect(clip('b').duration).toBe(3);
    expect(phoneSlideTo('d', 8, 0.2).result.ok).toBe(false);
  });

  it('closes the gaps on the track', () => {
    expect(phoneCloseTrackGaps('b').ok).toBe(true);
    expect(clip('d').startTime).toBeCloseTo(6, 6);
  });

  it('links a lone clip with the overlapping clip of the other kind and unlinks it again', () => {
    useTimelineStore.setState({
      clips: [...useTimelineStore.getState().clips, createMockClip({ id: 's', trackId: 'audio-1', startTime: 2.5, duration: 2, source: { type: 'audio', naturalDuration: 5 } })],
    });
    expect(phoneLinkCandidate(useTimelineStore.getState().clips, clip('b'), new Set(['audio-1']))?.id).toBe('s');
    expect(phoneLink('b', ['b']).ok).toBe(true);
    expect(clip('b').linkedClipId).toBe('s');
    expect(phoneUnlink('b').ok).toBe(true);
    expect(clip('b').linkedClipId).toBeUndefined();
    expect(phoneUnlink('b').ok).toBe(false);
  });
});
