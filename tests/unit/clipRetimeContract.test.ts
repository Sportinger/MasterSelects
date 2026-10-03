import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TimelineClip } from '../../src/types/timeline';
import type { Keyframe } from '../../src/types/keyframes';
import type { FrameContext } from '../../src/services/layerBuilder/types';
import type { FrameContextLike } from '../../src/engine/export/layerBuilder/contracts';
import {
  clipSourceTimeToLocal, createClipSpeedSource, createStoreSpeedSource,
  resolveClipSourceTime, resolveClipSourceWindow,
} from '../../src/services/timeline/retime/clipRetime';
import { calculateSourceTime, getSpeedAtTime } from '../../src/utils/speedIntegration';
import { getClipSourceWindowTime } from '../../src/engine/export/layerBuilder/timing';
import { timelineToSourceTime } from '../../src/engine/parallelDecode/clipWindow';
import { getRamPreviewClipTime } from '../../src/services/ramPreview/clipTiming';
import { getClipWarmupSourceTime } from '../../src/engine/export/clipPreparation/mediaElements';
import { temporalClipSource, temporalSourceTime } from '../../src/effects/time/temporalClipSource';
import { getClipSourceTimeAtTimelineTime, getClipTimeInfo } from '../../src/services/layerBuilder/FrameContext';
import { getClipSampleTimeNearPlayhead, getClipStartTime } from '../../src/services/layerBuilder/videoSyncTimelineQueries';

const state = vi.hoisted(() => ({ clips: [] as TimelineClip[], clipKeyframes: new Map<string, Keyframe[]>() }));
vi.mock('../../src/stores/timeline', () => ({ useTimelineStore: { getState: () => state } }));
vi.mock('../../src/stores/mediaStore', () => ({ useMediaStore: { getState: () => ({ files: [] }) } }));
vi.mock('../../src/services/mediaRuntime/runtimePlayback', () => ({ peekRuntimeFrameProvider: vi.fn() }));
vi.mock('../../src/engine/export/clipPreparation/sourceResolution', () => ({}));
vi.mock('../../src/engine/export/clipPreparation/admission', () => ({}));
vi.mock('../../src/services/timeline/exportRuntimeReporting', () => ({}));

function clip(overrides: Partial<TimelineClip> = {}): TimelineClip {
  return {
    id: 'retime', startTime: 10, duration: 8, inPoint: 2, outPoint: 18,
    speed: 1, reversed: false, effects: [], source: { type: 'video', mediaFileId: 'media' },
    ...overrides,
  } as TimelineClip;
}

function key(time: number, value: number, hold = false): Keyframe {
  return { id: `speed-${time}`, clipId: 'retime', property: 'speed', time, value, easing: 'linear', hold };
}

function context(c: TimelineClip, keys: Keyframe[], local: number): FrameContext & FrameContextLike {
  const source = createClipSpeedSource(c, keys);
  return {
    playheadPosition: c.startTime + local,
    visualPlayheadPosition: c.startTime + local,
    getSourceTimeForClip: (_id: string, time: number) => source.integrate(time),
    getInterpolatedSpeed: (_id: string, time: number) => source.speedAt(time),
  } as FrameContext & FrameContextLike;
}

beforeEach(() => { state.clips = []; state.clipKeyframes.clear(); });

const matrix = [1, 2, 0.5, -1, -2].flatMap(speed => [false, true].flatMap(reversed =>
  [0, 3].flatMap(inPoint => ['constant', 'ramp', 'hold'].map(curve => ({ speed, reversed, inPoint, curve })))));

