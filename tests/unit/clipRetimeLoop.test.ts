import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement, type MouseEvent as ReactMouseEvent } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { useClipTrim } from '../../src/components/timeline/hooks/useClipTrim';
import { createWorkerDrawableClips, getTimelineClipCanvasTrimExtent, resolveClipGeometry } from '../../src/components/timeline/utils/timelineClipCanvasClipGeometry';
import type { TimelineEditOperation } from '../../src/stores/timeline/editOperations/types';
import type { ClipTimeRemap, TimelineClip } from '../../src/types/timeline';
import type { Keyframe } from '../../src/types/keyframes';
import { createMockClip, createMockTrack } from '../helpers/mockData';
import { BACKWARD_FRAME_EPSILON, clipSourceTimeToLocal, createClipSpeedSource, resolveClipSourceTime, resolveClipSourceWindow, videoFrameSourceTime } from '../../src/services/timeline/retime/clipRetime';
import { splitClipSourceWindow } from '../../src/services/timeline/retime/clipEdgeRetime';
import { applySplitAtTimesOperation } from '../../src/stores/timeline/editOperations/splitBatchOperations';
import { applyTrimClipOperation, applyTrimEdgeToTimeOperation, applyRippleTrimEdgeToTimeOperation } from '../../src/stores/timeline/editOperations/trimOperations';
import { computeTrimTiming, trimOriginalsFromClip } from '../../src/components/timeline/utils/clipTrimTiming';
import { quantizeRetimeClipTiming } from '../../src/services/timeline/retime/clipRetimeQuantization';
import { needsProcessedAudioPreview } from '../../src/services/audio/preview/processedAudioPreviewPolicy';
import { processedAudioPreviewKey } from '../../src/services/audio/preview/ProcessedAudioPreviewCache';
import { resolveAudioPreviewRetime } from '../../src/services/timeline/retime/clipAudioRetime';
import { ClipAudioRenderService } from '../../src/services/audio/ClipAudioRenderService';
import { createBuffer } from '../../src/engine/audio/audioBufferFactory';
import { collectNestedVideoClips } from '../../src/engine/export/clipPreparation/nestedVideoClips';
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
// Keep PCM trimming real while avoiding AudioExtractor's browser AudioContext.
const extractor = {
  trimBuffer(buffer: AudioBuffer, start: number, end: number): AudioBuffer {
    const first = Math.floor(start * buffer.sampleRate);
    const last = Math.min(buffer.length, Math.ceil(end * buffer.sampleRate));
    const result = createBuffer(buffer.numberOfChannels, Math.max(1, last - first), buffer.sampleRate);
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      result.getChannelData(ch).set(buffer.getChannelData(ch).subarray(first, last));
    }
    return result;
  },
};
const track = createMockTrack({ id: 'v', type: 'video' });
const audioTrack = createMockTrack({ id: 'a', type: 'audio' });
function clip(patch: Partial<TimelineClip> = {}): TimelineClip {
  return createMockClip({ id: 'loop', trackId: 'v', startTime: 10, duration: 12,
    inPoint: 2, outPoint: 6, speed: 1, reversed: false,
    timeRemap: { kind: 'loop' }, source: { type: 'video', naturalDuration: 20 }, ...patch });
}
const key = (time: number, value: number, hold = false): Keyframe =>
  ({ id: `speed-${time}`, clipId: 'loop', property: 'speed', time, value, hold, easing: 'linear' });
const matrix = [1, 2, -1, -2].flatMap(speed => [false, true].map(reversed => ({ speed, reversed })));

