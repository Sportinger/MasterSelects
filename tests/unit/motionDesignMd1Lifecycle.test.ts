import { describe, expect, it, vi } from 'vitest';

const mediaStoreHarness = vi.hoisted(() => {
  const holder: { current: Record<string, unknown> } = {
    current: {
      files: [], compositions: [], folders: [], textItems: [], solidItems: [], meshItems: [],
      cameraItems: [], lightItems: [], splatEffectorItems: [], mathSceneItems: [],
      motionShapeItems: [], signalAssets: [], signalArtifacts: [], signalGraphs: [],
      signalOperators: [], activeCompositionId: null, openCompositionIds: [],
      slotAssignments: {}, slotDeckStates: {}, slotClipSettings: {},
      selectedSlotCompositionId: null, previewCompositionId: null, sourceMonitorFileId: null,
      sourceMonitorPlaybackRequestId: 0, sourceMonitorCropRequestId: 0,
      sourceMonitorInPoint: null, sourceMonitorOutPoint: null, activeLayerSlots: {},
      layerOpacities: {}, selectedIds: [], expandedFolderIds: [], currentProjectId: null,
      currentProjectName: 'Untitled Project', isLoading: false,
      projectLoadProgress: { active: false, phase: 'idle', percent: 0, message: '', blocking: false },
      proxyEnabled: false, proxyGenerationQueue: [], currentlyGeneratingProxyId: null,
      proxyFolderName: null,
    },
  };
  const getState = vi.fn(() => holder.current);
  const setState = vi.fn((update: unknown) => {
    const partial = typeof update === 'function'
      ? (update as (state: Record<string, unknown>) => Record<string, unknown>)(holder.current)
      : update as Record<string, unknown>;
    holder.current = { ...holder.current, ...partial };
  });
  const subscribe = vi.fn(() => () => {});
  const hook = Object.assign(
    vi.fn((selector?: (state: Record<string, unknown>) => unknown) =>
      selector ? selector(holder.current) : holder.current),
    { getState, setState, subscribe },
  );
  return { hook };
});

vi.mock('../../src/stores/mediaStore', () => ({ useMediaStore: mediaStoreHarness.hook }));

import { createMd1GoldenFixture } from '../../src/services/motionDesign/evidence/md1GoldenFixture';
import { createPastedClipboardClipsPlan } from '../../src/stores/timeline/clipboard/clipboardClipPastePlanner';
import { applyDeleteClipsOperation } from '../../src/stores/timeline/editOperations/deleteOperations';
import { applySplitAtTimesOperation } from '../../src/stores/timeline/editOperations/splitBatchOperations';
import { createRestoredMotionClip } from '../../src/stores/timeline/nestedRestore';
import { createSerializableTimelineState } from '../../src/stores/timeline/serialization/serializableTimelineState';
import type { ClipboardClipData } from '../../src/stores/timeline/types';
import { useTimelineStore } from '../../src/stores/timeline';
import { getHistoryStateView, useHistoryStore } from '../../src/stores/historyStore';
import { useMediaStore } from '../../src/stores/mediaStore';
import { useExportStore } from '../../src/stores/exportStore';
import { renderHostPort } from '../../src/services/render/renderHostPort';
import { getInterpolatedMotionLayer } from '../../src/utils/motionInterpolation';
import { syncStoresToProject } from '../../src/services/project/projectSave';
import { convertProjectCompositionToStore } from '../../src/services/project/load/loadTimelineHydration';
import { projectFileService } from '../../src/services/projectFileService';
import {
  MD1_DIFFERENTIAL_CONTROL_IDS,
  MD1_TEMPORAL_DIFFERENTIAL_CROP_IDS,
  assertMd1RestorableExportState,
  captureMd1EvidenceRestoreSnapshot,
  restoreMd1EvidenceSnapshot,
  runWithMd1EvidenceRestore,
} from '../../src/services/aiTools/devBridge/browser/debugActions/motionDesignMd1Evidence';
import { createTestTimelineStore } from '../helpers/storeFactory';
import type { ClipTransform } from '../../src/types';
import { createLegacyReplicatorContractFixture } from '../../src/services/motionDesign/replicator/contractFixtures';

