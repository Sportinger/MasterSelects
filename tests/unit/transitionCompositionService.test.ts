import { describe, expect, it, vi } from 'vitest';

import {
  ensureTransitionCompositionForPair,
  upgradeLegacyTransitionCompositionForPair,
} from '../../src/services/timeline/transitionCompositionService';
import { resolveTransitionRecipeBlendMode } from '../../src/services/timeline/transitionRecipeBlendWindows';
import { isValidTransitionSourceMap, resolveTransitionSourceMapTime } from '../../src/services/timeline/transitionSourceMap';
import { compositionRenderer } from '../../src/services/compositionRenderer';
import type { Composition } from '../../src/stores/mediaStore';
import { getAllTransitions } from '../../src/transitions';
import type { SerializableClip, TimelineClip } from '../../src/types/timeline';
import { evaluateTransitionRenderState } from '../../src/utils/transitionRenderInterpolation';

vi.mock('../../src/services/compositionRenderer', () => ({
  compositionRenderer: { invalidateCompositionAndParents: vi.fn() },
}));

function serializableClip(id: string, startTime: number): SerializableClip {
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

function timelineClip(clip: SerializableClip): TimelineClip {
  return {
    ...clip,
    file: new File([], `${clip.id}.mp4`),
    source: {
      type: 'video',
      mediaFileId: clip.mediaFileId,
      naturalDuration: clip.naturalDuration,
    },
  } as TimelineClip;
}

function legacyUpgradeFixture(sourceLayout: 'legacy-segmented' | undefined = 'legacy-segmented') {
  const serializableClips = [serializableClip('out', 0), serializableClip('in', 2)];
  serializableClips[0].transitionOut = {
    id: 'transition-1', type: 'crossfade', duration: 1, linkedClipId: 'in', compositionId: 'legacy',
  };
  serializableClips[1].transitionIn = {
    id: 'transition-1', type: 'crossfade', duration: 1, linkedClipId: 'out', compositionId: 'legacy',
  };
  const timelineClips = serializableClips.map(timelineClip);
  timelineClips[0].transitionOut = { ...serializableClips[0].transitionOut! };
  timelineClips[1].transitionIn = { ...serializableClips[1].transitionIn! };
  const parent: Composition = {
    id: 'parent', name: 'Parent', type: 'composition', parentId: null, createdAt: 1,
    width: 1920, height: 1080, frameRate: 30, duration: 4, backgroundColor: '#000000',
    timelineData: { tracks: [], clips: structuredClone(serializableClips), duration: 4 },
  };
  const legacy: Composition = {
    id: 'legacy', name: 'Legacy Transition', type: 'composition', parentId: null, createdAt: 2,
    width: 1920, height: 1080, frameRate: 30, duration: 1, backgroundColor: '#000000',
    timelineData: { tracks: [], clips: [serializableClip('legacy-source', 0)], duration: 1 },
    transitionComp: {
      kind: 'transition-comp',
      ...(sourceLayout ? { sourceLayout } : {}),
      parentCompositionId: parent.id,
      parentTransitionId: 'transition-1',
      parentOutgoingClipId: 'out',
      parentIncomingClipId: 'in',
      linkedOutgoingClipId: 'legacy-out',
      linkedIncomingClipId: 'legacy-in',
      innerTransitionId: '',
      paddingBefore: 0,
      paddingAfter: 0,
      bodyStart: 0,
      bodyEnd: 1,
    },
  };
  return { parent, legacy, serializableClips, timelineClips };
}

function buildTransitionComposition(
  outgoing: SerializableClip,
  transitionType = 'crossfade',
  params?: Record<string, string | number | boolean>,
): Composition {
  const incoming = serializableClip('in', outgoing.startTime + outgoing.duration);
  const serializableClips = [outgoing, incoming];
  const timelineClips = serializableClips.map(timelineClip);
  timelineClips[0].transitionOut = {
    id: 'transition-1', type: transitionType, duration: 1, linkedClipId: 'in', params,
  };
  timelineClips[1].transitionIn = {
    id: 'transition-1', type: transitionType, duration: 1, linkedClipId: 'out', params,
  };
  const parent: Composition = {
    id: 'parent', name: 'Parent', type: 'composition', parentId: null, createdAt: 1,
    width: 1920, height: 1080, frameRate: 30, duration: 8, backgroundColor: '#000000',
    timelineData: { tracks: [], clips: serializableClips, duration: 8 },
  };
  const compositions: Composition[] = [parent];
  const id = ensureTransitionCompositionForPair({
    outgoingClipId: 'out',
    transitionId: 'transition-1',
    timelineClips,
    serializableClips,
    parentComposition: parent,
    compositions,
    createComposition: (_name, settings) => {
      const composition: Composition = {
        id: 'transition-comp-1', name: 'Transition', type: 'composition', parentId: null, createdAt: 2,
        width: 1920, height: 1080, frameRate: 30, duration: settings?.duration ?? 1,
        backgroundColor: '#000000', timelineData: settings?.timelineData,
        transitionComp: settings?.transitionComp,
      };
      compositions.push(composition);
      return composition;
    },
    updateComposition: (compositionId, updates) => {
      const index = compositions.findIndex((composition) => composition.id === compositionId);
      compositions[index] = { ...compositions[index], ...updates };
    },
    attachTransitionComposition: () => {},
  });
  const composition = compositions.find((candidate) => candidate.id === id);
  if (!composition) throw new Error('Expected mapped transition composition');
  return composition;
}

function buildTransitionSource(
  outgoing: SerializableClip,
  transitionType = 'crossfade',
  target: 'outgoing' | 'incoming' = 'outgoing',
  params?: Record<string, string | number | boolean>,
): SerializableClip {
  const source = buildTransitionComposition(outgoing, transitionType, params)
    .timelineData?.clips.find((clip) => clip.id === `transition-comp:transition-1:${target}`);
  if (!source) throw new Error(`Expected mapped ${target} source`);
  return source;
}

describe('transition composition service', () => {
  it('upgrades one exact legacy pair to a fresh mapped-v3 comp without changing the backup', () => {
    const { parent, legacy, serializableClips, timelineClips } = legacyUpgradeFixture();
    const beforeLegacy = structuredClone(legacy);
    const replaceCompositions = vi.fn();

    const id = upgradeLegacyTransitionCompositionForPair({
      outgoingClipId: 'out',
      transitionId: 'transition-1',
      timelineClips,
      serializableClips,
      parentComposition: parent,
      compositions: [parent, legacy],
      replaceCompositions,
    });

    expect(id).not.toBeNull();
    expect(id).not.toBe(legacy.id);
    expect(replaceCompositions).toHaveBeenCalledTimes(1);
    const next = replaceCompositions.mock.calls[0][0] as Composition[];
    const upgraded = next.find((composition) => composition.id === id)!;
    const nextParent = next.find((composition) => composition.id === parent.id)!;
    const sources = upgraded.timelineData!.clips.filter((clip) =>
      clip.id === 'transition-comp:transition-1:outgoing' ||
      clip.id === 'transition-comp:transition-1:incoming'
    );

    expect(upgraded.transitionComp).toMatchObject({
      sourceLayout: 'mapped-v3',
      legacyBackupCompositionId: legacy.id,
    });
    expect(sources).toHaveLength(2);
    expect(sources.every((clip) =>
      clip.startTime === 0 &&
      clip.duration === upgraded.timelineData!.duration &&
      clip.transitionSourceMap?.version === 2 &&
      isValidTransitionSourceMap(clip.transitionSourceMap)
    )).toBe(true);
    expect(next.find((composition) => composition.id === legacy.id)).toEqual(beforeLegacy);
    expect(nextParent.timelineData!.clips.find((clip) => clip.id === 'out')?.transitionOut?.compositionId).toBe(id);
    expect(nextParent.timelineData!.clips.find((clip) => clip.id === 'in')?.transitionIn?.compositionId).toBe(id);
  });

  it('leaves all state untouched when a legacy upgrade is ineligible or lacks durable source durations', () => {
    for (const sourceLayout of ['mapped-v3', 'legacy-segmented'] as const) {
      const { parent, legacy, serializableClips, timelineClips } = legacyUpgradeFixture();
      if (sourceLayout === 'mapped-v3') {
        legacy.transitionComp!.sourceLayout = sourceLayout;
      } else {
        serializableClips[0] = { ...serializableClips[0], naturalDuration: undefined };
      }
      const compositions = [parent, legacy];
      const before = structuredClone(compositions);
      const replaceCompositions = vi.fn();

      expect(upgradeLegacyTransitionCompositionForPair({
        outgoingClipId: 'out',
        transitionId: 'transition-1',
        timelineClips,
        serializableClips,
        parentComposition: parent,
        compositions,
        replaceCompositions,
      })).toBeNull();
      expect(replaceCompositions).not.toHaveBeenCalled();
      expect(compositions).toEqual(before);
    }
  });

  it('keeps a migrated backup pointer on subsequent mapped-v3 maintenance', () => {
    const { parent, legacy, serializableClips, timelineClips } = legacyUpgradeFixture();
    let compositions = [parent, legacy];
    const id = upgradeLegacyTransitionCompositionForPair({
      outgoingClipId: 'out',
      transitionId: 'transition-1',
      timelineClips,
      serializableClips,
      parentComposition: parent,
      compositions,
      replaceCompositions: (next) => { compositions = next; },
    });
    const upgradedParent = compositions.find((composition) => composition.id === parent.id)!;
    const upgraded = compositions.find((composition) => composition.id === id)!;
    const maintainedTimelineClips = timelineClips.map((clip) => ({
      ...clip,
      transitionOut: clip.transitionOut ? { ...clip.transitionOut, compositionId: id! } : undefined,
      transitionIn: clip.transitionIn ? { ...clip.transitionIn, compositionId: id! } : undefined,
    }));
    const updateComposition = vi.fn((compositionId: string, updates: Partial<Composition>) => {
      compositions = compositions.map((composition) =>
        composition.id === compositionId ? { ...composition, ...updates } : composition
      );
    });

    expect(ensureTransitionCompositionForPair({
      outgoingClipId: 'out',
      transitionId: 'transition-1',
      timelineClips: maintainedTimelineClips,
      serializableClips: upgradedParent.timelineData!.clips,
      parentComposition: upgradedParent,
      compositions,
      createComposition: vi.fn(),
      updateComposition,
      attachTransitionComposition: vi.fn(),
    })).toBe(id);
    expect(updateComposition).toHaveBeenCalledWith(id, expect.objectContaining({
      transitionComp: expect.objectContaining({ legacyBackupCompositionId: legacy.id }),
    }));
    expect(upgraded.transitionComp?.legacyBackupCompositionId).toBe(legacy.id);
  });

  it('resolves mapped-v3 v2 parent playback canonically at non-anchor times', () => {
    const sourceTimeAt = (clip: SerializableClip, time: number) =>
      resolveTransitionSourceMapTime(clip.transitionSourceMap, time)!;

    const forward = buildTransitionSource(serializableClip('out', 0));
    expect(sourceTimeAt(forward, 0).sourceTime).toBeCloseTo(1.5);
    expect(sourceTimeAt(forward, 0.25)).toMatchObject({ sourceTime: 1.75, sourceRate: 1, animationTime: 1.75 });
    expect(sourceTimeAt(forward, 0.5)).toMatchObject({ sourceTime: 2, sourceRate: 0, isHold: true });
    expect(sourceTimeAt(forward, 1).sourceTime).toBe(2);

    const reversed = buildTransitionSource({ ...serializableClip('out', 0), reversed: true });
    expect(sourceTimeAt(reversed, 0).sourceTime).toBeCloseTo(0.5);
    expect(sourceTimeAt(reversed, 0.25)).toMatchObject({ sourceTime: 0.25, sourceRate: -1, animationTime: 1.75 });
    expect(sourceTimeAt(reversed, 0.5)).toMatchObject({ sourceTime: 0, sourceRate: 0, isHold: true });
    expect(sourceTimeAt(reversed, 1).sourceTime).toBe(0);

    const fast = buildTransitionSource({
      ...serializableClip('out', 0), outPoint: 4, naturalDuration: 6, speed: 2,
    });
    expect(sourceTimeAt(fast, 0).sourceTime).toBeCloseTo(3);
    expect(sourceTimeAt(fast, 0.25)).toMatchObject({ sourceTime: 3.5, sourceRate: 2, animationTime: 1.75 });
    expect(sourceTimeAt(fast, 1).sourceTime).toBeCloseTo(5);

    const slow = buildTransitionSource({
      ...serializableClip('out', 0), outPoint: 1, naturalDuration: 3, speed: 0.5,
    });
    expect(sourceTimeAt(slow, 0).sourceTime).toBeCloseTo(0.75);
    expect(sourceTimeAt(slow, 0.25)).toMatchObject({ sourceTime: 0.875, sourceRate: 0.5, animationTime: 1.75 });
    expect(sourceTimeAt(slow, 1).sourceTime).toBeCloseTo(1.25);

    const negativeSpeed = buildTransitionSource({
      ...serializableClip('out', 0), outPoint: 4, naturalDuration: 6, speed: -2, reversed: true,
    });
    expect(sourceTimeAt(negativeSpeed, 0).sourceTime).toBeCloseTo(1);
    expect(sourceTimeAt(negativeSpeed, 0.49).sourceRate).toBeCloseTo(-2);
    expect(sourceTimeAt(negativeSpeed, 0.5).sourceTime).toBe(0);
    expect(sourceTimeAt(negativeSpeed, 1).sourceTime).toBe(0);

    const speedKeyframes = [
      { id: 'speed-0', clipId: 'out', property: 'speed' as const, time: 0, value: 1, easing: 'linear' as const },
      { id: 'speed-1', clipId: 'out', property: 'speed' as const, time: 1, value: 3, easing: 'linear' as const },
      { id: 'speed-2', clipId: 'out', property: 'speed' as const, time: 2, value: 1, easing: 'linear' as const },
    ];
    const curved = buildTransitionSource({
      ...serializableClip('out', 0), outPoint: 4, naturalDuration: 6, keyframes: speedKeyframes,
    });
    expect(sourceTimeAt(curved, 0).sourceTime).toBeCloseTo(3.25);
    const curvedSample = sourceTimeAt(curved, 0.25);
    expect(curvedSample.sourceTime).toBeCloseTo(3.6875);
    expect(curvedSample).toMatchObject({ sourceRate: 1.5, animationTime: 1.75 });
    expect(sourceTimeAt(curved, 1).sourceTime).toBeCloseTo(4.5);
  });

  it('keeps parent animation snapshots untouched and generated keyframes local', () => {
    const outgoing = serializableClip('out', 0);
    outgoing.speed = 0.5;
    outgoing.transform = {
      opacity: 0.8,
      blendMode: 'screen',
      position: { x: 12, y: -8, z: 4 },
      scale: { all: 1.2, x: 1.1, y: 0.9, z: 1 },
      rotation: { x: 5, y: -10, z: 25 },
    };
    outgoing.effects = [{ id: 'fx-1', name: 'Brightness', type: 'brightness', enabled: true, params: { amount: 10 } }];
    outgoing.masks = [{
      id: 'mask-1', name: 'Mask', vertices: [], closed: true, opacity: 1, feather: 0,
      featherQuality: 1, inverted: false, mode: 'add', expanded: false,
      position: { x: 0, y: 0 }, enabled: true, visible: true,
    }];
    outgoing.keyframes = [
      {
        id: 'position-bezier', clipId: 'out', property: 'position.x', time: 1.25, value: 50,
        easing: 'bezier', handleIn: { x: -0.2, y: 0.4 }, handleOut: { x: 0.3, y: -0.5 },
      },
      {
        id: 'rotation', clipId: 'out', property: 'rotation.z', time: 1.5, value: 90,
        easing: 'ease-in-out', rotationInterpolation: 'continuous',
      },
      { id: 'effect', clipId: 'out', property: 'effect.fx-1.amount', time: 1.75, value: 40, easing: 'linear' },
      { id: 'mask', clipId: 'out', property: 'mask.mask-1.feather', time: 1.8, value: 30, easing: 'linear' },
      {
        id: 'path', clipId: 'out', property: 'mask.mask-1.path' as const, time: 1.9, value: 0,
        easing: 'bezier', pathValue: {
          closed: true,
          vertices: [{ id: 'vertex-1', x: 0.2, y: 0.4, handleIn: { x: -0.1, y: 0 }, handleOut: { x: 0.1, y: 0 } }],
        },
      },
      { id: 'opacity', clipId: 'out', property: 'opacity', time: 1.95, value: 0.4, easing: 'ease-out' },
    ];
    const parentKeyframes = structuredClone(outgoing.keyframes);

    const source = buildTransitionSource(outgoing, 'light-leak');
    if (source.transitionSourceMap?.version !== 2) throw new Error('Expected a v2 source map');

    expect(source.transitionSourceMap.parent).toEqual({
      duration: outgoing.duration,
      inPoint: outgoing.inPoint,
      outPoint: outgoing.outPoint,
      defaultSpeed: outgoing.speed,
      animation: {
        baseTransform: outgoing.transform,
        keyframes: parentKeyframes.map((keyframe) => ({
          ...keyframe,
          id: `${source.id}:${keyframe.id}`,
          clipId: source.id,
        })),
        sourceEffectIds: ['fx-1'],
        sourceMaskIds: ['mask-1'],
      },
    });
    expect(source.transform).toEqual(outgoing.transform);
    expect(source.effects).toEqual(outgoing.effects);
    expect(source.masks).toEqual(outgoing.masks);
    expect(source.speed).toBe(1);
    expect(source.reversed).toBe(false);
    expect(source.keyframes?.some((keyframe) => keyframe.property === 'opacity')).toBe(true);
    expect(source.keyframes?.some((keyframe) =>
      parentKeyframes.some((parentKeyframe) => keyframe.id === parentKeyframe.id)
    )).toBe(false);
    expect(source.keyframes?.some((keyframe) =>
      keyframe.property === 'position.x' || keyframe.property === 'effect.fx-1.amount' || keyframe.property === 'mask.mask-1.path'
    )).toBe(false);
  });

  it('does not create or update mapped comps without confirmed media duration', () => {
    const serializableClips = [
      { ...serializableClip('unresolved-out', 0), naturalDuration: undefined },
      { ...serializableClip('unresolved-in', 2), naturalDuration: undefined },
    ];
    const timelineClips = serializableClips.map(timelineClip);
    timelineClips[0].transitionOut = {
      id: 'transition-1', type: 'crossfade', duration: 1, linkedClipId: 'unresolved-in',
    };
    timelineClips[1].transitionIn = {
      id: 'transition-1', type: 'crossfade', duration: 1, linkedClipId: 'unresolved-out',
    };
    const parent: Composition = {
      id: 'parent', name: 'Parent', type: 'composition', parentId: null, createdAt: 1,
      width: 1920, height: 1080, frameRate: 30, duration: 4, backgroundColor: '#000000',
      timelineData: { tracks: [], clips: serializableClips, duration: 4 },
    };
    const createComposition = vi.fn((_name: string): Composition => {
      throw new Error('must not create');
    });
    const updateComposition = vi.fn();
    const attachTransitionComposition = vi.fn();

    expect(ensureTransitionCompositionForPair({
      outgoingClipId: 'unresolved-out',
      transitionId: 'transition-1',
      timelineClips,
      serializableClips,
      parentComposition: parent,
      compositions: [parent],
      createComposition,
      updateComposition,
      attachTransitionComposition,
    })).toBeNull();
    expect(createComposition).not.toHaveBeenCalled();
    expect(updateComposition).not.toHaveBeenCalled();
    expect(attachTransitionComposition).not.toHaveBeenCalled();
  });

  it('does not attach existing legacy comps without confirmed media duration', () => {
    const serializableClips = [
      { ...serializableClip('out', 0), naturalDuration: undefined },
      serializableClip('in', 2),
    ];
    const timelineClips = serializableClips.map(timelineClip);
    timelineClips[0].transitionOut = {
      id: 'transition-1', type: 'crossfade', duration: 1, linkedClipId: 'in', compositionId: 'existing',
    };
    timelineClips[1].transitionIn = {
      id: 'transition-1', type: 'crossfade', duration: 1, linkedClipId: 'out', compositionId: 'existing',
    };
    const parent: Composition = {
      id: 'parent', name: 'Parent', type: 'composition', parentId: null, createdAt: 1,
      width: 1920, height: 1080, frameRate: 30, duration: 4, backgroundColor: '#000000',
      timelineData: { tracks: [], clips: serializableClips, duration: 4 },
    };
    const existing: Composition = {
      ...parent,
      id: 'existing',
      transitionComp: {
        kind: 'transition-comp',
        sourceLayout: 'legacy-segmented',
        parentCompositionId: 'parent',
        parentTransitionId: 'transition-1',
        parentOutgoingClipId: 'out',
        parentIncomingClipId: 'in',
        linkedOutgoingClipId: 'legacy-out',
        linkedIncomingClipId: 'legacy-in',
        innerTransitionId: '',
        paddingBefore: 0,
        paddingAfter: 0,
        bodyStart: 0,
        bodyEnd: 1,
      },
    };
    const createComposition = vi.fn((_name: string): Composition => {
      throw new Error('must not create');
    });
    const updateComposition = vi.fn();
    const attachTransitionComposition = vi.fn();
    const invalidate = vi.mocked(compositionRenderer.invalidateCompositionAndParents);
    const invalidationCount = invalidate.mock.calls.length;

    expect(ensureTransitionCompositionForPair({
      outgoingClipId: 'out',
      transitionId: 'transition-1',
      timelineClips,
      serializableClips,
      parentComposition: parent,
      compositions: [parent, existing],
      createComposition,
      updateComposition,
      attachTransitionComposition,
    })).toBeNull();
    expect(createComposition).not.toHaveBeenCalled();
    expect(updateComposition).not.toHaveBeenCalled();
    expect(attachTransitionComposition).not.toHaveBeenCalled();
    expect(invalidate.mock.calls).toHaveLength(invalidationCount);
    expect(timelineClips[0].transitionOut?.compositionId).toBe('existing');
    expect(timelineClips[1].transitionIn?.compositionId).toBe('existing');
  });

  it('keeps existing mapped-v3 v1 comps unchanged', () => {
    const serializableClips = [serializableClip('out', 0), serializableClip('in', 2)];
    const timelineClips = serializableClips.map(timelineClip);
    timelineClips[0].transitionOut = {
      id: 'transition-1', type: 'crossfade', duration: 1, linkedClipId: 'in', compositionId: 'existing',
    };
    timelineClips[1].transitionIn = {
      id: 'transition-1', type: 'crossfade', duration: 1, linkedClipId: 'out', compositionId: 'existing',
    };
    const parent: Composition = {
      id: 'parent', name: 'Parent', type: 'composition', parentId: null, createdAt: 1,
      width: 1920, height: 1080, frameRate: 30, duration: 4, backgroundColor: '#000000',
      timelineData: { tracks: [], clips: serializableClips, duration: 4 },
    };
    const existing: Composition = {
      ...parent,
      id: 'existing',
      timelineData: {
        tracks: [],
        clips: [{
          ...serializableClip('transition-comp:transition-1:outgoing', 0),
          duration: 1,
          outPoint: 1,
          transitionSourceMap: {
            version: 1,
            segments: [{ kind: 'linear', compStart: 0, compEnd: 1, sourceStart: 1, sourceEnd: 2 }],
          },
        }],
        duration: 1,
      },
      transitionComp: {
        kind: 'transition-comp',
        sourceLayout: 'mapped-v3',
        parentCompositionId: 'parent',
        parentTransitionId: 'transition-1',
        parentOutgoingClipId: 'out',
        parentIncomingClipId: 'in',
        linkedOutgoingClipId: 'transition-comp:transition-1:outgoing',
        linkedIncomingClipId: 'transition-comp:transition-1:incoming',
        innerTransitionId: '',
        templateType: 'crossfade',
        templateVersion: 2,
        paddingBefore: 0,
        paddingAfter: 0,
        bodyStart: 0,
        bodyEnd: 1,
      },
    };
    const before = structuredClone(existing);
    const createComposition = vi.fn((_name: string): Composition => {
      throw new Error('must not create');
    });
    const updateComposition = vi.fn();

    expect(ensureTransitionCompositionForPair({
      outgoingClipId: 'out',
      transitionId: 'transition-1',
      timelineClips,
      serializableClips,
      parentComposition: parent,
      compositions: [parent, existing],
      createComposition,
      updateComposition,
      attachTransitionComposition: vi.fn(),
    })).toBe('existing');
    expect(existing).toEqual(before);
    expect(createComposition).not.toHaveBeenCalled();
    expect(updateComposition).not.toHaveBeenCalled();
  });

  it('creates one exact-duration hidden comp and reuses it on the next ensure', () => {
    const serializableClips = [serializableClip('out', 0), serializableClip('in', 2)];
    const timelineClips = serializableClips.map(timelineClip);
    timelineClips[0].transitionOut = {
      id: 'transition-1',
      type: 'crossfade',
      duration: 1,
      linkedClipId: 'in',
    };
    timelineClips[1].transitionIn = {
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
      duration: 5,
      backgroundColor: '#000000',
      timelineData: { tracks: [], clips: serializableClips, duration: 5 },
    };
    const compositions: Composition[] = [parent];
    const attachments: string[] = [];

    const createComposition = vi.fn((name: string, settings?: Partial<Composition>): Composition => {
      const comp = {
        id: 'transition-comp-1',
        name,
        type: 'composition' as const,
        parentId: null,
        createdAt: 2,
        width: 1920,
        height: 1080,
        frameRate: 30,
        duration: settings?.duration ?? 1,
        backgroundColor: '#000000',
        timelineData: settings?.timelineData,
        transitionComp: settings?.transitionComp,
      };
      compositions.push(comp);
      return comp;
    });
    const updateComposition = vi.fn((id: string, updates: Partial<Composition>) => {
      const index = compositions.findIndex((composition) => composition.id === id);
      compositions[index] = { ...compositions[index], ...updates };
    });

    const firstId = ensureTransitionCompositionForPair({
      outgoingClipId: 'out',
      transitionId: 'transition-1',
      timelineClips,
      serializableClips,
      parentComposition: parent,
      compositions,
      createComposition,
      updateComposition,
      attachTransitionComposition: ({ compositionId }) => {
        attachments.push(compositionId);
        timelineClips[0].transitionOut = { ...timelineClips[0].transitionOut!, compositionId };
        timelineClips[1].transitionIn = { ...timelineClips[1].transitionIn!, compositionId };
      },
    });

    const comp = compositions.find((composition) => composition.id === firstId)!;
    expect(firstId).toBe('transition-comp-1');
    expect(comp.transitionComp?.kind).toBe('transition-comp');
    expect(comp.transitionComp?.sourceLayout).toBe('mapped-v3');
    expect(comp.transitionComp?.bodyStart).toBe(0);
    expect(comp.transitionComp?.bodyEnd).toBe(1);
    expect(comp.transitionComp?.paddingBefore).toBe(0);
    expect(comp.transitionComp?.paddingAfter).toBe(0);
    expect(comp.transitionComp?.templateType).toBe('crossfade');
    expect(comp.transitionComp?.templateVersion).toBe(4);
    expect(comp.timelineData?.duration).toBe(1);
    const outgoingSources = comp.timelineData!.clips.filter((clip) =>
      clip.id.startsWith('transition-comp:transition-1:outgoing')
    );
    const incomingSources = comp.timelineData!.clips.filter((clip) =>
      clip.id.startsWith('transition-comp:transition-1:incoming')
    );
    expect(outgoingSources).toHaveLength(1);
    expect(incomingSources).toHaveLength(1);
    const [outgoingSource] = outgoingSources;
    const [incomingSource] = incomingSources;
    expect([outgoingSource, incomingSource].every((clip) =>
      clip.startTime === 0 && clip.duration === 1 && !/:seg:|:part:/.test(clip.id)
    )).toBe(true);
    expect(isValidTransitionSourceMap(outgoingSource.transitionSourceMap)).toBe(true);
    expect(isValidTransitionSourceMap(incomingSource.transitionSourceMap)).toBe(true);
    expect(outgoingSource.transitionSourceMap).toMatchObject({
      version: 2,
      mediaDuration: 2,
      parent: { duration: 2, inPoint: 0, outPoint: 2, defaultSpeed: 1 },
      segments: [{ kind: 'parent-linear', compStart: 0, compEnd: 1, parentStart: 1.5, parentEnd: 2.5 }],
    });
    expect(incomingSource.transitionSourceMap).toMatchObject({
      version: 2,
      mediaDuration: 2,
      parent: { duration: 2, inPoint: 0, outPoint: 2, defaultSpeed: 1 },
      segments: [{ kind: 'parent-linear', compStart: 0, compEnd: 1, parentStart: -0.5, parentEnd: 0.5 }],
    });
    expect(resolveTransitionSourceMapTime(outgoingSource.transitionSourceMap, 0.5)?.sourceTime).toBe(2);
    expect(resolveTransitionSourceMapTime(incomingSource.transitionSourceMap, 0)).toMatchObject({
      sourceTime: 0,
      sourceRate: 0,
      isHold: true,
      animationTime: -0.5,
    });
    expect(resolveTransitionSourceMapTime(incomingSource.transitionSourceMap, 0.5)?.sourceTime).toBe(0);

    const secondId = ensureTransitionCompositionForPair({
      outgoingClipId: 'out',
      transitionId: 'transition-1',
      timelineClips,
      serializableClips,
      parentComposition: parent,
      compositions,
      createComposition,
      updateComposition,
      attachTransitionComposition: ({ compositionId }) => attachments.push(compositionId),
    });

    expect(secondId).toBe(firstId);
    expect(createComposition).toHaveBeenCalledTimes(1);
    expect(attachments).toEqual(['transition-comp-1', 'transition-comp-1']);

    timelineClips[0].transitionOut = { ...timelineClips[0].transitionOut!, duration: 1.5 };
    timelineClips[1].transitionIn = { ...timelineClips[1].transitionIn!, duration: 1.5 };

    ensureTransitionCompositionForPair({
      outgoingClipId: 'out',
      transitionId: 'transition-1',
      timelineClips,
      serializableClips,
      parentComposition: parent,
      compositions,
      createComposition,
      updateComposition,
      attachTransitionComposition: ({ compositionId }) => attachments.push(compositionId),
    });

    expect(createComposition).toHaveBeenCalledTimes(1);
    expect(compositions.find((composition) => composition.id === firstId)?.timelineData?.duration).toBe(1.5);

    serializableClips[0] = { ...serializableClips[0], naturalDuration: 3 };
    serializableClips[1] = {
      ...serializableClips[1],
      naturalDuration: 3,
      inPoint: 0.75,
      outPoint: 2.75,
      keyframes: [{
        id: 'incoming-position',
        clipId: 'in',
        property: 'position.x',
        time: 0,
        value: 120,
        easing: 'linear',
      }],
    };
    timelineClips[0] = {
      ...timelineClips[0],
      source: { ...timelineClips[0].source!, naturalDuration: 3 },
      transitionOut: timelineClips[0].transitionOut,
    };
    timelineClips[1] = {
      ...timelineClips[1],
      inPoint: 0.75,
      outPoint: 2.75,
      source: { ...timelineClips[1].source!, naturalDuration: 3 },
      transitionIn: timelineClips[1].transitionIn,
    };
    ensureTransitionCompositionForPair({
      outgoingClipId: 'out',
      transitionId: 'transition-1',
      timelineClips,
      serializableClips,
      parentComposition: parent,
      compositions,
      createComposition,
      updateComposition,
      attachTransitionComposition: ({ compositionId }) => attachments.push(compositionId),
    });
    const refreshedSources = compositions.find((composition) => composition.id === firstId)!.timelineData!.clips
      .filter((clip) => clip.id === 'transition-comp:transition-1:outgoing' || clip.id === 'transition-comp:transition-1:incoming');
    expect(refreshedSources.every((clip) =>
      clip.duration === 1.5 && clip.transitionSourceMap?.version === 2 &&
      clip.transitionSourceMap.segments.every((segment) => segment.kind === 'parent-linear')
    )).toBe(true);
    const refreshedIncoming = refreshedSources.find((clip) => clip.id.endsWith(':incoming'));
    expect(refreshedIncoming?.keyframes?.some((keyframe) => keyframe.property === 'position.x')).toBe(false);
    expect(refreshedIncoming?.transitionSourceMap).toMatchObject({
      version: 2,
      parent: { animation: { keyframes: [{ property: 'position.x', time: 0 }] } },
    });
  });

  it('refreshes linked source windows without replacing manual comp edits', () => {
    const serializableClips = [serializableClip('out', 0), serializableClip('in', 2)];
    const timelineClips = serializableClips.map(timelineClip);
    timelineClips[0].transitionOut = {
      id: 'transition-1',
      type: 'crossfade',
      duration: 1,
      linkedClipId: 'in',
    };
    timelineClips[1].transitionIn = {
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
      duration: 5,
      backgroundColor: '#000000',
      timelineData: { tracks: [], clips: serializableClips, duration: 5 },
    };
    const compositions: Composition[] = [parent];
    const createComposition = vi.fn((name: string, settings?: Partial<Composition>): Composition => {
      const comp = {
        id: 'transition-comp-1',
        name,
        type: 'composition' as const,
        parentId: null,
        createdAt: 2,
        width: 1920,
        height: 1080,
        frameRate: 30,
        duration: settings?.duration ?? 1,
        backgroundColor: '#000000',
        timelineData: settings?.timelineData,
        transitionComp: settings?.transitionComp,
      };
      compositions.push(comp);
      return comp;
    });
    const updateComposition = vi.fn((id: string, updates: Partial<Composition>) => {
      const index = compositions.findIndex((composition) => composition.id === id);
      compositions[index] = { ...compositions[index], ...updates };
    });
    const attachTransitionComposition = ({ compositionId }: { compositionId: string }) => {
      timelineClips[0].transitionOut = { ...timelineClips[0].transitionOut!, compositionId };
      timelineClips[1].transitionIn = { ...timelineClips[1].transitionIn!, compositionId };
    };

    const firstId = ensureTransitionCompositionForPair({
      outgoingClipId: 'out',
      transitionId: 'transition-1',
      timelineClips,
      serializableClips,
      parentComposition: parent,
      compositions,
      createComposition,
      updateComposition,
      attachTransitionComposition,
    });
    const transitionComp = compositions.find((composition) => composition.id === firstId)!;
    transitionComp.timelineData = {
      ...transitionComp.timelineData!,
      clips: [
        ...transitionComp.timelineData!.clips,
        {
          id: 'manual-edit',
          trackId: 'manual-track',
          name: 'Manual Edit',
          mediaFileId: '',
          startTime: 0.25,
          duration: 0.5,
          inPoint: 0,
          outPoint: 0.5,
          sourceType: 'solid',
          solidColor: '#ff0000',
          transform: {
            opacity: 1,
            blendMode: 'normal',
            position: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
            rotation: { x: 0, y: 0, z: 0 },
          },
          effects: [],
        },
      ],
    };

    serializableClips[0] = { ...serializableClips[0], naturalDuration: 3, inPoint: 0.4, outPoint: 2.4 };
    timelineClips[0] = {
      ...timelineClips[0],
      inPoint: 0.4,
      outPoint: 2.4,
      source: { ...timelineClips[0].source!, naturalDuration: 3 },
      transitionOut: timelineClips[0].transitionOut,
    };

    ensureTransitionCompositionForPair({
      outgoingClipId: 'out',
      transitionId: 'transition-1',
      timelineClips,
      serializableClips,
      parentComposition: parent,
      compositions,
      createComposition,
      updateComposition,
      attachTransitionComposition,
    });

    const updatedComp = compositions.find((composition) => composition.id === firstId)!;
    expect(createComposition).toHaveBeenCalledTimes(1);
    expect(updatedComp.timelineData?.clips.some((clip) => clip.id === 'manual-edit')).toBe(true);
    expect(updatedComp.timelineData?.clips.find((clip) => clip.id === 'transition-comp:transition-1:outgoing')?.inPoint).toBeCloseTo(0.4);
  });

  it('reuses the attached comp after split remaps the parent clip id', () => {
    const serializableClips = [serializableClip('out', 0), serializableClip('in', 2)];
    const timelineClips = serializableClips.map(timelineClip);
    timelineClips[0].transitionOut = {
      id: 'transition-1',
      type: 'crossfade',
      duration: 1,
      linkedClipId: 'in',
    };
    timelineClips[1].transitionIn = {
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
      duration: 5,
      backgroundColor: '#000000',
      timelineData: { tracks: [], clips: serializableClips, duration: 5 },
    };
    const compositions: Composition[] = [parent];
    const createComposition = vi.fn((name: string, settings?: Partial<Composition>): Composition => {
      const comp = {
        id: 'transition-comp-1',
        name,
        type: 'composition' as const,
        parentId: null,
        createdAt: 2,
        width: 1920,
        height: 1080,
        frameRate: 30,
        duration: settings?.duration ?? 1,
        backgroundColor: '#000000',
        timelineData: settings?.timelineData,
        transitionComp: settings?.transitionComp,
      };
      compositions.push(comp);
      return comp;
    });
    const updateComposition = vi.fn((id: string, updates: Partial<Composition>) => {
      const index = compositions.findIndex((composition) => composition.id === id);
      compositions[index] = { ...compositions[index], ...updates };
    });
    const attachTransitionComposition = ({ compositionId }: { compositionId: string }) => {
      timelineClips[0].transitionOut = { ...timelineClips[0].transitionOut!, compositionId };
      timelineClips[1].transitionIn = { ...timelineClips[1].transitionIn!, compositionId };
    };

    const firstId = ensureTransitionCompositionForPair({
      outgoingClipId: 'out',
      transitionId: 'transition-1',
      timelineClips,
      serializableClips,
      parentComposition: parent,
      compositions,
      createComposition,
      updateComposition,
      attachTransitionComposition,
    });
    const transitionComp = compositions.find((composition) => composition.id === firstId)!;
    transitionComp.timelineData = {
      ...transitionComp.timelineData!,
      clips: [
        ...transitionComp.timelineData!.clips,
        {
          id: 'manual-edit',
          trackId: 'manual-track',
          name: 'Manual Edit',
          mediaFileId: '',
          startTime: 0.25,
          duration: 0.5,
          inPoint: 0,
          outPoint: 0.5,
          sourceType: 'solid',
          solidColor: '#00ff00',
          transform: {
            opacity: 1,
            blendMode: 'normal',
            position: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
            rotation: { x: 0, y: 0, z: 0 },
          },
          effects: [],
        },
      ],
    };

    const splitOut = { ...serializableClip('out-right', 0.5), duration: 1.5, inPoint: 0.5, outPoint: 2 };
    const splitIn = serializableClip('in', 2);
    const splitTimelineClips = [timelineClip(splitOut), timelineClip(splitIn)];
    splitTimelineClips[0].transitionOut = {
      ...timelineClips[0].transitionOut!,
      linkedClipId: 'in',
    };
    splitTimelineClips[1].transitionIn = {
      ...timelineClips[1].transitionIn!,
      linkedClipId: 'out-right',
    };

    const secondId = ensureTransitionCompositionForPair({
      outgoingClipId: 'out-right',
      transitionId: 'transition-1',
      timelineClips: splitTimelineClips,
      serializableClips: [splitOut, splitIn],
      parentComposition: parent,
      compositions,
      createComposition,
      updateComposition,
      attachTransitionComposition: vi.fn(),
    });

    const updatedComp = compositions.find((composition) => composition.id === firstId)!;
    expect(secondId).toBe(firstId);
    expect(createComposition).toHaveBeenCalledTimes(1);
    expect(updatedComp.transitionComp?.parentOutgoingClipId).toBe('out-right');
    expect(updatedComp.timelineData?.clips.some((clip) => clip.id === 'manual-edit')).toBe(true);
  });

  it('does not reuse an attached composition id from another parent pair', () => {
    const serializableClips = [serializableClip('out', 0), serializableClip('in', 2)];
    const timelineClips = serializableClips.map(timelineClip);
    timelineClips[0].transitionOut = {
      id: 'transition-1',
      type: 'crossfade',
      duration: 1,
      linkedClipId: 'in',
      compositionId: 'foreign-transition-comp',
    };
    timelineClips[1].transitionIn = {
      id: 'transition-1',
      type: 'crossfade',
      duration: 1,
      linkedClipId: 'out',
      compositionId: 'foreign-transition-comp',
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
      duration: 5,
      backgroundColor: '#000000',
      timelineData: { tracks: [], clips: serializableClips, duration: 5 },
    };
    const compositions: Composition[] = [
      parent,
      {
        id: 'foreign-transition-comp',
        name: 'Foreign Transition',
        type: 'composition',
        parentId: null,
        createdAt: 2,
        width: 1920,
        height: 1080,
        frameRate: 30,
        duration: 1,
        backgroundColor: '#000000',
        transitionComp: {
          kind: 'transition-comp',
          parentCompositionId: 'other-parent',
          parentTransitionId: 'transition-1',
          parentOutgoingClipId: 'out',
          parentIncomingClipId: 'in',
          linkedOutgoingClipId: 'foreign-out',
          linkedIncomingClipId: 'foreign-in',
          innerTransitionId: '',
          paddingBefore: 0,
          paddingAfter: 0,
          bodyStart: 0,
          bodyEnd: 1,
        },
        timelineData: { tracks: [], clips: [], duration: 1 },
      },
    ];
    const createComposition = vi.fn((name: string, settings?: Partial<Composition>): Composition => {
      const comp = {
        id: 'new-transition-comp',
        name,
        type: 'composition' as const,
        parentId: null,
        createdAt: 3,
        width: 1920,
        height: 1080,
        frameRate: 30,
        duration: settings?.duration ?? 1,
        backgroundColor: '#000000',
        timelineData: settings?.timelineData,
        transitionComp: settings?.transitionComp,
      };
      compositions.push(comp);
      return comp;
    });

    const id = ensureTransitionCompositionForPair({
      outgoingClipId: 'out',
      transitionId: 'transition-1',
      timelineClips,
      serializableClips,
      parentComposition: parent,
      compositions,
      createComposition,
      updateComposition: vi.fn(),
      attachTransitionComposition: vi.fn(),
    });

    expect(id).toBe('new-transition-comp');
    expect(createComposition).toHaveBeenCalledTimes(1);
  });

  it('materializes multi-panel transitions as source-rect clips on separate tracks', () => {
    const serializableClips = [serializableClip('out', 0), serializableClip('in', 2)];
    const timelineClips = serializableClips.map(timelineClip);
    timelineClips[0].transitionOut = {
      id: 'transition-1',
      type: 'puzzle-push',
      duration: 1,
      linkedClipId: 'in',
    };
    timelineClips[1].transitionIn = {
      id: 'transition-1',
      type: 'puzzle-push',
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
      duration: 5,
      backgroundColor: '#000000',
      timelineData: { tracks: [], clips: serializableClips, duration: 5 },
    };
    const compositions: Composition[] = [parent];
    const createComposition = vi.fn((name: string, settings?: Partial<Composition>): Composition => {
      const comp = {
        id: 'transition-comp-1',
        name,
        type: 'composition' as const,
        parentId: null,
        createdAt: 2,
        width: 1920,
        height: 1080,
        frameRate: 30,
        duration: settings?.duration ?? 1,
        backgroundColor: '#000000',
        timelineData: settings?.timelineData,
        transitionComp: settings?.transitionComp,
      };
      compositions.push(comp);
      return comp;
    });

    const id = ensureTransitionCompositionForPair({
      outgoingClipId: 'out',
      transitionId: 'transition-1',
      timelineClips,
      serializableClips,
      parentComposition: parent,
      compositions,
      createComposition,
      updateComposition: vi.fn(),
      attachTransitionComposition: vi.fn(),
    });

    const comp = compositions.find((composition) => composition.id === id)!;
    const panelClips = comp.timelineData!.clips.filter((clip) => clip.sourceRect);
    const panelTrackIds = new Set(panelClips.map((clip) => clip.trackId));

    expect(panelClips.length).toBeGreaterThanOrEqual(16);
    expect(panelTrackIds.size).toBe(16);
    expect(panelClips.every((clip) =>
      clip.startTime === 0 && clip.duration === 1 &&
      isValidTransitionSourceMap(clip.transitionSourceMap) &&
      !/:seg:|:part:/.test(clip.id)
    )).toBe(true);
    const panelMaps = panelClips.map((clip) => clip.transitionSourceMap);
    expect(panelMaps.every((map) => map?.version === 2)).toBe(true);
    expect(new Set(panelMaps).size).toBe(panelClips.length);
    expect(new Set(panelMaps.map((map) => map?.version === 2 ? map.parent.animation : undefined)).size).toBe(panelClips.length);
    expect(panelClips.every((clip) => clip.keyframes?.some((keyframe) => keyframe.property === 'position.x'))).toBe(true);
  });

  it('materializes distortion transitions as animated effect clips', () => {
    const serializableClips = [serializableClip('out', 0), serializableClip('in', 2)];
    const timelineClips = serializableClips.map(timelineClip);
    timelineClips[0].transitionOut = {
      id: 'transition-1',
      type: 'swirl',
      duration: 1,
      linkedClipId: 'in',
    };
    timelineClips[1].transitionIn = {
      id: 'transition-1',
      type: 'swirl',
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
      duration: 5,
      backgroundColor: '#000000',
      timelineData: { tracks: [], clips: serializableClips, duration: 5 },
    };
    const compositions: Composition[] = [parent];
    const createComposition = vi.fn((name: string, settings?: Partial<Composition>): Composition => {
      const comp = {
        id: 'transition-comp-1',
        name,
        type: 'composition' as const,
        parentId: null,
        createdAt: 2,
        width: 1920,
        height: 1080,
        frameRate: 30,
        duration: settings?.duration ?? 1,
        backgroundColor: '#000000',
        timelineData: settings?.timelineData,
        transitionComp: settings?.transitionComp,
      };
      compositions.push(comp);
      return comp;
    });

    const id = ensureTransitionCompositionForPair({
      outgoingClipId: 'out',
      transitionId: 'transition-1',
      timelineClips,
      serializableClips,
      parentComposition: parent,
      compositions,
      createComposition,
      updateComposition: vi.fn(),
      attachTransitionComposition: vi.fn(),
    });

    const comp = compositions.find((composition) => composition.id === id)!;
    const distortedClips = comp.timelineData!.clips.filter((clip) =>
      clip.effects?.some((effect) => effect.type === 'twirl')
    );

    expect(distortedClips).toHaveLength(2);
    expect(distortedClips.every((clip) => clip.transitionRender === undefined)).toBe(true);
    expect(distortedClips.every((clip) =>
      clip.keyframes?.some((keyframe) =>
        typeof keyframe.property === 'string' &&
        keyframe.property.startsWith('effect.') &&
        keyframe.property.endsWith('.amount')
      )
    )).toBe(true);
  });

  it('uses blend windows instead of splitting source clips', () => {
    const serializableClips = [serializableClip('out', 0), serializableClip('in', 2)];
    const timelineClips = serializableClips.map(timelineClip);
    timelineClips[0].transitionOut = {
      id: 'transition-1',
      type: 'additive-dissolve',
      duration: 1,
      linkedClipId: 'in',
    };
    timelineClips[1].transitionIn = {
      id: 'transition-1',
      type: 'additive-dissolve',
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
      duration: 5,
      backgroundColor: '#000000',
      timelineData: { tracks: [], clips: serializableClips, duration: 5 },
    };
    const compositions: Composition[] = [parent];
    const createComposition = vi.fn((name: string, settings?: Partial<Composition>): Composition => {
      const comp = {
        id: 'transition-comp-1',
        name,
        type: 'composition' as const,
        parentId: null,
        createdAt: 2,
        width: 1920,
        height: 1080,
        frameRate: 30,
        duration: settings?.duration ?? 1,
        backgroundColor: '#000000',
        timelineData: settings?.timelineData,
        transitionComp: settings?.transitionComp,
      };
      compositions.push(comp);
      return comp;
    });

    const id = ensureTransitionCompositionForPair({
      outgoingClipId: 'out',
      transitionId: 'transition-1',
      timelineClips,
      serializableClips,
      parentComposition: parent,
      compositions,
      createComposition,
      updateComposition: vi.fn(),
      attachTransitionComposition: vi.fn(),
    });

    const comp = compositions.find((composition) => composition.id === id)!;
    const incomingClips = comp.timelineData!.clips.filter((clip) =>
      clip.id.startsWith('transition-comp:transition-1:incoming')
    );

    expect(incomingClips).toHaveLength(1);
    const [incomingClip] = incomingClips;
    expect(incomingClip.transform.blendMode).toBe('normal');
    expect(incomingClip.transitionRecipeBlendWindows).toEqual([
      { compStart: 0.04, compEnd: 0.92, blendMode: 'add' },
    ]);
    expect(resolveTransitionRecipeBlendMode(incomingClip.transitionRecipeBlendWindows, 0.039, 'normal')).toBe('normal');
    expect(resolveTransitionRecipeBlendMode(incomingClip.transitionRecipeBlendWindows, 0.04, 'normal')).toBe('add');
    expect(resolveTransitionRecipeBlendMode(incomingClip.transitionRecipeBlendWindows, 0.92, 'normal')).toBe('normal');
  });

  it('materializes semantic procedural, pattern, and clock masks with editable progress', () => {
    const cases = [
      ['block-glitch', { kind: 'procedural-mask', procedural: 'blocks', seed: 37 }],
      ['noise-dissolve', { kind: 'procedural-mask', procedural: 'noise', seed: 37 }],
      ['checker-wipe', { kind: 'pattern-mask', pattern: 'checker' }],
      ['doom-bars', { kind: 'pattern-mask', pattern: 'doom-bars' }],
      ['paint-splatter', { kind: 'pattern-mask', pattern: 'paint-splatter' }],
      ['polka-dot-curtain', { kind: 'pattern-mask', pattern: 'polka-dot' }],
      ['random-blocks', { kind: 'pattern-mask', pattern: 'random-blocks' }],
      ['venetian-blinds-horizontal', { kind: 'pattern-mask', pattern: 'venetian-horizontal' }],
      ['venetian-blinds-vertical', { kind: 'pattern-mask', pattern: 'venetian-vertical' }],
      ['zig-zag-blocks', { kind: 'pattern-mask', pattern: 'zig-zag' }],
      ['clock-wipe', { kind: 'clock-mask', clockwise: true, angleOffset: 0 }],
    ] as const;

    for (const [transitionType, expected] of cases) {
      const source = buildTransitionSource(
        serializableClip('out', 0),
        transitionType,
        'incoming',
        expected.kind === 'procedural-mask' ? { seed: 37 } : undefined,
      );
      const progressKeyframes = source.keyframes
        ?.filter((keyframe) => keyframe.property === 'transitionRender.progress')
        .map((keyframe) => ({ time: keyframe.time, value: keyframe.value }));

      expect(source.transitionRender).toMatchObject({ ...expected, progress: 0 });
      expect(source.masks).toEqual([]);
      expect(progressKeyframes).toEqual([{ time: 0, value: 0 }, { time: 1, value: 1 }]);
      expect(evaluateTransitionRenderState(source.transitionRender, source.keyframes, 0.5))
        .toMatchObject({ ...expected, progress: 0.5 });
    }
  });

  it('materializes distinct editable cross and star iris paths', () => {
    const cross = buildTransitionSource(serializableClip('out', 0), 'cross-iris', 'incoming');
    const star = buildTransitionSource(serializableClip('out', 0), 'star-iris', 'incoming');
    const crossVertices = cross.masks?.[0]?.vertices;
    const starVertices = star.masks?.[0]?.vertices;

    expect(cross.transitionRender).toBeUndefined();
    expect(star.transitionRender).toBeUndefined();
    expect(crossVertices).toHaveLength(12);
    expect(starVertices).toHaveLength(10);
    expect(crossVertices).not.toEqual(starVertices);
    expect(crossVertices?.[0]).toMatchObject({ x: -0.35, y: -2 });
    expect(starVertices?.[0]?.x).toBeCloseTo(0.5);
    expect(starVertices?.[0]?.y).toBe(-2);
    expect(cross.keyframes?.find((keyframe) => keyframe.time === 1)?.pathValue?.vertices).toHaveLength(12);
    expect(star.keyframes?.find((keyframe) => keyframe.time === 1)?.pathValue?.vertices).toHaveLength(10);
  });

  it('marks every scene-3d-panel source clip as 3D', () => {
    const scene3dTypes = [
      'card-spin', 'flip-horizontal', 'flip-vertical', 'roll-3d', 'spinback-3d', 'tumble-away',
    ] as const;

    for (const transitionType of scene3dTypes) {
      const sources = buildTransitionComposition(serializableClip('out', 0), transitionType)
        .timelineData!.clips.filter((clip) => /:outgoing$|:incoming$/.test(clip.id));
      expect(sources).toHaveLength(2);
      expect(sources.every((clip) => clip.is3D)).toBe(true);
    }
  });

  it('converts recipe and panel rotations to timeline degrees without changing kaleidoscope radians', () => {
    const rotationCases = [
      ['card-spin', 'rotation.y', 0.5, Math.PI / 2],
      ['flip-horizontal', 'rotation.y', 0.5, -Math.PI / 2],
      ['flip-vertical', 'rotation.x', 0.5, Math.PI / 2],
      ['roll-3d', 'rotation.x', 0.52, -Math.PI / 2],
      ['spinback-3d', 'rotation.x', 0.68, 0.36],
      ['tumble-away', 'rotation.x', 0.78, 0.92],
      ['rotate-90', 'rotation.z', 1, -Math.PI / 2],
      ['rotate-left', 'rotation.z', 1, -0.42],
      ['rotate-right', 'rotation.z', 1, 0.42],
      ['spin-zoom', 'rotation.z', 1, 0.18],
    ] as const;

    for (const [transitionType, property, time, radians] of rotationCases) {
      const keyframe = buildTransitionSource(serializableClip('out', 0), transitionType)
        .keyframes?.find((candidate) => candidate.property === property && candidate.time === time);
      expect(keyframe?.value).toBeCloseTo(radians * 180 / Math.PI);
    }

    const shatterPanels = buildTransitionComposition(serializableClip('out', 0), 'shatter-glass')
      .timelineData!.clips.filter((clip) => clip.sourceRect);
    expect(shatterPanels).toHaveLength(24);
    expect(shatterPanels.some((panel) => panel.keyframes?.some((keyframe) =>
      keyframe.property === 'rotation.z' && Math.abs(keyframe.value - 0.28 * 180 / Math.PI) < 0.0001
    ))).toBe(true);

    const kaleidoscope = buildTransitionSource(serializableClip('out', 0), 'kaleidoscope');
    const rotationKeyframes = kaleidoscope.keyframes?.filter((keyframe) =>
      String(keyframe.property).endsWith('.rotation')
    ).map((keyframe) => keyframe.value);
    expect([...new Set(rotationKeyframes)]).toEqual([0, Math.PI * 2]);
  });

  it('materializes every runtime transition type without inner transition metadata', () => {
    const failures: string[] = [];

    for (const definition of getAllTransitions()) {
      const serializableClips = [serializableClip('out', 0), serializableClip('in', 2)];
      const timelineClips = serializableClips.map(timelineClip);
      timelineClips[0].transitionOut = {
        id: 'transition-1',
        type: definition.id,
        duration: 1,
        linkedClipId: 'in',
      };
      timelineClips[1].transitionIn = {
        id: 'transition-1',
        type: definition.id,
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
        duration: 5,
        backgroundColor: '#000000',
        timelineData: { tracks: [], clips: serializableClips, duration: 5 },
      };
      const compositions: Composition[] = [parent];
      const createComposition = vi.fn((name: string, settings?: Partial<Composition>): Composition => {
        const comp = {
          id: `transition-comp-${definition.id}`,
          name,
          type: 'composition' as const,
          parentId: null,
          createdAt: 2,
          width: 1920,
          height: 1080,
          frameRate: 30,
          duration: settings?.duration ?? 1,
          backgroundColor: '#000000',
          timelineData: settings?.timelineData,
          transitionComp: settings?.transitionComp,
        };
        compositions.push(comp);
        return comp;
      });

      try {
        const id = ensureTransitionCompositionForPair({
          outgoingClipId: 'out',
          transitionId: 'transition-1',
          timelineClips,
          serializableClips,
          parentComposition: parent,
          compositions,
          createComposition,
          updateComposition: vi.fn(),
          attachTransitionComposition: vi.fn(),
        });
        const comp = compositions.find((composition) => composition.id === id);
        expect(comp?.timelineData?.duration).toBe(1);
        expect(comp?.transitionComp?.templateVersion).toBe(definition.id === 'light-leak' ? 3 : 4);
        expect(comp?.timelineData?.clips.length).toBeGreaterThan(0);
        expect(comp?.timelineData?.clips.some((clip) => clip.transitionIn || clip.transitionOut)).toBe(false);
        if (definition.id === 'light-leak') {
          const sources = comp?.timelineData?.clips.filter((clip) =>
            clip.id === 'transition-comp:transition-1:outgoing' ||
            clip.id === 'transition-comp:transition-1:incoming'
          ) ?? [];
          expect(sources).toHaveLength(2);
          expect(sources.every((clip) =>
            clip.startTime === 0 &&
            clip.duration === 1 &&
            isValidTransitionSourceMap(clip.transitionSourceMap) &&
            !/:seg:|:part:/.test(clip.id)
          )).toBe(true);
        }
      } catch (error) {
        failures.push(`${definition.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    expect(failures).toEqual([]);
  });
});
