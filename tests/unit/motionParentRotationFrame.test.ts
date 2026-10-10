import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTimelineStore } from '../../src/stores/timeline';
import { useMediaStore } from '../../src/stores/mediaStore';
import { Logger } from '../../src/services/logger';
import { projectLayerUvToCanvas } from '../../src/components/preview/editModeOverlayMath';
import { evaluateParentedClipTransform } from '../../src/services/layerBuilder/parentTransformEvaluation';
import {
  applyTimelineMotionStructurePlan,
  planTimelineMotionParentMutation,
  toMotionParentTransform2D,
} from '../../src/services/motionDesign/contracts/timelineStructureAdapter';
import { MOTION_PARENT_ERROR_CODES } from '../../src/services/motionDesign/structure/contracts';
import {
  createMotionParentGraphSnapshot,
  evaluateMotionParentGraphWorldTransforms,
} from '../../src/services/motionDesign/structure/parentGraphPlanner';
import {
  composeMotionParentTransforms2D,
  deriveMotionParentLocalTransform2D,
} from '../../src/services/motionDesign/structure/parentTransformMath';
import {
  createCompositionParentPositionFrame,
  rotateParentPositionOffset,
  SCENE_PARENT_POSITION_FRAME,
} from '../../src/utils/parentPositionFrame';
import { composeTransforms, resolveClipParentPositionFrame } from '../../src/utils/transformComposition';
import type { TimelineClip } from '../../src/types/timeline';
import type { ClipTransform } from '../../src/types/timelineCore';
import type { Keyframe } from '../../src/types/keyframes';
import { createMockClip, createMockTransform } from '../helpers/mockData';

/**
 * Live repro: a 1080x1920 composition, a Motion Null at rotation.z 23.3 and a
 * shape at local (-122, -128) px. Rotating the normalized half-extent values
 * directly put it at about (-85, -208) px: skewed by the 9:16 aspect, and
 * turned clockwise while the compositor turns layers counter-clockwise.
 */
const PORTRAIT = { width: 1080, height: 1920 } as const;
const HALF_W = PORTRAIT.width / 2;
const HALF_H = PORTRAIT.height / 2;
const ROTATION = 23.3;
const CHILD_LOCAL_PX = { x: -122, y: -128 };

type Point = { x: number; y: number };

const toNormalized = (px: Point): Point => ({ x: px.x / HALF_W, y: px.y / HALF_H });
const toPixels = (normalized: Point): Point => ({ x: normalized.x * HALF_W, y: normalized.y * HALF_H });

/** Counter-clockwise on a Y-down screen, which is how the compositor turns +rotation.z. */
function turnOnScreen(px: Point, degrees: number): Point {
  const radians = degrees * Math.PI / 180;
  return {
    x: px.x * Math.cos(radians) + px.y * Math.sin(radians),
    y: -px.x * Math.sin(radians) + px.y * Math.cos(radians),
  };
}

function transformAtPx(px: Point, overrides: Partial<ClipTransform> = {}): ClipTransform {
  const position = toNormalized(px);
  return createMockTransform({ position: { x: position.x, y: position.y, z: 0 }, ...overrides });
}

function expectPx(actual: Point, expected: Point, digits = 6): void {
  expect(actual.x).toBeCloseTo(expected.x, digits);
  expect(actual.y).toBeCloseTo(expected.y, digits);
}

const portraitFrame = createCompositionParentPositionFrame(PORTRAIT);