describe('Loop source contract', () => {
  it.each(matrix)('wraps speed=$speed reverse=$reversed with phase and no clamp', ({ speed, reversed }) => {
    const c = clip({ speed, reversed, timeRemap: { kind: 'loop', phase: 0.75 } });
    for (const t of [0, 0.25, 1, 2, 4, 11.5, -1]) {
      const offset = ((speed * t + 0.75) % 4 + 4) % 4;
      expect(resolveClipSourceTime(c, t)).toMatchObject({ sourceTime: reversed ? 6 - offset : 2 + offset,
        sourceRate: reversed ? -speed : speed, isHold: false, clamped: false });
    }
    expect(clipSourceTimeToLocal(c, 3)).toBeUndefined();
  });

  it('uses a half-open cycle, defaults phase to zero and freezes empty cycles', () => {
    expect(resolveClipSourceTime(clip(), 4)).toMatchObject({ sourceTime: 2, wrapped: true });
    expect(resolveClipSourceTime(clip({ reversed: true }), 4).sourceTime).toBe(6);
    expect(resolveClipSourceTime(clip({ timeRemap: { kind: 'loop', phase: NaN } }), 1).sourceTime).toBe(3);
    const empty = clip({ inPoint: 3, outPoint: 3, reversed: true });
    expect(resolveClipSourceTime(empty, 50)).toMatchObject({ sourceTime: 3, sourceRate: 0, isHold: true });
    expect(resolveClipSourceWindow(empty, 0, 50).maxSourceTime).toBe(3);
  });

  it('integrates keyframe ramps and holds before wrapping', () => {
    const c = clip();
    const source = createClipSpeedSource(c, [key(0, 1), key(4, 3)]);
    expect(resolveClipSourceTime(c, 2, source).sourceTime).toBeCloseTo(5);
    expect(resolveClipSourceTime(c, 3, source).sourceTime).toBeCloseTo(3.25);
    expect(resolveClipSourceTime(c, 4, source).sourceRate).toBe(3);
    const held = createClipSpeedSource(c, [key(0, 2, true), key(3, 0)]);
    expect(resolveClipSourceTime(c, 2.5, held).sourceTime).toBeCloseTo(3);
    expect(resolveClipSourceTime(c, 4, held).isHold).toBe(true);
  });

  it('retains transition precedence and uses full prefetch bounds across any wrap', () => {
    const c = clip({ transitionSourceMap: { version: 1, segments: [
      { kind: 'linear', compStart: 0, compEnd: 12, sourceStart: 3, sourceEnd: 15 },
    ] }, transitionSourceTimeOverride: 9, transitionSourceHold: true });
    expect(resolveClipSourceTime(c, 2).sourceTime).toBe(5);
    expect(resolveClipSourceTime({ ...c, transitionSourceMap: undefined }, 2).sourceTime).toBe(9);
    expect(resolveClipSourceTime({ ...c, transitionSourceMap: undefined, transitionSourceTimeOverride: undefined }, 2).sourceTime).toBe(2);
    expect(resolveClipSourceWindow(clip(), 0.5, 1.5)).toMatchObject({ minSourceTime: 2.5, maxSourceTime: 3.5 });
    for (const [start, end] of [[3, 5], [1, 9], [9, 1]]) {
      expect(resolveClipSourceWindow(clip(), start, end)).toMatchObject({ minSourceTime: 2, maxSourceTime: 6 });
    }
    expect(resolveClipSourceWindow(clip(), 0.5, 1, { speedAt: () => 1, integrate: t => t }))
      .toMatchObject({ minSourceTime: 2, maxSourceTime: 6 });
  });
});