function createClipboardMotionClipData(): ClipboardClipData {
  const fixture = createMd1GoldenFixture();
  const clip = fixture.clips.find((candidate) => candidate.id === 'md1-clip-rectangle')!;
  return {
    id: clip.id,
    trackId: clip.trackId,
    trackType: 'video',
    name: clip.name,
    startTime: clip.startTime,
    duration: clip.duration,
    inPoint: clip.inPoint,
    outPoint: clip.outPoint,
    sourceType: 'motion-shape',
    naturalDuration: clip.duration,
    transform: structuredClone(clip.transform),
    effects: structuredClone(clip.effects),
    masks: structuredClone(clip.masks),
    motion: structuredClone(clip.motion),
    keyframes: structuredClone(fixture.keyframes.get(clip.id)),
  };
}

function expect2DTransformClose(
  actual: ClipTransform,
  expected: ClipTransform,
): void {
  expect(actual.position.x).toBeCloseTo(expected.position.x, 8);
  expect(actual.position.y).toBeCloseTo(expected.position.y, 8);
  expect(actual.scale.all ?? 1).toBeCloseTo(expected.scale.all ?? 1, 8);
  expect(actual.scale.x).toBeCloseTo(expected.scale.x, 8);
  expect(actual.scale.y).toBeCloseTo(expected.scale.y, 8);
  expect(actual.rotation.z).toBeCloseTo(expected.rotation.z, 8);
  expect(actual.opacity).toBeCloseTo(expected.opacity, 8);
}

