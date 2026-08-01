/**
 * MD6 Structure 1.0 is deliberately limited to acyclic, same-composition 2D
 * parenting. Groups and mixed 2D/3D relationships are not part of this
 * contract. All values are plain data so plans can cross history/AI boundaries.
 */

export const MOTION_PARENT_GRAPH_CONTRACT_VERSION = 1 as const;
export const MOTION_PARENT_GROUPS_SUPPORTED = false as const;
export const MOTION_PARENT_WORLD_PRESERVATION = 'operation-time-only' as const;
export const MOTION_PARENT_GRAPH_BUDGETS = {
  /** Inclusive number of nodes accepted by one graph/evaluation packet. */
  maxNodes: 10_000,
  /** Inclusive number of nodes on one root-to-leaf parent chain. */
  maxDepth: 256,
} as const;
export const MOTION_PARENT_STABLE_ID_POLICY = {
  maxLength: 512,
  forbidControlCharacters: true,
} as const;

export const MOTION_PARENT_ERROR_CODES = {
  SELF_PARENT: 'MD6_PARENT_SELF',
  CHILD_MISSING: 'MD6_PARENT_CHILD_MISSING',
  PARENT_MISSING: 'MD6_PARENT_PARENT_MISSING',
  CYCLE: 'MD6_PARENT_CYCLE',
  MIXED_3D_UNSUPPORTED: 'MD6_PARENT_MIXED_3D_UNSUPPORTED',
  COMPOSITION_MISMATCH: 'MD6_PARENT_COMPOSITION_MISMATCH',
  INVALID_TIMELINE_TIME: 'MD6_PARENT_INVALID_TIMELINE_TIME',
  EVALUATION_INVALID: 'MD6_PARENT_EVALUATION_INVALID',
  DUPLICATE_EVALUATION: 'MD6_PARENT_DUPLICATE_EVALUATION',
  EVALUATION_MISSING: 'MD6_PARENT_EVALUATION_MISSING',
  NON_FINITE_TRANSFORM: 'MD6_PARENT_NON_FINITE_TRANSFORM',
  NON_INVERTIBLE_TRANSFORM: 'MD6_PARENT_NON_INVERTIBLE_TRANSFORM',
  REVISION_MISMATCH: 'MD6_PARENT_GRAPH_REVISION_MISMATCH',
  GRAPH_NODE_INVALID: 'MD6_PARENT_GRAPH_NODE_INVALID',
  GRAPH_ORDER_INVALID: 'MD6_PARENT_GRAPH_ORDER_INVALID',
  DUPLICATE_CLIP_ID: 'MD6_PARENT_DUPLICATE_CLIP_ID',
  GRAPH_NODE_BUDGET_EXCEEDED: 'MD6_PARENT_GRAPH_NODE_BUDGET_EXCEEDED',
  GRAPH_DEPTH_BUDGET_EXCEEDED: 'MD6_PARENT_GRAPH_DEPTH_BUDGET_EXCEEDED',
  EVALUATION_BUDGET_EXCEEDED: 'MD6_PARENT_EVALUATION_BUDGET_EXCEEDED',
  MUTATION_INPUT_INVALID: 'MD6_PARENT_MUTATION_INPUT_INVALID',
  RELATIONSHIP_UNCHANGED: 'MD6_PARENT_RELATIONSHIP_UNCHANGED',
  REMAP_TARGET_MISSING: 'MD6_PARENT_REMAP_TARGET_MISSING',
  NULL_ID_EXISTS: 'MD6_STRUCTURE_NULL_ID_EXISTS',
  NULL_DESCRIPTOR_INVALID: 'MD6_STRUCTURE_NULL_DESCRIPTOR_INVALID',
  BATCH_BUDGET_EXCEEDED: 'MD6_STRUCTURE_BATCH_BUDGET_EXCEEDED',
  GROUP_INTENT_UNSUPPORTED: 'MD6_STRUCTURE_GROUP_INTENT_UNSUPPORTED',
  INTENT_INVALID: 'MD6_STRUCTURE_INTENT_INVALID',
} as const;

export const MOTION_PARENT_DIAGNOSTIC_CODES = {
  EXTERNAL_EDGE_CLEARED: 'MD6_PARENT_EXTERNAL_EDGE_CLEARED',
  GROUPS_OUT_OF_SCOPE: 'MD6_PARENT_GROUPS_OUT_OF_1_0',
  RELATIONSHIP_BLOCKED: 'MD6_STRUCTURE_RELATIONSHIP_BLOCKED',
} as const;

