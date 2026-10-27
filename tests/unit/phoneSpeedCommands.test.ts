import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  PHONE_SPEED_CHIPS, applyPhoneSpeedState, formatPhoneSpeed, phoneSliderToSpeed, phoneSpeedToSlider,
  phoneSpeedLeftOutNote, phoneSpeedTarget, phoneSpeedUnavailableReason, readPhoneSpeedSnapshot,
} from '../../src/components/mobileSkin/speed/phoneSpeedCommands';
import {
  PHONE_SPEED_CURVES, PHONE_SPEED_CURVE_SEGMENTS, buildPhoneSpeedCurveWarp, identifyPhoneSpeedCurve, phoneWarpSourceAt,
} from '../../src/components/mobileSkin/speed/phoneSpeedCurves';
import { sampleWarp, validWarpPoints } from '../../src/services/timeline/retime/clipWarp';
import { resolveClipSourceTime } from '../../src/services/timeline/retime/clipRetime';
import { useTimelineStore } from '../../src/stores/timeline';
import type { TimelineClip } from '../../src/types/timeline';
import { createMockClip, createMockTrack } from '../helpers/mockData';

const originalState = useTimelineStore.getState();
const clipA = () => useTimelineStore.getState().clips.find((clip) => clip.id === 'a')!;

describe('phone speed curves', () => {
  const clip = { duration: 4, inPoint: 1, outPoint: 5, backward: false };

  it('keeps the clip length, covers exactly the source window and stays a valid editor warp', () => {
    for (const preset of PHONE_SPEED_CURVES) {
      const warp = buildPhoneSpeedCurveWarp(clip, preset.id)!;
      expect(validWarpPoints(warp.points), preset.id).toBe(true);
      expect(warp.points).toHaveLength(PHONE_SPEED_CURVE_SEGMENTS + 1);
      expect(warp.points[0]).toEqual({ time: 0, source: 1 });
      expect(warp.points.at(-1)).toEqual({ time: 4, source: 5 });
      // Monotonic forward playback, every segment faster than zero.
      warp.points.slice(1).forEach((point, index) => expect(point.source).toBeGreaterThan(warp.points[index].source));
      // Our sampler matches the engine's.
      for (const local of [0.13, 1.7, 2.0, 3.99]) expect(phoneWarpSourceAt(warp.points, local)).toBeCloseTo(sampleWarp(warp.points, local).sourceTime, 9);
    }
  });

  it('shapes the pace: "Speed up" starts slow and ends fast, "Slow middle" slows in the middle', () => {
    const up = buildPhoneSpeedCurveWarp(clip, 'speed-up')!;
    expect(phoneWarpSourceAt(up.points, 2) - 1).toBeLessThan(2);
    const slow = buildPhoneSpeedCurveWarp(clip, 'slow-middle')!;
    const rate = (points: typeof slow.points, t: number) => (phoneWarpSourceAt(points, t + 0.01) - phoneWarpSourceAt(points, t)) / 0.01;
    expect(rate(slow.points, 2)).toBeLessThan(rate(slow.points, 0.2));
  });

  it('plays backward clips from the out point and is recognised again on reopen', () => {
    const backward = { ...clip, backward: true };
    const warp = buildPhoneSpeedCurveWarp(backward, 'pulse')!;
    expect(warp.points[0].source).toBe(5);
    expect(warp.points.at(-1)!.source).toBe(1);
    expect(identifyPhoneSpeedCurve(backward, warp)).toBe('pulse');
    expect(identifyPhoneSpeedCurve(clip, warp)).toBeNull();
    expect(identifyPhoneSpeedCurve(clip, { kind: 'warp', points: [{ time: 0, source: 1 }, { time: 4, source: 5 }] })).toBeNull();
    expect(buildPhoneSpeedCurveWarp({ ...clip, outPoint: 1 }, 'pulse')).toBeNull();
  });
});

describe('phone speed slider and labels', () => {
  it('maps 0.1x..10x logarithmically with 1x in the middle and snaps to the chips', () => {
    expect(phoneSpeedToSlider(1)).toBe(500);
    expect(phoneSliderToSpeed(0)).toBe(0.1);
    expect(phoneSliderToSpeed(1000)).toBe(10);
    for (const chip of PHONE_SPEED_CHIPS) expect(phoneSliderToSpeed(phoneSpeedToSlider(chip))).toBe(chip);
    expect(phoneSliderToSpeed(phoneSpeedToSlider(1.5))).toBeCloseTo(1.5, 1);
  });

  it('labels speeds briefly', () => {
    expect(PHONE_SPEED_CHIPS.map(formatPhoneSpeed)).toEqual(['0.1x', '0.25x', '0.5x', '1x', '2x', '4x', '10x']);
    expect(formatPhoneSpeed(1.5)).toBe('1.5x');
  });

  it('explains why generated clips have no speed', () => {
    expect(phoneSpeedUnavailableReason(createMockClip({ source: { type: 'video' } as TimelineClip['source'] }))).toBeNull();
    expect(phoneSpeedUnavailableReason(createMockClip({ source: { type: 'audio' } as TimelineClip['source'] }))).toBeNull();
    expect(phoneSpeedUnavailableReason(createMockClip({ source: { type: 'text' } as TimelineClip['source'] }))).toMatch(/text clip/);
  });
});

