import type { AnimatableProperty } from '../../../types/animationProperties';
import type { Keyframe } from '../../../types/keyframes';
import type { ClipTransform } from '../../../types/timelineCore';
import type { TimelineClip } from '../../../types/timeline';
import { getInterpolatedClipTransform } from '../../../utils/keyframeInterpolation';
import {
  MOTION_STRUCTURE_LEAF_CONTRACT_VERSION,
  type MotionStructureLeafOperationPlan,
  type MotionStructureLeafPlanResult,
} from '../structure/leafContracts';
import {
  planMotionClearParent,
  planMotionCreateNull,
  planMotionCreateNullAndParentSelected,
  planMotionSetParent,
} from '../structure/leafOperationPlanner';
import {
  createMotionParentGraphSnapshot,
  evaluateMotionParentGraphWorldTransforms,
  validateMotionParentGraph,
} from '../structure/parentGraphPlanner';
import {
  MOTION_PARENT_DIAGNOSTIC_CODES,
  MOTION_PARENT_WORLD_PRESERVATION,
  type MotionParentGraphEvaluation,
  type MotionParentTransform2D,
} from '../structure/contracts';

const TWO_D_TRANSFORM_PROPERTIES = [
  'position.x',
  'position.y',
  'scale.all',
  'scale.x',
  'scale.y',
  'rotation.z',
  'opacity',
] as const satisfies readonly AnimatableProperty[];

export interface TimelineMotionParentPlanningInput {
  readonly compositionId: string;
  readonly clips: readonly TimelineClip[];
  readonly clipKeyframes: ReadonlyMap<string, readonly Keyframe[]>;
  readonly timelineTime: number;
  readonly childClipId: string;
  readonly parentClipId?: string;
}

export interface TimelineMotionStructureApplyInput {
  readonly compositionId: string;
  readonly clips: readonly TimelineClip[];
  readonly clipKeyframes: ReadonlyMap<string, readonly Keyframe[]>;
  readonly plan: MotionStructureLeafOperationPlan;
}

export interface TimelineMotionCreateNullPlanningInput {
  readonly compositionId: string;
  readonly clips: readonly TimelineClip[];
  readonly clipKeyframes: ReadonlyMap<string, readonly Keyframe[]>;
  readonly timelineTime: number;
  readonly nullClip: TimelineClip;
}

export interface TimelineMotionCreateNullAndParentPlanningInput
  extends TimelineMotionCreateNullPlanningInput {
  readonly selectedClipIds: readonly string[];
}

export interface TimelineMotionCreateNullApplyInput extends TimelineMotionCreateNullPlanningInput {
  readonly plan: MotionStructureLeafOperationPlan;
}

export interface TimelineMotionCreateNullAndParentApplyInput
  extends TimelineMotionCreateNullAndParentPlanningInput {
  readonly plan: MotionStructureLeafOperationPlan;
}

export type TimelineMotionStructureApplyResult =
  | {
      readonly ok: true;
      readonly clips: TimelineClip[];
      readonly clipKeyframes: Map<string, Keyframe[]>;
    }
  | {
      readonly ok: false;
      readonly message: string;
    };

export interface TimelineMotionWorldTransformApplyInput {
  readonly clip: TimelineClip;
  readonly keyframes: readonly Keyframe[];
  readonly timelineTime: number;
  readonly worldTransform: MotionParentTransform2D;
}

export interface TimelineMotionWorldTransformApplyResult {
  readonly clip: TimelineClip;
  readonly keyframes: Keyframe[];
}

export function toMotionParentTransform2D(transform: ClipTransform): MotionParentTransform2D {
  return {
    position: { x: transform.position.x, y: transform.position.y },
    scale: {
      all: transform.scale.all ?? 1,
      x: transform.scale.x,
      y: transform.scale.y,
    },
    rotationZ: transform.rotation.z,
    opacity: transform.opacity,
  };
}