describe('Domain-safe video frame selection', () => {
  it.each(matrix)('wraps exact seams at speed=$speed reverse=$reversed', ({ speed, reversed }) => {
    const c = clip({ speed, reversed });
    for (const local of [0, 4 / Math.abs(speed), 8 / Math.abs(speed)]) {
      const sample = resolveClipSourceTime(c, local);
      const exact = sample.sourceTime;
      const expected = sample.sourceRate < 0 ? c.outPoint - BACKWARD_FRAME_EPSILON : c.inPoint;
      expect(videoFrameSourceTime(sample)).toBeCloseTo(expected, 10);
      expect(sample.sourceTime).toBe(exact);
      expect(sample.clamped).toBe(false);
    }
    const phased = { ...c, timeRemap: { kind: 'loop' as const, phase: 1 } };
    const seam = (speed > 0 ? 3 : 1) / Math.abs(speed);
    for (const offset of [-BACKWARD_FRAME_EPSILON / 2, 0, BACKWARD_FRAME_EPSILON / 2]) {
      const frameTime = videoFrameSourceTime(resolveClipSourceTime(phased, seam + offset));
      expect(frameTime).toBeGreaterThanOrEqual(c.inPoint);
      expect(frameTime).toBeLessThan(c.outPoint);
    }
  });

  it.each([{ speed: 1, reversed: true }, { speed: -1, reversed: false }])(
    'clamps ordinary backward samples to inPoint: $speed/$reversed', timing => {
      const c = clip({ ...timing, timeRemap: undefined, duration: 4 });
      const sample = resolveClipSourceTime(c, 4 - BACKWARD_FRAME_EPSILON / 2);
      expect(sample.sourceRate).toBe(-1);
      expect(videoFrameSourceTime(sample)).toBe(c.inPoint);
      expect(videoFrameSourceTime(sample, 2.5)).toBe(2.5);
      expect(videoFrameSourceTime(resolveClipSourceTime(c, 1))).toBe(5 - BACKWARD_FRAME_EPSILON);
    },
  );

  it('keeps absolute maps, freezes and legacy samples independent of trim bounds', () => {
    const mapped = clip({ transitionSourceMap: { version: 1, segments: [
      { kind: 'linear', compStart: 0, compEnd: 2, sourceStart: 2, sourceEnd: 0 },
    ] } });
    expect(videoFrameSourceTime(resolveClipSourceTime(mapped, 1))).toBe(1 - BACKWARD_FRAME_EPSILON);
    expect(videoFrameSourceTime(resolveClipSourceTime(clip({ timeRemap: { kind: 'freeze', sourceTime: 12 } }), 0))).toBe(12);
    expect(videoFrameSourceTime({ sourceTime: 0, sourceRate: -1 })).toBe(0);
    const sample = resolveClipSourceTime(clip({ speed: -1 }), 0);
    expect(videoFrameSourceTime(sample, 2)).toBeCloseTo(6 - BACKWARD_FRAME_EPSILON, 10);
  });
});

