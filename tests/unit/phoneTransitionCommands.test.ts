import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  applyPhoneTransition, phoneTransitionCatalog, phoneTransitionScopeCuts, phoneTransitionTiming,
  phoneTransitionUnavailableReason, setPhoneCutTransition,
} from '../../src/components/mobileSkin/transition/phoneTransitionCommands';
import {
  findPhoneCuts, findPhoneCutsOnTrack, phoneCutForClip, resolvePhoneCut,
} from '../../src/components/mobileSkin/transition/phoneTransitionCuts';
import { useTimelineStore } from '../../src/stores/timeline';
import { getAllTransitions } from '../../src/transitions';
import type { TimelineClip } from '../../src/types/timeline';
import { createMockClip, createMockTrack } from '../helpers/mockData';

const video = (id: string, startTime: number, duration: number, trackId = 'video-1'): TimelineClip =>
  createMockClip({ id, trackId, startTime, duration, inPoint: 0, outPoint: duration, source: { type: 'video', naturalDuration: 20 } as TimelineClip['source'] });
const audio = (id: string, startTime: number, duration: number): TimelineClip =>
  createMockClip({ id, trackId: 'audio-1', startTime, duration, inPoint: 0, outPoint: duration, file: new File([], 'a.wav', { type: 'audio/wav' }), source: { type: 'audio' } as TimelineClip['source'] });

const originalState = useTimelineStore.getState();

describe('phone cuts', () => {
  it('finds touching neighbours on each track and skips gaps and overlaps', () => {
    const clips = [video('a', 0, 4), video('b', 4, 3), video('c', 7.5, 1), video('d', 8.5, 2), video('x', 0, 2, 'video-2'), video('y', 1, 3, 'video-2')];
    const cuts = findPhoneCuts(clips);
    expect(cuts.get('video-1')?.map((cut) => [cut.clipAId, cut.clipBId, cut.time])).toEqual([['a', 'b', 4], ['c', 'd', 8.5]]);
    expect(cuts.has('video-2')).toBe(false);
  });

  it('accepts the editor junction epsilon and no more', () => {
    expect(findPhoneCutsOnTrack([video('a', 0, 4), video('b', 4.00005, 3)], 'video-1')).toHaveLength(1);
    expect(findPhoneCutsOnTrack([video('a', 0, 4), video('b', 4.001, 3)], 'video-1')).toHaveLength(0);
  });

  it('picks the cut after a clip, else the cut before it', () => {
    const clips = [video('a', 0, 4), video('b', 4, 3), video('c', 7, 1)];
    expect(phoneCutForClip(clips, 'a')).toMatchObject({ clipAId: 'a', clipBId: 'b' });
    expect(phoneCutForClip(clips, 'b')).toMatchObject({ clipAId: 'b', clipBId: 'c' });
    expect(phoneCutForClip(clips, 'c')).toMatchObject({ clipAId: 'b', clipBId: 'c' });
    expect(phoneCutForClip([video('lonely', 0, 4)], 'lonely')).toBeNull();
    expect(resolvePhoneCut(clips, { trackId: 'video-1', clipAId: 'a', clipBId: 'c' })).toBeNull();
  });
});

