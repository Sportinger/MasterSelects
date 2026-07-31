import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handleSetTransform } from '../../src/services/aiTools/handlers/transform';
import { formatClipInfo } from '../../src/services/aiTools/utils';
import { getMotionMvpCapabilities } from '../../src/services/motionDesign/mvpCapabilities';
import { propertyRegistry } from '../../src/services/properties';
import {
  describePropertyAuthoringDescriptor,
  propertyValueFromStorage,
  propertyValueToStorage,
  resolveClipPropertyAuthoringContext,
  resolveTransformPositionUnitMode,
  writePropertyAuthoringValue,
} from '../../src/services/properties/propertyAuthoring';
import { useMediaStore } from '../../src/stores/mediaStore';
import { DEFAULT_TRANSFORM, useTimelineStore } from '../../src/stores/timeline';
import type { TimelineClip } from '../../src/types/timeline';
import { createDefaultMotionLayerDefinition } from '../../src/types/motionDesign';

const initialTimelineState = useTimelineStore.getState();
const initialMediaState = useMediaStore.getState();

function makeClip(overrides: Partial<TimelineClip> = {}): TimelineClip {
  return {
    id: 'authoring-clip',
    trackId: 'video-1',
    name: 'Authoring Clip',
    file: new File([], 'clip.mp4'),
    startTime: 0,
    duration: 5,
    inPoint: 0,
    outPoint: 5,
    source: { type: 'video', naturalDuration: 5 },
    transform: structuredClone(DEFAULT_TRANSFORM),
    effects: [],
    ...overrides,
  };
}