describe('applyPhoneSpeedState (real editor actions)', () => {
  beforeEach(() => {
    useTimelineStore.setState({
      tracks: [createMockTrack({ id: 'video-1', type: 'video' })],
      clips: [createMockClip({ id: 'a', startTime: 0, duration: 4, inPoint: 0, outPoint: 4, source: { type: 'video', naturalDuration: 4 } as TimelineClip['source'] })],
      clipKeyframes: new Map(),
      playheadPosition: 0,
      isExporting: false,
    });
  });

  afterEach(() => {
    useTimelineStore.setState({ clips: originalState.clips, tracks: originalState.tracks, clipKeyframes: originalState.clipKeyframes });
  });

  it('sets the speed and the clip length follows like setClipSpeed on the desktop', () => {
    const original = readPhoneSpeedSnapshot(clipA());
    expect(applyPhoneSpeedState(original, { magnitude: 2, preservesPitch: true, reversed: false, curve: 'keep' })).toEqual([]);
    expect(clipA()).toMatchObject({ speed: 2, duration: 2 });
    // Absolute: applying the same state again changes nothing.
    const clips = useTimelineStore.getState().clips;
    applyPhoneSpeedState(original, { magnitude: 2, preservesPitch: true, reversed: false, curve: 'keep' });
    expect(useTimelineStore.getState().clips).toBe(clips);
    applyPhoneSpeedState(original, { magnitude: 0.5, preservesPitch: false, reversed: true, curve: 'keep' });
    expect(clipA()).toMatchObject({ speed: 0.5, duration: 8, preservesPitch: false, reversed: true });
  });

  it('puts a curve on top of the base speed and removes it again', () => {
    const original = readPhoneSpeedSnapshot(clipA());
    applyPhoneSpeedState(original, { magnitude: 2, preservesPitch: true, reversed: false, curve: 'fast-middle' });
    const clip = clipA();
    expect(clip.duration).toBe(2);
    expect(clip.timeRemap?.kind).toBe('warp');
    expect(readPhoneSpeedSnapshot(clip).curve).toBe('fast-middle');
    // The engine reads the curve: the whole source plays within the clip.
    expect(resolveClipSourceTime(clip, 1.999).sourceTime).toBeGreaterThan(3.9);
    applyPhoneSpeedState(original, { magnitude: 1, preservesPitch: true, reversed: false, curve: 'none' });
    expect(clipA().timeRemap).toBeUndefined();
    expect(clipA().duration).toBe(4);
  });

  it('builds a reversed curve when the clip plays backwards', () => {
    const original = readPhoneSpeedSnapshot(clipA());
    applyPhoneSpeedState(original, { magnitude: 1, preservesPitch: true, reversed: true, curve: 'speed-up' });
    expect(resolveClipSourceTime(clipA(), 0).sourceTime).toBe(4);
    expect(readPhoneSpeedSnapshot(clipA()).curve).toBe('speed-up');
  });

  it('reports a locked track instead of failing silently', () => {
    useTimelineStore.setState({ tracks: [createMockTrack({ id: 'video-1', type: 'video', locked: true })] });
    const original = readPhoneSpeedSnapshot(clipA());
    const problems = applyPhoneSpeedState(original, { magnitude: 2, preservesPitch: true, reversed: false, curve: 'keep' });
    expect(problems.join(' ')).toMatch(/locked/);
    expect(clipA().speed ?? 1).toBe(1);
  });
});

describe('phoneSpeedTarget (which clip the speed sheet changes)', () => {
  const video = (id: string, extra: Partial<TimelineClip> = {}) => createMockClip({ id, name: `Clip ${id}`, source: { type: 'video', naturalDuration: 4 } as TimelineClip['source'], ...extra });

  afterEach(() => {
    useTimelineStore.setState({
      clips: originalState.clips, selectedClipIds: originalState.selectedClipIds, primarySelectedClipId: originalState.primarySelectedClipId,
    });
  });

  it('targets the primary selection and names the other selected clips it leaves unchanged', () => {
    useTimelineStore.setState({ clips: [video('a'), video('b'), video('c')], selectedClipIds: new Set(['a', 'b']), primarySelectedClipId: 'b' });
    const target = phoneSpeedTarget();
    expect(target.clip?.id).toBe('b');
    expect(target.leftOut.map((clip) => clip.id)).toEqual(['a']);
    expect(phoneSpeedLeftOutNote(target)).toBe('Only this clip changes; the other selected clip (Clip a) keeps its speed. Select a clip on its own to change it.');

    useTimelineStore.setState({ selectedClipIds: new Set(['a', 'b', 'c']) });
    expect(phoneSpeedLeftOutNote(phoneSpeedTarget())).toMatch(/the other 2 selected clips keep their speed/);
  });

  it('does not count the linked audio that follows the target as left out', () => {
    useTimelineStore.setState({
      clips: [video('v', { linkedClipId: 'au' }), createMockClip({ id: 'au', linkedClipId: 'v', source: { type: 'audio', naturalDuration: 4 } as TimelineClip['source'] })],
      selectedClipIds: new Set(['v', 'au']),
      primarySelectedClipId: 'v',
    });
    const target = phoneSpeedTarget();
    expect(target.clip?.id).toBe('v');
    expect(target.leftOut).toEqual([]);
    expect(phoneSpeedLeftOutNote(target)).toBeNull();
  });

  it('falls back to the first selected clip and is empty without a selection', () => {
    useTimelineStore.setState({ clips: [video('a'), video('b')], selectedClipIds: new Set(['b']), primarySelectedClipId: null });
    expect(phoneSpeedTarget().clip?.id).toBe('b');
    useTimelineStore.setState({ selectedClipIds: new Set() });
    expect(phoneSpeedTarget()).toEqual({ clip: undefined, leftOut: [] });
  });
});