describe('phone transition commands (real editor operations)', () => {
  beforeEach(() => {
    useTimelineStore.setState({
      tracks: [createMockTrack({ id: 'video-1', type: 'video' }), createMockTrack({ id: 'audio-1', type: 'audio' })],
      clips: [video('a', 0, 4), video('b', 4, 3), video('c', 7, 2), audio('s1', 0, 2), audio('s2', 2, 2)],
      isExporting: false,
    });
  });

  afterEach(() => {
    useTimelineStore.setState({ clips: originalState.clips, tracks: originalState.tracks });
  });

  const target = { trackId: 'video-1', clipAId: 'a', clipBId: 'b' };
  const transitionOf = (id: string) => useTimelineStore.getState().clips.find((clip) => clip.id === id)?.transitionOut;

  it('offers the same runtime transitions as the desktop, grouped by category', () => {
    const catalog = phoneTransitionCatalog();
    expect(catalog.flatMap((group) => group.transitions.map((definition) => definition.id)).toSorted())
      .toEqual(getAllTransitions().map((definition) => definition.id).toSorted());
    expect(catalog.every((group) => group.label.length > 0)).toBe(true);
  });

  it('applies, retypes, re-times and removes through the editor and is idempotent', () => {
    expect(setPhoneCutTransition(target, { type: 'crossfade', duration: 0.8 })).toEqual([]);
    expect(transitionOf('a')).toMatchObject({ type: 'crossfade', duration: 0.8, linkedClipId: 'b' });
    const id = transitionOf('a')!.id;
    // Clips never move: transitions are metadata at the cut.
    expect(useTimelineStore.getState().clips.find((clip) => clip.id === 'b')?.startTime).toBe(4);

    expect(setPhoneCutTransition(target, { type: 'dip-to-white', duration: 1.5 })).toEqual([]);
    expect(transitionOf('a')).toMatchObject({ id, type: 'dip-to-white', duration: 1.5 });
    const before = useTimelineStore.getState().clips;
    expect(setPhoneCutTransition(target, { type: 'dip-to-white', duration: 1.5 })).toEqual([]);
    expect(useTimelineStore.getState().clips).toBe(before);

    expect(setPhoneCutTransition(target, { type: 'none', duration: 1.5 })).toEqual([]);
    expect(transitionOf('a')).toBeUndefined();
    expect(useTimelineStore.getState().clips.find((clip) => clip.id === 'b')?.transitionIn).toBeUndefined();
  });

  it('applies to every cut of the track for "Apply to all cuts"', () => {
    expect(phoneTransitionScopeCuts(useTimelineStore.getState().clips, target, 'track')).toHaveLength(2);
    const report = applyPhoneTransition(target, 'track', { type: 'wipe-left', duration: 1 });
    expect(report).toEqual({ applied: 2, problems: [] });
    expect(transitionOf('a')?.type).toBe('wipe-left');
    expect(transitionOf('b')?.type).toBe('wipe-left');
    expect(transitionOf('s1')).toBeUndefined();
  });

  it('reports the editor refusal on a locked track instead of failing silently', () => {
    useTimelineStore.setState({ tracks: [createMockTrack({ id: 'video-1', type: 'video', locked: true })] });
    const report = applyPhoneTransition(target, 'cut', { type: 'crossfade', duration: 1 });
    expect(report.applied).toBe(0);
    expect(report.problems.join(' ')).toMatch(/lock/i);
  });

  it('allows only the crossfade at audio cuts and says why', () => {
    const cut = findPhoneCutsOnTrack(useTimelineStore.getState().clips, 'audio-1')[0];
    expect(phoneTransitionUnavailableReason(useTimelineStore.getState().clips, cut, 'wipe-left')).toMatch(/crossfade/);
    expect(phoneTransitionUnavailableReason(useTimelineStore.getState().clips, cut, 'crossfade')).toBeNull();
    const report = applyPhoneTransition({ trackId: 'audio-1', clipAId: 's1', clipBId: 's2' }, 'cut', { type: 'wipe-left', duration: 1 });
    expect(report.applied).toBe(0);
    expect(report.problems[0]).toMatch(/crossfade/);
  });

  it('tells when a clip runs out of footage and its edge frame holds', () => {
    setPhoneCutTransition(target, { type: 'crossfade', duration: 2 });
    // Clip a uses its whole source (outPoint 4 of naturalDuration 20 means handles exist), b starts at source 0.
    const timing = phoneTransitionTiming(target);
    expect(timing?.resolvedDuration).toBe(2);
    expect(timing?.holdSeconds).toBeGreaterThan(0);
  });
});