describe('parent rotation in 2D composition pixel space', () => {
  it('turns a child offset rigidly on a portrait composition (live repro)', () => {
    const parent = createMockTransform({ rotation: { x: 0, y: 0, z: ROTATION } });
    const world = composeTransforms(parent, transformAtPx(CHILD_LOCAL_PX), portraitFrame);
    const worldPx = toPixels(world.position);

    expectPx(worldPx, turnOnScreen(CHILD_LOCAL_PX, ROTATION));
    expect(Math.hypot(worldPx.x, worldPx.y)).toBeCloseTo(Math.hypot(-122, -128), 6);
    // Neither the skewed nor the clockwise result of the old algebra.
    expect(Math.abs(worldPx.x - -85)).toBeGreaterThan(50);
  });

  it('places a child exactly where the renderer draws the same point of the rotated parent', () => {
    const parentRotation = ROTATION;
    const projection = {
      sourceWidth: PORTRAIT.width,
      sourceHeight: PORTRAIT.height,
      outputWidth: PORTRAIT.width,
      outputHeight: PORTRAIT.height,
      canvasWidth: PORTRAIT.width,
      canvasHeight: PORTRAIT.height,
      position: { x: 0, y: 0 },
      scale: { x: 1, y: 1 },
      rotation: parentRotation * Math.PI / 180,
    };
    for (const local of [CHILD_LOCAL_PX, { x: 300, y: 0 }, { x: 0, y: 500 }, { x: -40, y: 210 }]) {
      // The preview overlay projection mirrors composite.wgsl.
      const drawn = projectLayerUvToCanvas(
        { x: 0.5 + local.x / PORTRAIT.width, y: 0.5 + local.y / PORTRAIT.height },
        projection,
      );
      const parent = createMockTransform({ rotation: { x: 0, y: 0, z: parentRotation } });
      const world = composeTransforms(parent, transformAtPx(local), portraitFrame);
      expectPx(toPixels(world.position), { x: drawn.x - HALF_W, y: drawn.y - HALF_H }, 5);
    }
  });

  it('turns offsets in the renderer direction: +90 deg moves a right-hand child above the parent', () => {
    const parent = createMockTransform({ rotation: { x: 0, y: 0, z: 90 } });
    const world = composeTransforms(parent, transformAtPx({ x: 200, y: 0 }), portraitFrame);
    expectPx(toPixels(world.position), { x: 0, y: -200 });
  });

  it('keeps Scale All and the parent position while turning the offset', () => {
    const parentPx = { x: 100, y: -200 };
    const parent = transformAtPx(parentPx, {
      rotation: { x: 0, y: 0, z: ROTATION },
      scale: { all: 1.25, x: 2, y: 0.5 },
    });
    const world = composeTransforms(parent, transformAtPx(CHILD_LOCAL_PX), portraitFrame);
    const turned = turnOnScreen({ x: CHILD_LOCAL_PX.x * 1.25, y: CHILD_LOCAL_PX.y * 1.25 }, ROTATION);
    expectPx(toPixels(world.position), { x: parentPx.x + turned.x, y: parentPx.y + turned.y });
  });

  it('inverts exactly with the negated angle', () => {
    const offset = toNormalized(CHILD_LOCAL_PX);
    const turned = rotateParentPositionOffset(offset, ROTATION, portraitFrame);
    const back = rotateParentPositionOffset(turned, -ROTATION, portraitFrame);
    expect(back.x).toBeCloseTo(offset.x, 12);
    expect(back.y).toBeCloseTo(offset.y, 12);
  });

  it('keeps isotropic Y-up scene units for effective-3D clips', () => {
    const clip3D = createMockClip({ id: 'plane-3d', is3D: true });
    expect(resolveClipParentPositionFrame(clip3D, PORTRAIT)).toBe(SCENE_PARENT_POSITION_FRAME);
    const parent = createMockTransform({ rotation: { x: 0, y: 0, z: 90 } });
    const child = createMockTransform({ position: { x: 1, y: 0, z: 0 } });
    const world = composeTransforms(parent, child, SCENE_PARENT_POSITION_FRAME);
    expect(world.position.x).toBeCloseTo(0, 12);
    expect(world.position.y).toBeCloseTo(1, 12);
  });

  it('says so when a 2D child has no composition size and falls back to a square frame', () => {
    Logger.clear();
    const clip = createMockClip({ id: 'sizeless-2d-child' });
    const frame = resolveClipParentPositionFrame(clip, undefined);
    expect(frame).toEqual({ xUnitScale: 1, yAxis: 'down' });
    expect(Logger.search('sizeless-2d-child').some((entry) => entry.level === 'WARN')).toBe(true);
  });
});

