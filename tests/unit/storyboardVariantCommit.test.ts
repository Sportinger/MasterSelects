import { describe, expect, it, vi } from 'vitest';
import type { Composition } from '../../src/stores/mediaStore/types';
import type {
  SerializableClip,
  TimelineTrack,
} from '../../src/types/timeline';
import {
  archiveTimelineVariantSet,
  assertVariantIsolation,
  captureVariantRangeSnapshot,
  commitTimelineVariantOption,
  createVariantTimelineSourceFromComposition,
  fingerprintVariantRangeSnapshot,
  rebaseTimelineVariantSet,
  replaceTimelineRangeWithVariant,
  StaleTimelineVariantError,
  type VariantMaterializationIdFactory,
  type VariantRangeSnapshot,
} from '../../src/services/storyboard/variants';
import type {
  StoryboardCandidate,
  StoryboardProjectState,
  StoryboardScene,
  TimelineFragment,
  TimelineVariantOption,
  TimelineVariantSet,
} from '../../src/services/storyboard/contracts';
import { createEmptyStoryboardStoreProjectState } from '../../src/stores/storyboardStore';
import {
  getStoryboardProjectSnapshot,
  hydrateStoryboardProjectState,
} from '../../src/stores/storyboardStore';
import {
  getHistoryStateView,
  initHistoryStoreRefs,
  setHistoryDisabledForDebug,
  undo,
} from '../../src/stores/historyStore';
import { useMediaStore } from '../../src/stores/mediaStore';
import { useTimelineStore } from '../../src/stores/timeline';
import { useDockStore } from '../../src/stores/dockStore';

function track(id: string, type: 'video' | 'audio' = 'video'): TimelineTrack {
  return {
    id,
    name: id,
    type,
    height: 64,
    muted: false,
    visible: true,
    solo: false,
  };
}

function clip(
  id: string,
  trackId: string,
  startTime: number,
  duration: number,
): SerializableClip {
  return {
    id,
    trackId,
    name: id,
    mediaFileId: `media-${id}`,
    startTime,
    duration,
    inPoint: 0,
    outPoint: duration,
    sourceType: 'video',
    transform: {
      opacity: 1,
      blendMode: 'normal',
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      rotation: { x: 0, y: 0, z: 0 },
    },
    effects: [],
  };
}

function composition(withBoundaryTransition = false): Composition {
  const before = clip('before', 'video-1', 0, 8);
  const crossing = clip('crossing', 'video-1', 8, 4);
  const inside = clip('inside', 'video-1', 12, 6);
  const outsideAfter = clip('outside-after', 'video-1', 24, 4);
  const outsideTrack = clip('outside-track', 'video-2', 12, 6);
  if (withBoundaryTransition) {
    before.duration = 10;
    before.outPoint = 10;
    crossing.startTime = 10;
    crossing.duration = 2;
    crossing.outPoint = 2;
    before.transitionOut = {
      id: 'boundary-transition',
      type: 'crossfade',
      duration: 0.5,
      linkedClipId: crossing.id,
    };
    crossing.transitionIn = {
      ...before.transitionOut,
      linkedClipId: before.id,
    };
  }
  return {
    id: 'base-comp',
    name: 'Base',
    type: 'composition',
    parentId: null,
    createdAt: 1,
    width: 1920,
    height: 1080,
    frameRate: 30,
    duration: 40,
    backgroundColor: '#000',
    timelineData: {
      tracks: [track('video-1'), track('video-2')],
      clips: [before, crossing, inside, outsideAfter, outsideTrack],
      playheadPosition: 0,
      duration: 40,
      zoom: 100,
      scrollX: 0,
      inPoint: null,
      outPoint: null,
      loopPlayback: false,
    },
  };
}

function fragment(): TimelineFragment {
  const payload = clip('payload', 'unused', 0, 10);
  payload.mediaFileId = 'media-accepted';
  payload.storyboardProperties = {
    schemaVersion: 1,
    planId: 'plan-1',
    sceneId: 'scene-1',
    title: 'Opening',
    description: 'A committed scene',
    targetDurationSeconds: 10,
    status: 'accepted',
  };
  return {
    schemaVersion: 1,
    durationSeconds: 10,
    tracks: [{
      localTrackId: 'fragment-video',
      sourceTrackId: 'video-1',
      kind: 'video',
    }],
    clips: [{
      localId: 'fragment-clip',
      localTrackId: 'fragment-video',
      startOffsetSeconds: 0,
      durationSeconds: 10,
      payload: structuredClone(payload) as never,
    }],
    links: [],
    keyframes: [],
    effects: [],
    masks: [],
    transitions: [],
    markers: [{ id: 'variant-marker', time: 5, label: 'Beat', color: '#fff' }],
    annotations: [],
    sceneIds: ['scene-1'],
    candidateIds: ['candidate-1'],
    warnings: [],
  };
}

