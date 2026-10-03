import { describe, expect, it, vi } from 'vitest';
import type { TimelineClip } from '../../src/types/timeline';
import type { FrameContext } from '../../src/services/layerBuilder/types';
import type { FrameContextLike } from '../../src/engine/export/layerBuilder/contracts';
import {
  BACKWARD_FRAME_EPSILON, clipSourceTimeToLocal, createClipSpeedSource,
  resolveClipSourceTime, resolveClipSourceWindow, videoFrameSourceTime,
} from '../../src/services/timeline/retime/clipRetime';
import { resolveAudioPreviewRetime } from '../../src/services/timeline/retime/clipAudioRetime';
import { splitClipSourceWindow, trimClipSourceEdge } from '../../src/services/timeline/retime/clipEdgeRetime';
import { getClipTimeInfo, getClipSourceTimeAtTimelineTime } from '../../src/services/layerBuilder/FrameContext';
import { getClipSourceWindowTime, getMappedClipSourceTime } from '../../src/engine/export/layerBuilder/timing';
import { getRamPreviewClipTime, getNestedRamPreviewClipTime } from '../../src/services/ramPreview/clipTiming';
import { getNestedClipSourceTime } from '../../src/services/layerBuilder/layerBuilderNestedSourceTiming';
import { visitNestedClipsAtTime } from '../../src/services/timeline/retime/nestedClipRetime';
import { timelineToSourceTime } from '../../src/engine/parallelDecode/clipWindow';
import { getClipWarmupSourceTime } from '../../src/engine/export/clipPreparation/mediaElements';
import { temporalClipSource, temporalSourceTime } from '../../src/effects/time/temporalClipSource';

vi.mock('../../src/stores/timeline', () => ({ useTimelineStore: { getState: () => ({ clips: [], clipKeyframes: new Map() }) } }));
vi.mock('../../src/stores/mediaStore', () => ({ useMediaStore: { getState: () => ({ files: [] }) } }));
vi.mock('../../src/services/mediaRuntime/runtimePlayback', () => ({ peekRuntimeFrameProvider: vi.fn() }));
vi.mock('../../src/engine/export/clipPreparation/sourceResolution', () => ({}));
vi.mock('../../src/engine/export/clipPreparation/admission', () => ({}));
vi.mock('../../src/services/timeline/exportRuntimeReporting', () => ({}));

const fps = 30;
function clip(overrides: Partial<TimelineClip> = {}): TimelineClip {
  return { id: 'frame-boundary', trackId: 'video', startTime: 0, duration: 4,
    inPoint: 2, outPoint: 6, speed: 1, reversed: false, effects: [],
    source: { type: 'video', mediaFileId: 'media', naturalDuration: 8 },
    ...overrides } as TimelineClip;
}
function context(c: TimelineClip, local: number): FrameContext & FrameContextLike {
  const speed = createClipSpeedSource(c);
  return { playheadPosition: c.startTime + local, visualPlayheadPosition: c.startTime + local,
    getSourceTimeForClip: (_id: string, t: number) => speed.integrate(t),
    getInterpolatedSpeed: (_id: string, t: number) => speed.speedAt(t),
  } as FrameContext & FrameContextLike;
}
function selections(c: TimelineClip, local: number): number[] {
  const ctx = context(c, local);
  const info = getClipTimeInfo(ctx, c);
  const temporal = temporalClipSource(c, local, [])!;
  return [info.clipTime, info.visualClipTime,
    getClipSourceTimeAtTimelineTime(ctx, c, c.startTime + local),
    getClipSourceWindowTime(c, local, ctx),
    getRamPreviewClipTime(c, c.startTime + local, ctx),
    getNestedRamPreviewClipTime(c.startTime + local, c),
    getNestedClipSourceTime(c, local),
    timelineToSourceTime({ ...c, speed: c.speed ?? 1, reversed: c.reversed ?? false },
      c.startTime + local, createClipSpeedSource(c)),
    getClipWarmupSourceTime(c, c.startTime + local, createClipSpeedSource(c)),
    temporalSourceTime(temporal, temporal.localTime),
  ];
}

