import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useMediaStore, type Composition } from '../../src/stores/mediaStore';
import {
  convertProjectCompositionToStore,
  normalizeLoadedTransitionCompositions,
} from '../../src/services/project/load/loadTimelineHydration';
import type { ProjectComposition } from '../../src/services/project/projectFileService';
import type { SerializableClip } from '../../src/types/timeline';
import { installFakeMediaStore } from '../helpers/fakeMediaStore';

vi.mock('../../src/services/compositionRenderer', () => ({
  compositionRenderer: { invalidateCompositionAndParents: vi.fn() },
}));

function clip(id: string, startTime: number): SerializableClip {
  return {
    id,
    trackId: 'track-1',
    name: id,
    mediaFileId: `${id}-media`,
    startTime,
    duration: 2,
    inPoint: 0,
    outPoint: 2,
    sourceType: 'video',
    naturalDuration: 2,
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

function hiddenTransitionComp(id: string): Composition {
  return {
    id,
    name: id,
    type: 'composition',
    parentId: null,
    createdAt: 2,
    width: 1920,
    height: 1080,
    frameRate: 30,
    duration: 1,
    backgroundColor: '#000000',
    timelineData: { tracks: [], clips: [], duration: 1 },
    transitionComp: {
      kind: 'transition-comp',
      parentCompositionId: 'parent',
      parentTransitionId: 'orphan-transition',
      parentOutgoingClipId: 'missing-out',
      parentIncomingClipId: 'missing-in',
      linkedOutgoingClipId: 'missing-out',
      linkedIncomingClipId: 'missing-in',
      innerTransitionId: '',
      paddingBefore: 0,
      paddingAfter: 0,
      bodyStart: 0,
      bodyEnd: 1,
      templateType: 'crossfade',
      templateVersion: 2,
    },
  };
}

describe('transition composition load migration', () => {
  beforeEach(() => {
    installFakeMediaStore();
  });

  it('creates missing hidden comps once and removes orphan transition comps', () => {
    const outgoing = clip('out', 0);
    const incoming = clip('in', 2);
    outgoing.transitionOut = {
      id: 'transition-1',
      type: 'crossfade',
      duration: 1,
      linkedClipId: 'in',
    };
    incoming.transitionIn = {
      id: 'transition-1',
      type: 'crossfade',
      duration: 1,
      linkedClipId: 'out',
    };
    const parent: Composition = {
      id: 'parent',
      name: 'Parent',
      type: 'composition',
      parentId: null,
      createdAt: 1,
      width: 1920,
      height: 1080,
      frameRate: 30,
      duration: 4,
      backgroundColor: '#000000',
      timelineData: { tracks: [], clips: [outgoing, incoming], duration: 4 },
    };

    useMediaStore.setState({
      compositions: [parent, hiddenTransitionComp('orphan-transition-comp')],
      activeCompositionId: 'parent',
      openCompositionIds: ['parent'],
    });

    normalizeLoadedTransitionCompositions();

    const firstState = useMediaStore.getState();
    const transitionComps = firstState.compositions.filter((composition) =>
      composition.transitionComp?.kind === 'transition-comp'
    );
    const normalizedParent = firstState.compositions.find((composition) => composition.id === 'parent');
    const normalizedOut = normalizedParent?.timelineData?.clips.find((candidate) => candidate.id === 'out');
    const normalizedIn = normalizedParent?.timelineData?.clips.find((candidate) => candidate.id === 'in');

    expect(transitionComps).toHaveLength(1);
    expect(transitionComps[0]?.id).not.toBe('orphan-transition-comp');
    expect(transitionComps[0]?.transitionComp?.sourceLayout).toBe('mapped-v3');
    expect(normalizedOut?.transitionOut?.compositionId).toBe(transitionComps[0]?.id);
    expect(normalizedIn?.transitionIn?.compositionId).toBe(transitionComps[0]?.id);

    normalizeLoadedTransitionCompositions();

    expect(useMediaStore.getState().compositions.filter((composition) =>
      composition.transitionComp?.kind === 'transition-comp'
    ).map((composition) => composition.id)).toEqual([transitionComps[0]?.id]);
  });

  it('keeps hidden transition comps referenced by attached hidden comp timelines', () => {
    const outgoing = clip('out', 0);
    const incoming = clip('in', 2);
    outgoing.transitionOut = {
      id: 'transition-1',
      type: 'crossfade',
      duration: 1,
      linkedClipId: 'in',
    };
    incoming.transitionIn = {
      id: 'transition-1',
      type: 'crossfade',
      duration: 1,
      linkedClipId: 'out',
    };
    const parent: Composition = {
      id: 'parent',
      name: 'Parent',
      type: 'composition',
      parentId: null,
      createdAt: 1,
      width: 1920,
      height: 1080,
      frameRate: 30,
      duration: 4,
      backgroundColor: '#000000',
      timelineData: { tracks: [], clips: [outgoing, incoming], duration: 4 },
    };

    useMediaStore.setState({
      compositions: [parent],
      activeCompositionId: 'parent',
      openCompositionIds: ['parent'],
    });
    normalizeLoadedTransitionCompositions();

    const transitionComp = useMediaStore.getState().compositions.find((composition) =>
      composition.transitionComp?.kind === 'transition-comp'
    )!;
    const nestedTransitionClip: SerializableClip = {
      ...clip('nested-out', 0),
      transitionOut: {
        id: 'nested-transition',
        type: 'crossfade',
        duration: 0.5,
        linkedClipId: 'nested-in',
        compositionId: 'nested-transition-comp',
      },
    };
    const baseNestedTransitionComp = hiddenTransitionComp('nested-transition-comp');
    const nestedTransitionComp: Composition = {
      ...baseNestedTransitionComp,
      transitionComp: {
        ...baseNestedTransitionComp.transitionComp!,
        parentCompositionId: transitionComp.id,
        parentTransitionId: 'nested-transition',
        parentOutgoingClipId: 'nested-out',
        parentIncomingClipId: 'nested-in',
      },
    };
    useMediaStore.setState((state) => ({
      compositions: [
        ...state.compositions.map((composition) => composition.id === transitionComp.id
          ? {
              ...composition,
              timelineData: {
                ...composition.timelineData!,
                clips: [...composition.timelineData!.clips, nestedTransitionClip],
              },
            }
          : composition),
        nestedTransitionComp,
      ],
    }));

    normalizeLoadedTransitionCompositions();

    expect(useMediaStore.getState().compositions.some((composition) =>
      composition.id === 'nested-transition-comp'
    )).toBe(true);
  });

  it('reuses missing-layout and explicit legacy segmented comps unchanged', () => {
    for (const sourceLayout of [undefined, 'legacy-segmented'] as const) {
      const id = `legacy-${sourceLayout ?? 'missing'}`;
      const outgoing = clip('out', 0);
      const incoming = clip('in', 2);
      outgoing.transitionOut = {
        id: 'transition-1',
        type: 'crossfade',
        duration: 1,
        linkedClipId: 'in',
        compositionId: id,
      };
      incoming.transitionIn = {
        id: 'transition-1',
        type: 'crossfade',
        duration: 1,
        linkedClipId: 'out',
        compositionId: id,
      };
      const parent: Composition = {
        id: 'parent',
        name: 'Parent',
        type: 'composition',
        parentId: null,
        createdAt: 1,
        width: 1920,
        height: 1080,
        frameRate: 30,
        duration: 4,
        backgroundColor: '#000000',
        timelineData: { tracks: [], clips: [outgoing, incoming], duration: 4 },
      };
      const base = hiddenTransitionComp(id);
      const legacy: Composition = {
        ...base,
        timelineData: { tracks: [], clips: [clip('legacy-source', 0)], duration: 1 },
        transitionComp: {
          ...base.transitionComp!,
          ...(sourceLayout ? { sourceLayout } : {}),
          parentCompositionId: 'parent',
          parentTransitionId: 'transition-1',
          parentOutgoingClipId: 'out',
          parentIncomingClipId: 'in',
          linkedOutgoingClipId: 'legacy-out',
          linkedIncomingClipId: 'legacy-in',
        },
      };
      const before = structuredClone(legacy);
      useMediaStore.setState({
        compositions: [parent, legacy],
        activeCompositionId: 'parent',
        openCompositionIds: ['parent'],
      });

      normalizeLoadedTransitionCompositions();

      expect(useMediaStore.getState().compositions.find((composition) => composition.id === id)).toEqual(before);
    }
  });

  it('retains a linked legacy backup while normalizing the active mapped transition comp', () => {
    const outgoing = clip('out', 0);
    const incoming = clip('in', 2);
    outgoing.transitionOut = {
      id: 'transition-1', type: 'crossfade', duration: 1, linkedClipId: 'in', compositionId: 'mapped',
    };
    incoming.transitionIn = {
      id: 'transition-1', type: 'crossfade', duration: 1, linkedClipId: 'out', compositionId: 'mapped',
    };
    const parent: Composition = {
      id: 'parent', name: 'Parent', type: 'composition', parentId: null, createdAt: 1,
      width: 1920, height: 1080, frameRate: 30, duration: 4, backgroundColor: '#000000',
      timelineData: { tracks: [], clips: [outgoing, incoming], duration: 4 },
    };
    const active = hiddenTransitionComp('mapped');
    active.transitionComp = {
      ...active.transitionComp!,
      sourceLayout: 'mapped-v3',
      legacyBackupCompositionId: 'legacy-backup',
      parentCompositionId: parent.id,
      parentTransitionId: 'transition-1',
      parentOutgoingClipId: 'out',
      parentIncomingClipId: 'in',
    };
    const backup = hiddenTransitionComp('legacy-backup');
    backup.transitionComp = {
      ...backup.transitionComp!,
      sourceLayout: 'legacy-segmented',
      parentCompositionId: parent.id,
      parentTransitionId: 'transition-1',
      parentOutgoingClipId: 'out',
      parentIncomingClipId: 'in',
    };
    useMediaStore.setState({
      compositions: [parent, active, backup],
      activeCompositionId: parent.id,
      openCompositionIds: [parent.id],
    });

    normalizeLoadedTransitionCompositions();

    expect(useMediaStore.getState().compositions.map((composition) => composition.id)).toEqual([
      parent.id,
      active.id,
      backup.id,
    ]);
    expect(useMediaStore.getState().compositions.find((composition) => composition.id === active.id)
      ?.transitionComp?.legacyBackupCompositionId).toBe(backup.id);
  });

  it('hydrates transition comp clip render fields from project data', () => {
    const projectComposition: ProjectComposition = {
      id: 'transition-comp',
      name: 'Transition Comp',
      width: 1920,
      height: 1080,
      frameRate: 30,
      duration: 1,
      backgroundColor: '#000000',
      folderId: null,
      transitionComp: {
        ...hiddenTransitionComp('transition-comp').transitionComp!,
        sourceLayout: 'mapped-v3',
      },
      tracks: [{
        id: 'track-1',
        name: 'Video 1',
        type: 'video',
        height: 60,
        locked: false,
        visible: true,
        muted: false,
        solo: false,
      }],
      clips: [{
        id: 'clip-1',
        trackId: 'track-1',
        name: 'Panel',
        mediaId: 'media-1',
        startTime: 0,
        duration: 1,
        inPoint: 0,
        outPoint: 1,
        transform: {
          x: 0,
          y: 0,
          z: 0,
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          rotationX: 0,
          rotationY: 0,
          anchorX: 0.5,
          anchorY: 0.5,
          opacity: 1,
          blendMode: 'normal',
        },
        sourceRect: { x: 0.25, y: 0, width: 0.5, height: 1 },
        transitionRender: { kind: 'distortion', progress: 0.4, distortion: 'swirl', seed: 7 },
        effects: [],
        masks: [],
        keyframes: [],
        volume: 1,
        audioEnabled: true,
        reversed: false,
        disabled: false,
        sourceType: 'video',
        transitionSourceTimeOverride: 2.5,
        transitionSourceHold: true,
        transitionSourceMap: {
          version: 1,
          segments: [
            { kind: 'linear', compStart: 0, compEnd: 0.5, sourceStart: 2.5, sourceEnd: 3 },
            { kind: 'hold', compStart: 0.5, compEnd: 1, sourceTime: 3 },
          ],
        },
        transitionRecipeBlendWindows: [{ compStart: 0.25, compEnd: 0.75, blendMode: 'add' }],
      }],
      markers: [],
    };

    const [composition] = convertProjectCompositionToStore([projectComposition]);
    const [clip] = composition.timelineData!.clips;

    expect(clip.sourceRect).toEqual({ x: 0.25, y: 0, width: 0.5, height: 1 });
    expect(clip.transitionRender).toEqual({ kind: 'distortion', progress: 0.4, distortion: 'swirl', seed: 7 });
    expect(clip.transitionSourceTimeOverride).toBe(2.5);
    expect(clip.transitionSourceHold).toBe(true);
    expect(clip.transitionSourceMap).toEqual(projectComposition.clips[0].transitionSourceMap);
    expect(clip.transitionRecipeBlendWindows).toEqual(projectComposition.clips[0].transitionRecipeBlendWindows);
    expect(composition.transitionComp?.sourceLayout).toBe('mapped-v3');
  });
});
