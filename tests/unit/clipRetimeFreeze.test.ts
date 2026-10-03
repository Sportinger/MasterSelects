import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClipTimeRemap, TimelineClip } from '../../src/types/timeline';
import { createMockClip, createMockTrack } from '../helpers/mockData';
import { resolveClipSourceTime, resolveClipSourceWindow, clipSourceTimeToLocal } from '../../src/services/timeline/retime/clipRetime';
import { splitClipSourceWindow } from '../../src/services/timeline/retime/clipEdgeRetime';
import { visitNestedClipsAtTime } from '../../src/services/timeline/retime/nestedClipRetime';
import { resolveAudioPreviewRetime } from '../../src/services/timeline/retime/clipAudioRetime';
import { needsProcessedAudioPreview } from '../../src/services/audio/preview/processedAudioPreviewPolicy';
import { processedAudioPreviewKey } from '../../src/services/audio/preview/ProcessedAudioPreviewCache';
import { ClipAudioRenderService } from '../../src/services/audio/ClipAudioRenderService';
import { temporalClipSource, temporalSourceTime } from '../../src/effects/time/temporalClipSource';
import { collectNestedVideoClips } from '../../src/engine/export/clipPreparation/nestedVideoClips';
import { timelineToSourceTime } from '../../src/engine/parallelDecode/clipWindow';
import { createBuffer } from '../../src/engine/audio/audioBufferFactory';
import { computeTrimTiming, trimOriginalsFromClip } from '../../src/components/timeline/utils/clipTrimTiming';
import { applyTrimClipOperation } from '../../src/stores/timeline/editOperations/trimOperations';
import { quantizeRetimeClipTiming } from '../../src/services/timeline/retime/clipRetimeQuantization';
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
const videoTrack = createMockTrack({ id: 'v', type: 'video' });
const audioTrack = createMockTrack({ id: 'a', type: 'audio' });
const frozen: ClipTimeRemap = { kind: 'freeze', sourceTime: 12 };
function clip(patch: Partial<TimelineClip> = {}) {
  return createMockClip({ id: 'frozen', trackId: 'v', startTime: 10, duration: 4,
    inPoint: 2, outPoint: 10, speed: -2, reversed: true,
    source: { type: 'video', naturalDuration: 20 }, timeRemap: frozen, ...patch });
}

describe('Freeze source contract', () => {
  it('ignores speed, mirror and trim window, with a single-frame prefetch window', () => {
    const source = { speedAt: () => -100, integrate: () => 900 };
    for (const local of [0, 1, 3.9, -1, 100]) {
      expect(resolveClipSourceTime(clip(), local, source)).toEqual({
        sourceTime: 12, sourceRate: 0, isHold: true, mirrored: false, clamped: false });
    }
    expect(resolveClipSourceWindow(clip(), 0, 4, source)).toEqual({
      sourceStart: 12, sourceEnd: 12, minSourceTime: 12, maxSourceTime: 12 });
    expect(clipSourceTimeToLocal(clip(), 12)).toBeUndefined();
  });

  it('keeps reduced temporal and parallel records frozen beyond the trim window', () => {
    const temporal = temporalClipSource(clip({ mediaFileId: 'media' }), 1, [])!;
    expect(temporalSourceTime(temporal, 3)).toBe(12);
    expect(timelineToSourceTime({ clipId: 'nested', isNested: true, startTime: 10, duration: 4,
      inPoint: 2, outPoint: 10, speed: 1, reversed: false, timeRemap: frozen,
      source: { type: 'video', naturalDuration: 20 } }, 13)).toBe(12);
  });

  it('admits nested export frames throughout an extended frozen parent', () => {
    const leaf = clip({ id: 'leaf', startTime: 0, duration: 2, timeRemap: undefined });
    const parent = clip({ startTime: 0, duration: 100, speed: 1, reversed: false,
      isComposition: true, timeRemap: { kind: 'freeze', sourceTime: 1 },
      nestedClips: [leaf], nestedTracks: [videoTrack] });
    expect(collectNestedVideoClips(parent, { startTime: 90, endTime: 95 })).toEqual([
      expect.objectContaining({ clip: leaf, mainTimelineStart: 0, mainTimelineDuration: 100 }),
    ]);
  });

  it('clamps to the media domain and tolerates malformed/unknown persisted values', () => {
    expect(resolveClipSourceTime(clip({ timeRemap: { kind: 'freeze', sourceTime: 50 } }), 0).sourceTime).toBe(20);
    expect(resolveClipSourceTime(clip({ timeRemap: { kind: 'freeze', sourceTime: -1 } }), 0).sourceTime).toBe(0);
    expect(resolveClipSourceTime(clip({ timeRemap: { kind: 'freeze', sourceTime: NaN } }), 0).sourceTime).toBe(2);
    const future = { kind: 'future', payload: [1, 2] } as unknown as ClipTimeRemap;
    expect(resolveClipSourceTime(clip({ timeRemap: future }), 1)).toEqual(resolveClipSourceTime(clip({ timeRemap: undefined }), 1));
  });

  it('honors map > override > hold > Freeze precedence', () => {
    const c = clip({ transitionSourceTimeOverride: 8, transitionSourceHold: true,
      transitionSourceMap: { version: 1, segments: [
        { kind: 'linear', compStart: 0, compEnd: 4, sourceStart: 4, sourceEnd: 8 },
      ] } });
    expect(resolveClipSourceTime(c, 1).sourceTime).toBe(5);
    expect(resolveClipSourceTime({ ...c, transitionSourceMap: undefined }, 1).sourceTime).toBe(8);
    expect(resolveClipSourceTime({ ...c, transitionSourceMap: undefined, transitionSourceTimeOverride: undefined }, 1).sourceTime).toBe(2);
    expect(resolveClipSourceTime(clip(), 1).sourceTime).toBe(12);
  });

  it('freezes a composition clock and propagates hold to its leaf', () => {
    const leaf = clip({ id: 'leaf', startTime: 0, duration: 20, inPoint: 0, outPoint: 20,
      speed: 1, reversed: false, timeRemap: undefined });
    const parent = clip({ isComposition: true, nestedClips: [leaf], nestedTracks: [videoTrack] });
    for (const local of [0, 1, 3.9]) {
      const parentTime = resolveClipSourceTime(parent, local);
      const visitor = vi.fn();
      visitNestedClipsAtTime(parent, parentTime.sourceTime, visitor, parentTime.sourceRate);
      expect(visitor).toHaveBeenCalledWith(leaf, expect.objectContaining({ sourceTime: 12, sourceRate: 0, isHold: true }));
    }
  });
});