describe('video frame selection at exact output frame starts', () => {
  it('keeps the reported reversed clip and its identity Warp on the same frame in every consumer', () => {
    const c = clip({ startTime: 10, inPoint: 61 / 60, outPoint: 6, duration: 6 - 61 / 60,
      reversed: true, source: { type: 'video', mediaFileId: 'media', naturalDuration: 30.037 } });
    const warped = { ...c, timeRemap: { kind: 'warp' as const, points: [
      { time: 0, source: 6 }, { time: c.duration, source: c.inPoint },
    ] } };
    for (const local of [0, 1 / 60, 1, 2.5, 4, 4.95]) {
      const plainTimes = selections(c, local);
      selections(warped, local).forEach((time, index) => {
        expect(time).toBeCloseTo(plainTimes[index], 10);
        expect(Math.floor(time * 60)).toBe(Math.floor(plainTimes[index] * 60));
        if (local === 4.95) expect(Math.floor(time * 60)).toBe(62);
      });
    }
  });

  it.each([{ reversed: true, speed: 1 }, { reversed: false, speed: -1 }])(
    'selects the left source frame for reversed=$reversed, speed=$speed', timing => {
      const c = clip(timing);
      for (let k = 0; k < c.duration * fps; k++) {
        const local = k / fps;
        const s = 6 - local;
        const expectedFrame = Math.floor((s - 0.5 / fps) * fps);
        for (const time of selections(c, local)) {
          expect(Math.floor(time * fps)).toBe(expectedFrame);
          expect(time).toBeCloseTo(s - BACKWARD_FRAME_EPSILON, 10);
        }
        // Mid-frame preview and exact-start export must select the same image.
        for (const time of selections(c, (k + 0.5) / fps)) {
          expect(Math.floor(time * fps)).toBe(expectedFrame);
        }
      }
    },
  );

  it.each([{ speed: 1, reversed: false }, { speed: -1, reversed: true }])(
    'keeps forward samples exact for speed=$speed, reversed=$reversed', timing => {
      const c = clip(timing);
      for (let k = 0; k < c.duration * fps; k++) {
        const local = k / fps;
        const exact = resolveClipSourceTime(c, local).sourceTime;
        for (const time of selections(c, local)) expect(time).toBe(exact);
      }
    },
  );

  it('passes the biased composition clock to a forward nested video, including the out boundary', () => {
    const leaf = clip({ id: 'leaf', duration: 8, inPoint: 0, outPoint: 8 });
    const parent = clip({ isComposition: true, reversed: true, nestedClips: [leaf] });
    for (let k = 0; k < parent.duration * fps; k++) {
      const local = k / fps;
      const ctx = context(parent, local);
      const expected = Math.floor((6 - local - 0.5 / fps) * fps);
      const clocks = [getClipTimeInfo(ctx, parent).clipTime,
        getClipSourceWindowTime(parent, local, ctx),
        getRamPreviewClipTime(parent, local, ctx), getNestedClipSourceTime(parent, local)];
      for (const time of clocks) {
        expect(Math.floor(getNestedClipSourceTime(leaf, time) * fps)).toBe(expected);
        const visited: number[] = [];
        visitNestedClipsAtTime(parent, time, (_clip, sample) => visited.push(sample.sourceTime), -1);
        expect(visited).toHaveLength(1);
        expect(Math.floor(visited[0] * fps)).toBe(expected);
      }
    }
    // A cut at source 6 belongs to the outgoing child when the parent runs backward.
    const outgoing = { ...leaf, duration: 6 };
    const incoming = { ...leaf, id: 'incoming', startTime: 6, duration: 2 };
    const visited: string[] = [];
    visitNestedClipsAtTime({ ...parent, nestedClips: [outgoing, incoming] },
      getNestedClipSourceTime(parent, 0), child => visited.push(child.id), -1);
    expect(visited).toEqual(['leaf']);
  });

  it('biases a reversed nested child once before composing the playback rate', () => {
    const leaf = clip({ reversed: true });
    const parent = clip({ isComposition: true, inPoint: 0, outPoint: 4, nestedClips: [leaf] });
    for (let k = 0; k < 120; k++) {
      const times: number[] = [];
      visitNestedClipsAtTime(parent, k / fps, (_clip, sample) => times.push(sample.sourceTime));
      expect(times).toHaveLength(1);
      expect(Math.floor(times[0] * fps)).toBe(Math.floor((6 - (k + 0.5) / fps) * fps));
    }
  });

  it('biases negative transition-map rates but leaves holds and explicit freezes exact', () => {
    const mapped = clip({ transitionSourceMap: { version: 1, segments: [
      { kind: 'linear', compStart: 0, compEnd: 4, sourceStart: 6, sourceEnd: 2 },
    ] } });
    expect(getMappedClipSourceTime(mapped, 1)).toBe(5 - BACKWARD_FRAME_EPSILON);
    expect(getMappedClipSourceTime(clip(), 1)).toBeUndefined();
    for (const c of [clip({ reversed: true, timeRemap: { kind: 'freeze', sourceTime: 5 } }),
      clip({ reversed: true, transitionSourceTimeOverride: 5 })]) {
      for (const time of selections(c, 1)) expect(time).toBe(5);
    }
    expect(videoFrameSourceTime({ sourceTime: 0, sourceRate: -1 })).toBe(0);
    expect(videoFrameSourceTime({ sourceTime: 2, sourceRate: -1 }, 2)).toBe(2);
  });

  it('keeps timing, relative clocks, inverse, split, trim and audio sample positions exact', () => {
    const c = clip({ reversed: true });
    expect(resolveClipSourceTime(c, 1).sourceTime).toBe(5);
    expect(clipSourceTimeToLocal(c, 5)).toBe(1);
    expect(resolveClipSourceWindow(c, 0, 1)).toMatchObject({ sourceStart: 6, sourceEnd: 5 });
    expect(splitClipSourceWindow(c, 0, 1)).toEqual({ inPoint: 5, outPoint: 6 });
    expect(trimClipSourceEdge(c, 'start', 1)).toEqual({ outPoint: 5 });
    const info = getClipTimeInfo(context(c, 1), c);
    expect(info.sourceTime).toBe(-1);
    expect(info.visualSourceTime).toBe(-1);
    const audio = { ...c, source: { type: 'audio' as const } };
    expect(resolveAudioPreviewRetime(audio, 1).sourceTime).toBe(5);
    expect(getClipTimeInfo(context(audio, 1), audio).clipTime).toBe(5);
    expect(getClipSourceWindowTime(audio, 1, context(audio, 1))).toBe(5);
    expect(getClipSourceTimeAtTimelineTime(context(audio, 1), audio, 1)).toBe(5);
  });
});
