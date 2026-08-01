import { describe, expect, it } from 'vitest';

import {
  MOTION_PARENT_ERROR_CODES,
  type MotionParentGraphEvaluation,
  type MotionParentGraphNode,
  type MotionParentTransform2D,
} from '../../src/services/motionDesign/structure/contracts';
import {
  MOTION_NULL_VIEWPORT_CONTROLLER_VERSION,
  MOTION_NULL_VIEWPORT_DIAGNOSTIC_CODES,
  buildMotionNullViewportController,
  planMotionNullViewportDrag,
  type MotionNullViewportClipDescriptor,
  type MotionNullViewportControllerInput,
  type MotionNullViewportMappingInput,
} from '../../src/services/motionDesign/structure/nullViewportController';
import { createMotionParentGraphSnapshot } from '../../src/services/motionDesign/structure/parentGraphPlanner';

const mapping: MotionNullViewportMappingInput = {
  compositionSize: { width: 1920, height: 1080 },
  screenRect: { x: 100, y: 50, width: 960, height: 540 },
};

function transform(overrides: Partial<{
  x: number;
  y: number;
  scaleAll: number;
  scaleX: number;
  scaleY: number;
  rotationZ: number;
  opacity: number;
}> = {}): MotionParentTransform2D {
  return {
    position: { x: overrides.x ?? 0, y: overrides.y ?? 0 },
    scale: {
      all: overrides.scaleAll ?? 1,
      x: overrides.scaleX ?? 1,
      y: overrides.scaleY ?? 1,
    },
    rotationZ: overrides.rotationZ ?? 0,
    opacity: overrides.opacity ?? 1,
  };
}

function evaluation(
  timelineTime: number,
  values: Readonly<Record<string, MotionParentTransform2D>>,
): MotionParentGraphEvaluation {
  return {
    timelineTime,
    localTransforms: Object.entries(values)
      .map(([clipId, value]) => ({ clipId, transform: value }))
      .sort((left, right) => left.clipId.localeCompare(right.clipId)),
  };
}

function descriptors(
  overrides: Partial<MotionNullViewportClipDescriptor> = {},
): MotionNullViewportClipDescriptor[] {
  return [{
    clipId: 'null',
    name: 'Rig Control',
    sourceType: 'motion-null',
    locked: false,
    hidden: false,
    ...overrides,
  }];
}

function controllerInput(options: {
  timelineTime?: number;
  evaluationTime?: number;
  parent?: MotionParentTransform2D;
  local?: MotionParentTransform2D;
  clips?: MotionNullViewportClipDescriptor[];
  nodes?: readonly MotionParentGraphNode[];
  selectedClipId?: string | null;
  mapping?: MotionNullViewportMappingInput;
} = {}): MotionNullViewportControllerInput {
  const timelineTime = options.timelineTime ?? 3;
  const nodes = options.nodes ?? [
    { clipId: 'null', compositionId: 'comp', space: '2d', parentClipId: 'parent' },
    { clipId: 'parent', compositionId: 'comp', space: '2d' },
  ];
  const local = options.local ?? transform({
    x: 0.2,
    y: 0.1,
    scaleAll: 0.5,
    scaleX: 0.75,
    scaleY: 1.5,
    rotationZ: 15,
    opacity: 0.8,
  });
  const parent = options.parent ?? transform({
    x: 0.1,
    y: -0.2,
    scaleAll: 2,
    scaleX: 3,
    scaleY: 0.5,
    rotationZ: 90,
    opacity: 0.5,
  });
  const values: Record<string, MotionParentTransform2D> = {};
  for (const node of nodes) {
    values[node.clipId] = node.clipId === 'null' ? local : parent;
  }
  return {
    selectedClipId: options.selectedClipId === undefined ? 'null' : options.selectedClipId,
    clips: options.clips ?? descriptors(),
    graph: createMotionParentGraphSnapshot(nodes),
    evaluation: evaluation(options.evaluationTime ?? timelineTime, values),
    timelineTime,
    mapping: options.mapping ?? mapping,
  };
}