describe('Loop split and duration', () => {
  it.each([false, true])('admits repeated descendants over the root interval (nested loop=%s)', nested => {
    const leaf = clip({ id: 'leaf', startTime: 0, duration: 2, inPoint: 0, outPoint: 2, timeRemap: undefined });
    const loop = clip({ id: 'loop-comp', startTime: 0, duration: 100, inPoint: 0, outPoint: 2,
      isComposition: true, nestedClips: [leaf], nestedTracks: [track] });
    const root = nested ? clip({ id: 'root', startTime: 0, duration: 100, inPoint: 0, outPoint: 100,
      isComposition: true, timeRemap: undefined, nestedClips: [loop], nestedTracks: [track] }) : loop;
    expect(collectNestedVideoClips(root, { startTime: 90, endTime: 95 })).toEqual([
      expect.objectContaining({ clip: leaf, mainTimelineStart: 0, mainTimelineDuration: 100 }),
    ]);
  });
  function assertFrames(before: TimelineClip, after: TimelineClip, shift = 0) {
    for (let i = 0; i < 80; i++) {
      const local = after.duration * i / 80;
      expect(resolveClipSourceTime(after, local).sourceTime).toBeCloseTo(
        resolveClipSourceTime(before, after.startTime - before.startTime + local + shift).sourceTime, 8);
    }
  }
  it.each(matrix)('preserves split samples at speed=$speed reverse=$reversed', ({ speed, reversed }) => {
    const c = clip({ speed, reversed, timeRemap: { kind: 'loop', phase: 1.25 } });
    const second = { ...c, startTime: 13.5, duration: 8.5, ...splitClipSourceWindow(c, 3.5, 12) };
    assertFrames(c, second);
    const result = applySplitAtTimesOperation({ id: 'split', type: 'split-at-times', clipId: c.id,
      times: [13.5, 17] }, [c], [track]);
    expect(result.warnings).toEqual([]);
    expect(result.clips).toHaveLength(3);
    for (const part of result.clips) {
      expect(part).toMatchObject({ inPoint: 2, outPoint: 6, timeRemap: { kind: 'loop' } });
      assertFrames(c, part);
    }
  });

  it('retains the full linear speed ramp in rebased split parts', () => {
    const c = clip({ duration: 4, timeRemap: { kind: 'loop', phase: 0.2 } });
    const keys = [key(0, 1), key(4, 3)];
    const result = applySplitAtTimesOperation({ id: 'split', type: 'split-at-times', clipId: c.id,
      times: [11.5] }, [c], [track], { clipKeyframes: new Map([[c.id, keys]]), timelineTime: 11.5 });
    for (const part of result.clips) {
      const source = createClipSpeedSource(part, result.clipKeyframes!.get(part.id));
      for (const t of [0.13, 0.47, 0.81]) expect(resolveClipSourceTime(part, t, source).sourceTime).toBeCloseTo(
        resolveClipSourceTime(c, part.startTime - c.startTime + t, createClipSpeedSource(c, keys)).sourceTime, 7);
    }
  });

  it.each(matrix)('preserves left trim phase and extends right freely: $speed/$reversed', ({ speed, reversed }) => {
    const c = clip({ speed, reversed, timeRemap: { kind: 'loop', phase: 1 } });
    for (const edge of ['left', 'right'] as const) {
      const timing = computeTrimTiming(c, edge, trimOriginalsFromClip(c), edge === 'left' ? 1.5 : 100);
      const result = applyTrimClipOperation({ id: 'trim', type: 'trim-clip', clipId: c.id,
        inPoint: timing.newInPoint, outPoint: timing.newOutPoint, startTime: timing.newStartTime,
        duration: timing.newDuration }, [c], [track]);
      expect(result.warnings).toEqual([]);
      expect(result.clips[0].duration).toBe(edge === 'left' ? 10.5 : 112);
      expect(quantizeRetimeClipTiming(result.clips[0], 30).duration).toBe(result.clips[0].duration);
      assertFrames(c, result.clips[0]);
    }
    const edge = applyTrimEdgeToTimeOperation({ id: 'edge', type: 'trim-edge-to-time', edge: 'end', time: 100,
      clipIds: [c.id] }, [c], [track], new Set());
    expect(edge.clips[0].duration).toBe(90);
    const ripple = applyRippleTrimEdgeToTimeOperation({ id: 'ripple', type: 'ripple-trim-edge-to-time',
      edge: 'start', time: 11.5, clipIds: [c.id] }, [c], [track], new Set());
    assertFrames(c, ripple.clips[0], 1.5);
  });
});