export function applyMotionParentTransformToClipTransform(
  transform: ClipTransform,
  value: MotionParentTransform2D,
): ClipTransform {
  return {
    ...transform,
    opacity: value.opacity,
    position: { ...transform.position, x: value.position.x, y: value.position.y },
    scale: {
      ...transform.scale,
      all: value.scale.all,
      x: value.scale.x,
      y: value.scale.y,
    },
    rotation: { ...transform.rotation, z: value.rotationZ },
  };
}

function createGraph(compositionId: string, clips: readonly TimelineClip[]) {
  return createMotionParentGraphSnapshot(clips.map((clip) => ({
    clipId: clip.id,
    compositionId,
    space: clip.is3D ? '3d' as const : '2d' as const,
    ...(clip.parentClipId ? { parentClipId: clip.parentClipId } : {}),
  })));
}

export function getTimelineMotionStructureGraphRevision(
  compositionId: string,
  clips: readonly TimelineClip[],
): string {
  return createGraph(compositionId, clips).revision;
}

export function getTimelineMotionLocalTransformAtTime(
  clip: TimelineClip,
  keyframes: readonly Keyframe[],
  timelineTime: number,
): ClipTransform {
  return getInterpolatedClipTransform(
    [...keyframes],
    timelineTime - clip.startTime,
    clip.transform,
    { rotationMode: clip.source?.type === 'camera' ? 'shortest' : 'linear' },
  );
}

export function createTimelineMotionParentEvaluation(
  clips: readonly TimelineClip[],
  clipKeyframes: ReadonlyMap<string, readonly Keyframe[]>,
  timelineTime: number,
): MotionParentGraphEvaluation {
  return {
    timelineTime,
    localTransforms: clips
      .map((clip) => ({
        clipId: clip.id,
        transform: toMotionParentTransform2D(getTimelineMotionLocalTransformAtTime(
          clip,
          clipKeyframes.get(clip.id) ?? [],
          timelineTime,
        )),
      }))
      .toSorted((left, right) => (
        left.clipId < right.clipId ? -1 : left.clipId > right.clipId ? 1 : 0
      )),
  };
}

export function planTimelineMotionParentMutation(
  input: TimelineMotionParentPlanningInput,
): MotionStructureLeafPlanResult {
  const graph = createGraph(input.compositionId, input.clips);
  const evaluation = createTimelineMotionParentEvaluation(
    input.clips,
    input.clipKeyframes,
    input.timelineTime,
  );
  if (!input.parentClipId) {
    const child = input.clips.find((clip) => clip.id === input.childClipId);
    const clipIds = new Set(input.clips.map((clip) => clip.id));
    if (child?.parentClipId && !clipIds.has(child.parentClipId)) {
      const nextGraph = createMotionParentGraphSnapshot(graph.nodes.map((node) => (
        node.clipId === child.id
          ? {
              clipId: node.clipId,
              compositionId: node.compositionId,
              space: node.space,
            }
          : node
      )));
      if (validateMotionParentGraph(nextGraph).length === 0) {
        const evaluated = evaluateMotionParentGraphWorldTransforms(nextGraph, evaluation);
        const local = evaluation.localTransforms.find((entry) => entry.clipId === child.id)?.transform;
        const world = evaluated.worlds?.get(child.id);
        if (local && world) {
          const fromParentClipId = child.parentClipId;
          const diagnostic = {
            code: MOTION_PARENT_DIAGNOSTIC_CODES.EXTERNAL_EDGE_CLEARED,
            message: 'Cleared a dangling parent relationship whose parent is no longer present.',
            clipIds: [child.id, fromParentClipId],
          } as const;
          return {
            ok: true,
            failures: [],
            diagnostics: [diagnostic],
            plan: {
              contractVersion: MOTION_STRUCTURE_LEAF_CONTRACT_VERSION,
              kind: 'clear-parent',
              timelineTime: input.timelineTime,
              preservation: MOTION_PARENT_WORLD_PRESERVATION,
              affectedClipIds: [child.id],
              preservedWorldTransformsAtOperationTime: [{
                clipId: child.id,
                transform: structuredClone(world),
              }],
              apply: {
                expectedRevision: graph.revision,
                nextRevision: nextGraph.revision,
                graph: nextGraph,
                executionOrder: ['relationship-changes'],
                nullChanges: [],
                relationshipChanges: [{
                  clipId: child.id,
                  fromParentClipId,
                  fromLocalTransform: structuredClone(local),
                  toLocalTransform: structuredClone(world),
                }],
              },
              undo: {
                expectedRevision: nextGraph.revision,
                nextRevision: graph.revision,
                graph,
                executionOrder: ['relationship-changes'],
                nullChanges: [],
                relationshipChanges: [{
                  clipId: child.id,
                  toParentClipId: fromParentClipId,
                  fromLocalTransform: structuredClone(world),
                  toLocalTransform: structuredClone(local),
                }],
              },
              diagnostics: [diagnostic],
              history: {
                mode: 'single-entry',
                label: 'Clear Parent',
                atomic: true,
              },
            },
          };
        }
      }
    }
  }
  return input.parentClipId
    ? planMotionSetParent({
        graph,
        evaluation,
        childClipId: input.childClipId,
        parentClipId: input.parentClipId,
      })
    : planMotionClearParent({ graph, evaluation, childClipId: input.childClipId });
}

