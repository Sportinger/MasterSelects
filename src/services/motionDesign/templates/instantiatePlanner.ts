import { cloneMotionJsonValue } from '../presets/jsonSafety';
import { decodeMotionTemplateEnvelope } from './codec';
import {
  MOTION_TEMPLATE_PLAN_ERROR_CODES,
  MOTION_TEMPLATE_PLAN_BUDGETS,
  MOTION_TEMPLATE_VERSION,
  type MotionTemplateDependencyResolution,
  type MotionTemplateEnvelopeV1,
  type MotionTemplateInstantiateOperation,
  type MotionTemplateInstantiatePlan,
  type MotionTemplatePlanFailure,
  type MotionTemplatePlanResult,
} from './contracts';
import {
  inspectExactDataRecord,
  inspectMotionTemplateDependencyResolutions,
  inspectMotionTemplateOccupiedTargetIds,
} from './boundarySafety';
import { inventoryMotionTemplateDependencies } from './dependencyInventory';
import { planMotionTemplateIdRemap, stableMotionTemplateHash } from './idRemapPlanner';

function failure(
  code: MotionTemplatePlanFailure['code'],
  ids: readonly string[],
  message: string,
): MotionTemplatePlanFailure {
  return { code, ids: [...new Set(ids)].sort(), message };
}

export interface PlanMotionTemplateInstantiationInput {
  readonly envelope: MotionTemplateEnvelopeV1;
  readonly destinationCompositionId: string;
  readonly insertionTime: number;
  readonly instanceKey: string;
  readonly dependencyResolutions: readonly MotionTemplateDependencyResolution[];
  readonly occupiedTargetIds: readonly string[];
}

const INSTANTIATION_INPUT_KEYS = new Set([
  'envelope',
  'destinationCompositionId',
  'insertionTime',
  'instanceKey',
  'dependencyResolutions',
  'occupiedTargetIds',
]);

