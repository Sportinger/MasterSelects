import {
  MOTION_PARENT_GRAPH_CONTRACT_VERSION,
  MOTION_PARENT_WORLD_PRESERVATION,
  type MotionParentDiagnosticCode,
  type MotionParentErrorCode,
  type MotionParentFailure,
  type MotionParentGraphEvaluation,
  type MotionParentGraphSnapshot,
  type MotionParentRelationshipChange,
  type MotionParentTransform2D,
} from './contracts';

export const MOTION_STRUCTURE_LEAF_CONTRACT_VERSION = MOTION_PARENT_GRAPH_CONTRACT_VERSION;
export const MOTION_STRUCTURE_LEAF_BUDGETS = {
  maxSelectedClipIds: 256,
  maxRelationshipChanges: 256,
  maxNullChanges: 1,
  maxDiagnostics: 64,
} as const;

export interface MotionStructureNullEntity2D {
  readonly kind: 'null';
  readonly clipId: string;
  readonly compositionId: string;
  readonly space: '2d';
  /** A created root null's local transform is also its operation-time world transform. */
  readonly localTransform: MotionParentTransform2D;
}

export interface MotionStructureNullChange {
  readonly action: 'create' | 'delete';
  readonly entity: MotionStructureNullEntity2D;
}

export interface MotionStructureLeafDiagnostic {
  readonly code: MotionParentDiagnosticCode;
  readonly message: string;
  readonly clipIds: readonly string[];
  readonly blockedBy?: MotionParentErrorCode;
}

export interface MotionStructureLeafPlanDirection {
  readonly expectedRevision: string;
  readonly nextRevision: string;
  readonly graph: MotionParentGraphSnapshot;
  /** Deterministic application order inside the single atomic history entry. */
  readonly executionOrder: readonly ('null-changes' | 'relationship-changes')[];
  readonly nullChanges: readonly MotionStructureNullChange[];
  readonly relationshipChanges: readonly MotionParentRelationshipChange[];
}

export type MotionStructureLeafOperationKind =
  | 'create-null'
  | 'set-parent'
  | 'clear-parent'
  | 'create-null-and-parent-selected';

export interface MotionStructureLeafOperationPlan {
  readonly contractVersion: typeof MOTION_STRUCTURE_LEAF_CONTRACT_VERSION;
  readonly kind: MotionStructureLeafOperationKind;
  readonly timelineTime: number;
  readonly preservation: typeof MOTION_PARENT_WORLD_PRESERVATION;
  readonly affectedClipIds: readonly string[];
  readonly preservedWorldTransformsAtOperationTime: readonly {
    readonly clipId: string;
    readonly transform: MotionParentTransform2D;
  }[];
  readonly apply: MotionStructureLeafPlanDirection;
  readonly undo: MotionStructureLeafPlanDirection;
  readonly diagnostics: readonly MotionStructureLeafDiagnostic[];
  readonly history: {
    readonly mode: 'single-entry';
    readonly label: string;
    readonly atomic: true;
  };
}

export type MotionStructureLeafPlanResult =
  | {
      readonly ok: true;
      readonly plan: MotionStructureLeafOperationPlan;
      readonly failures: readonly [];
      readonly diagnostics: readonly MotionStructureLeafDiagnostic[];
    }
  | {
      readonly ok: false;
      readonly failures: readonly MotionParentFailure[];
      readonly diagnostics: readonly MotionStructureLeafDiagnostic[];
    };

export interface PlanMotionCreateNullInput {
  readonly graph: MotionParentGraphSnapshot;
  readonly timelineTime: number;
  readonly nullEntity: MotionStructureNullEntity2D;
}

export interface PlanMotionSetParentInput {
  readonly graph: MotionParentGraphSnapshot;
  readonly evaluation: MotionParentGraphEvaluation;
  readonly childClipId: string;
  readonly parentClipId: string;
}

export interface PlanMotionClearParentInput {
  readonly graph: MotionParentGraphSnapshot;
  readonly evaluation: MotionParentGraphEvaluation;
  readonly childClipId: string;
}

export interface PlanMotionCreateNullAndParentSelectedInput {
  readonly graph: MotionParentGraphSnapshot;
  readonly evaluation: MotionParentGraphEvaluation;
  readonly nullEntity: MotionStructureNullEntity2D;
  readonly selectedClipIds: readonly string[];
}

export type MotionStructureSemanticIntent =
  | {
      readonly type: 'create-null';
      readonly timelineTime: number;
      readonly nullEntity: MotionStructureNullEntity2D;
    }
  | {
      readonly type: 'set-parent';
      readonly evaluation: MotionParentGraphEvaluation;
      readonly childClipId: string;
      readonly parentClipId: string;
    }
  | {
      readonly type: 'clear-parent';
      readonly evaluation: MotionParentGraphEvaluation;
      readonly childClipId: string;
    }
  | {
      readonly type: 'create-null-and-parent-selected';
      readonly evaluation: MotionParentGraphEvaluation;
      readonly nullEntity: MotionStructureNullEntity2D;
      readonly selectedClipIds: readonly string[];
    }
  | {
      readonly type: 'group';
      readonly selectedClipIds: readonly string[];
    };

export interface PlanMotionStructureSemanticIntentInput {
  readonly graph: MotionParentGraphSnapshot;
  readonly intent: MotionStructureSemanticIntent;
}