describe('MD6 Motion Null viewport controller', () => {
  it('resolves exact-frame local/world transforms and canvas-ready handle geometry', () => {
    const result = buildMotionNullViewportController(controllerInput());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.controller.version).toBe(MOTION_NULL_VIEWPORT_CONTROLLER_VERSION);
    expect(result.controller.timelineTime).toBe(3);
    expect(result.controller.localTransform.position).toEqual({ x: 0.2, y: 0.1 });
    expect(result.controller.worldTransform.position.x).toBeCloseTo(0);
    expect(result.controller.worldTransform.position.y).toBeCloseTo(0);
    expect(result.controller.worldTransform.scale).toEqual({ all: 1, x: 2.25, y: 0.75 });
    expect(result.controller.worldTransform.rotationZ).toBe(105);
    expect(result.controller.worldTransform.opacity).toBeCloseTo(0.4);
    expect(result.controller.position).toMatchObject({
      composition: { x: 960, y: 540 },
      screen: { x: 580, y: 320 },
      insideComposition: true,
    });
    expect(result.controller.handle.geometry.center).toEqual({ x: 580, y: 320 });
    expect(result.controller.handle.geometry.rotationDegrees).toBe(105);
    expect(result.controller.handle.geometry.xAxis.from.x)
      .not.toBe(result.controller.handle.geometry.xAxis.to.x);
    expect(result.controller.handle).toMatchObject({
      render: true,
      interactive: true,
      visual: 'motion-null-crosshair',
      hitRadiusScreenPixels: 12,
    });
  });

  it('keeps accessibility and gesture descriptors stable and serializable', () => {
    const first = buildMotionNullViewportController(controllerInput());
    const second = buildMotionNullViewportController(controllerInput());

    expect(first).toEqual(second);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.controller.accessibility).toEqual({
      id: 'motion-null-viewport-null',
      role: 'button',
      tabIndex: 0,
      label: 'Move Rig Control',
      description: 'Drag to move in two dimensions. Use the arrow keys to nudge.',
      disabled: false,
    });
    expect(first.controller.gesture).toEqual({
      pointer: {
        action: 'translate-2d',
        button: 0,
        cursor: 'move',
        pointerCapture: true,
        axisConstraintModifier: 'Shift',
      },
      keyboard: {
        keys: ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'],
        defaultStepScreenPixels: 10,
        fineStepScreenPixels: 1,
        coarseStepScreenPixels: 50,
        fineModifier: 'ControlOrMeta',
        coarseModifier: 'Alt',
      },
    });
    expect(structuredClone(first)).toEqual(first);
    expect(JSON.parse(JSON.stringify(first))).toEqual(first);
  });

  it('uses only the supplied exact frame snapshot and rejects a stale time', () => {
    const atTwo = buildMotionNullViewportController(controllerInput({
      timelineTime: 2,
      parent: transform({ x: 0.2 }),
    }));
    const atEight = buildMotionNullViewportController(controllerInput({
      timelineTime: 8,
      parent: transform({ x: 0.8 }),
    }));
    const stale = buildMotionNullViewportController(controllerInput({
      timelineTime: 8,
      evaluationTime: 2,
    }));

    expect(atTwo.ok && atTwo.controller.worldTransform.position.x).toBeCloseTo(0.4);
    expect(atEight.ok && atEight.controller.worldTransform.position.x).toBeCloseTo(1);
    expect(stale.ok).toBe(false);
    expect(stale.diagnostics[0]?.code)
      .toBe(MOTION_NULL_VIEWPORT_DIAGNOSTIC_CODES.FRAME_TIME_MISMATCH);
    expect('controller' in stale && stale.controller).toBeNull();
  });

  it('maps a drag through composition/world space back into rotated parent-local space', () => {
    const built = buildMotionNullViewportController(controllerInput());
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    const drag = planMotionNullViewportDrag({
      controller: built.controller,
      screenDelta: { x: 96, y: 54 },
    });

    expect(drag.ok).toBe(true);
    if (!drag.ok) return;
    expect(drag.intent.timelineTime).toBe(3);
    expect(drag.intent.delta.screen).toEqual({ x: 96, y: 54 });
    expect(drag.intent.delta.composition).toEqual({ x: 192, y: 108 });
    expect(drag.intent.delta.world.x).toBeCloseTo(0.2);
    expect(drag.intent.delta.world.y).toBeCloseTo(0.2);
    expect(drag.intent.delta.local.x).toBeCloseTo(0.2);
    expect(drag.intent.delta.local.y).toBeCloseTo(-0.2);
    expect(drag.intent.to.local.x).toBeCloseTo(0.4);
    expect(drag.intent.to.local.y).toBeCloseTo(-0.1);
    expect(drag.intent.to.world).toEqual({ x: 0.2, y: 0.2 });
    expect(drag.intent.propertyValues[0]).toMatchObject({
      property: 'position.x',
      fromValue: 0.2,
      toValue: 0.4,
    });
    expect(drag.intent.localTransformPatch.position.y).toBeCloseTo(-0.1);
    expect(drag.intent.previewWorldTransform.scale).toEqual({ all: 1, x: 2.25, y: 0.75 });
    expect(drag.intent.history).toEqual({
      mode: 'single-entry',
      label: 'Move Motion Null',
      atomic: true,
    });
  });

  it('supports deterministic axis constraints without changing the other axis', () => {
    const built = buildMotionNullViewportController(controllerInput({
      nodes: [{ clipId: 'null', compositionId: 'comp', space: '2d' }],
      local: transform({ x: -0.25, y: 0.25 }),
    }));
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    const drag = planMotionNullViewportDrag({
      controller: built.controller,
      screenDelta: { x: 120, y: 90 },
      axis: 'x',
    });

    expect(drag.ok).toBe(true);
    if (!drag.ok) return;
    expect(drag.intent.delta.screen).toEqual({ x: 120, y: 0 });
    expect(drag.intent.to.local.y).toBe(0.25);
    expect(drag.intent.to.screen.y).toBe(built.controller.position.screen.y);
  });

  it('returns locked/hidden state diagnostics and emits no drag intent', () => {
    const locked = buildMotionNullViewportController(controllerInput({
      clips: descriptors({ locked: true }),
    }));
    const hidden = buildMotionNullViewportController(controllerInput({
      clips: descriptors({ hidden: true }),
    }));

    expect(locked.ok).toBe(true);
    expect(hidden.ok).toBe(true);
    if (!locked.ok || !hidden.ok) return;
    expect(locked.controller.handle).toMatchObject({ render: true, interactive: false });
    expect(locked.controller.accessibility).toMatchObject({ tabIndex: -1, disabled: true });
    expect(locked.diagnostics[0]?.code).toBe(MOTION_NULL_VIEWPORT_DIAGNOSTIC_CODES.LOCKED);
    expect(hidden.controller.handle).toMatchObject({ render: false, interactive: false });
    expect(hidden.diagnostics[0]?.code).toBe(MOTION_NULL_VIEWPORT_DIAGNOSTIC_CODES.HIDDEN);

    const lockedDrag = planMotionNullViewportDrag({
      controller: locked.controller,
      screenDelta: { x: 1, y: 1 },
    });
    const hiddenDrag = planMotionNullViewportDrag({
      controller: hidden.controller,
      screenDelta: { x: 1, y: 1 },
    });
    expect(lockedDrag.ok).toBe(false);
    expect(lockedDrag.diagnostics[0]?.code).toBe(MOTION_NULL_VIEWPORT_DIAGNOSTIC_CODES.LOCKED);
    expect(hiddenDrag.ok).toBe(false);
    expect(hiddenDrag.diagnostics[0]?.code).toBe(MOTION_NULL_VIEWPORT_DIAGNOSTIC_CODES.HIDDEN);
    expect(lockedDrag.intent).toBeNull();
    expect(hiddenDrag.intent).toBeNull();
  });

  it('fails closed when a parent transform is singular during world-to-local drag inversion', () => {
    const built = buildMotionNullViewportController(controllerInput({
      parent: transform({ scaleX: 0, rotationZ: 30 }),
    }));
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    const drag = planMotionNullViewportDrag({
      controller: built.controller,
      screenDelta: { x: 10, y: 5 },
    });

    expect(drag.ok).toBe(false);
    expect(drag.intent).toBeNull();
    expect(drag.diagnostics[0]?.code).toBe(MOTION_PARENT_ERROR_CODES.NON_INVERTIBLE_TRANSFORM);
  });

  it.each([
    {
      name: 'missing parent',
      nodes: [
        { clipId: 'null', compositionId: 'comp', space: '2d', parentClipId: 'missing' },
      ] satisfies MotionParentGraphNode[],
      code: MOTION_PARENT_ERROR_CODES.PARENT_MISSING,
    },
    {
      name: 'cycle',
      nodes: [
        { clipId: 'null', compositionId: 'comp', space: '2d', parentClipId: 'parent' },
        { clipId: 'parent', compositionId: 'comp', space: '2d', parentClipId: 'null' },
      ] satisfies MotionParentGraphNode[],
      code: MOTION_PARENT_ERROR_CODES.CYCLE,
    },
    {
      name: '3D Null',
      nodes: [
        { clipId: 'null', compositionId: 'comp', space: '3d' },
      ] satisfies MotionParentGraphNode[],
      code: MOTION_NULL_VIEWPORT_DIAGNOSTIC_CODES.THREE_D_UNSUPPORTED,
    },
  ])('returns a stable diagnostic and no controller for $name', ({ nodes, code }) => {
    const result = buildMotionNullViewportController(controllerInput({ nodes }));

    expect(result.ok).toBe(false);
    expect(result.controller).toBeNull();
    expect(result.diagnostics.map((item) => item.code)).toContain(code);
  });

  it('fails closed for missing/wrong selections, invalid mappings, and non-finite drags', () => {
    const noSelection = buildMotionNullViewportController(controllerInput({ selectedClipId: null }));
    const missing = buildMotionNullViewportController(controllerInput({ selectedClipId: 'absent' }));
    const wrongType = buildMotionNullViewportController(controllerInput({
      clips: descriptors({ sourceType: 'motion-shape' }),
    }));
    const invalidMapping = buildMotionNullViewportController(controllerInput({
      mapping: {
        ...mapping,
        screenRect: { ...mapping.screenRect, width: 0 },
      },
    }));

    expect(noSelection.diagnostics[0]?.code).toBe(MOTION_NULL_VIEWPORT_DIAGNOSTIC_CODES.NO_SELECTION);
    expect(missing.diagnostics[0]?.code).toBe(MOTION_NULL_VIEWPORT_DIAGNOSTIC_CODES.CLIP_MISSING);
    expect(wrongType.diagnostics[0]?.code).toBe(MOTION_NULL_VIEWPORT_DIAGNOSTIC_CODES.NOT_MOTION_NULL);
    expect(invalidMapping.diagnostics[0]?.code).toBe(MOTION_NULL_VIEWPORT_DIAGNOSTIC_CODES.MAPPING_INVALID);

    const built = buildMotionNullViewportController(controllerInput());
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const invalidDrag = planMotionNullViewportDrag({
      controller: built.controller,
      screenDelta: { x: Number.NaN, y: 1 },
    });
    expect(invalidDrag.ok).toBe(false);
    expect(invalidDrag.intent).toBeNull();
    expect(invalidDrag.diagnostics[0]?.code)
      .toBe(MOTION_NULL_VIEWPORT_DIAGNOSTIC_CODES.DRAG_DELTA_INVALID);
  });
});