describe('Right-edge trim gesture, canvas and commit', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });
  const modes = ['loop', 'freeze', 'normal'] as const;
  function gesture(kind: typeof modes[number], tool: 'select' | 'ripple-trim' = 'select', withNeighbor = true, naturalDuration = 30) {
    let nextFrame: FrameRequestCallback | undefined;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { nextFrame = callback; return 1; });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => { nextFrame = undefined; });
    const target = clip({ startTime: 0, duration: 7, inPoint: 2, outPoint: kind === 'normal' ? 9 : 6,
      source: { type: 'video', naturalDuration }, timeRemap: kind === 'normal' ? undefined
        : kind === 'freeze' ? { kind: 'freeze', sourceTime: 3 } : { kind: 'loop' } });
    const neighbor = clip({ id: 'next', startTime: 10, duration: 2, inPoint: 0, outPoint: 2, timeRemap: undefined });
    let clips = withNeighbor ? [target, neighbor] : [target];
    const preview = vi.fn();
    const commit = vi.fn((operation: TimelineEditOperation) => {
      const result = operation.type === 'trim-clip'
        ? applyTrimClipOperation(operation, clips, [track])
        : operation.type === 'ripple-trim-edge-to-time'
          ? applyRippleTrimEdgeToTimeOperation(operation, clips, [track], new Set([target.id]))
          : undefined;
      if (!result) throw new Error(`Unexpected operation ${operation.type}`);
      clips = result.clips;
      return { success: result.warnings.length === 0, warnings: result.warnings };
    });
    let latest!: ReturnType<typeof useClipTrim>;
    const clipMap = new Map(clips.map(c => [c.id, c]));
    function Harness() {
      latest = useClipTrim({ clipMap, tracks: [track], isExporting: false,
        activeTimelineToolId: tool, selectedClipIds: new Set([target.id]), snappingEnabled: true,
        playheadPosition: 7, frameRate: 30, selectClip: vi.fn(),
        applyTimelineEditOperation: commit, setTimelineToolPreview: preview, pixelToTime: px => px / 100 });
      return createElement('div', { 'data-testid': 'trim',
        onMouseDown: (event: ReactMouseEvent<HTMLDivElement>) => latest.handleTrimStart(event, target.id, 'right') });
    }
    const view = render(createElement(Harness));
    fireEvent.mouseDown(view.getByTestId('trim'), { clientX: 700 });
    return {
      target, commit, preview, clips: () => clips,
      move(end: number) {
        fireEvent.mouseMove(document, { clientX: end * 100 });
        act(() => nextFrame?.(0));
        const props = { trackId: target.trackId, clipTrim: latest.clipTrim };
        const geometry = resolveClipGeometry(target, props);
        expect(createWorkerDrawableClips([target], props)[0].duration).toBe(geometry.duration);
        expect(getTimelineClipCanvasTrimExtent(target, props)).toBeGreaterThanOrEqual(geometry.startTime + geometry.duration);
        return geometry;
      },
      release(end: number) { fireEvent.mouseUp(document, { clientX: end * 100 }); },
    };
  }

  it.each(modes)('extends %s from 7 to 9.5 through snapped pointer updates and the real trim operation', kind => {
    const run = gesture(kind);
    for (let step = 1; step <= 10; step++) expect(run.move(7 + step * 0.25).duration).toBeCloseTo(7 + step * 0.25, 1);
    expect(run.commit).not.toHaveBeenCalled();
    run.release(9.5);
    expect(run.commit).toHaveBeenCalledOnce();
    expect(run.clips()[0].duration).toBe(9.5);
    expect(run.clips()[1].startTime).toBe(10);
    expect([run.clips()[0].inPoint, run.clips()[0].outPoint]).toEqual(kind === 'normal' ? [2, 11.5] : [2, 6]);
  });

  it.each(modes)('stops %s at the next clip in ordinary edge trim', kind => {
    const run = gesture(kind);
    expect(run.move(12).duration).toBe(10);
    run.release(12);
    expect(run.clips()[0].duration).toBe(10);
    expect(run.clips()[1].startTime).toBe(10);
  });

  it.each(modes)('uses source bounds only for normal clips without a neighbor: %s', kind => {
    const run = gesture(kind, 'select', false);
    const expected = kind === 'normal' ? 28 : 50;
    expect(run.move(50).duration).toBe(expected);
    run.release(50);
    expect(run.clips()[0].duration).toBe(expected);
  });

  it.each(['loop', 'freeze'] as const)('extends %s in ripple mode and shifts the next clip atomically', kind => {
    const run = gesture(kind, 'ripple-trim');
    expect(run.move(12).duration).toBe(12);
    expect(run.preview.mock.lastCall?.[0]).toMatchObject({ time: 12,
      ghostRanges: expect.arrayContaining([expect.objectContaining({ trackId: 'v', startTime: 15, endTime: 17 })]) });
    run.release(12);
    expect(run.commit).toHaveBeenCalledOnce();
    expect(run.clips()[0].duration).toBe(12);
    expect(run.clips()[1].startTime).toBe(15);
  });

  it.each(['loop', 'freeze'] as const)('allocates live canvas space beyond the end of a %s source', kind => {
    const run = gesture(kind, 'select', false, 6);
    expect(run.move(9.5).duration).toBe(9.5);
    run.release(9.5);
    expect(run.clips()[0].duration).toBe(9.5);
  });
});