describe('video retime consumer parity', () => {
  it.each(matrix)('$speed / reversed=$reversed / trim=$inPoint / $curve', ({ speed, reversed, inPoint, curve }) => {
    const c = clip({ speed, reversed, inPoint, outPoint: inPoint + 16 });
    const keys = curve === 'constant' ? [] : [key(0, speed, curve === 'hold'), key(2, speed / 2), key(4, speed)];
    state.clips = [c]; state.clipKeyframes.set(c.id, keys);
    const source = createClipSpeedSource(c, keys);
    const locals = [0, 0.125, 1, 2, 3.75, 6, 8];
    const forward: number[] = [];
    for (const local of locals) {
      const ctx = context(c, keys, local);
      const base = (getSpeedAtTime(keys, 0, speed) >= 0 ? c.inPoint : c.outPoint) + calculateSourceTime(keys, local, speed);
      const bounded = Math.max(c.inPoint, Math.min(c.outPoint, base));
      const expected = reversed ? c.inPoint + c.outPoint - bounded : bounded;
      const result = resolveClipSourceTime(c, local, source);
      expect(result.sourceTime).toBeCloseTo(expected, 4);
      expect(resolveClipSourceTime(c, local, createStoreSpeedSource(c.id, ctx))).toEqual(result);
      expect(getClipSourceWindowTime(c, local, ctx)).toBeCloseTo(expected, 4);
      expect(getRamPreviewClipTime(c, c.startTime + local, ctx)).toBeCloseTo(expected, 4);
      expect(getClipWarmupSourceTime(c, c.startTime + local, source)).toBeCloseTo(expected, 4);
      // Default export preparation adapter reads the actual keyframe snapshot too.
      expect(getClipWarmupSourceTime(c, c.startTime + local)).toBeCloseTo(expected, 4);
      const window = { ...c, clipId: c.id, speed, reversed };
      expect(timelineToSourceTime(window, c.startTime + local, source)).toBeCloseTo(expected, 4);
      expect(timelineToSourceTime(window, c.startTime + local)).toBeCloseTo(expected, 4);
      expect(getClipSourceTimeAtTimelineTime(ctx, c, c.startTime + local)).toBeCloseTo(expected, 4);
      expect(getClipTimeInfo(ctx, c).clipTime).toBeCloseTo(expected, 4);
      expect(getClipTimeInfo(ctx, c).sourceRate).toBe(result.sourceRate);
      const temporal = temporalClipSource(c, local, keys)!;
      expect(temporalSourceTime(temporal, temporal.localTime)).toBeCloseTo(expected, 4);
      forward.push(result.sourceTime);
    }
    expect(locals.toReversed().map(local => resolveClipSourceTime(c, local, source).sourceTime)).toEqual(forward.toReversed());
    expect(getClipStartTime(context(c, keys, 0), c)).toBeCloseTo(forward[0], 4);
  });

  it('preserves visual quantization separately from exact timeline sampling', () => {
    const c = clip({ reversed: true, speed: 2 });
    const ctx = context(c, [], 1.019);
    ctx.visualPlayheadPosition = c.startTime + 1;
    expect(getClipTimeInfo(ctx, c).clipTime).toBeCloseTo(15.962, 4);
    expect(getClipTimeInfo(ctx, c).visualClipTime).toBeCloseTo(16, 4);
  });

  it('always chooses the starting trim endpoint from speed at zero, even after a direction change', () => {
    const c = clip();
    const keys = [key(0, 2), key(2, -2), key(4, 2)];
    const ctx = context(c, keys, 2);
    expect(getClipSampleTimeNearPlayhead(ctx, c)).toBeCloseTo(c.inPoint, 10);
    const bounds = resolveClipSourceWindow(c, 0, 4, createClipSpeedSource(c, keys));
    for (let local = 0; local <= 4; local += 0.05) {
      const sample = resolveClipSourceTime(c, local, createClipSpeedSource(c, keys)).sourceTime;
      expect(sample).toBeGreaterThanOrEqual(bounds.minSourceTime);
      expect(sample).toBeLessThanOrEqual(bounds.maxSourceTime);
    }
  });
});