export function planTimelineMotionCreateNullAndParentSelected(
  input: TimelineMotionCreateNullAndParentPlanningInput,
): MotionStructureLeafPlanResult {
  const graph = createGraph(input.compositionId, input.clips);
  const evaluation = createTimelineMotionParentEvaluation(
    input.clips,
    input.clipKeyframes,
    input.timelineTime,
  );
  return planMotionCreateNullAndParentSelected({
    graph,
    evaluation,
    nullEntity: {
      kind: 'null',
      clipId: input.nullClip.id,
      compositionId: input.compositionId,
      space: '2d',
      localTransform: toMotionParentTransform2D(input.nullClip.transform),
    },
    selectedClipIds: [...input.selectedClipIds],
  });
}

export function planTimelineMotionCreateNull(
  input: TimelineMotionCreateNullPlanningInput,
): MotionStructureLeafPlanResult {
  return planMotionCreateNull({
    graph: createGraph(input.compositionId, input.clips),
    timelineTime: input.timelineTime,
    nullEntity: {
      kind: 'null',
      clipId: input.nullClip.id,
      compositionId: input.compositionId,
      space: '2d',
      localTransform: toMotionParentTransform2D(input.nullClip.transform),
    },
  });
}

function transformValue(
  transform: MotionParentTransform2D,
  property: typeof TWO_D_TRANSFORM_PROPERTIES[number],
): number {
  switch (property) {
    case 'position.x': return transform.position.x;
    case 'position.y': return transform.position.y;
    case 'scale.all': return transform.scale.all;
    case 'scale.x': return transform.scale.x;
    case 'scale.y': return transform.scale.y;
    case 'rotation.z': return transform.rotationZ;
    case 'opacity': return transform.opacity;
  }
}

function stableKeyframeId(
  clipId: string,
  property: AnimatableProperty,
  time: number,
  occupiedIds: ReadonlySet<string>,
): string {
  const canonicalTime = Object.is(time, -0) ? '0' : String(time);
  const base = `motion-parent:${clipId}:${property}:${canonicalTime}`;
  if (!occupiedIds.has(base)) return base;
  let suffix = 2;
  while (occupiedIds.has(`${base}:${suffix}`)) suffix += 1;
  return `${base}:${suffix}`;
}