describe('Loop audio', () => {
  it('treats a non-positive cycle as frozen silence, without effects or tails', async () => {
    const source = createBuffer(1, 80, 8);
    source.getChannelData(0).fill(1);
    const effects = { renderEffectInstances: vi.fn() };
    const { buffer } = await new ClipAudioRenderService({ extractor, effectRenderer: effects }).render({
      clip: clip({ inPoint: 3, outPoint: 3, duration: 2 }), sourceBuffer: source, effectTailSeconds: 4,
    });
    expect(buffer.duration).toBe(2);
    expect(buffer.getChannelData(0).every(value => value === 0)).toBe(true);
    expect(effects.renderEffectInstances).not.toHaveBeenCalled();
  });

  it('retains the source clock when a ranged export supplies only the required prefix', async () => {
    const prefix = createBuffer(1, 8, 8);
    prefix.getChannelData(0).set([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]);
    const { buffer } = await new ClipAudioRenderService({ extractor }).render({
      clip: clip({ duration: 1, preservesPitch: false }), sourceBuffer: prefix, sourceIsClipRange: true,
    });
    expect([...buffer.getChannelData(0)]).toEqual([...prefix.getChannelData(0)]);
  });

  it('renders automated wraps and zero-rate holds from the shared clock', async () => {
    const source = createBuffer(1, 80, 8);
    source.getChannelData(0).set(Array.from({ length: 80 }, (_, i) => i / 100));
    const c = clip({ duration: 6, preservesPitch: false, reversed: true, timeRemap: { kind: 'loop', phase: 0.5 } });
    const keys = [key(0, 1), key(4, 3), key(5, 0, true)];
    const speed = createClipSpeedSource(c, keys);
    const { buffer } = await new ClipAudioRenderService({ extractor }).render({ clip: c, sourceBuffer: source, keyframes: keys });
    for (let i = 0; i < buffer.length; i++) {
      const sample = resolveClipSourceTime(c, i / 8, speed);
      const position = ((sample.sourceTime * 8 - 16 - (sample.sourceRate < 0 ? 1 : 0)) % 32 + 32) % 32;
      const index = Math.floor(position), fraction = position - index;
      const expected = sample.isHold ? 0 : ((16 + index) * (1 - fraction) + (16 + (index + 1) % 32) * fraction) / 100;
      expect(buffer.getChannelData(0)[i]).toBeCloseTo(expected, 5);
    }
  });

  it.each(matrix)('renders repeated trimmed PCM with phase: $speed/$reversed', async ({ speed, reversed }) => {
    const source = createBuffer(1, 80, 8);
    source.getChannelData(0).set(Array.from({ length: 80 }, (_, i) => i / 100));
    const c = clip({ speed, reversed, duration: 9, preservesPitch: false, timeRemap: { kind: 'loop', phase: 1 } });
    const { buffer } = await new ClipAudioRenderService({ extractor }).render({ clip: c, sourceBuffer: source });
    expect(buffer.duration).toBe(9);
    const cycleLength = 32 / Math.abs(speed);
    for (let i = 0; i < buffer.length - cycleLength; i++)
      expect(buffer.getChannelData(0)[i + cycleLength]).toBeCloseTo(buffer.getChannelData(0)[i], 6);
    const atZero = resolveClipSourceTime(c, 0);
    expect(buffer.getChannelData(0)[0]).toBeCloseTo((atZero.sourceTime * 8 - (atZero.sourceRate < 0 ? 1 : 0)) / 100, 5);
    expect(buffer.getChannelData(0).some(value => value !== 0)).toBe(true);
  });

  it('uses processed preview and invalidates cache identity for phase/kind changes', () => {
    const c = clip();
    expect(needsProcessedAudioPreview(c, [])).toBe(true);
    expect(resolveAudioPreviewRetime(c, 1).mutedReason).toContain('processed preview');
    const initial = processedAudioPreviewKey(c, [], 'media');
    for (const timeRemap of [undefined, { kind: 'freeze', sourceTime: 2 }, { kind: 'loop', phase: 1 }] as const)
      expect(processedAudioPreviewKey({ ...c, timeRemap }, [], 'media')).not.toBe(initial);
  });
});

