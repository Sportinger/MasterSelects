import type { Keyframe } from '../../src/types/keyframes';
import { toggleClipWarpAction } from '../../src/stores/timeline/clip/clipTimeRemapActions';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClipTimeRemap, TimelineClip } from '../../src/types/timeline';
import { createMockClip, createMockTrack } from '../helpers/mockData';
import { BACKWARD_FRAME_EPSILON, clipSourceTimeToLocal, createClipSpeedSource, createIdentityClipWarp,
  resolveClipSourceTime, resolveClipSourceWindow, videoFrameSourceTime } from '../../src/services/timeline/retime/clipRetime';
import { sampleWarp, sliceWarp, validWarpPoints } from '../../src/services/timeline/retime/clipWarp';
import { splitClipSourceWindow, trimClipSourceEdge } from '../../src/services/timeline/retime/clipEdgeRetime';
import { quantizeRetimeClipTiming } from '../../src/services/timeline/retime/clipRetimeQuantization';
import { applySplitAtTimesOperation } from '../../src/stores/timeline/editOperations/splitBatchOperations';
import { applyTrimClipOperation, applyTrimEdgeToTimeOperation, applyRippleTrimEdgeToTimeOperation } from '../../src/stores/timeline/editOperations/trimOperations';
import { computeTrimTiming, trimOriginalsFromClip } from '../../src/components/timeline/utils/clipTrimTiming';
import { collectNestedVideoClips } from '../../src/engine/export/clipPreparation/nestedVideoClips';
import { ClipAudioRenderService } from '../../src/services/audio/ClipAudioRenderService';
import { createBuffer } from '../../src/engine/audio/audioBufferFactory';
import { needsProcessedAudioPreview } from '../../src/services/audio/preview/processedAudioPreviewPolicy';
import { processedAudioPreviewKey } from '../../src/services/audio/preview/ProcessedAudioPreviewCache';
import { resolveAudioPreviewRetime } from '../../src/services/timeline/retime/clipAudioRetime';
import { createSerializableTimelineState } from '../../src/stores/timeline/serialization/serializableTimelineState';
import { applyCommonRestoredClipFields } from '../../src/stores/timeline/serialization/loadStateCommonClipRestore';
import { convertRuntimeProjectClip } from '../../src/services/project/projectCompositionSerialization';
import { classifyFields } from '../../src/services/project/repository/domains/fieldOwnership';
import { ProjectClipFields } from '../../src/services/project/repository/domains/fieldClassification2';
import { splitNestedDomain } from '../../src/services/project/repository/domains/nestedOwnership';
import { useTimelineStore } from '../../src/stores/timeline';
import { captureSnapshot, getHistoryStateView, initHistoryStoreRefs, setHistoryCallbacks,
  useHistoryStore, undo, redo } from '../../src/stores/historyStore';

vi.mock('../../src/stores/timeline/editOperations/activeCompositionFrameRate', () => ({ getActiveCompositionFrameRate: () => 30 }));
const track = createMockTrack({ id: 'v', type: 'video' });
const audioTrack = createMockTrack({ id: 'a', type: 'audio' });
const warp = (pairs: number[][]): Extract<ClipTimeRemap, { kind: 'warp' }> => ({
  kind: 'warp', points: pairs.map(([time, source]) => ({ time, source })),
});
const remap = warp([[1, 2], [3, 6], [5, 4], [6, 4]]);
function clip(patch: Partial<TimelineClip> = {}): TimelineClip {
  return createMockClip({ id: 'warp', trackId: 'v', startTime: 10, duration: 8,
    inPoint: 2, outPoint: 6, speed: 3, reversed: true, timeRemap: remap,
    source: { type: 'video', naturalDuration: 20 }, ...patch });
}
function assertSamples(before: TimelineClip, after: TimelineClip, shift = after.startTime - before.startTime) {
  for (let i = 0; i < Math.ceil(after.duration * 30); i++) {
    const t = i / 30;
    expect(resolveClipSourceTime(after, t).sourceTime).toBeCloseTo(resolveClipSourceTime(before, t + shift).sourceTime, 8);
    expect(videoFrameSourceTime(resolveClipSourceTime(after, t))).toBeCloseTo(
      videoFrameSourceTime(resolveClipSourceTime(before, t + shift)), 8);
  }
}