export type MotionParentErrorCode =
  (typeof MOTION_PARENT_ERROR_CODES)[keyof typeof MOTION_PARENT_ERROR_CODES];
export type MotionParentDiagnosticCode =
  (typeof MOTION_PARENT_DIAGNOSTIC_CODES)[keyof typeof MOTION_PARENT_DIAGNOSTIC_CODES];

export type MotionParentSpace = '2d' | '3d';

/**
 * This mirrors the existing 2D portion of `composeTransforms`: parent scale
 * does not affect child position, scale.all and axis scale compose separately,
 * Z rotation rotates XY position, and opacity multiplies. Blend mode is omitted
 * because the child blend mode wins and is therefore not parent-relative.
 */
export interface MotionParentTransform2D {
  readonly position: {
    readonly x: number;
    readonly y: number;
  };
  readonly scale: {
    readonly all: number;
    readonly x: number;
    readonly y: number;
  };
  readonly rotationZ: number;
  readonly opacity: number;
}

export interface MotionParentGraphNode {
  readonly clipId: string;
  readonly compositionId: string;
  readonly space: MotionParentSpace;
  readonly parentClipId?: string;
}

export interface MotionParentGraphSnapshot {
  readonly version: typeof MOTION_PARENT_GRAPH_CONTRACT_VERSION;
  readonly revision: string;
  /** Canonical order is ascending clipId. */
  readonly nodes: readonly MotionParentGraphNode[];
}

/** A caller-owned, already-evaluated transform snapshot at exactly one time. */
export interface MotionParentGraphEvaluation {
  readonly timelineTime: number;
  /** Canonical order is ascending clipId. No live playhead is consulted. */
  readonly localTransforms: readonly {
    readonly clipId: string;
    readonly transform: MotionParentTransform2D;
  }[];
}

export interface MotionParentFailure {
  readonly code: MotionParentErrorCode;
  readonly message: string;
  readonly clipIds: readonly string[];
}

export interface MotionParentDiagnostic {
  readonly code: MotionParentDiagnosticCode;
  readonly message: string;
  readonly clipIds: readonly string[];
}

export interface MotionParentRelationshipChange {
  readonly clipId: string;
  readonly fromParentClipId?: string;
  readonly toParentClipId?: string;
  readonly fromLocalTransform: MotionParentTransform2D;
  readonly toLocalTransform: MotionParentTransform2D;
}

export interface MotionParentPlanDirection {
  readonly expectedRevision: string;
  readonly nextRevision: string;
  readonly graph: MotionParentGraphSnapshot;
  /** A single atomic write packet. Partial application is forbidden. */
  readonly changes: readonly MotionParentRelationshipChange[];
}

export type MotionParentMutationKind = 'set' | 'clear' | 'reparent';

export interface MotionParentMutationPlan {
  readonly contractVersion: typeof MOTION_PARENT_GRAPH_CONTRACT_VERSION;
  readonly kind: MotionParentMutationKind;
  readonly timelineTime: number;
  readonly preservation: typeof MOTION_PARENT_WORLD_PRESERVATION;
  readonly affectedClipIds: readonly string[];
  readonly childWorldTransformAtOperationTime: MotionParentTransform2D;
  readonly apply: MotionParentPlanDirection;
  readonly undo: MotionParentPlanDirection;
  readonly history: {
    readonly mode: 'single-entry';
    readonly label: string;
    readonly atomic: true;
  };
}

export type MotionParentPlanResult =
  | {
      readonly ok: true;
      readonly plan: MotionParentMutationPlan;
      readonly failures: readonly [];
    }
  | {
      readonly ok: false;
      readonly failures: readonly MotionParentFailure[];
    };

export interface MotionParentRemapAssignment {
  readonly sourceClipId: string;
  readonly targetClipId: string;
  readonly parentClipId?: string;
}

export interface MotionParentRemapPlan {
  readonly contractVersion: typeof MOTION_PARENT_GRAPH_CONTRACT_VERSION;
  readonly destinationCompositionId: string;
  readonly assignments: readonly MotionParentRemapAssignment[];
  readonly graph: MotionParentGraphSnapshot;
  readonly diagnostics: readonly MotionParentDiagnostic[];
}

export type MotionParentRemapResult =
  | {
      readonly ok: true;
      readonly plan: MotionParentRemapPlan;
      readonly failures: readonly [];
    }
  | {
      readonly ok: false;
      readonly failures: readonly MotionParentFailure[];
    };
