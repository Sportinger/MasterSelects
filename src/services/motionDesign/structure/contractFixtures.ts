import type {
  MotionParentGraphEvaluation,
  MotionParentGraphNode,
  MotionParentTransform2D,
} from './contracts';
import { createMotionParentGraphSnapshot } from './parentGraphPlanner';

export const MD6_CONTRACT_FIXTURE_IDS = {
  composition: 'md6-comp-a',
  otherComposition: 'md6-comp-b',
  parentA: 'md6-parent-a',
  parentB: 'md6-parent-b',
  child: 'md6-child',
  grandchild: 'md6-grandchild',
  threeD: 'md6-3d',
} as const;

export function createMotionParentContractTransform(
  overrides: Partial<{
    x: number;
    y: number;
    scaleAll: number;
    scaleX: number;
    scaleY: number;
    rotationZ: number;
    opacity: number;
  }> = {},
): MotionParentTransform2D {
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

export function createMotionParentContractGraphFixture(options: {
  readonly childParentId?: string;
  readonly includeGrandchild?: boolean;
  readonly includeThreeD?: boolean;
} = {}) {
  const ids = MD6_CONTRACT_FIXTURE_IDS;
  const nodes: MotionParentGraphNode[] = [
    { clipId: ids.parentA, compositionId: ids.composition, space: '2d' },
    { clipId: ids.parentB, compositionId: ids.composition, space: '2d' },
    {
      clipId: ids.child,
      compositionId: ids.composition,
      space: '2d',
      ...(options.childParentId ? { parentClipId: options.childParentId } : {}),
    },
  ];
  if (options.includeGrandchild) {
    nodes.push({
      clipId: ids.grandchild,
      compositionId: ids.composition,
      space: '2d',
      parentClipId: ids.child,
    });
  }
  if (options.includeThreeD) {
    nodes.push({ clipId: ids.threeD, compositionId: ids.composition, space: '3d' });
  }
  return createMotionParentGraphSnapshot(nodes);
}

/** Deterministic animation fixture sampled only from the supplied time. */
export function createMotionParentContractEvaluationFixture(
  timelineTime: number,
  options: { readonly includeGrandchild?: boolean; readonly includeThreeD?: boolean } = {},
): MotionParentGraphEvaluation {
  const ids = MD6_CONTRACT_FIXTURE_IDS;
  const localTransforms = [
    {
      clipId: ids.parentA,
      transform: createMotionParentContractTransform({
        x: 20 + timelineTime * 5,
        y: -10 + timelineTime * 2,
        rotationZ: timelineTime * 12,
        scaleAll: 1 + timelineTime * 0.02,
        opacity: 0.8,
      }),
    },
    {
      clipId: ids.parentB,
      transform: createMotionParentContractTransform({
        x: -50 + timelineTime,
        y: 30,
        rotationZ: -20 + timelineTime * 3,
        scaleX: 1.5,
        scaleY: 0.75,
        opacity: 0.9,
      }),
    },
    {
      clipId: ids.child,
      transform: createMotionParentContractTransform({
        x: 12,
        y: 18,
        scaleX: 0.7,
        scaleY: 1.2,
        rotationZ: 14,
        opacity: 0.75,
      }),
    },
    ...(options.includeGrandchild
      ? [{
          clipId: ids.grandchild,
          transform: createMotionParentContractTransform({ x: 4, y: 6, rotationZ: 5 }),
        }]
      : []),
    ...(options.includeThreeD
      ? [{
          clipId: ids.threeD,
          transform: createMotionParentContractTransform(),
        }]
      : []),
  ].sort((left, right) => left.clipId < right.clipId ? -1 : left.clipId > right.clipId ? 1 : 0);
  return {
    timelineTime,
    localTransforms,
  };
}