describe('Warp source contract', () => {
  it('interpolates in local seconds, ignores speed/reverse, and holds outside and on flats', () => {
    const c = clip();
    expect(resolveClipSourceTime(c, 2)).toMatchObject({ sourceTime: 4, sourceRate: 2, isHold: false, mirrored: false });
    expect(resolveClipSourceTime(c, 4)).toMatchObject({ sourceTime: 5, sourceRate: -1, isHold: false });
    for (const t of [-3, 0, 0.99, 5, 5.5, 6, 100])
      expect(resolveClipSourceTime(c, t)).toMatchObject({ sourceTime: t < 1 ? 2 : 4, sourceRate: 0, isHold: true });
    expect(resolveClipSourceTime(c, 1).sourceRate).toBe(2);
    expect(resolveClipSourceTime(c, 3).sourceRate).toBe(-1);
    expect(clipSourceTimeToLocal(c, 5)).toBeUndefined();
  });

  it('clamps after interpolation to media or composition duration, with bounded backward frames', () => {
    const c = clip({ timeRemap: warp([[0, -2], [2, 10], [4, -2]]), source: { type: 'video', naturalDuration: 8 } });
    expect(resolveClipSourceTime(c, 0)).toMatchObject({ sourceTime: 0, sourceRate: 0, clamped: true });
    expect(resolveClipSourceTime(c, 1).sourceTime).toBe(4);
    expect(resolveClipSourceTime(c, 2)).toMatchObject({ sourceTime: 8, sourceRate: 0, clamped: true });
    expect(videoFrameSourceTime(resolveClipSourceTime(c, 3))).toBe(4 - BACKWARD_FRAME_EPSILON);
    expect(videoFrameSourceTime(resolveClipSourceTime(c, 4))).toBe(0);
    expect(resolveClipSourceTime({ ...c, source: undefined }, 2).sourceTime).toBe(6);
    expect(resolveClipSourceTime({ ...c, isComposition: true }, 2).sourceTime).toBe(8);
  });

  it('finds exact interior extrema and honors transition precedence', () => {
    const c = clip({ timeRemap: warp([[0, 1], [2, 9], [4, 0], [6, 4]]) });
    expect(resolveClipSourceWindow(c, 1, 5)).toEqual({ sourceStart: 5, sourceEnd: 2, minSourceTime: 0, maxSourceTime: 9 });
    expect(resolveClipSourceWindow(c, 5, 1)).toEqual({ sourceStart: 2, sourceEnd: 5, minSourceTime: 0, maxSourceTime: 9 });
    expect(resolveClipSourceWindow(c, 2.5, 3)).toMatchObject({ minSourceTime: 4.5, maxSourceTime: 6.75 });
    const mapped = { ...c, transitionSourceMap: { version: 1 as const, segments: [
      { kind: 'linear' as const, compStart: 0, compEnd: 8, sourceStart: 3, sourceEnd: 11 },
    ] }, transitionSourceTimeOverride: 15, transitionSourceHold: true };
    expect(resolveClipSourceTime(mapped, 2).sourceTime).toBe(5);
    expect(resolveClipSourceTime({ ...mapped, transitionSourceMap: undefined }, 2).sourceTime).toBe(15);
    expect(resolveClipSourceTime({ ...mapped, transitionSourceMap: undefined, transitionSourceTimeOverride: undefined }, 2).sourceTime).toBe(2);
    expect(resolveClipSourceWindow({ ...c, transitionSourceTimeOverride: 15 }, 0, 6)).toMatchObject({ minSourceTime: 15, maxSourceTime: 15 });
  });

  it.each([1, 2, -1, -2].flatMap(speed => [false, true].map(reversed => ({ speed, reversed }))))(
    'preserves every visible frame when enabling on affine speed=$speed reverse=$reversed', timing => {
      const c = clip({ ...timing, duration: 4 / Math.abs(timing.speed), timeRemap: undefined });
      const enabled = { ...c, timeRemap: createIdentityClipWarp(c) };
      expect(enabled.timeRemap.points).toHaveLength(2);
      assertSamples(c, enabled);
    },
  );

  it('preserves freeze on enable and inserts points on the raw curve without moving clamp crossings', () => {
    const c = clip({ timeRemap: { kind: 'freeze', sourceTime: 7 } });
    assertSamples(c, { ...c, timeRemap: createIdentityClipWarp(c) });
    const original = clip({ timeRemap: warp([[0, -5], [4, 15]]) });
    const points = (original.timeRemap as typeof remap).points;
    const inserted = { ...original, timeRemap: { kind: 'warp' as const, points: [...points,
      { time: 0.5, source: sampleWarp(points, 0.5).sourceTime }].toSorted((a, b) => a.time - b.time) } };
    assertSamples(original, inserted);
  });
});