describe('property authoring foundation', () => {
  beforeEach(() => {
    useTimelineStore.setState(initialTimelineState);
    vi.mocked(useMediaStore.getState).mockReturnValue({
      ...initialMediaState,
      activeCompositionId: 'comp-1',
      compositions: [{ id: 'comp-1', width: 1920, height: 1080 } as never],
    });
  });

  it('converts centered pixel positions through composition half extents without changing storage units', () => {
    const clip = makeClip();
    const context = {
      compositionId: 'comp-1',
      compositionWidth: 1920,
      compositionHeight: 1080,
      positionUnitMode: 'composition-pixels' as const,
    };
    const x = propertyRegistry.getDescriptor('position.x', clip)!;
    const y = propertyRegistry.getDescriptor('position.y', clip)!;
    const z = propertyRegistry.getDescriptor('position.z', clip)!;

    expect(propertyValueToStorage(x, 192, context)).toBeCloseTo(0.2);
    expect(propertyValueToStorage(y, -108, context)).toBeCloseTo(-0.2);
    expect(propertyValueToStorage(z, 96, context)).toBeCloseTo(0.1);
    expect(propertyValueFromStorage(x, 0.2, context)).toBeCloseTo(192);

    const updated = writePropertyAuthoringValue(
      propertyRegistry,
      clip,
      'position.x',
      192,
      context,
    );
    expect(updated.transform.position.x).toBeCloseTo(0.2);
    expect(clip.transform.position.x).toBe(0);
  });

  it('exposes capability metadata as first-class descriptor fields', () => {
    const clip = makeClip();
    const position = describePropertyAuthoringDescriptor(
      propertyRegistry.getDescriptor('position.x', clip)!,
      {
        clip,
        context: {
          compositionId: 'comp-1',
          compositionWidth: 1920,
          compositionHeight: 1080,
          positionUnitMode: 'composition-pixels',
        },
      },
    );
    const opacity = describePropertyAuthoringDescriptor(
      propertyRegistry.getDescriptor('opacity', clip)!,
      { clip },
    );

    expect(position).toMatchObject({
      valueType: 'number',
      animatable: true,
      writable: true,
      unit: 'px',
      storageUnit: 'normalized',
      coordinateSpace: 'composition-center',
      axis: 'x',
      codec: 'composition-half-extent',
    });
    expect(opacity.range).toEqual({ min: 0, max: 1, step: 0.01 });
    expect(opacity.aliases).toEqual(['alpha', 'transparency']);

    const motion = createDefaultMotionLayerDefinition('shape');
    const motionClip = makeClip({
      source: { type: 'motion-shape', naturalDuration: 5 },
      motion,
    });
    const motionView = getMotionMvpCapabilities(motionClip).properties?.find(
      (property) => property.path === 'shape.size.w',
    );
    expect(motionView).toMatchObject({
      valueType: 'number',
      animatable: true,
      writable: true,
      range: { min: 1, step: 1 },
      aliases: ['motion', 'shape'],
      codec: 'identity',
    });
  });

  it('uses the live active timeline first, then resolves an inactive persisted owner', () => {
    const compositions = [
      {
        id: 'active-comp',
        width: 1920,
        height: 1080,
        timelineData: { clips: [{ id: 'shared-stale-id' }] },
      },
      {
        id: 'inactive-comp',
        width: 1280,
        height: 720,
        timelineData: {
          clips: [{ id: 'live-clip' }, { id: 'shared-stale-id' }],
        },
      },
    ];

    expect(resolveClipPropertyAuthoringContext({
      clipId: 'live-clip',
      compositions,
      activeCompositionId: 'active-comp',
      liveClipIds: ['live-clip'],
      positionUnitMode: 'composition-pixels',
    })).toMatchObject({
      ok: true,
      source: 'active-live',
      context: {
        compositionId: 'active-comp',
        compositionWidth: 1920,
        compositionHeight: 1080,
      },
    });

    expect(resolveClipPropertyAuthoringContext({
      clipId: 'shared-stale-id',
      compositions,
      activeCompositionId: 'active-comp',
      liveClipIds: ['some-other-live-clip'],
      positionUnitMode: 'composition-pixels',
    })).toMatchObject({
      ok: true,
      source: 'persisted-owner',
      context: {
        compositionId: 'inactive-comp',
        compositionWidth: 1280,
        compositionHeight: 720,
      },
    });

    expect(resolveClipPropertyAuthoringContext({
      clipId: 'missing-clip',
      compositions,
      activeCompositionId: 'active-comp',
      liveClipIds: [],
      positionUnitMode: 'composition-pixels',
    })).toEqual({
      ok: false,
      reason: 'owner-not-found',
      compositionIds: [],
    });

    expect(resolveClipPropertyAuthoringContext({
      clipId: 'live-clip',
      compositions,
      activeCompositionId: null,
      liveClipIds: ['live-clip'],
      positionUnitMode: 'composition-pixels',
    })).toEqual({
      ok: false,
      reason: 'owner-not-found',
      compositionIds: [],
    });

    expect(resolveClipPropertyAuthoringContext({
      clipId: 'duplicate-owner',
      compositions: [
        { id: 'one', width: 1920, height: 1080, timelineData: { clips: [{ id: 'duplicate-owner' }] } },
        { id: 'two', width: 1280, height: 720, timelineData: { clips: [{ id: 'duplicate-owner' }] } },
      ],
      activeCompositionId: null,
      liveClipIds: [],
      positionUnitMode: 'composition-pixels',
    })).toEqual({
      ok: false,
      reason: 'owner-ambiguous',
      compositionIds: ['one', 'two'],
    });

    expect(resolveClipPropertyAuthoringContext({
      clipId: 'live-clip',
      compositions: [{ id: 'invalid', width: 0, height: 1080 }],
      activeCompositionId: 'invalid',
      liveClipIds: ['live-clip'],
      positionUnitMode: 'composition-pixels',
    })).toEqual({
      ok: false,
      reason: 'invalid-composition-size',
      compositionIds: ['invalid'],
    });
  });

  it('keeps effectively-3D and camera positions in raw scene units', () => {
    const descriptor = propertyRegistry.getDescriptor('position.x', makeClip())!;
    const sceneContext = {
      compositionId: 'comp-3d',
      compositionWidth: 1920,
      compositionHeight: 1080,
      positionUnitMode: 'scene-units' as const,
    };
    const sceneClip = makeClip({ is3D: true });
    const cameraClip = makeClip({ source: { type: 'camera' } });

    expect(resolveTransformPositionUnitMode(makeClip())).toBe('composition-pixels');
    expect(resolveTransformPositionUnitMode(sceneClip)).toBe('scene-units');
    expect(resolveTransformPositionUnitMode(cameraClip)).toBe('scene-units');
    expect(propertyValueToStorage(descriptor, 2.5, sceneContext)).toBe(2.5);
    expect(propertyValueFromStorage(descriptor, -3, sceneContext)).toBe(-3);
    expect(describePropertyAuthoringDescriptor(descriptor, {
      clip: sceneClip,
      context: sceneContext,
    })).toMatchObject({
      unit: 'scene-unit',
      storageUnit: 'scene-unit',
      codec: 'identity',
      value: 0,
    });
  });

  it('excludes catalog-only effect templates from clip search', () => {
    const plainClip = makeClip();
    const catalogMatches = propertyRegistry.search({ query: 'brightness' });
    const plainClipMatches = propertyRegistry.search({
      clip: plainClip,
      query: 'brightness',
    });
    const plainClipDescriptors = propertyRegistry.getAllDescriptors(plainClip);
    const effectClip = makeClip({
      effects: [{
        id: 'fx-brightness-instance',
        type: 'brightness',
        name: 'Brightness',
        enabled: true,
        params: { amount: 0.25 },
      }],
    });
    const effectClipMatches = propertyRegistry.search({
      clip: effectClip,
      query: 'brightness',
    });

    expect(catalogMatches.some((descriptor) => descriptor.catalogOnly)).toBe(true);
    expect(plainClipMatches.some((descriptor) => descriptor.path.startsWith('effect.'))).toBe(false);
    expect(plainClipDescriptors.some((descriptor) => descriptor.path.startsWith('shape.'))).toBe(false);
    expect(propertyRegistry.getDescriptor('shape.size.w', plainClip)).toBeUndefined();
    expect(effectClipMatches.some((descriptor) => (
      descriptor.path === 'effect.fx-brightness-instance.amount'
      && descriptor.catalogOnly === false
    ))).toBe(true);
  });

  it('makes setTransform use the live owner context and the shared codec atomically', async () => {
    const clip = makeClip();
    vi.mocked(useMediaStore.getState).mockReturnValue({
      ...initialMediaState,
      activeCompositionId: 'active-comp',
      openCompositionIds: ['active-comp'],
      compositions: [
        {
          id: 'active-comp',
          width: 1000,
          height: 800,
          timelineData: undefined,
        } as never,
        {
          id: 'stale-owner',
          width: 2000,
          height: 1000,
          timelineData: { clips: [{ id: clip.id }] } as never,
        } as never,
      ],
    });
    useTimelineStore.setState({ clips: [clip] });
    expect(useMediaStore.getState().activeCompositionId).toBe('active-comp');
    expect(useMediaStore.getState().compositions.map((composition) => composition.id))
      .toContain('active-comp');
    expect(useTimelineStore.getState().clips.map((candidate) => candidate.id))
      .toContain(clip.id);

    const result = await handleSetTransform({
      clipId: clip.id,
      x: 250,
      y: -200,
      z: 125,
      opacity: 0.6,
    }, useTimelineStore.getState());
    const updated = useTimelineStore.getState().clips.find(
      (candidate) => candidate.id === clip.id,
    )!;

    expect(result.success, result.error).toBe(true);
    expect(updated.transform.position).toEqual({ x: 0.5, y: -0.5, z: 0.25 });
    expect(updated.transform.opacity).toBe(0.6);

    const rejected = await handleSetTransform({
      clipId: clip.id,
      opacity: 2,
      x: 400,
    }, useTimelineStore.getState());
    expect(rejected.success).toBe(false);
    expect(useTimelineStore.getState().clips.find(
      (candidate) => candidate.id === clip.id,
    )?.transform).toEqual(updated.transform);
  });

  it('formats AI clip reads in authoring units and exposes storage values explicitly', () => {
    const clip = makeClip({
      transform: {
        ...structuredClone(DEFAULT_TRANSFORM),
        position: { x: 0.2, y: -0.2, z: 0.1 },
      },
    });
    const info = formatClipInfo(clip, undefined, {
      compositionId: 'comp-1',
      compositionWidth: 1920,
      compositionHeight: 1080,
      positionUnitMode: 'composition-pixels',
    });

    expect(info.transform.position).toEqual({ x: 192, y: -108, z: 96 });
    expect(info.storedTransform.position).toEqual({ x: 0.2, y: -0.2, z: 0.1 });
    expect(info.transformAuthoring).toEqual(expect.objectContaining({
      compositionId: 'comp-1',
      positionUnit: 'px',
      coordinateSpace: 'composition-center',
    }));
  });
});