function projectState(): StoryboardProjectState {
  const empty = createEmptyStoryboardStoreProjectState();
  const scene: StoryboardScene = {
    schemaVersion: 1,
    id: 'scene-1',
    planId: 'plan-1',
    title: 'Opening',
    description: 'Opening scene',
    targetDurationSeconds: 10,
    status: 'review',
    filledClipIds: [],
    evidenceRefIds: [],
    variantSetIds: [],
    createdAt: 1,
    updatedAt: 1,
  };
  const candidate: StoryboardCandidate = {
    schemaVersion: 1,
    id: 'candidate-1',
    sceneId: scene.id,
    kind: 'generated-video',
    state: 'accepted',
    mediaFileId: 'media-accepted',
    sourceMomentHandles: [],
    durationSeconds: 10,
    createdAt: 1,
  };
  return {
    ...empty,
    scenes: { [scene.id]: scene },
    candidates: { [candidate.id]: candidate },
  };
}

function sequentialFactory(): VariantMaterializationIdFactory {
  let index = 0;
  return (kind, sourceId) => (
    `${kind}-${++index}-${sourceId.replaceAll('\u0000', '-')}`
  );
}

async function fixture(withBoundaryTransition = false): Promise<{
  base: Composition;
  snapshot: VariantRangeSnapshot;
  variantSet: TimelineVariantSet;
  option: TimelineVariantOption;
}> {
  const base = composition(withBoundaryTransition);
  const scope = {
    startTime: 10,
    endTime: 20,
    trackIds: ['video-1'],
    includeLinked: false,
  };
  const snapshot = captureVariantRangeSnapshot(
    createVariantTimelineSourceFromComposition({
      composition: base,
      scope,
      boundaryPaddingSeconds: 1,
    }),
  );
  const fingerprints = await fingerprintVariantRangeSnapshot(snapshot);
  const variantSet: TimelineVariantSet = {
    schemaVersion: 1,
    id: 'variant-set',
    title: 'Alternatives',
    baseCompositionId: base.id,
    sceneIds: ['scene-1'],
    scope,
    baseFingerprint: fingerprints.scope,
    boundaryFingerprint: fingerprints.boundary,
    status: 'review',
    optionIds: ['option-1'],
    createdAt: 1,
  };
  const option: TimelineVariantOption = {
    schemaVersion: 1,
    id: 'option-1',
    variantSetId: variantSet.id,
    title: 'Selected opening',
    rationale: 'Clearer opening.',
    state: 'ready',
    fragment: fragment(),
    candidateIds: ['candidate-1'],
  };
  return { base, snapshot, variantSet, option };
}