describe('exact-frame parent evaluation (preview and export builders)', () => {
  it('uses the owning composition size', () => {
    const parent = createMockClip({
      id: 'eval-parent',
      transform: createMockTransform({ rotation: { x: 0, y: 0, z: ROTATION } }),
    });
    const child = createMockClip({
      id: 'eval-child',
      parentClipId: parent.id,
      transform: transformAtPx(CHILD_LOCAL_PX),
    });
    const result = evaluateParentedClipTransform({
      clip: child,
      clips: [parent, child],
      clipLocalTime: 1,
      parentTimelineTime: 1,
      compositionSize: PORTRAIT,
      getKeyframes: () => [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expectPx(toPixels(result.transform.position), turnOnScreen(CHILD_LOCAL_PX, ROTATION));
  });
});

describe('Structure parent algebra on a non-square composition', () => {
  const parent = toMotionParentTransform2D(transformAtPx({ x: 100, y: -200 }, {
    rotation: { x: 0, y: 0, z: ROTATION },
    scale: { all: 1.25, x: 2, y: 0.5 },
  }));
  const local = toMotionParentTransform2D(transformAtPx(CHILD_LOCAL_PX, {
    rotation: { x: 0, y: 0, z: 7 },
  }));

  it('matches composeTransforms in the same composition frame', () => {
    const structureWorld = composeMotionParentTransforms2D(parent, local, PORTRAIT);
    const clipWorld = composeTransforms(
      createMockTransform({
        position: { x: parent.position.x, y: parent.position.y, z: 0 },
        rotation: { x: 0, y: 0, z: parent.rotationZ },
        scale: { ...parent.scale },
      }),
      createMockTransform({ position: { x: local.position.x, y: local.position.y, z: 0 } }),
      portraitFrame,
    );
    expect(structureWorld.position.x).toBeCloseTo(clipWorld.position.x, 12);
    expect(structureWorld.position.y).toBeCloseTo(clipWorld.position.y, 12);
  });

  it('derives the exact local transform back from the world transform', () => {
    const world = composeMotionParentTransforms2D(parent, local, PORTRAIT);
    const inverse = deriveMotionParentLocalTransform2D(parent, world, [], PORTRAIT);
    expect(inverse.ok).toBe(true);
    if (!inverse.ok) return;
    expect(inverse.transform.position.x).toBeCloseTo(local.position.x, 12);
    expect(inverse.transform.position.y).toBeCloseTo(local.position.y, 12);
    expect(inverse.transform.rotationZ).toBeCloseTo(local.rotationZ, 12);
  });

  it('rejects a malformed composition size in the evaluation envelope', () => {
    const graph = createMotionParentGraphSnapshot([
      { clipId: 'child', compositionId: 'comp', space: '2d', parentClipId: 'parent' },
      { clipId: 'parent', compositionId: 'comp', space: '2d' },
    ]);
    const localTransforms = [
      { clipId: 'child', transform: local },
      { clipId: 'parent', transform: parent },
    ];
    for (const compositionSize of [{ width: 0, height: 1920 }, { width: 1080, height: 1920, depth: 1 }]) {
      const result = evaluateMotionParentGraphWorldTransforms(graph, {
        timelineTime: 0,
        compositionSize,
        localTransforms,
      } as never);
      expect(result.worlds).toBeUndefined();
      expect(result.failures[0]?.code).toBe(MOTION_PARENT_ERROR_CODES.EVALUATION_INVALID);
    }
    const valid = evaluateMotionParentGraphWorldTransforms(graph, {
      timelineTime: 0,
      compositionSize: PORTRAIT,
      localTransforms,
    });
    expect(valid.worlds?.get('child')?.position.x)
      .toBeCloseTo(composeMotionParentTransforms2D(parent, local, PORTRAIT).position.x, 12);
  });
});

function createParentAndChild(): { parent: TimelineClip; child: TimelineClip } {
  const parent = createMockClip({
    id: 'rig-null',
    trackId: 'video-1',
    transform: transformAtPx({ x: 100, y: -200 }, {
      rotation: { x: 0, y: 0, z: ROTATION },
      scale: { all: 1.25, x: 1, y: 1 },
    }),
  });
  const child = createMockClip({
    id: 'rig-shape',
    trackId: 'video-2',
    transform: transformAtPx({ x: 300, y: 400 }, { rotation: { x: 0, y: 0, z: 10 } }),
  });
  return { parent, child };
}

describe('set/clear parent preserves the world transform on a rotated parent', () => {
  it('round-trips through the timeline structure adapter', () => {
    const { parent, child } = createParentAndChild();
    const clipKeyframes = new Map<string, Keyframe[]>();
    const plan = (clips: TimelineClip[], parentClipId?: string) => {
      const planned = planTimelineMotionParentMutation({
        compositionId: 'comp-portrait',
        compositionSize: PORTRAIT,
        clips,
        clipKeyframes,
        timelineTime: 1,
        childClipId: child.id,
        ...(parentClipId ? { parentClipId } : {}),
      });
      expect(planned.ok).toBe(true);
      if (!planned.ok) throw new Error('planning failed');
      const applied = applyTimelineMotionStructurePlan({
        compositionId: 'comp-portrait',
        compositionSize: PORTRAIT,
        clips,
        clipKeyframes,
        plan: planned.plan,
      });
      expect(applied.ok).toBe(true);
      if (!applied.ok) throw new Error(applied.message);
      return applied.clips;
    };

    const parented = plan([parent, child], parent.id);
    const parentedChild = parented.find((clip) => clip.id === child.id)!;
    expect(parentedChild.parentClipId).toBe(parent.id);
    const world = composeTransforms(parent.transform, parentedChild.transform, portraitFrame);
    expect(world.position.x).toBeCloseTo(child.transform.position.x, 12);
    expect(world.position.y).toBeCloseTo(child.transform.position.y, 12);
    expect(world.rotation.z).toBeCloseTo(10, 12);
    // The stored local offset is the rigid pixel offset, undone by Scale All.
    const localPx = toPixels(parentedChild.transform.position);
    expect(Math.hypot(localPx.x, localPx.y) * 1.25)
      .toBeCloseTo(Math.hypot(300 - 100, 400 - -200), 6);

    const cleared = plan(parented).find((clip) => clip.id === child.id)!;
    expect(cleared.parentClipId).toBeUndefined();
    expect(cleared.transform.position.x).toBeCloseTo(child.transform.position.x, 12);
    expect(cleared.transform.position.y).toBeCloseTo(child.transform.position.y, 12);
    expect(cleared.transform.rotation.z).toBeCloseTo(10, 12);
  });

  describe('through the live timeline store', () => {
    const initialMediaState = useMediaStore.getState();

    beforeEach(() => {
      vi.mocked(useMediaStore.getState).mockReturnValue({
        ...initialMediaState,
        activeCompositionId: 'comp-portrait',
        compositions: [{ id: 'comp-portrait', ...PORTRAIT } as never],
      } as never);
      const { parent, child } = createParentAndChild();
      useTimelineStore.setState({
        clips: [parent, child],
        tracks: [],
        clipKeyframes: new Map(),
        playheadPosition: 1,
      } as never);
    });

    afterEach(() => {
      vi.mocked(useMediaStore.getState).mockReturnValue(initialMediaState);
    });

    it('renders the parented child where it was and restores it on clear', () => {
      const original = structuredClone(
        useTimelineStore.getState().clips.find((clip) => clip.id === 'rig-shape')!.transform,
      );
      useTimelineStore.getState().setClipParent('rig-shape', 'rig-null');
      const parented = useTimelineStore.getState().clips.find((clip) => clip.id === 'rig-shape')!;
      expect(parented.parentClipId).toBe('rig-null');
      const rendered = useTimelineStore.getState().getInterpolatedTransform('rig-shape', 1);
      expectPx(toPixels(rendered.position), { x: 300, y: 400 });
      expect(rendered.rotation.z).toBeCloseTo(10, 9);

      useTimelineStore.getState().setClipParent('rig-shape', null);
      const cleared = useTimelineStore.getState().clips.find((clip) => clip.id === 'rig-shape')!;
      expect(cleared.parentClipId).toBeUndefined();
      expect(cleared.transform.position.x).toBeCloseTo(original.position.x, 12);
      expect(cleared.transform.position.y).toBeCloseTo(original.position.y, 12);
    });

    it('turns the group rigidly when the parent rotates', () => {
      useTimelineStore.getState().setClipParent('rig-shape', 'rig-null');
      const parentBefore = useTimelineStore.getState().clips.find((clip) => clip.id === 'rig-null')!;
      useTimelineStore.setState({
        clips: useTimelineStore.getState().clips.map((clip) => clip.id === 'rig-null'
          ? { ...clip, transform: { ...clip.transform, rotation: { x: 0, y: 0, z: ROTATION + 40 } } }
          : clip),
      } as never);
      const rendered = toPixels(useTimelineStore.getState().getInterpolatedTransform('rig-shape', 1).position);
      const parentPx = toPixels(parentBefore.transform.position);
      const before = { x: 300 - parentPx.x, y: 400 - parentPx.y };
      expectPx(
        { x: rendered.x - parentPx.x, y: rendered.y - parentPx.y },
        turnOnScreen(before, 40),
      );
    });
  });
});