describe('frame-aware Warp initialization', () => {
  it.each([24, 30, 60])('approximates a speed ramp below half a source frame at %s fps', fps => {
    const c = clip({ timeRemap: undefined, duration: 4, inPoint: 1, outPoint: 19, speed: 1, reversed: false });
    const keys: Keyframe[] = [
      { id: 'a', clipId: c.id, property: 'speed', time: 0, value: 1, easing: 'linear' },
      { id: 'b', clipId: c.id, property: 'speed', time: 4, value: 5, easing: 'linear' },
    ];
    const timing = { ...c, keyframes: keys }, source = createClipSpeedSource(timing);
    const timeRemap = createIdentityClipWarp(timing, source, fps);
    expect(timeRemap.points.length).toBeGreaterThan(2);
    expect(timeRemap.points.length).toBeLessThanOrEqual(256);
    for (let i = 0; i < 4 * fps * 16; i++) {
      const time = i / (fps * 16);
      expect(Math.abs(resolveClipSourceTime({ ...c, timeRemap }, time).sourceTime -
        resolveClipSourceTime(c, time, source).sourceTime)).toBeLessThan(0.5 / fps);
    }
  });

  it('keeps a constant-speed interior clamp at its exact hit time', () => {
    const c = clip({ duration: 8, speed: 2, reversed: false, timeRemap: undefined });
    const timeRemap = createIdentityClipWarp(c);
    expect(timeRemap.points).toEqual([{ time: 0, source: 2 }, { time: 2, source: 6 }, { time: 8, source: 6 }]);
    assertSamples(c, { ...c, timeRemap });
  });

  it('does not duplicate the endpoint when the clamp crossing rounds just below the duration', () => {
    // Browser repro: 60 fps trim values; out - in rounds 1e-16 below duration.
    const c = clip({ duration: 4.983333333333333, inPoint: 1.0166666666666675, outPoint: 6, speed: 1,
      reversed: true, timeRemap: undefined });
    const timeRemap = createIdentityClipWarp(c, createClipSpeedSource(c), 60);
    expect(timeRemap.points).toHaveLength(2);
    assertSamples(c, { ...c, timeRemap });
  });

  it.each([1, -1].flatMap(speed => [false, true].flatMap(reversed => [0, 0.15].map(phase => ({ speed, reversed, phase })))))(
    'retains loop output frames using one-frame seams: $speed / $reversed / $phase', timing => {
      const fps = 30, c = clip({ speed: timing.speed, reversed: timing.reversed, duration: 9, timeRemap: { kind: 'loop', phase: timing.phase } });
      const timeRemap = createIdentityClipWarp(c, createClipSpeedSource(c), fps);
      const bridges = timeRemap.points.slice(1).map((b, i) => ({ a: timeRemap.points[i], b }))
        .filter(({ a, b }) => Math.abs((b.source - a.source) / (b.time - a.time)) > 10);
      expect(bridges).toHaveLength(timing.speed < 0 && timing.phase > 0 ? 3 : 2);
      for (const { a, b } of bridges) expect(b.time - a.time).toBeCloseTo(1 / fps, 9);
      for (let frame = 0; frame < c.duration * fps; frame++) {
        const local = frame / fps;
        const expected = videoFrameSourceTime(resolveClipSourceTime(c, local));
        const actual = videoFrameSourceTime(resolveClipSourceTime({ ...c, timeRemap }, local));
        expect(Math.floor((actual + 1e-9) * fps)).toBe(Math.floor((expected + 1e-9) * fps));
      }
    },
  );

  it('keeps frozen mappings at two equal source points and rejects unrepresentable loops', () => {
    const frozen = createIdentityClipWarp(clip({ timeRemap: { kind: 'freeze', sourceTime: 10 } }));
    expect(frozen.points).toEqual([{ time: 0, source: 10 }, { time: 8, source: 10 }]);
    expect(() => createIdentityClipWarp(clip({ duration: 600, speed: 1, timeRemap: { kind: 'loop' } })))
      .toThrow('256 Warp points');
  });
});