function getNearestKeyframeAtTime(
  keyframes: readonly Keyframe[],
  property: AnimatableProperty,
  time: number,
  tolerance = 0.01,
): Keyframe | undefined {
  return keyframes
    .filter((keyframe) => keyframe.property === property && Math.abs(keyframe.time - time) < tolerance)
    .toSorted((left, right) => {
      const distance = Math.abs(left.time - time) - Math.abs(right.time - time);
      if (distance !== 0) return distance;
      if (left.time !== right.time) return left.time - right.time;
      return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
    })[0];
}

function writeAnimatedLocalTransform(
  keyframes: readonly Keyframe[],
  clip: TimelineClip,
  timelineTime: number,
  transform: MotionParentTransform2D,
): Keyframe[] {
  const clipLocalTime = Math.max(0, Math.min(timelineTime - clip.startTime, clip.duration));
  const occupiedIds = new Set(keyframes.map((keyframe) => keyframe.id));
  let next = keyframes.map((keyframe) => structuredClone(keyframe));
  for (const property of TWO_D_TRANSFORM_PROPERTIES) {
    const existing = getNearestKeyframeAtTime(next, property, clipLocalTime);
    if (existing) {
      next = next.map((keyframe) => keyframe.id === existing.id
        ? {
            ...keyframe,
            time: clipLocalTime,
            value: transformValue(transform, property),
          }
        : keyframe);
      continue;
    }
    const id = stableKeyframeId(clip.id, property, clipLocalTime, occupiedIds);
    occupiedIds.add(id);
    next.push({
      id,
      clipId: clip.id,
      property,
      time: clipLocalTime,
      value: transformValue(transform, property),
      easing: 'linear',
    });
  }
  return next.toSorted((left, right) => (
    left.time - right.time || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
  ));
}

function hasAnimated2DTransform(keyframes: readonly Keyframe[]): boolean {
  const properties = new Set<AnimatableProperty>(TWO_D_TRANSFORM_PROPERTIES);
  return keyframes.some((keyframe) => properties.has(keyframe.property));
}

/**
 * Writes an already-evaluated world transform as the new root-local value.
 * Animated clips receive one complete tuple at the explicit operation time;
 * static clips keep their keyframe-free representation.
 */
export function applyTimelineMotionWorldTransformAtTime(
  input: TimelineMotionWorldTransformApplyInput,
): TimelineMotionWorldTransformApplyResult {
  const animated = hasAnimated2DTransform(input.keyframes);
  return {
    clip: {
      ...input.clip,
      parentClipId: undefined,
      transform: animated
        ? structuredClone(input.clip.transform)
        : applyMotionParentTransformToClipTransform(input.clip.transform, input.worldTransform),
    },
    keyframes: animated
      ? writeAnimatedLocalTransform(
          input.keyframes,
          input.clip,
          input.timelineTime,
          input.worldTransform,
        )
      : input.keyframes.map((keyframe) => structuredClone(keyframe)),
  };
}

function stablePlanValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'number') {
    if (Object.is(value, -0)) return 'number:0';
    return `number:${String(value)}`;
  }
  if (typeof value === 'string') return `string:${JSON.stringify(value)}`;
  if (typeof value === 'boolean') return `boolean:${String(value)}`;
  if (Array.isArray(value)) return `[${value.map(stablePlanValue).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
      .map((key) => `${JSON.stringify(key)}:${stablePlanValue(record[key])}`)
      .join(',')}}`;
  }
  return `${typeof value}:${String(value)}`;
}

