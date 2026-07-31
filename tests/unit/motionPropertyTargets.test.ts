import { describe, expect, it } from 'vitest';

import {
  buildMotionPropertyTargetModel,
  MOTION_PROPERTY_TARGET_LIMIT,
} from '../../src/services/motionDesign/propertyTargets';
import { PropertyRegistry } from '../../src/services/properties/PropertyRegistry';
import { registerCoreProperties } from '../../src/services/properties/registerCoreProperties';
import { DEFAULT_TRANSFORM } from '../../src/stores/timeline';
import type { TimelineClip } from '../../src/types/timeline';
import { createDefaultMotionLayerDefinition } from '../../src/types/motionDesign';

function makeMotionClip(
  id: string,
  pinnedProperties: string[] = [],
  overrides: Partial<TimelineClip> = {},
): TimelineClip {
  const motion = createDefaultMotionLayerDefinition('shape');
  motion.ui = { ...motion.ui, pinnedProperties };
  return {
    id,
    trackId: 'video-1',
    name: id,
    file: new File([], `${id}.motion`),
    startTime: 0,
    duration: 5,
    inPoint: 0,
    outPoint: 5,
    source: { type: 'motion-shape', naturalDuration: 5 },
    transform: structuredClone(DEFAULT_TRANSFORM),
    effects: [],
    motion,
    ...overrides,
  };
}

function createRegistry(): PropertyRegistry {
  return registerCoreProperties(new PropertyRegistry());
}

describe('Motion property target model', () => {
  it('orders selected, pinned, favorited, and animated targets with exact-path dedupe', () => {
    const registry = createRegistry();
    const clipA = makeMotionClip('motion-a', [
      'shape.size.w',
      'appearance.stale.opacity',
      'opacity',
      'shape.size.w',
      'replicator.enabled',
    ]);
    const clipB = makeMotionClip('motion-b', ['shape.size.h']);
    const originalPins = structuredClone(clipA.motion?.ui?.pinnedProperties);
    const favoritePaths = [
      'opacity',
      'appearance.stale.opacity',
      'shape.size.w',
      ' opacity',
    ];
    const model = buildMotionPropertyTargetModel({
      registry,
      clips: [clipA, clipB],
      selectedTargets: [
        { clipId: clipA.id, path: 'opacity' },
        { clipId: clipB.id, path: 'position.y' },
        { clipId: clipA.id, path: 'opacity' },
        { clipId: 'missing-clip', path: 'position.x' },
      ],
      favoritePaths,
      animatedByClip: new Map([
        [clipA.id, [
          { property: 'position.x' },
          { property: 'opacity' },
          { property: 'shape.size.h' },
          { property: 'appearance.stale.opacity' },
          { property: 'replicator.enabled' },
        ]],
        [clipB.id, [
          { property: 'opacity' },
          { property: 'position.y' },
        ]],
      ]),
    });

    expect(model.targets.map(({ id, priority }) => ({ id, priority }))).toEqual([
      { id: 'motion-a::opacity', priority: 'selected' },
      { id: 'motion-b::position.y', priority: 'selected' },
      { id: 'motion-a::shape.size.w', priority: 'pinned' },
      { id: 'motion-b::shape.size.h', priority: 'pinned' },
      { id: 'motion-b::opacity', priority: 'favorited' },
      { id: 'motion-b::shape.size.w', priority: 'favorited' },
      { id: 'motion-a::position.x', priority: 'animated' },
      { id: 'motion-a::shape.size.h', priority: 'animated' },
    ]);
    expect(model.targets[0].sources).toEqual([
      'selected',
      'pinned',
      'favorited',
      'animated',
    ]);
    expect(model.targets[1].sources).toEqual(['selected', 'animated']);
    expect(model.targets[2].sources).toEqual(['pinned', 'favorited']);
    expect(new Set(model.targets.map((target) => target.id)).size).toBe(model.targets.length);
    expect(model.targets.every((target) => target.descriptor.path === target.path)).toBe(true);
    expect(clipA.motion?.ui?.pinnedProperties).toEqual(originalPins);
    expect(favoritePaths).toEqual([
      'opacity',
      'appearance.stale.opacity',
      'shape.size.w',
      ' opacity',
    ]);
  });

  it('keeps only animatable descriptors enumerated as valid for the exact clip', () => {
    const registry = createRegistry();
    const motionClip = makeMotionClip('motion-valid');
    const fillId = motionClip.motion?.appearance?.items[0]?.id;
    expect(fillId).toBeDefined();
    motionClip.motion!.ui = {
      pinnedProperties: [
        `appearance.${fillId}.opacity`,
        'appearance.stale.opacity',
        'shape.star.points',
        'replicator.enabled',
        'blendMode',
      ],
    };
    const videoWithStaleMotion = makeMotionClip('ordinary-video', [
      'shape.size.w',
      'opacity',
    ], {
      source: { type: 'video', naturalDuration: 5 },
    });

    const model = buildMotionPropertyTargetModel({
      registry,
      clips: [motionClip, videoWithStaleMotion],
    });

    expect(model.targets.map((target) => target.id)).toEqual([
      `motion-valid::appearance.${fillId}.opacity`,
      'ordinary-video::opacity',
    ]);
    expect(motionClip.motion?.ui?.pinnedProperties).toContain('appearance.stale.opacity');
    expect(videoWithStaleMotion.motion?.ui?.pinnedProperties).toContain('shape.size.w');
  });

  it('bounds the default output to the existing Motion property operation limit', () => {
    const registry = createRegistry();
    const clips = [
      makeMotionClip('bounded-a'),
      makeMotionClip('bounded-b'),
      makeMotionClip('bounded-c'),
    ];
    const favoritePaths = registry
      .getAllDescriptors(clips[0])
      .filter((descriptor) => descriptor.animatable && !descriptor.path.startsWith('appearance.'))
      .map((descriptor) => descriptor.path);

    const model = buildMotionPropertyTargetModel({ registry, clips, favoritePaths });

    expect(model.totalResolved).toBeGreaterThan(MOTION_PROPERTY_TARGET_LIMIT);
    expect(model.targets).toHaveLength(MOTION_PROPERTY_TARGET_LIMIT);
    expect(model.limit).toBe(MOTION_PROPERTY_TARGET_LIMIT);
    expect(model.truncated).toBe(true);
  });
});