describe('Warp split, trim and nested admission', () => {
  it('preserves samples in shared split windows and multi-splits with linked audio', () => {
    const c = clip({ linkedClipId: 'audio' });
    const audio = clip({ id: 'audio', trackId: 'a', linkedClipId: c.id, source: { type: 'audio', naturalDuration: 20 } });
    assertSamples(c, { ...c, startTime: 12.5, duration: 3, ...splitClipSourceWindow(c, 2.5, 5.5) });
    const result = applySplitAtTimesOperation({ id: 'split', type: 'split-at-times', clipId: c.id,
      times: [12.5, 15.5] }, [c, audio], [track, audioTrack]);
    expect(result.warnings).toEqual([]);
    expect(result.clips).toHaveLength(6);
    for (const part of result.clips) { assertSamples(c, part); expect(validWarpPoints((part.timeRemap as typeof remap).points)).toBe(true); }
  });

  it.each([-2, 1.5, 7])('rebases left trim by %s while preserving future points and linked samples', delta => {
    const c = clip({ linkedClipId: 'audio' });
    const audio = clip({ id: 'audio', trackId: 'a', linkedClipId: c.id });
    const timing = computeTrimTiming(c, 'left', trimOriginalsFromClip(c), delta);
    const result = applyTrimClipOperation({ id: 'trim', type: 'trim-clip', clipId: c.id,
      inPoint: timing.newInPoint, outPoint: timing.newOutPoint, startTime: timing.newStartTime,
      duration: timing.newDuration }, [c, audio], [track, audioTrack]);
    expect(result.warnings).toEqual([]);
    for (const part of result.clips) assertSamples(c, part);
  });

  it('extends right with a hold, keeps independent duration, and ripple-left rebases both partners', () => {
    const c = clip({ linkedClipId: 'audio' });
    const audio = clip({ id: 'audio', trackId: 'a', linkedClipId: c.id });
    const right = applyTrimEdgeToTimeOperation({ id: 'right', type: 'trim-edge-to-time', clipIds: [c.id],
      edge: 'end', time: 50 }, [c, audio], [track, audioTrack], new Set());
    expect(right.warnings).toEqual([]);
    for (const part of right.clips) {
      expect(part).toMatchObject({ duration: 40, timeRemap: remap, inPoint: 2, outPoint: 6 });
      expect(quantizeRetimeClipTiming(part, 30).duration).toBe(40);
      assertSamples(c, part);
    }
    const ripple = applyRippleTrimEdgeToTimeOperation({ id: 'ripple', type: 'ripple-trim-edge-to-time',
      clipIds: [c.id], edge: 'start', time: 12.5 }, [c, audio], [track, audioTrack], new Set());
    expect(ripple.warnings).toEqual([]);
    for (const part of ripple.clips) assertSamples(c, part, 2.5);
  });

  it('preserves clamp crossings through edits and obeys the point cap at exterior holds', () => {
    const c = clip({ timeRemap: warp([[0, -8], [4, 24], [8, -8]]) });
    assertSamples(c, { ...c, startTime: 10.5, duration: 7.5, ...trimClipSourceEdge(c, 'start', 0.5) });
    assertSamples(c, { ...c, startTime: 10.5, duration: 4.5, ...splitClipSourceWindow(c, 0.5, 5) });
    const points = Array.from({ length: 256 }, (_, i) => ({ time: i + 1, source: i % 2 }));
    expect(validWarpPoints(sliceWarp(points, -1).points)).toBe(true);
    expect(validWarpPoints(sliceWarp(points, 0, 300).points)).toBe(true);
  });

  it('admits descendants across a non-invertible parent interval', () => {
    const leaf = clip({ id: 'leaf', startTime: 0, duration: 8, inPoint: 0, outPoint: 8, timeRemap: undefined });
    const parent = clip({ startTime: 0, duration: 100, isComposition: true, nestedClips: [leaf], nestedTracks: [track] });
    expect(collectNestedVideoClips(parent, { startTime: 90, endTime: 95 })).toEqual([
      expect.objectContaining({ clip: leaf, mainTimelineStart: 0, mainTimelineDuration: 100 }),
    ]);
  });
});