export function applyTimelineMotionStructurePlan(
  input: TimelineMotionStructureApplyInput,
): TimelineMotionStructureApplyResult {
  if (input.plan.kind !== 'set-parent' && input.plan.kind !== 'clear-parent') {
    return { ok: false, message: 'Timeline parent adapter accepts only set-parent or clear-parent plans' };
  }
  if (input.plan.apply.nullChanges.length > 0 || input.plan.apply.relationshipChanges.length !== 1) {
    return { ok: false, message: 'Timeline parent plan has an unsupported mutation shape' };
  }
  const currentGraph = createGraph(input.compositionId, input.clips);
  if (currentGraph.revision !== input.plan.apply.expectedRevision) {
    return { ok: false, message: 'Timeline parent plan revision is stale' };
  }
  const change = input.plan.apply.relationshipChanges[0];
  const target = input.clips.find((clip) => clip.id === change.clipId);
  if (!target) return { ok: false, message: 'Timeline parent target clip is missing' };

  const replanned = planTimelineMotionParentMutation({
    compositionId: input.compositionId,
    clips: input.clips,
    clipKeyframes: input.clipKeyframes,
    timelineTime: input.plan.timelineTime,
    childClipId: change.clipId,
    ...(change.toParentClipId ? { parentClipId: change.toParentClipId } : {}),
  });
  if (!replanned.ok || stablePlanValue(replanned.plan) !== stablePlanValue(input.plan)) {
    return { ok: false, message: 'Timeline parent plan transform state is stale' };
  }

  const currentKeyframes = input.clipKeyframes.get(target.id) ?? [];
  const nextKeyframes = new Map<string, Keyframe[]>();
  for (const [clipId, keyframes] of input.clipKeyframes) {
    nextKeyframes.set(clipId, keyframes.map((keyframe) => structuredClone(keyframe)));
  }
  const animated = hasAnimated2DTransform(currentKeyframes);
  if (animated) {
    nextKeyframes.set(
      target.id,
      writeAnimatedLocalTransform(currentKeyframes, target, input.plan.timelineTime, change.toLocalTransform),
    );
  }
  const clips = input.clips.map((clip) => clip.id === target.id
    ? {
        ...clip,
        parentClipId: change.toParentClipId,
        transform: animated
          ? structuredClone(clip.transform)
          : applyMotionParentTransformToClipTransform(clip.transform, change.toLocalTransform),
      }
    : clip);
  const nextGraph = createGraph(input.compositionId, clips);
  if (nextGraph.revision !== input.plan.apply.nextRevision) {
    return { ok: false, message: 'Timeline parent application did not reach the planned revision' };
  }
  return { ok: true, clips, clipKeyframes: nextKeyframes };
}