export function planMotionTemplateInstantiation(
  input: PlanMotionTemplateInstantiationInput,
): MotionTemplatePlanResult<MotionTemplateInstantiatePlan> {
  const inputInspection = inspectExactDataRecord(input, INSTANTIATION_INPUT_KEYS);
  if (!inputInspection) {
    return {
      ok: false,
      failures: [failure(
        MOTION_TEMPLATE_PLAN_ERROR_CODES.INVALID_INSTANCE,
        [],
        'Template instantiation input must be a plain contract object.',
      )],
    };
  }
  const descriptors = inputInspection.descriptors;
  const dependencyResolutions = inspectMotionTemplateDependencyResolutions(
    descriptors.dependencyResolutions.value,
  );
  const occupiedTargetIds = inspectMotionTemplateOccupiedTargetIds(
    descriptors.occupiedTargetIds.value,
  );
  if (!dependencyResolutions.ok || !occupiedTargetIds.ok) {
    return {
      ok: false,
      failures: [failure(
        MOTION_TEMPLATE_PLAN_ERROR_CODES.INVALID_INSTANCE,
        [],
        'Template instantiation collections exceed their limits or are not inert exact arrays.',
      )],
    };
  }

  const decoded = decodeMotionTemplateEnvelope(descriptors.envelope.value);
  if (!decoded.ok) {
    return {
      ok: false,
      failures: [failure(
        MOTION_TEMPLATE_PLAN_ERROR_CODES.INVALID_TEMPLATE,
        [],
        `Template codec rejected the envelope: ${decoded.failures[0]?.code ?? 'unknown'}.`,
      )],
    };
  }
  const destinationCompositionId = descriptors.destinationCompositionId.value;
  const instanceKey = descriptors.instanceKey.value;
  const insertionTime = descriptors.insertionTime.value;
  if (
    typeof destinationCompositionId !== 'string' ||
    !destinationCompositionId ||
    typeof instanceKey !== 'string' ||
    !instanceKey ||
    instanceKey.length > 256 ||
    typeof insertionTime !== 'number' ||
    !Number.isFinite(insertionTime) ||
    insertionTime < 0 ||
    !Number.isFinite(insertionTime + decoded.envelope.duration)
  ) {
    return {
      ok: false,
      failures: [failure(
        MOTION_TEMPLATE_PLAN_ERROR_CODES.INVALID_INSTANCE,
        [],
        'Template instantiation requires a destination, bounded instance key, and finite time.',
      )],
    };
  }
  const combinedCollectionEntries =
    decoded.envelope.entities.length +
    decoded.envelope.relationships.length +
    decoded.envelope.dependencies.length +
    dependencyResolutions.values.length +
    occupiedTargetIds.values.length;
  if (combinedCollectionEntries > MOTION_TEMPLATE_PLAN_BUDGETS.maxCombinedCollectionEntries) {
    return {
      ok: false,
      failures: [failure(
        MOTION_TEMPLATE_PLAN_ERROR_CODES.INVALID_INSTANCE,
        [],
        'Template instantiation exceeds the named combined collection-entry budget.',
      )],
    };
  }

  const inventory = inventoryMotionTemplateDependencies(
    decoded.envelope,
    dependencyResolutions.values,
  );
  if (!inventory.ok) return inventory;
  if (!inventory.plan.complete) {
    return {
      ok: false,
      failures: [failure(
        MOTION_TEMPLATE_PLAN_ERROR_CODES.MISSING_DEPENDENCY,
        inventory.plan.missingDependencyIds,
        'Every declared template dependency must be resolved before instantiation.',
      )],
    };
  }

  const namespaceKey = JSON.stringify([destinationCompositionId, instanceKey]);
  const remap = planMotionTemplateIdRemap(
    decoded.envelope,
    namespaceKey,
    occupiedTargetIds.values,
  );
  if (!remap.ok) return remap;
  const entityIdBySourceId = new Map(
    remap.plan
      .filter((entry) => entry.kind === 'entity')
      .map((entry) => [entry.sourceId, entry.targetId]),
  );
  const relationshipIdBySourceId = new Map(
    remap.plan
      .filter((entry) => entry.kind === 'relationship')
      .map((entry) => [entry.sourceId, entry.targetId]),
  );
  const resolvedProjectIdByDependencyId = new Map(
    inventory.plan.entries.map((entry) => [entry.dependencyId, entry.resolvedProjectId!]),
  );

  const entityOperations: MotionTemplateInstantiateOperation[] = [...decoded.envelope.entities]
    .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
    .map((entity) => ({
      type: 'create-entity',
      targetEntityId: entityIdBySourceId.get(entity.id)!,
      entityKind: entity.kind,
      startTime: insertionTime + entity.startOffset,
      duration: entity.duration,
      payload: cloneMotionJsonValue(entity.payload),
      dependencyBindings: [...entity.dependencyIds]
        .sort()
        .map((dependencyId) => ({
          dependencyId,
          resolvedProjectId: resolvedProjectIdByDependencyId.get(dependencyId)!,
        })),
    }));
  const relationshipOperations: MotionTemplateInstantiateOperation[] = [...decoded.envelope.relationships]
    .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
    .map((relationship) => ({
      type: 'create-relationship',
      targetRelationshipId: relationshipIdBySourceId.get(relationship.id)!,
      relationshipKind: relationship.kind,
      fromEntityId: entityIdBySourceId.get(relationship.fromEntityId)!,
      toEntityId: entityIdBySourceId.get(relationship.toEntityId)!,
      payload: cloneMotionJsonValue(relationship.payload),
    }));
  const batchSeed = JSON.stringify([
    decoded.envelope.templateId,
    destinationCompositionId,
    instanceKey,
    insertionTime.toString(),
  ]);

  return {
    ok: true,
    failures: [],
    plan: {
      contractVersion: MOTION_TEMPLATE_VERSION,
      templateId: decoded.envelope.templateId,
      destinationCompositionId,
      insertionTime,
      idRemap: remap.plan,
      dependencyInventory: inventory.plan,
      batch: {
        batchId: `msm_batch_${stableMotionTemplateHash(batchSeed)}`,
        mode: 'single-undo-batch',
        atomic: true,
        operations: [...entityOperations, ...relationshipOperations],
      },
    },
  };
}