describe('retime boundaries, precedence and inverse', () => {
  it.each([1, 2, 0.5, -1, -2])('mirrors and round-trips constant speed %s', speed => {
    for (const reversed of [false, true]) {
      const c = clip({ speed, reversed, duration: 16 / Math.abs(speed) });
      for (const local of [0, c.duration / 4, c.duration / 2, c.duration]) {
        const source = resolveClipSourceTime(c, local).sourceTime;
        expect(clipSourceTimeToLocal(c, source)).toBeCloseTo(local, 10);
        expect(source + resolveClipSourceTime({ ...c, reversed: !reversed }, local).sourceTime)
          .toBeCloseTo(c.inPoint + c.outPoint, 10);
      }
      expect(resolveClipSourceTime(c, -1)).toMatchObject({ clamped: true, isHold: true, sourceRate: 0 });
      expect(resolveClipSourceTime(c, c.duration + 1)).toMatchObject({ clamped: true, isHold: true, sourceRate: 0 });
      const bounds = resolveClipSourceWindow(c, 1, 2);
      const times = [resolveClipSourceTime(c, 1).sourceTime, resolveClipSourceTime(c, 2).sourceTime];
      expect(bounds.minSourceTime).toBe(Math.min(...times));
      expect(bounds.maxSourceTime).toBe(Math.max(...times));
    }
  });

  it('starts reversed positive speed at outPoint and reverses the effective rate', () => {
    expect(resolveClipSourceTime(clip({ reversed: true }), 0))
      .toMatchObject({ sourceTime: 18, sourceRate: -1, mirrored: true, isHold: false });
    expect(resolveClipSourceTime(clip({ reversed: true, speed: -2 }), 0))
      .toMatchObject({ sourceTime: 2, sourceRate: 2, mirrored: true });
  });

  it('respects keyframe holds and zero-speed freezes', () => {
    const c = clip({ reversed: true });
    const source = createClipSpeedSource(c, [key(0, 2, true), key(1, 0, true), key(3, -1)]);
    expect(resolveClipSourceTime(c, 0.5, source)).toMatchObject({ sourceTime: 17, sourceRate: -2 });
    expect(resolveClipSourceTime(c, 2, source)).toMatchObject({ sourceTime: 16, sourceRate: 0, isHold: true });
  });

  it('gives absolute transition requests precedence and never mirrors their source time', () => {
    const c = clip({ reversed: true, transitionSourceTimeOverride: 8, transitionSourceHold: true,
      transitionSourceMap: { version: 1, segments: [
        { kind: 'linear', compStart: 0, compEnd: 2, sourceStart: 20, sourceEnd: 24 },
        { kind: 'hold', compStart: 2, compEnd: 4, sourceTime: 30 },
      ] } });
    expect(resolveClipSourceTime(c, 1)).toMatchObject({ sourceTime: 22, sourceRate: 2, mirrored: false });
    expect(resolveClipSourceTime(c, 3)).toMatchObject({ sourceTime: 30, isHold: true });
    expect(resolveClipSourceWindow(c, 0, 4)).toMatchObject({ minSourceTime: 20, maxSourceTime: 30 });
    expect(resolveClipSourceTime({ ...c, transitionSourceMap: undefined }, 1))
      .toMatchObject({ sourceTime: 8, sourceRate: 0, mirrored: false, isHold: true });
    expect(resolveClipSourceTime({ ...c, transitionSourceMap: undefined, transitionSourceTimeOverride: undefined }, 1))
      .toMatchObject({ sourceTime: 2, sourceRate: 0, mirrored: false, isHold: true });
  });

  it('keeps section bypass and Slit Scan factors identical to the store primitives', () => {
    const c = clip({ speed: -2, reversed: true, videoInspectorSections: { speedChange: false },
      effects: [{ id: 'scan', name: 'Slit Scan', type: 'slit-scan', enabled: true, params: { bypassSlowdown: true, timeFactor: 3 } }] });
    expect(resolveClipSourceTime(c, 1)).toMatchObject({ sourceTime: 15, sourceRate: -3 });
    const temporal = temporalClipSource(c, 1, [])!;
    // Backward video selection sits 10 microseconds left of the exact clock.
    expect(temporalSourceTime(temporal, temporal.localTime)).toBeCloseTo(15, 4);
    expect(clipSourceTimeToLocal(c, 15)).toBe(1);
  });

  it('rejects non-invertible or out-of-domain source times', () => {
    expect(clipSourceTimeToLocal(clip({ speed: 0 }), 2)).toBeUndefined();
    expect(clipSourceTimeToLocal(clip({ transitionSourceHold: true }), 2)).toBeUndefined();
    expect(clipSourceTimeToLocal({ ...clip(), keyframes: [key(0, 1), key(1, -1)] }, 3)).toBeUndefined();
    expect(clipSourceTimeToLocal(clip(), 20)).toBeUndefined();
    expect(clipSourceTimeToLocal(clip({ duration: 20 }), 18)).toBeUndefined();
  });
});