export function applyTimelineMotionCreateNullAndParentSelectedPlan(
  input: TimelineMotionCreateNullAndParentApplyInput,
): TimelineMotionStructureApplyResult {
  if (input.plan.kind !== 'create-null-and-parent-selected') {
    return { ok: false, message: 'Timeline null adapter requires a create-null-and-parent-selected plan' };
  }
  const createChanges = input.plan.apply.nullChanges.filter((change) => change.action === 'create');
  if (
    createChanges.length !== 1
    || input.plan.apply.nullChanges.length !== 1
    || input.plan.apply.relationshipChanges.length === 0
    || createChanges[0].entity.clipId !== input.nullClip.id
  ) {
    return { ok: false, message: 'Timeline null plan has an unsupported mutation shape' };
  }
  if (input.clips.some((clip) => clip.id === input.nullClip.id)) {
    return { ok: false, message: 'Timeline null id already exists' };
  }
  const currentGraph = createGraph(input.compositionId, input.clips);
  if (currentGraph.revision !== input.plan.apply.expectedRevision) {
    return { ok: false, message: 'Timeline null plan revision is stale' };
  }
  const replanned = planTimelineMotionCreateNullAndParentSelected({
    compositionId: input.compositionId,
    clips: input.clips,
    clipKeyframes: input.clipKeyframes,
    timelineTime: input.timelineTime,
    nullClip: input.nullClip,
    selectedClipIds: input.selectedClipIds,
  });
  if (!replanned.ok || stablePlanValue(replanned.plan) !== stablePlanValue(input.plan)) {
    return { ok: false, message: 'Timeline null plan transform state is stale' };
  }

  const changesByClipId = new Map(input.plan.apply.relationshipChanges.map((change) => [
    change.clipId,
    change,
  ] as const));
  if (changesByClipId.size !== input.plan.apply.relationshipChanges.length) {
    return { ok: false, message: 'Timeline null plan contains duplicate relationship changes' };
  }
  if ([...changesByClipId.keys()].some((clipId) => !input.clips.some((clip) => clip.id === clipId))) {
    return { ok: false, message: 'Timeline null plan target clip is missing' };
  }

  const nextKeyframes = new Map<string, Keyframe[]>();
  for (const [clipId, keyframes] of input.clipKeyframes) {
    nextKeyframes.set(clipId, keyframes.map((keyframe) => structuredClone(keyframe)));
  }
  const clips = input.clips.map((clip) => {
    const change = changesByClipId.get(clip.id);
    if (!change) return clip;
    const currentKeyframes = input.clipKeyframes.get(clip.id) ?? [];
    const animated = hasAnimated2DTransform(currentKeyframes);
    if (animated) {
      nextKeyframes.set(
        clip.id,
        writeAnimatedLocalTransform(currentKeyframes, clip, input.timelineTime, change.toLocalTransform),
      );
    }
    return {
      ...clip,
      parentClipId: change.toParentClipId,
      transform: animated
        ? structuredClone(clip.transform)
        : applyMotionParentTransformToClipTransform(clip.transform, change.toLocalTransform),
    };
  });
  clips.push(structuredClone(input.nullClip));
  const nextGraph = createGraph(input.compositionId, clips);
  if (nextGraph.revision !== input.plan.apply.nextRevision) {
    return { ok: false, message: 'Timeline null application did not reach the planned revision' };
  }
  return { ok: true, clips, clipKeyframes: nextKeyframes };
}

export function applyTimelineMotionCreateNullPlan(
  input: TimelineMotionCreateNullApplyInput,
): TimelineMotionStructureApplyResult {
  if (input.plan.kind !== 'create-null') {
    return { ok: false, message: 'Timeline null adapter requires a create-null plan' };
  }
  const createChanges = input.plan.apply.nullChanges.filter((change) => change.action === 'create');
  if (
    createChanges.length !== 1
    || input.plan.apply.nullChanges.length !== 1
    || input.plan.apply.relationshipChanges.length !== 0
    || createChanges[0].entity.clipId !== input.nullClip.id
  ) {
    return { ok: false, message: 'Timeline create-null plan has an unsupported mutation shape' };
  }
  if (input.clips.some((clip) => clip.id === input.nullClip.id)) {
    return { ok: false, message: 'Timeline null id already exists' };
  }
  const currentGraph = createGraph(input.compositionId, input.clips);
  if (currentGraph.revision !== input.plan.apply.expectedRevision) {
    return { ok: false, message: 'Timeline create-null plan revision is stale' };
  }
  const replanned = planTimelineMotionCreateNull({
    compositionId: input.compositionId,
    clips: input.clips,
    clipKeyframes: input.clipKeyframes,
    timelineTime: input.timelineTime,
    nullClip: input.nullClip,
  });
  if (!replanned.ok || stablePlanValue(replanned.plan) !== stablePlanValue(input.plan)) {
    return { ok: false, message: 'Timeline create-null plan state is stale' };
  }

  const clips = [...input.clips, structuredClone(input.nullClip)];
  const nextGraph = createGraph(input.compositionId, clips);
  if (nextGraph.revision !== input.plan.apply.nextRevision) {
    return { ok: false, message: 'Timeline create-null application did not reach the planned revision' };
  }
  const clipKeyframes = new Map<string, Keyframe[]>();
  for (const [clipId, keyframes] of input.clipKeyframes) {
    clipKeyframes.set(clipId, keyframes.map((keyframe) => structuredClone(keyframe)));
  }
  return { ok: true, clips, clipKeyframes };
}
