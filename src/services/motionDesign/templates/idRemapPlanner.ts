import { decodeMotionTemplateEnvelope } from './codec';
import {
  MOTION_TEMPLATE_PLAN_ERROR_CODES,
  type MotionTemplateEnvelopeV1,
  type MotionTemplateIdRemapEntry,
  type MotionTemplatePlanFailure,
  type MotionTemplatePlanResult,
} from './contracts';
import { inspectMotionTemplateOccupiedTargetIds } from './boundarySafety';

function hash64(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
}

export function stableMotionTemplateHash(value: string): string {
  return hash64(value);
}

function failure(
  code: MotionTemplatePlanFailure['code'],
  ids: readonly string[],
  message: string,
): MotionTemplatePlanFailure {
  return { code, ids: [...new Set(ids)].sort(), message };
}

export function planMotionTemplateIdRemap(
  envelope: MotionTemplateEnvelopeV1,
  namespaceKey: string,
  occupiedTargetIds: readonly string[],
): MotionTemplatePlanResult<readonly MotionTemplateIdRemapEntry[]> {
  const decoded = decodeMotionTemplateEnvelope(envelope);
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
  if (typeof namespaceKey !== 'string' || !namespaceKey || namespaceKey.length > 512) {
    return {
      ok: false,
      failures: [failure(
        MOTION_TEMPLATE_PLAN_ERROR_CODES.INVALID_INSTANCE,
        [],
        'Template remapping requires a bounded non-empty namespace key.',
      )],
    };
  }
  const occupiedInspection = inspectMotionTemplateOccupiedTargetIds(occupiedTargetIds);
  if (!occupiedInspection.ok) {
    return {
      ok: false,
      failures: [failure(
        MOTION_TEMPLATE_PLAN_ERROR_CODES.INVALID_INSTANCE,
        [],
        'Occupied target ids must be a bounded dense array of unique inert strings.',
      )],
    };
  }

  const entries: MotionTemplateIdRemapEntry[] = [
    ...decoded.envelope.entities.map((entity) => ({
      sourceId: entity.id,
      targetId: `msm_e_${hash64(JSON.stringify([
        decoded.envelope.templateId,
        namespaceKey,
        'entity',
        entity.id,
      ]))}`,
      kind: 'entity' as const,
    })),
    ...decoded.envelope.relationships.map((relationship) => ({
      sourceId: relationship.id,
      targetId: `msm_r_${hash64(JSON.stringify([
        decoded.envelope.templateId,
        namespaceKey,
        'relationship',
        relationship.id,
      ]))}`,
      kind: 'relationship' as const,
    })),
  ].sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === 'entity' ? -1 : 1;
    return left.sourceId < right.sourceId ? -1 : left.sourceId > right.sourceId ? 1 : 0;
  });
  const occupiedTargets = new Set(occupiedInspection.values);
  const targets = new Set<string>();
  for (const entry of entries) {
    if (targets.has(entry.targetId) || occupiedTargets.has(entry.targetId)) {
      return {
        ok: false,
        failures: [failure(
          MOTION_TEMPLATE_PLAN_ERROR_CODES.ID_COLLISION,
          [entry.sourceId],
          'Deterministic template id remapping produced a collision.',
        )],
      };
    }
    targets.add(entry.targetId);
  }
  return { ok: true, failures: [], plan: entries };
}