describe('first-class storyboard variant range commit', () => {
  it('changes only the selected range, commits scene state, and preserves outside fingerprints', async () => {
    const { base, snapshot, variantSet, option } = await fixture();
    const original = structuredClone(base);
    const result = await replaceTimelineRangeWithVariant({
      compositions: [base],
      variantSet,
      option,
      currentRangeSnapshot: snapshot,
      boundaryPolicy: 'preserve',
      storyboardState: projectState(),
      idFactory: sequentialFactory(),
      now: 50,
    });

    expect(base).toEqual(original);
    expect(result.variantSet).toMatchObject({
      status: 'committed',
      committedOptionId: option.id,
    });
    expect(result.option.state).toBe('accepted');
    expect(result.insertedClipIds).toHaveLength(1);
    expect(result.baseComposition.timelineData!.clips).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'crossing', startTime: 8, duration: 2 }),
        expect.objectContaining({ id: 'outside-after', startTime: 24, duration: 4 }),
        expect.objectContaining({ id: 'outside-track', startTime: 12, duration: 6 }),
      ]),
    );
    expect(result.baseComposition.timelineData!.clips.some(
      (entry) => entry.id === 'inside',
    )).toBe(false);
    expect(result.baseComposition.timelineData!.markers).toEqual([
      expect.objectContaining({ time: 15, label: 'Beat' }),
    ]);
    expect(result.storyboardState!.scenes['scene-1']).toMatchObject({
      status: 'filled',
      selectedCandidateId: 'candidate-1',
      filledClipIds: result.insertedClipIds,
      variantSetIds: ['variant-set'],
      updatedAt: 50,
    });

    const after = captureVariantRangeSnapshot(
      createVariantTimelineSourceFromComposition({
        composition: result.baseComposition,
        scope: variantSet.scope,
        boundaryPaddingSeconds: snapshot.boundaryPaddingSeconds,
        sourceClipIdentityByClipId: result.sourceClipIdentityByClipId,
      }),
    );
    const isolation = await assertVariantIsolation({
      before: snapshot,
      after,
      expectedBaseFingerprint: variantSet.baseFingerprint,
      expectedBoundaryFingerprint: variantSet.boundaryFingerprint,
      boundaryPolicy: 'preserve',
    });
    expect(isolation).toMatchObject({ ok: true });
  });

  it('rejects stale scope before mutation and marks the durable set stale in runtime', async () => {
    const { base, snapshot, variantSet, option } = await fixture();
    const changedSource = structuredClone(snapshot.source);
    changedSource.clips.find((entry) => entry.id === 'inside')!.payload.name = 'changed';
    const staleSnapshot = captureVariantRangeSnapshot(changedSource);
    const applyBaseComposition = vi.fn();
    const markVariantSetStale = vi.fn();

    await expect(commitTimelineVariantOption({
      compositions: [base],
      storyboardState: projectState(),
      variantSet,
      option,
      currentRangeSnapshot: staleSnapshot,
      boundaryPolicy: 'preserve',
      idFactory: sequentialFactory(),
    }, {
      listCompositions: () => [base],
      getStoryboardState: projectState,
      applyBaseComposition,
      applyStoryboardState: vi.fn(),
      markVariantSetStale,
      startHistoryBatch: vi.fn(() => ({ opened: true })),
      endHistoryBatch: vi.fn(),
      cancelHistoryBatch: vi.fn(),
    })).rejects.toBeInstanceOf(StaleTimelineVariantError);
    expect(applyBaseComposition).not.toHaveBeenCalled();
    expect(markVariantSetStale).toHaveBeenCalledWith(
      expect.objectContaining({ id: variantSet.id, status: 'stale' }),
    );
  });

  it('uses one history batch and rolls the exact state back when completion verification fails', async () => {
    const { base, snapshot, variantSet, option } = await fixture();
    const beforeComposition = structuredClone(base);
    const beforeStoryboard = projectState();
    let liveComposition = structuredClone(base);
    let liveStoryboard = structuredClone(beforeStoryboard);
    let rollback: (() => void) | undefined;
    const startHistoryBatch = vi.fn(() => {
      const compositionSnapshot = structuredClone(liveComposition);
      const storyboardSnapshot = structuredClone(liveStoryboard);
      rollback = () => {
        liveComposition = compositionSnapshot;
        liveStoryboard = storyboardSnapshot;
      };
      return { opened: true };
    });
    const endHistoryBatch = vi.fn();
    const cancelHistoryBatch = vi.fn(() => rollback?.());

    await expect(commitTimelineVariantOption({
      variantSet,
      option,
      currentRangeSnapshot: snapshot,
      boundaryPolicy: 'preserve',
      idFactory: sequentialFactory(),
    }, {
      listCompositions: () => [liveComposition],
      getStoryboardState: () => liveStoryboard,
      applyBaseComposition: (composition) => {
        liveComposition = structuredClone(composition);
      },
      applyStoryboardState: (state) => {
        liveStoryboard = structuredClone(state);
      },
      markVariantSetStale: vi.fn(),
      startHistoryBatch,
      endHistoryBatch,
      cancelHistoryBatch,
      verifyComplete: vi.fn(async () => ({
        ok: false,
        message: 'Final editor verification failed.',
      })),
    })).rejects.toThrow('Final editor verification failed');

    expect(startHistoryBatch).toHaveBeenCalledOnce();
    expect(endHistoryBatch).not.toHaveBeenCalled();
    expect(cancelHistoryBatch).toHaveBeenCalledOnce();
    expect(liveComposition).toEqual(beforeComposition);
    expect(liveStoryboard).toEqual(beforeStoryboard);
  });

  it('creates one real global undo point that restores the exact base and storyboard state', async () => {
    const { base, snapshot, variantSet, option } = await fixture();
    let mediaState = {
      ...useMediaStore.getState(),
      compositions: [structuredClone(base)],
      activeCompositionId: null,
    };
    let storyboardState = projectState();
    setHistoryDisabledForDebug(false);
    getHistoryStateView().clearHistory();
    initHistoryStoreRefs({
      timeline: {
        getState: useTimelineStore.getState,
        setState: useTimelineStore.setState,
      },
      media: {
        getState: () => mediaState,
        setState: (state) => {
          mediaState = { ...mediaState, ...state };
        },
      },
      dock: {
        getState: useDockStore.getState,
        setState: useDockStore.setState,
      },
      storyboard: {
        getState: () => storyboardState,
        setState: (state) => {
          storyboardState = structuredClone(state);
        },
      },
    });

    try {
      await commitTimelineVariantOption({
        variantSet,
        option,
        currentRangeSnapshot: snapshot,
        boundaryPolicy: 'preserve',
        idFactory: sequentialFactory(),
      }, {
        listCompositions: () => mediaState.compositions,
        getStoryboardState: () => storyboardState,
        applyBaseComposition: (composition) => {
          mediaState = {
            ...mediaState,
            compositions: mediaState.compositions.map((entry) => (
              entry.id === composition.id ? structuredClone(composition) : entry
            )),
          };
        },
        applyStoryboardState: (state) => {
          storyboardState = structuredClone(state);
        },
        markVariantSetStale: vi.fn(),
        startHistoryBatch: (label) => getHistoryStateView().startBatch(label),
        endHistoryBatch: () => getHistoryStateView().endBatch(),
        cancelHistoryBatch: () => getHistoryStateView().cancelBatch(),
      });
      expect(getHistoryStateView().undoStack).toHaveLength(1);
      expect(mediaState.compositions[0]).not.toEqual(base);
      expect(storyboardState.variantSets[variantSet.id]?.status)
        .toBe('committed');

      expect(undo()).not.toBeNull();
      expect(mediaState.compositions).toEqual([base]);
      expect(storyboardState).toEqual(projectState());
    } finally {
      initHistoryStoreRefs({
        timeline: {
          getState: useTimelineStore.getState,
          setState: useTimelineStore.setState,
        },
        media: {
          getState: useMediaStore.getState,
          setState: useMediaStore.setState,
        },
        dock: {
          getState: useDockStore.getState,
          setState: useDockStore.setState,
        },
        storyboard: {
          getState: getStoryboardProjectSnapshot,
          setState: hydrateStoryboardProjectState,
        },
      });
      getHistoryStateView().clearHistory();
    }
  });

  it('enforces preserve, rebuild, and drop-with-warning boundary transition policies', async () => {
    const preserved = await fixture(true);
    await expect(replaceTimelineRangeWithVariant({
      compositions: [preserved.base],
      variantSet: preserved.variantSet,
      option: preserved.option,
      currentRangeSnapshot: preserved.snapshot,
      boundaryPolicy: 'preserve',
      idFactory: sequentialFactory(),
    })).rejects.toThrow(/choose rebuild or drop-with-warning/i);

    const rebuiltFixture = await fixture(true);
    const rebuilt = await replaceTimelineRangeWithVariant({
      compositions: [rebuiltFixture.base],
      variantSet: rebuiltFixture.variantSet,
      option: rebuiltFixture.option,
      currentRangeSnapshot: rebuiltFixture.snapshot,
      boundaryPolicy: 'rebuild',
      idFactory: sequentialFactory(),
    });
    const insertedId = rebuilt.insertedClipIds[0]!;
    expect(rebuilt.baseComposition.timelineData!.clips.find(
      (entry) => entry.id === 'before',
    )!.transitionOut).toMatchObject({ linkedClipId: insertedId });
    expect(rebuilt.baseComposition.timelineData!.clips.find(
      (entry) => entry.id === insertedId,
    )!.transitionIn).toMatchObject({ linkedClipId: 'before' });

    const droppedFixture = await fixture(true);
    const dropped = await replaceTimelineRangeWithVariant({
      compositions: [droppedFixture.base],
      variantSet: droppedFixture.variantSet,
      option: droppedFixture.option,
      currentRangeSnapshot: droppedFixture.snapshot,
      boundaryPolicy: 'drop-with-warning',
      idFactory: sequentialFactory(),
    });
    expect(dropped.warnings).toContain(
      'Dropped boundary transition boundary-transition at the start boundary.',
    );
    expect(dropped.baseComposition.timelineData!.clips.every(
      (entry) => entry.transitionIn?.id !== 'boundary-transition'
        && entry.transitionOut?.id !== 'boundary-transition',
    )).toBe(true);
  });

  it('supports explicit rebase and archive flows without silently committing', async () => {
    const { snapshot, variantSet } = await fixture();
    const rebased = await rebaseTimelineVariantSet(
      { ...variantSet, status: 'stale' },
      snapshot,
    );
    expect(rebased).toMatchObject({
      id: variantSet.id,
      status: 'building',
      committedOptionId: undefined,
    });
    expect(archiveTimelineVariantSet({
      ...variantSet,
      status: 'stale',
    }).status).toBe('archived');
    expect(() => archiveTimelineVariantSet({
      ...variantSet,
      status: 'committed',
      committedOptionId: 'option-1',
    })).toThrow(/committed variant set/i);
  });
});