describe('Loop persistence and atomic action', () => {
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
      clip({ id: 'audio', trackId: 'a', linkedClipId: 'loop', timeRemap: undefined,
        followsLinkedVideoSpeed: false, source: { type: 'audio', naturalDuration: 20 } })],
      tracks: [track, audioTrack], selectedClipIds: new Set(), layers: [], selectedLayerId: null,
      clipKeyframes: new Map(), markers: [], isExporting: false, compositionGraph: undefined });
    captureSnapshot('initial');
  });
  afterEach(() => { getHistoryStateView().clearHistory(); useTimelineStore.setState(initialState); });

  it('loops both partners in one undo step; freeze replaces loop; unloop retains duration', async () => {
    const remap: ClipTimeRemap = { kind: 'loop', phase: 1.25 };
    expect(useTimelineStore.getState().setClipTimeRemap('loop', remap)).toBe(true);
    expect(useTimelineStore.getState().clips.map(c => c.timeRemap)).toEqual([remap, remap]);
    expect(getHistoryStateView().undoStack).toHaveLength(1);
    await undo();
    expect(useTimelineStore.getState().clips.every(c => c.timeRemap === undefined)).toBe(true);
    await redo();
    expect(useTimelineStore.getState().clips.map(c => c.timeRemap)).toEqual([remap, remap]);
    expect(useTimelineStore.getState().setClipTimeRemap('loop', { kind: 'freeze', sourceTime: 3 })).toBe(true);
    expect(useTimelineStore.getState().clips.every(c => c.timeRemap?.kind === 'freeze')).toBe(true);
    expect(useTimelineStore.getState().setClipTimeRemap('loop', remap)).toBe(true);
    expect(useTimelineStore.getState().setClipTimeRemap('loop', null)).toBe(true);
    expect(useTimelineStore.getState().clips.every(c => !c.timeRemap && c.duration === 12)).toBe(true);
    expect(resolveClipSourceTime(useTimelineStore.getState().clips[0], 11)).toMatchObject({ sourceTime: 6, isHold: true });
  });

  it('rejects invalid phases and linked locks without partial writes', () => {
    expect(useTimelineStore.getState().setClipTimeRemap('loop', { kind: 'loop', phase: Infinity })).toBe(false);
    useTimelineStore.setState({ tracks: [track, { ...audioTrack, locked: true }] });
    expect(useTimelineStore.getState().setClipTimeRemap('loop', { kind: 'loop' })).toBe(false);
    expect(useTimelineStore.getState().clips.every(c => !c.timeRemap)).toBe(true);
    expect(getHistoryStateView().undoStack).toHaveLength(0);
  });

  it.each<ClipTimeRemap>([{ kind: 'loop', phase: 1 }, { kind: 'freeze', sourceTime: 3 }])(
    'preserves authored duration during speed and source-window edits: $kind', remap => {
      useTimelineStore.setState({ clips: useTimelineStore.getState().clips.map(c => ({ ...c, followsLinkedVideoSpeed: undefined })) });
      expect(useTimelineStore.getState().setClipTimeRemap('loop', remap)).toBe(true);
      expect(useTimelineStore.getState().setClipSpeed('loop', 2)).toBe(true);
      expect(useTimelineStore.getState().clips.map(c => c.duration)).toEqual([12, 12]);
      useTimelineStore.getState().trimClip('loop', 3, 5);
      const edited = useTimelineStore.getState().clips.find(c => c.id === 'loop')!;
      expect(edited.duration).toBe(12);
      expect(edited.timeRemap).toEqual(remap);
      expect([edited.inPoint, edited.outPoint]).toEqual(remap.kind === 'loop' ? [3, 5] : [2, 6]);
    },
  );

  it('round-trips loop phase and independent duration through all persistence boundaries', () => {
    const c = clip({ timeRemap: { kind: 'loop', phase: 1.25 } });
    const serialized = createSerializableTimelineState({ ...useTimelineStore.getState(), clips: [c] }).clips[0];
    expect(applyCommonRestoredClipFields(JSON.parse(JSON.stringify(serialized))).timeRemap).toEqual(c.timeRemap);
    const projectClip = JSON.parse(JSON.stringify(convertRuntimeProjectClip(c, [])));
    expect(classifyFields(projectClip, ProjectClipFields).content?.timeRemap).toEqual(c.timeRemap);
    expect(splitNestedDomain(projectClip, 'ProjectClip').content).toMatchObject({ timeRemap: c.timeRemap, duration: 12 });
    expect(quantizeRetimeClipTiming(c, 30)).toMatchObject({ duration: 12, inPoint: 2, outPoint: 6 });
  });
});