describe('Warp audio', () => {
  it.each([false, true])('renders signed slopes and silent holds with preservesPitch=%s', async preservesPitch => {
    const sourceBuffer = createBuffer(1, 160, 8);
    sourceBuffer.getChannelData(0).set(Array.from({ length: 160 }, (_, i) => i / 200));
    const c = clip({ preservesPitch });
    const { buffer } = await new ClipAudioRenderService().render({ clip: c, sourceBuffer });
    expect(buffer.duration).toBe(c.duration);
    for (let i = 0; i < buffer.length; i++) {
      const sample = resolveClipSourceTime(c, i / 8);
      const expected = sample.isHold ? 0 : (sample.sourceTime * 8 - (sample.sourceRate < 0 ? 1 : 0)) / 200;
      expect(buffer.getChannelData(0)[i]).toBeCloseTo(expected, 6);
    }
  });

  it('resamples a bounded source range using its absolute origin', async () => {
    const c = clip();
    const full = createBuffer(1, 160, 8), range = createBuffer(1, 40, 8);
    full.getChannelData(0).set(Array.from({ length: 160 }, (_, i) => i / 200));
    range.getChannelData(0).set(full.getChannelData(0).subarray(8, 48));
    const renderer = new ClipAudioRenderService();
    const expected = await renderer.render({ clip: c, sourceBuffer: full });
    const actual = await renderer.render({ clip: c, sourceBuffer: range, sourceIsClipRange: true, sourceBufferStart: 1 });
    expect([...actual.buffer.getChannelData(0)]).toEqual([...expected.buffer.getChannelData(0)]);
  });

  it('rejects incomplete ranged export audio rather than silently dropping out-of-window samples', async () => {
    const c = clip({ timeRemap: warp([[0, 0], [4, 10]]) });
    const sourceBuffer = createBuffer(1, 32, 8);
    await expect(new ClipAudioRenderService().render({ clip: c, sourceBuffer, sourceIsClipRange: true }))
      .rejects.toThrow('complete source window');
  });

  it('selects processed preview and keys every control point', () => {
    const c = clip();
    expect(needsProcessedAudioPreview(c, [])).toBe(true);
    expect(resolveAudioPreviewRetime(c, 2).mutedReason).toContain('processed preview');
    const before = processedAudioPreviewKey(c, [], 'media');
    expect(processedAudioPreviewKey({ ...c, source: { type: 'video', naturalDuration: 3 } }, [], 'media')).not.toBe(before);
    for (const timeRemap of [undefined, warp([[0, 1], [2, 3]]), warp([[0, 1], [3, 3]])])
      expect(processedAudioPreviewKey({ ...c, timeRemap }, [], 'media')).not.toBe(before);
  });
});