describe('Freeze duration and audio', () => {
  it('extends beyond source bounds, retains in/out and limits left trim to one frame', () => {
    const c = clip();
    const timing = computeTrimTiming(c, 'right', trimOriginalsFromClip(c), 100);
    const result = applyTrimClipOperation({ id: 'trim', type: 'trim-clip', clipId: c.id,
      inPoint: timing.newInPoint, outPoint: timing.newOutPoint, duration: timing.newDuration }, [c], [videoTrack]);
    expect(result.warnings).toEqual([]);
    expect(result.clips[0]).toMatchObject({ inPoint: 2, outPoint: 10, duration: 104, timeRemap: frozen });
    const left = computeTrimTiming(c, 'left', trimOriginalsFromClip(c), 100);
    expect(left.newDuration).toBeCloseTo(1 / 30);
    expect(left.newStartTime).toBeCloseTo(14 - 1 / 30);
    expect(left.newInPoint).toBe(2);
    expect(quantizeRetimeClipTiming(result.clips[0], 30)).toMatchObject({ duration: 104, outPoint: 10 });
    expect(splitClipSourceWindow(c, 1, 3)).toEqual({ inPoint: 2, outPoint: 10 });
  });

  it('silences preview and export without rendering FX or pitch, and invalidates prepared PCM identity', async () => {
    const c = clip({ duration: 2, preservesPitch: true });
    const source = createBuffer(2, 1024, 1024);
    source.getChannelData(0).fill(1); source.getChannelData(1).fill(1);
    const effects = { renderEffectInstances: vi.fn() };
    const renderer = new ClipAudioRenderService({ effectRenderer: effects });
    const { buffer } = await renderer.render({ clip: c, sourceBuffer: source, effectTailSeconds: 3 });
    expect(buffer.duration).toBe(2);
    expect(buffer.numberOfChannels).toBe(2);
    expect(buffer.getChannelData(0).every(value => value === 0)).toBe(true);
    expect(buffer.getChannelData(1).every(value => value === 0)).toBe(true);
    expect(effects.renderEffectInstances).not.toHaveBeenCalled();
    expect(resolveAudioPreviewRetime(c, 1).mutedReason).toContain('frozen');
    expect(needsProcessedAudioPreview(c, [])).toBe(false);
    expect(processedAudioPreviewKey(c, [], 'media')).not.toBe(processedAudioPreviewKey({ ...c, timeRemap: undefined }, [], 'media'));
  });
});