describe('MD1 motion-design lifecycle', () => {
  it('refuses non-restorable export resources before evidence mutation', () => {
    expect(() => assertMd1RestorableExportState({
      isExporting: false,
      exportPreviewFrame: null,
    })).not.toThrow();
    expect(() => assertMd1RestorableExportState({
      isExporting: true,
      exportPreviewFrame: null,
    })).toThrow('export in progress');
    expect(() => assertMd1RestorableExportState({
      isExporting: false,
      exportPreviewFrame: {} as ImageBitmap,
    })).toThrow('no existing export preview frame');
  });

  it('requires differential pixel controls for every MD1 render signal', () => {
    expect(MD1_DIFFERENTIAL_CONTROL_IDS).toEqual([
      'ordered-appearance-stack',
      'mask-enabled',
      'effect-enabled',
      'clip-opacity',
      'clip-blend-mode',
      'appearance-opacity',
      'appearance-blend-mode',
      'appearance-visibility',
      'gradient-rendering',
      'stroke-rendering',
    ]);
    expect(MD1_TEMPORAL_DIFFERENTIAL_CROP_IDS).toEqual(['rectangle', 'star']);
  });

  it('copy/paste preserves the full appearance stack and remaps keyframes', () => {
    const clipData = createClipboardMotionClipData();
    let suffix = 0;
    const plan = createPastedClipboardClipsPlan({
      clipboardData: [clipData],
      playheadPosition: 8,
      tracks: [{
        id: clipData.trackId,
        name: 'Motion',
        type: 'video',
        height: 70,
        muted: false,
        visible: true,
        solo: false,
      }],
      clipKeyframes: new Map(),
      timestamp: 4242,
      createSuffix: () => `stable-${suffix += 1}`,
    });

    expect(plan.newClips).toHaveLength(1);
    const pasted = plan.newClips[0];
    expect(pasted.id).not.toBe(clipData.id);
    expect(pasted.motion).toEqual(clipData.motion);
    expect(pasted.motion).not.toBe(clipData.motion);
    expect(pasted.motion?.appearance).not.toBe(clipData.motion?.appearance);
    expect(pasted.motion?.appearance?.items[0]).not.toBe(clipData.motion?.appearance?.items[0]);

    const originalAppearanceIds = clipData.motion?.appearance?.items.map((item) => item.id);
    expect(pasted.motion?.appearance?.items.map((item) => item.id)).toEqual(originalAppearanceIds);
    const originalStopIds = clipData.motion?.appearance?.items.flatMap((item) =>
      item.kind === 'linear-gradient' || item.kind === 'radial-gradient'
        ? item.stops.map((stop) => stop.id)
        : [],
    );
    const pastedStopIds = pasted.motion?.appearance?.items.flatMap((item) =>
      item.kind === 'linear-gradient' || item.kind === 'radial-gradient'
        ? item.stops.map((stop) => stop.id)
        : [],
    );
    expect(pastedStopIds).toEqual(originalStopIds);

    const pastedKeyframes = plan.newKeyframes.get(pasted.id)!;
    expect(pastedKeyframes.map((keyframe) => keyframe.property))
      .toEqual(clipData.keyframes?.map((keyframe) => keyframe.property));
    expect(pastedKeyframes.every((keyframe) => keyframe.clipId === pasted.id)).toBe(true);
    expect(pastedKeyframes.map((keyframe) => keyframe.id))
      .not.toEqual(clipData.keyframes?.map((keyframe) => keyframe.id));

    pasted.motion!.appearance!.items[0].opacity = 0.01;
    expect(clipData.motion?.appearance?.items[0].opacity).toBe(1);
  });

  it('normalizes legacy Replicators at the clipboard paste boundary', () => {
    const clipData = createClipboardMotionClipData();
    clipData.motion!.replicator = createLegacyReplicatorContractFixture() as unknown as
      NonNullable<typeof clipData.motion>['replicator'];
    const plan = createPastedClipboardClipsPlan({
      clipboardData: [clipData],
      playheadPosition: 8,
      tracks: [{
        id: clipData.trackId,
        name: 'Motion',
        type: 'video',
        height: 70,
        muted: false,
        visible: true,
        solo: false,
      }],
      clipKeyframes: new Map(),
      timestamp: 4242,
      createSuffix: () => 'legacy-normalized',
    });

    expect(plan.newClips[0]?.motion?.replicator).toMatchObject({
      contract: 'masterselects.motion-replicator',
      version: 2,
      enabled: true,
    });
  });

  it('remaps copied parent links only when the parent is in the same clipboard batch', () => {
    const child = {
      ...createClipboardMotionClipData(),
      id: 'motion-child',
      parentClipId: 'motion-parent',
    };
    const parent = {
      ...createClipboardMotionClipData(),
      id: 'motion-parent',
      parentClipId: undefined,
    };
    let suffix = 0;
    const input = {
      playheadPosition: 8,
      tracks: [{
        id: child.trackId,
        name: 'Motion',
        type: 'video' as const,
        height: 70,
        muted: false,
        visible: true,
        solo: false,
      }],
      clipKeyframes: new Map(),
      timestamp: 4242,
      createSuffix: () => `stable-${suffix += 1}`,
    };

    const complete = createPastedClipboardClipsPlan({
      ...input,
      clipboardData: [child, parent],
    });
    const pastedChild = complete.newClips.find(
      (clip) => clip.id === complete.idMapping.get(child.id),
    );
    expect(pastedChild?.parentClipId).toBe(complete.idMapping.get(parent.id));

    const detached = createPastedClipboardClipsPlan({
      ...input,
      clipboardData: [child],
    });
    expect(detached.newClips[0].parentClipId).toBeUndefined();
  });

  it('clears surviving child links atomically when their parent is deleted', () => {
    const fixture = createMd1GoldenFixture();
    const parent = { ...fixture.clips[0], id: 'motion-parent' };
    const child = {
      ...fixture.clips[1],
      id: 'motion-child',
      parentClipId: parent.id,
    };
    const result = applyDeleteClipsOperation(
      { type: 'delete-clips', clipIds: [parent.id], includeLinked: false },
      [parent, child],
      fixture.tracks,
      new Set([parent.id, child.id]),
    );

    expect(result.clips).toHaveLength(1);
    expect(result.clips[0].parentClipId).toBeUndefined();
    expect(result.changedClipIds).toEqual([parent.id, child.id]);
    expect(result.selectedClipIds).toEqual(new Set([child.id]));
  });

  it('clears surviving child links through the production removeClip action', () => {
    const restoreSnapshot = captureMd1EvidenceRestoreSnapshot();
    const fixture = createMd1GoldenFixture();
    const parent = { ...fixture.clips[0], id: 'motion-parent' };
    const child = {
      ...fixture.clips[1],
      id: 'motion-child',
      parentClipId: parent.id,
    };
    try {
      useTimelineStore.setState({
        tracks: fixture.tracks,
        clips: [parent, child],
        selectedClipIds: new Set([parent.id]),
        primarySelectedClipId: parent.id,
      });

      useTimelineStore.getState().removeClip(parent.id);

      expect(useTimelineStore.getState().clips).toHaveLength(1);
      expect(useTimelineStore.getState().clips[0].id).toBe(child.id);
      expect(useTimelineStore.getState().clips[0].parentClipId).toBeUndefined();
    } finally {
      restoreMd1EvidenceSnapshot(restoreSnapshot);
    }
  });

  it('remaps children to a covering split-parent part and detaches spanning children', () => {
    const fixture = createMd1GoldenFixture();
    const parent = {
      ...fixture.clips[0],
      id: 'motion-parent',
      startTime: 0,
      duration: 6,
      inPoint: 0,
      outPoint: 6,
    };
    const earlyChild = {
      ...fixture.clips[1],
      id: 'motion-child-early',
      startTime: 0.5,
      duration: 1,
      parentClipId: parent.id,
    };
    const lateChild = {
      ...fixture.clips[2],
      id: 'motion-child-late',
      startTime: 4,
      duration: 1,
      parentClipId: parent.id,
    };
    const spanningChild = {
      ...fixture.clips[3],
      id: 'motion-child-spanning',
      startTime: 2,
      duration: 2,
      parentClipId: parent.id,
    };
    const result = applySplitAtTimesOperation({
      id: 'split-motion-parent',
      type: 'split-at-times',
      clipId: parent.id,
      times: [3],
      includeLinked: false,
    }, [parent, earlyChild, lateChild, spanningChild], fixture.tracks);
    const parentParts = result.clips
      .filter((clip) => clip.id !== earlyChild.id
        && clip.id !== lateChild.id
        && clip.id !== spanningChild.id)
      .toSorted((left, right) => left.startTime - right.startTime);

    expect(result.clips.find((clip) => clip.id === earlyChild.id)?.parentClipId)
      .toBe(parentParts[0].id);
    expect(result.clips.find((clip) => clip.id === lateChild.id)?.parentClipId)
      .toBe(parentParts[1].id);
    expect(result.clips.find((clip) => clip.id === spanningChild.id)?.parentClipId)
      .toBeUndefined();
  });

  it('routes production set/clear parent through the frozen planner and preserves static world space', () => {
    const restoreSnapshot = captureMd1EvidenceRestoreSnapshot();
    const fixture = createMd1GoldenFixture();
    const parent = {
      ...fixture.clips[0],
      id: 'motion-parent',
      transform: {
        ...structuredClone(fixture.clips[0].transform),
        position: { x: 120, y: -35, z: 0 },
        scale: { all: 1.1, x: 0.8, y: 1.2 },
        rotation: { x: 0, y: 0, z: 25 },
        opacity: 0.9,
      },
    };
    const child = {
      ...fixture.clips[1],
      id: 'motion-child',
      transform: {
        ...structuredClone(fixture.clips[1].transform),
        position: { x: -20, y: 45, z: 0 },
        scale: { all: 0.95, x: 1.3, y: 0.75 },
        rotation: { x: 0, y: 0, z: -15 },
        opacity: 0.7,
      },
    };
    try {
      useTimelineStore.setState({
        tracks: fixture.tracks,
        clips: [parent, child],
        clipKeyframes: new Map(),
        playheadPosition: 2,
      });
      const before = useTimelineStore.getState().getInterpolatedTransform(child.id, 2 - child.startTime);

      useTimelineStore.getState().setClipParent(child.id, parent.id);

      expect(useTimelineStore.getState().clips.find((clip) => clip.id === child.id)?.parentClipId)
        .toBe(parent.id);
      const parented = useTimelineStore.getState().getInterpolatedTransform(child.id, 2 - child.startTime);
      expect2DTransformClose(parented, before);

      useTimelineStore.getState().setClipParent(child.id, null);

      expect(useTimelineStore.getState().clips.find((clip) => clip.id === child.id)?.parentClipId)
        .toBeUndefined();
      const cleared = useTimelineStore.getState().getInterpolatedTransform(child.id, 2 - child.startTime);
      expect2DTransformClose(cleared, before);
    } finally {
      restoreMd1EvidenceSnapshot(restoreSnapshot);
    }
  });

  it('writes one current-time transform keyframe tuple for animated reparenting', () => {
    const restoreSnapshot = captureMd1EvidenceRestoreSnapshot();
    const fixture = createMd1GoldenFixture();
    const parent = {
      ...fixture.clips[0],
      id: 'motion-parent',
      startTime: 0,
      transform: {
        ...structuredClone(fixture.clips[0].transform),
        position: { x: 80, y: 20, z: 0 },
        scale: { all: 1, x: 1.2, y: 0.9 },
        rotation: { x: 0, y: 0, z: 30 },
        opacity: 0.8,
      },
    };
    const child = { ...fixture.clips[1], id: 'motion-child', startTime: 0 };
    const childKeyframes = [{
      id: 'child-position-start',
      clipId: child.id,
      property: 'position.x' as const,
      time: 0,
      value: 10,
      easing: 'linear' as const,
    }, {
      id: 'child-position-current',
      clipId: child.id,
      property: 'position.x' as const,
      time: 2,
      value: 50,
      easing: 'linear' as const,
    }];
    try {
      useTimelineStore.setState({
        tracks: fixture.tracks,
        clips: [parent, child],
        clipKeyframes: new Map([[child.id, childKeyframes]]),
        playheadPosition: 2,
      });
      const before = useTimelineStore.getState().getInterpolatedTransform(child.id, 2);

      useTimelineStore.getState().setClipParent(child.id, parent.id);

      const after = useTimelineStore.getState().getInterpolatedTransform(child.id, 2);
      expect2DTransformClose(after, before);
      const atOperationTime = useTimelineStore.getState().clipKeyframes.get(child.id)
        ?.filter((keyframe) => keyframe.time === 2);
      expect(new Set(atOperationTime?.map((keyframe) => keyframe.property))).toEqual(new Set([
        'position.x',
        'position.y',
        'scale.all',
        'scale.x',
        'scale.y',
        'rotation.z',
        'opacity',
      ]));
      expect(atOperationTime?.find((keyframe) => keyframe.property === 'position.x')?.id)
        .toBe('child-position-current');
    } finally {
      restoreMd1EvidenceSnapshot(restoreSnapshot);
    }
  });

  it('creates one null and parents the selected clips through one production action', () => {
    const restoreSnapshot = captureMd1EvidenceRestoreSnapshot();
    const fixture = createMd1GoldenFixture();
    const first = {
      ...fixture.clips[0],
      id: 'motion-selected-a',
      startTime: 0.5,
      duration: 3,
    };
    const second = {
      ...fixture.clips[1],
      id: 'motion-selected-b',
      startTime: 1,
      duration: 4,
    };
    try {
      useTimelineStore.setState({
        tracks: fixture.tracks,
        clips: [first, second],
        clipKeyframes: new Map(),
        selectedClipIds: new Set([first.id, second.id]),
        primarySelectedClipId: first.id,
        playheadPosition: 2,
      });
      const beforeFirst = useTimelineStore.getState().getInterpolatedTransform(first.id, 1.5);
      const beforeSecond = useTimelineStore.getState().getInterpolatedTransform(second.id, 1);

      const nullId = useTimelineStore.getState().addMotionNullAndParentSelected(first.trackId, 2);

      expect(nullId).toBeTruthy();
      const state = useTimelineStore.getState();
      const nullClip = state.clips.find((clip) => clip.id === nullId);
      expect(nullClip?.source?.type).toBe('motion-null');
      expect(nullClip?.startTime).toBeLessThanOrEqual(first.startTime);
      expect((nullClip?.startTime ?? 0) + (nullClip?.duration ?? 0))
        .toBeGreaterThanOrEqual(second.startTime + second.duration);
      expect(state.clips.find((clip) => clip.id === first.id)?.parentClipId).toBe(nullId);
      expect(state.clips.find((clip) => clip.id === second.id)?.parentClipId).toBe(nullId);
      expect(state.selectedClipIds).toEqual(new Set([nullId!]));
      expect2DTransformClose(state.getInterpolatedTransform(first.id, 1.5), beforeFirst);
      expect2DTransformClose(state.getInterpolatedTransform(second.id, 1), beforeSecond);
    } finally {
      restoreMd1EvidenceSnapshot(restoreSnapshot);
    }
  });

  it('duplicates through the production copyClips/pasteClips store actions', () => {
    const restoreSnapshot = captureMd1EvidenceRestoreSnapshot();
    const fixture = createMd1GoldenFixture();
    const source = fixture.clips.find((clip) => clip.id === 'md1-clip-rectangle')!;
    try {
      useTimelineStore.setState({
        tracks: fixture.tracks,
        clips: [source],
        clipKeyframes: new Map([[source.id, fixture.keyframes.get(source.id)!]]),
        selectedClipIds: new Set([source.id]),
        primarySelectedClipId: source.id,
        playheadPosition: source.duration,
      });

      useTimelineStore.getState().copyClips();
      useTimelineStore.getState().pasteClips();

      const duplicate = useTimelineStore.getState().clips.find((clip) => clip.id !== source.id)!;
      expect(duplicate).toBeDefined();
      expect(duplicate.startTime).toBe(source.duration);
      expect(duplicate.motion).toEqual(source.motion);
      expect(duplicate.motion).not.toBe(source.motion);
      expect(useTimelineStore.getState().clipKeyframes.get(duplicate.id)?.map((keyframe) => keyframe.property))
        .toEqual(fixture.keyframes.get(source.id)?.map((keyframe) => keyframe.property));
    } finally {
      restoreMd1EvidenceSnapshot(restoreSnapshot);
    }
  });

  it('save/reload preserves appearance ids, gradient stop ids, masks, effects, and keyframes', () => {
    const fixture = createMd1GoldenFixture();
    const store = createTestTimelineStore({
      tracks: fixture.tracks,
      clips: fixture.clips,
      clipKeyframes: fixture.keyframes,
      duration: fixture.duration,
    });
    const serialized = createSerializableTimelineState(store.getState());
    const serializedRectangle = serialized.clips.find((clip) => clip.id === 'md1-clip-rectangle')!;
    const serializedPolygon = serialized.clips.find((clip) => clip.id === 'md1-clip-polygon')!;

    expect(serializedRectangle.motion).toEqual(
      fixture.clips.find((clip) => clip.id === serializedRectangle.id)?.motion,
    );
    expect(serializedRectangle.keyframes).toEqual(fixture.keyframes.get(serializedRectangle.id));
    expect(serializedPolygon.masks).toEqual(
      fixture.clips.find((clip) => clip.id === serializedPolygon.id)?.masks,
    );
    expect(serializedPolygon.effects).toEqual(
      fixture.clips.find((clip) => clip.id === serializedPolygon.id)?.effects,
    );

    const restored = createRestoredMotionClip(serializedRectangle, 'md1-restored-rectangle')!;
    expect(restored.motion).toEqual(serializedRectangle.motion);
    expect(restored.motion).not.toBe(serializedRectangle.motion);
    expect(restored.motion?.appearance?.items.map((item) => item.id))
      .toEqual(serializedRectangle.motion?.appearance?.items.map((item) => item.id));
    const restoredGradient = restored.motion?.appearance?.items.find((item) => item.kind === 'linear-gradient');
    const serializedGradient = serializedRectangle.motion?.appearance?.items.find((item) => item.kind === 'linear-gradient');
    expect(restoredGradient?.kind === 'linear-gradient' ? restoredGradient.stops.map((stop) => stop.id) : [])
      .toEqual(serializedGradient?.kind === 'linear-gradient' ? serializedGradient.stops.map((stop) => stop.id) : []);
  });

  it('quarantines corrupt Replicator payloads during nested load', () => {
    const fixture = createMd1GoldenFixture();
    const store = createTestTimelineStore({
      tracks: fixture.tracks,
      clips: fixture.clips,
      clipKeyframes: fixture.keyframes,
      duration: fixture.duration,
    });
    const serialized = createSerializableTimelineState(store.getState());
    const corrupt = structuredClone(
      serialized.clips.find((clip) => clip.id === 'md1-clip-rectangle')!,
    );
    corrupt.motion!.replicator = {
      ...createLegacyReplicatorContractFixture(),
      layout: {
        mode: 'grid',
        count: { x: 0, y: 2 },
        spacing: { x: 10, y: 20 },
      },
    } as unknown as NonNullable<typeof corrupt.motion>['replicator'];

    const restored = createRestoredMotionClip(corrupt, 'corrupt-restored')!;

    expect(restored.motion?.replicator).toBeUndefined();
    expect(restored.motion?.replicatorRecovery).toMatchObject({
      raw: expect.any(Object),
      diagnostic: expect.any(String),
    });
  });

  it('split produces independent full-stack motion definitions', () => {
    const fixture = createMd1GoldenFixture();
    const source = fixture.clips.find((clip) => clip.id === 'md1-clip-rectangle')!;
    const store = createTestTimelineStore({ tracks: fixture.tracks, clips: [source] });

    store.getState().splitClip(source.id, 2);
    const split = store.getState().clips;
    expect(split).toHaveLength(2);
    expect(split[0].motion).toEqual(split[1].motion);
    expect(split[0].motion).not.toBe(split[1].motion);
    expect(split[0].motion?.appearance).not.toBe(split[1].motion?.appearance);
    expect(split[0].motion?.appearance?.items[0]).not.toBe(split[1].motion?.appearance?.items[0]);

    split[0].motion!.appearance!.items[0].visible = false;
    expect(split[1].motion?.appearance?.items[0].visible).toBe(true);
  });

  it('nested fixture clones retain the same appearance and property identities', () => {
    const fixture = createMd1GoldenFixture();
    expect(fixture.nestedWrapperClip.nestedClips).not.toBe(fixture.clips);
    expect(fixture.nestedWrapperClip.nestedClips?.map((clip) => clip.id))
      .toEqual(fixture.clips.map((clip) => clip.id));
    for (let index = 0; index < fixture.clips.length; index += 1) {
      const direct = fixture.clips[index];
      const nested = fixture.nestedWrapperClip.nestedClips![index];
      expect(nested.motion).toEqual(direct.motion);
      expect(nested.motion).not.toBe(direct.motion);
      expect(nested.motion?.appearance?.items.map((item) => item.id))
        .toEqual(direct.motion?.appearance?.items.map((item) => item.id));
      const embeddedKeyframes = (nested as typeof nested & { keyframes?: unknown[] }).keyframes;
      expect(embeddedKeyframes).toEqual(fixture.keyframes.get(direct.id) ?? []);
    }

    const directRectangle = fixture.clips.find((clip) => clip.id === 'md1-clip-rectangle')!;
    const nestedRectangle = fixture.nestedWrapperClip.nestedClips!.find(
      (clip) => clip.id === directRectangle.id,
    ) as typeof directRectangle & { keyframes?: typeof fixture.keyframes extends Map<string, infer T> ? T : never };
    const directEvaluated = getInterpolatedMotionLayer(
      directRectangle,
      fixture.keyframes.get(directRectangle.id)!,
      fixture.sampleTime,
    );
    const nestedEvaluated = getInterpolatedMotionLayer(
      nestedRectangle,
      nestedRectangle.keyframes ?? [],
      fixture.sampleTime,
    );
    const directGradient = directEvaluated?.appearance?.items.find((item) => item.id === 'md1-rect-gradient');
    const nestedGradient = nestedEvaluated?.appearance?.items.find((item) => item.id === 'md1-rect-gradient');
    expect(directGradient?.opacity).toBeGreaterThan(0.3);
    expect(directGradient?.opacity).toBeLessThan(0.88);
    expect(nestedGradient?.opacity).toBe(directGradient?.opacity);
  });

  it('round-trips MD1 through the production project save codec, project JSON, and load codec', async () => {
    const restoreSnapshot = captureMd1EvidenceRestoreSnapshot();
    const fixture = createMd1GoldenFixture();
    const clipsWithParent = fixture.clips.map((clip) => (
      clip.id === 'md1-clip-rectangle'
        ? { ...clip, parentClipId: 'md1-clip-ellipse' }
        : clip
    ));
    const updateCompositions = vi.spyOn(projectFileService, 'updateCompositions').mockImplementation(() => {});
    const updateMedia = vi.spyOn(projectFileService, 'updateMedia').mockImplementation(() => {});
    const updateFolders = vi.spyOn(projectFileService, 'updateFolders').mockImplementation(() => {});
    try {
      expect(projectFileService.isProjectOpen()).toBe(false);
      useTimelineStore.setState({
        tracks: fixture.tracks,
        clips: clipsWithParent,
        clipKeyframes: fixture.keyframes,
        duration: fixture.duration,
        playheadPosition: fixture.sampleTime,
      });
      const timelineData = useTimelineStore.getState().getSerializableState();
      const template = useMediaStore.getState().compositions[0] ?? {
        id: 'template',
        name: 'Template',
        type: 'composition' as const,
        parentId: null,
        createdAt: 0,
        width: fixture.width,
        height: fixture.height,
        frameRate: 30,
        duration: fixture.duration,
        backgroundColor: '#000000',
      };
      useMediaStore.setState({
        compositions: [{
          ...template,
          id: 'md1-project-codec-comp',
          name: 'MD1 Project Codec',
          width: fixture.width,
          height: fixture.height,
          duration: fixture.duration,
          frameRate: 30,
          timelineData,
        }],
        activeCompositionId: 'md1-project-codec-comp',
        openCompositionIds: ['md1-project-codec-comp'],
        currentProjectId: null,
        currentProjectName: 'Untitled Project',
      });
      expect(useMediaStore.getState().compositions).toHaveLength(1);

      await syncStoresToProject();
      expect(updateCompositions).toHaveBeenCalled();
      const projectCompositions = updateCompositions.mock.calls.at(-1)![0];
      const projectRectangle = projectCompositions[0].clips.find(
        (clip) => clip.id === 'md1-clip-rectangle',
      );
      expect(projectRectangle?.motion).toEqual(
        fixture.clips.find((clip) => clip.id === 'md1-clip-rectangle')?.motion,
      );
      expect(projectRectangle?.parentClipId).toBe('md1-clip-ellipse');
      expect(projectRectangle?.keyframes.map((keyframe) => keyframe.property))
        .toEqual(fixture.keyframes.get('md1-clip-rectangle')?.map((keyframe) => keyframe.property));

      const persistedProjectJson = JSON.stringify({
        version: 1,
        name: 'MD1 codec snapshot',
        compositions: projectCompositions,
      });
      const decodedProject = JSON.parse(persistedProjectJson) as { compositions: typeof projectCompositions };
      const hydratedCompositions = convertProjectCompositionToStore(decodedProject.compositions);
      await useTimelineStore.getState().loadState(hydratedCompositions[0].timelineData);

      const restoredRectangle = useTimelineStore.getState().clips.find(
        (clip) => clip.id === 'md1-clip-rectangle',
      );
      const restoredPolygon = useTimelineStore.getState().clips.find(
        (clip) => clip.id === 'md1-clip-polygon',
      );
      expect(restoredRectangle?.motion).toEqual(
        fixture.clips.find((clip) => clip.id === 'md1-clip-rectangle')?.motion,
      );
      expect(restoredRectangle?.parentClipId).toBe('md1-clip-ellipse');
      expect(useTimelineStore.getState().clipKeyframes.get('md1-clip-rectangle'))
        .toEqual(fixture.keyframes.get('md1-clip-rectangle'));
      expect(restoredPolygon?.masks).toEqual(
        expect.arrayContaining([expect.objectContaining({
          id: 'md1-mask-polygon-cut',
          mode: 'add',
          enabled: true,
        })]),
      );
      expect(restoredPolygon?.effects).toEqual(
        fixture.clips.find((clip) => clip.id === 'md1-clip-polygon')?.effects,
      );
    } finally {
      updateCompositions.mockRestore();
      updateMedia.mockRestore();
      updateFolders.mockRestore();
      restoreMd1EvidenceSnapshot(restoreSnapshot);
    }
  });

  it('restores timeline view/export and history state even when evidence execution throws', async () => {
    const timelineBefore = useTimelineStore.getState();
    const historyBefore = getHistoryStateView();
    const mediaBefore = useMediaStore.getState();
    const exportBefore = useExportStore.getState();
    const dimensionsBefore = renderHostPort.getOutputDimensions();
    const snapshot = captureMd1EvidenceRestoreSnapshot();

    await expect(runWithMd1EvidenceRestore(async () => {
      useTimelineStore.setState({
        zoom: timelineBefore.zoom + 9,
        scrollX: timelineBefore.scrollX + 17,
        selectedClipIds: new Set(['evidence-temp']),
        selectedKeyframeIds: new Set(['evidence-kf']),
        isExporting: true,
        exportProgress: 42,
        exportCurrentTime: 0.5,
        exportRange: { start: 0, end: 1 },
        exportPreviewFrameTime: 0.5,
      });
      useHistoryStore.setState({ maxHistoryNodes: historyBefore.maxHistorySize + 1 });
      useMediaStore.setState({
        compositions: [],
        selectedIds: ['evidence-media'],
        currentProjectName: 'Evidence mutation',
      });
      useExportStore.setState({
        settings: { ...exportBefore.settings, filename: 'evidence-mutation' },
        selectedPresetId: 'evidence-preset',
      });
      renderHostPort.setResolution(dimensionsBefore.width + 8, dimensionsBefore.height + 8);
      throw new Error('forced MD1 evidence failure');
    }, () => restoreMd1EvidenceSnapshot(snapshot))).rejects.toThrow('forced MD1 evidence failure');

    const timelineAfter = useTimelineStore.getState();
    expect(timelineAfter.zoom).toBe(timelineBefore.zoom);
    expect(timelineAfter.scrollX).toBe(timelineBefore.scrollX);
    expect(timelineAfter.selectedClipIds).toBe(timelineBefore.selectedClipIds);
    expect(timelineAfter.selectedKeyframeIds).toBe(timelineBefore.selectedKeyframeIds);
    expect(timelineAfter.isExporting).toBe(timelineBefore.isExporting);
    expect(timelineAfter.exportProgress).toBe(timelineBefore.exportProgress);
    expect(timelineAfter.exportCurrentTime).toBe(timelineBefore.exportCurrentTime);
    expect(timelineAfter.exportRange).toBe(timelineBefore.exportRange);
    expect(timelineAfter.exportPreviewFrameTime).toBe(timelineBefore.exportPreviewFrameTime);
    expect(getHistoryStateView().maxHistorySize).toBe(historyBefore.maxHistorySize);
    expect(useMediaStore.getState().compositions).toEqual(mediaBefore.compositions);
    expect(useMediaStore.getState().selectedIds).toEqual(mediaBefore.selectedIds);
    expect(useMediaStore.getState().currentProjectName).toBe(mediaBefore.currentProjectName);
    expect(useExportStore.getState().settings).toEqual(exportBefore.settings);
    expect(useExportStore.getState().selectedPresetId).toBe(exportBefore.selectedPresetId);
    expect(renderHostPort.getOutputDimensions()).toEqual(dimensionsBefore);
  });
});
