import type { MotionContentDependency } from '../presets/contracts';
import type { MotionJsonObject } from '../presets/jsonSafety';

export const MOTION_TEMPLATE_FORMAT = 'masterselects.msmotion' as const;
export const MOTION_TEMPLATE_VERSION = 1 as const;
export const MOTION_TEMPLATE_MAX_OCCUPIED_TARGET_IDS = 10_000 as const;
export const MOTION_TEMPLATE_PLAN_BUDGETS = {
  maxDependencyResolutions: 10_000,
  maxCombinedCollectionEntries: 30_000,
  maxFailures: 64,
} as const;

export interface MotionTemplateEntityV1 {
  readonly id: string;
  /** Extensible leaf kind. The complete MD1-MD7 catalog remains integration-owned. */
  readonly kind: string;
  readonly startOffset: number;
  readonly duration: number;
  readonly payload: MotionJsonObject;
  readonly dependencyIds: readonly string[];
}

export interface MotionTemplateRelationshipV1 {
  readonly id: string;
  readonly kind: string;
  readonly fromEntityId: string;
  readonly toEntityId: string;
  readonly payload: MotionJsonObject;
}

export interface MotionTemplateEnvelopeV1 {
  readonly format: typeof MOTION_TEMPLATE_FORMAT;
  readonly version: typeof MOTION_TEMPLATE_VERSION;
  readonly scope: 'project-local';
  readonly templateId: string;
  readonly name: string;
  readonly category: string;
  readonly duration: number;
  readonly entities: readonly MotionTemplateEntityV1[];
  readonly relationships: readonly MotionTemplateRelationshipV1[];
  readonly dependencies: readonly MotionContentDependency[];
}

export const MOTION_TEMPLATE_CODEC_ERROR_CODES = {
  MALFORMED_JSON: 'MD8_TEMPLATE_MALFORMED_JSON',
  MALFORMED_ENVELOPE: 'MD8_TEMPLATE_MALFORMED_ENVELOPE',
  UNKNOWN_VERSION: 'MD8_TEMPLATE_UNKNOWN_VERSION',
  DUPLICATE_ENTITY: 'MD8_TEMPLATE_DUPLICATE_ENTITY',
  DUPLICATE_RELATIONSHIP: 'MD8_TEMPLATE_DUPLICATE_RELATIONSHIP',
  DUPLICATE_DEPENDENCY: 'MD8_TEMPLATE_DUPLICATE_DEPENDENCY',
  MISSING_ENTITY: 'MD8_TEMPLATE_MISSING_ENTITY',
  MISSING_DEPENDENCY_DECLARATION: 'MD8_TEMPLATE_MISSING_DEPENDENCY_DECLARATION',
  JSON_UNSAFE: 'MD8_TEMPLATE_JSON_UNSAFE',
} as const;

export type MotionTemplateCodecErrorCode =
  (typeof MOTION_TEMPLATE_CODEC_ERROR_CODES)[keyof typeof MOTION_TEMPLATE_CODEC_ERROR_CODES];

export interface MotionTemplateCodecFailure {
  readonly code: MotionTemplateCodecErrorCode;
  readonly path: string;
  readonly message: string;
}

export type MotionTemplateCodecResult =
  | { readonly ok: true; readonly envelope: MotionTemplateEnvelopeV1 }
  | { readonly ok: false; readonly failures: readonly MotionTemplateCodecFailure[] };

export const MOTION_TEMPLATE_PLAN_ERROR_CODES = {
  INVALID_TEMPLATE: 'MD8_TEMPLATE_PLAN_INVALID_TEMPLATE',
  INVALID_INSTANCE: 'MD8_TEMPLATE_PLAN_INVALID_INSTANCE',
  DUPLICATE_RESOLUTION: 'MD8_TEMPLATE_DUPLICATE_RESOLUTION',
  UNKNOWN_RESOLUTION: 'MD8_TEMPLATE_UNKNOWN_RESOLUTION',
  MISSING_DEPENDENCY: 'MD8_TEMPLATE_MISSING_DEPENDENCY',
  ID_COLLISION: 'MD8_TEMPLATE_ID_COLLISION',
} as const;

export type MotionTemplatePlanErrorCode =
  (typeof MOTION_TEMPLATE_PLAN_ERROR_CODES)[keyof typeof MOTION_TEMPLATE_PLAN_ERROR_CODES];

export interface MotionTemplatePlanFailure {
  readonly code: MotionTemplatePlanErrorCode;
  readonly ids: readonly string[];
  readonly message: string;
}

export interface MotionTemplateDependencyResolution {
  readonly dependencyId: string;
  readonly resolvedProjectId: string;
}

export interface MotionTemplateDependencyInventoryEntry {
  readonly dependencyId: string;
  readonly kind: MotionContentDependency['kind'];
  readonly sourceProjectId: string;
  readonly status: 'resolved' | 'missing';
  readonly resolvedProjectId?: string;
}

export interface MotionTemplateDependencyInventory {
  readonly complete: boolean;
  readonly entries: readonly MotionTemplateDependencyInventoryEntry[];
  readonly missingDependencyIds: readonly string[];
}

export interface MotionTemplateIdRemapEntry {
  readonly sourceId: string;
  readonly targetId: string;
  readonly kind: 'entity' | 'relationship';
}

export interface MotionTemplateCreateEntityOperation {
  readonly type: 'create-entity';
  readonly targetEntityId: string;
  readonly entityKind: string;
  readonly startTime: number;
  readonly duration: number;
  readonly payload: MotionJsonObject;
  readonly dependencyBindings: readonly {
    readonly dependencyId: string;
    readonly resolvedProjectId: string;
  }[];
}

export interface MotionTemplateCreateRelationshipOperation {
  readonly type: 'create-relationship';
  readonly targetRelationshipId: string;
  readonly relationshipKind: string;
  readonly fromEntityId: string;
  readonly toEntityId: string;
  readonly payload: MotionJsonObject;
}

export type MotionTemplateInstantiateOperation =
  | MotionTemplateCreateEntityOperation
  | MotionTemplateCreateRelationshipOperation;

export interface MotionTemplateInstantiatePlan {
  readonly contractVersion: typeof MOTION_TEMPLATE_VERSION;
  readonly templateId: string;
  readonly destinationCompositionId: string;
  readonly insertionTime: number;
  readonly idRemap: readonly MotionTemplateIdRemapEntry[];
  readonly dependencyInventory: MotionTemplateDependencyInventory;
  readonly batch: {
    readonly batchId: string;
    readonly mode: 'single-undo-batch';
    readonly atomic: true;
    readonly operations: readonly MotionTemplateInstantiateOperation[];
  };
}

export type MotionTemplatePlanResult<T> =
  | { readonly ok: true; readonly plan: T; readonly failures: readonly [] }
  | { readonly ok: false; readonly failures: readonly MotionTemplatePlanFailure[] };
