import { expect, it } from 'vitest';
import { slitScanPlaybackFactor } from '../../src/effects/time/slit-scan/timeFactor';
import { temporalClipSource, temporalSourceTime } from '../../src/effects/time/temporalClipSource';
import { reconcileSlitScanDuration } from '../../src/stores/timeline/helpers/slitScanDuration';
import { createKeyframeTransformInterpolationActions } from '../../src/stores/timeline/keyframes/keyframeTransformInterpolationActions';
import type { TimelineClip } from '../../src/types/timeline';
import { slitScanPlaybackLookahead } from '../../src/effects/time/slit-scan/playbackLookahead';

function makeClip(params: Record<string, number | boolean> = {}, speed = 1): TimelineClip {
  return { id: 'clip', duration: 10, inPoint: 5, outPoint: 15, speed,
    source: { type: 'video', mediaFileId: 'video' }, effects: [{ id: 'scan', type: 'slit-scan', enabled: true, params }] } as TimelineClip;
}

it('keeps old effects and disabled bypass on the original playback clock', () => {
  expect(slitScanPlaybackFactor(makeClip({ timeFactor: 4 }))).toBe(1);
  expect(slitScanPlaybackFactor(makeClip({ timeFactor: 4, bypassSlowdown: false }))).toBe(1);
  expect(slitScanPlaybackFactor(makeClip({ timeFactor: 1, bypassSlowdown: true }))).toBe(1);
});

it('keeps half a second of source lookahead at 8x without exceeding spare GPU slots', () => {
  const clip = makeClip({ timeFactor: 8, bypassSlowdown: true, bypassDurationFactor: 8 });
  const clock = temporalClipSource(clip, 0.25, [])!;
  const frames = Array.from({ length: 600 }, (_, i) => ({ time: i / 24, duration: 1 / 24 }));
  const ahead = slitScanPlaybackLookahead(clock, frames, new Set(), new Map(), 100);
  expect(ahead).toHaveLength(96);
  expect(ahead.at(-1)! - ahead[0]).toBeCloseTo(95 / 24);
  expect(slitScanPlaybackLookahead(clock, frames, new Set(), new Map(), 10)).toHaveLength(10);
  const reverse = slitScanPlaybackLookahead({ ...clock, speed: -1 }, frames, new Set(), new Map(), 10);
  expect(reverse[0]).toBeGreaterThan(reverse.at(-1)!);
});

it.each([1, -1])('uses the same accelerated time for normal playback, export and history at speed %s', speed => {
  const original = makeClip({ timeFactor: 4 }, speed);
  const clip = reconcileSlitScanDuration(original, makeClip({ timeFactor: 4, bypassSlowdown: true }, speed));
  const state = { clips: [clip], clipKeyframes: new Map() };
  const actions = createKeyframeTransformInterpolationActions(() => {}, () => state as any, {} as any);
  const clock = temporalClipSource(clip, 2, [])!;
  expect(actions.getInterpolatedSpeed('clip', 2)).toBe(4 * speed);
  expect(actions.getSourceTimeForClip('clip', 2)).toBe(8 * speed);
  expect(clock.duration).toBe(10);
  expect(temporalSourceTime(clock, clock.localTime)).toBe(speed > 0 ? 13 : 7);
  expect(clip.duration).toBe(2.5);
  expect(clip.speed).toBe(speed);
});

it('shortens a clip, follows factor edits, and restores duration on bypass/removal', () => {
  const clip = { duration: 40, effects: [{ id: 'scan', type: 'slit-scan', enabled: true,
    params: { timeFactor: 4 } }] } as TimelineClip;
  const enable = { ...clip, effects: [{ ...clip.effects[0], params: { timeFactor: 4, bypassSlowdown: true } }] };
  const accelerated = reconcileSlitScanDuration(clip, enable);
  expect(accelerated.duration).toBe(10);
  const edited = reconcileSlitScanDuration(accelerated, { ...accelerated,
    effects: [{ ...accelerated.effects[0], params: { ...accelerated.effects[0].params, timeFactor: 8 } }] });
  expect(edited.duration).toBe(5);
  const disabled = reconcileSlitScanDuration(edited, { ...edited, effects: [{ ...edited.effects[0], enabled: false }] });
  expect(disabled.duration).toBe(40);
  expect(reconcileSlitScanDuration(edited, { ...edited, effects: [] }).duration).toBe(40);
  expect(reconcileSlitScanDuration(edited, edited)).toBe(edited);
});