describe('Freeze store, history and persistence', () => {
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
      clip({ id: 'audio', trackId: 'a', linkedClipId: 'frozen', timeRemap: undefined,
        followsLinkedVideoSpeed: false, source: { type: 'audio', naturalDuration: 20 } })],
      tracks: [videoTrack, audioTrack], selectedClipIds: new Set(), layers: [], selectedLayerId: null,
      clipKeyframes: new Map(), markers: [], isExporting: false, compositionGraph: undefined });
    captureSnapshot('initial');
  });
  afterEach(() => {
    getHistoryStateView().clearHistory();
    useTimelineStore.setState(initialState);
  });

  it('changes both partners in one undo step and restores them on redo', async () => {
    expect(useTimelineStore.getState().setClipTimeRemap('frozen', frozen)).toBe(true);
    expect(useTimelineStore.getState().clips.map(c => c.timeRemap)).toEqual([frozen, frozen]);
    expect(getHistoryStateView().undoStack).toHaveLength(1);
    await undo();
    expect(useTimelineStore.getState().clips.every(c => c.timeRemap === undefined)).toBe(true);
    await redo();
    expect(useTimelineStore.getState().clips.map(c => c.timeRemap)).toEqual([frozen, frozen]);
    expect(useTimelineStore.getState().setClipTimeRemap('audio', null)).toBe(true);
    expect(useTimelineStore.getState().clips.every(c => c.timeRemap === undefined)).toBe(true);
  });

  it('rejects linked track locks, export locks and unsupported actions without a partial edit', () => {
    useTimelineStore.setState({ tracks: [videoTrack, { ...audioTrack, locked: true }] });
    expect(useTimelineStore.getState().setClipTimeRemap('frozen', frozen)).toBe(false);
    useTimelineStore.setState({ tracks: [videoTrack, audioTrack], isExporting: true });
    expect(useTimelineStore.getState().freezeClipAtPlayhead('frozen')).toBe(false);
    useTimelineStore.setState({ isExporting: false });
    expect(useTimelineStore.getState().setClipTimeRemap('frozen', { kind: 'future' } as unknown as ClipTimeRemap)).toBe(false);
    expect(useTimelineStore.getState().clips.every(c => !c.timeRemap)).toBe(true);
    expect(getHistoryStateView().undoStack).toHaveLength(0);
  });

  it('enforces a one-frame minimum for a subframe audio clip', () => {
    useTimelineStore.setState({ clips: [clip({ id: 'short', linkedClipId: undefined,
      trackId: 'a', duration: 0.001, timeRemap: undefined, source: { type: 'audio', naturalDuration: 20 } })] });
    expect(useTimelineStore.getState().setClipTimeRemap('short', frozen)).toBe(true);
    expect(useTimelineStore.getState().clips[0].duration).toBeCloseTo(1 / 30);
  });

  it('freezes the current contract time without changing retained speed, mirror, window or duration', () => {
    useTimelineStore.setState({ playheadPosition: 11.25 });
    const before = useTimelineStore.getState().clips[0];
    const expected = resolveClipSourceTime(before, 1.25).sourceTime;
    expect(useTimelineStore.getState().freezeClipAtPlayhead(before.id)).toBe(true);
    const after = useTimelineStore.getState().clips[0];
    expect(resolveClipSourceTime(after, 1.25).sourceTime).toBe(expected);
    expect(after).toMatchObject({ duration: before.duration, inPoint: before.inPoint, outPoint: before.outPoint,
      speed: before.speed, reversed: before.reversed });
  });

  it('rejects freezing at a playhead outside the clip instead of clamping to an edge frame', () => {
    const before = useTimelineStore.getState().clips[0];
    for (const playheadPosition of [before.startTime - 1, before.startTime + before.duration + 0.5]) {
      useTimelineStore.setState({ playheadPosition });
      expect(useTimelineStore.getState().freezeClipAtPlayhead(before.id)).toBe(false);
      expect(useTimelineStore.getState().clips[0].timeRemap).toBeUndefined();
    }
  });

  it.each([frozen, { kind: 'future', payload: { points: [2, 4] } } as unknown as ClipTimeRemap])(
    'round-trips remap data through composition, repository ownership and common load', timeRemap => {
      const c = clip({ timeRemap });
      const serialized = createSerializableTimelineState({ ...useTimelineStore.getState(), clips: [c] }).clips[0];
      expect(applyCommonRestoredClipFields(JSON.parse(JSON.stringify(serialized))).timeRemap).toEqual(timeRemap);
      const projectClip = JSON.parse(JSON.stringify(convertRuntimeProjectClip(c, [])));
      expect(classifyFields(projectClip, ProjectClipFields).content?.timeRemap).toEqual(timeRemap);
      expect(splitNestedDomain(projectClip, 'ProjectClip').content).toMatchObject({ timeRemap });
    },
  );
});