describe('Warp atomic action, validation and persistence', () => {
  const initialState = useTimelineStore.getState();
  beforeEach(() => {
    initHistoryStoreRefs({
      timeline: { getState: useTimelineStore.getState, setState: useTimelineStore.setState },
      media: { getState: () => ({ files: [], compositions: [], folders: [], selectedIds: [],
        expandedFolderIds: [], textItems: [], solidItems: [], mathSceneItems: [], motionShapeItems: [],
        signalAssets: [], signalArtifacts: [], signalGraphs: [], signalOperators: [] }), setState: () => undefined },
      dock: { getState: () => ({ layout: null }), setState: () => undefined },
    });
    setHistoryCallbacks({ flushPendingCapture: () => undefined, suppressCaptures: () => undefined });
    useHistoryStore.setState({ batchId: null, batchLabel: null });
    getHistoryStateView().clearHistory();
    useTimelineStore.setState({ clips: [clip({ timeRemap: undefined, linkedClipId: 'audio' }),
      clip({ id: 'audio', trackId: 'a', linkedClipId: 'warp', timeRemap: undefined,
        followsLinkedVideoSpeed: false, source: { type: 'audio', naturalDuration: 20 } })],
      tracks: [track, audioTrack], selectedClipIds: new Set(), layers: [], selectedLayerId: null,
      clipKeyframes: new Map(), markers: [], isExporting: false, compositionGraph: undefined });
    captureSnapshot('initial');
  });
  afterEach(() => { getHistoryStateView().clearHistory(); useTimelineStore.setState(initialState); });

  it('updates both partners in one undo step, clones points, and restores on redo', async () => {
    const input = structuredClone(remap);
    expect(useTimelineStore.getState().setClipTimeRemap('warp', input)).toBe(true);
    input.points[0].source = 99;
    expect(useTimelineStore.getState().clips.map(c => c.timeRemap)).toEqual([remap, remap]);
    expect(getHistoryStateView().undoStack).toHaveLength(1);
    await undo();
    expect(useTimelineStore.getState().clips.every(c => !c.timeRemap)).toBe(true);
    await redo();
    expect(useTimelineStore.getState().clips.map(c => c.timeRemap)).toEqual([remap, remap]);
    expect(useTimelineStore.getState().setClipTimeRemap('audio', null)).toBe(true);
    expect(useTimelineStore.getState().clips.every(c => !c.timeRemap && c.duration === 8)).toBe(true);
  });

  it('uses fresh speed keys for an atomic pair conversion and leaves over-budget clips unchanged', () => {
    const state = useTimelineStore.getState();
    const current = state.clips[0];
    const keys: Keyframe[] = [
      { id: 's0', clipId: current.id, property: 'speed', time: 0, value: 0.1, easing: 'linear' },
      { id: 's1', clipId: current.id, property: 'speed', time: 8, value: 0.8, easing: 'linear' },
    ];
    useTimelineStore.setState({ clipKeyframes: new Map([[current.id, keys]]) });
    expect(toggleClipWarpAction({ get: useTimelineStore.getState, set: useTimelineStore.setState }, current.id)).toBe(true);
    const converted = useTimelineStore.getState().clips;
    expect(converted[0].timeRemap).toEqual(converted[1].timeRemap);
    expect(getHistoryStateView().undoStack).toHaveLength(1);
    const source = createClipSpeedSource(current, keys);
    for (let i = 0; i < 240; i++) expect(Math.abs(resolveClipSourceTime(converted[0], i / 30).sourceTime -
      resolveClipSourceTime(current, i / 30, source).sourceTime)).toBeLessThan(0.5 / 30);
    useTimelineStore.setState({ clips: [clip({ duration: 600, speed: 1, timeRemap: { kind: 'loop' } })], clipKeyframes: new Map() });
    const before = useTimelineStore.getState().clips, historyCount = getHistoryStateView().undoStack.length;
    expect(toggleClipWarpAction({ get: useTimelineStore.getState, set: useTimelineStore.setState }, before[0].id)).toBe(false);
    expect(useTimelineStore.getState().clips).toBe(before);
    expect(getHistoryStateView().undoStack).toHaveLength(historyCount);
  });

  it('rejects malformed arrays and linked locks atomically; bad persisted points safely use the legacy clock', () => {
    const invalid: unknown[] = [null, {}, [], new Array(2), [{ time: 0, source: 1 }], [null, null],
      [{ time: 0, source: 1 }, { time: 0, source: 2 }], [{ time: 1, source: 1 }, { time: 0, source: 2 }],
      [{ time: -1, source: 1 }, { time: 1, source: 2 }], [{ time: 0, source: NaN }, { time: 1, source: 2 }],
      [{ time: 0, source: 1 }, { time: Infinity, source: 2 }],
      Array.from({ length: 257 }, (_, time) => ({ time, source: time }))];
    for (const points of invalid) {
      const bad = { kind: 'warp', points } as ClipTimeRemap;
      expect(useTimelineStore.getState().setClipTimeRemap('warp', bad)).toBe(false);
      expect(resolveClipSourceTime(clip({ timeRemap: bad }), 1)).toEqual(resolveClipSourceTime(clip({ timeRemap: undefined }), 1));
    }
    useTimelineStore.setState({ tracks: [track, { ...audioTrack, locked: true }] });
    expect(useTimelineStore.getState().setClipTimeRemap('warp', remap)).toBe(false);
    expect(useTimelineStore.getState().clips.every(c => !c.timeRemap)).toBe(true);
    expect(getHistoryStateView().undoStack).toHaveLength(0);
  });

  it('retains duration and inactive speed/reverse through source edits and save/load', () => {
    expect(useTimelineStore.getState().setClipTimeRemap('warp', remap)).toBe(true);
    useTimelineStore.getState().trimClip('warp', 3, 5);
    expect(useTimelineStore.getState().setClipSpeed('warp', 2)).toBe(true);
    const c = useTimelineStore.getState().clips.find(c => c.id === 'warp')!;
    expect(c).toMatchObject({ duration: 8, inPoint: 2, outPoint: 6, reversed: true, timeRemap: remap });
    const serialized = createSerializableTimelineState({ ...useTimelineStore.getState(), clips: [c] }).clips[0];
    expect(applyCommonRestoredClipFields(JSON.parse(JSON.stringify(serialized))).timeRemap).toEqual(remap);
    const projectClip = JSON.parse(JSON.stringify(convertRuntimeProjectClip(c, [])));
    expect(classifyFields(projectClip, ProjectClipFields).content?.timeRemap).toEqual(remap);
    expect(splitNestedDomain(projectClip, 'ProjectClip').content).toMatchObject({ timeRemap: remap, duration: 8 });
  });
});
