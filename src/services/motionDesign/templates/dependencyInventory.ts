import {
  MOTION_TEMPLATE_PLAN_ERROR_CODES,
  MOTION_TEMPLATE_PLAN_BUDGETS,
  type MotionTemplateDependencyInventory,
  type MotionTemplateDependencyResolution,
  type MotionTemplateEnvelopeV1,
  type MotionTemplatePlanFailure,
  type MotionTemplatePlanResult,
} from './contracts';
import { decodeMotionTemplateEnvelope } from './codec';
import { inspectMotionTemplateDependencyResolutions } from './boundarySafety';

function failure(
  code: MotionTemplatePlanFailure['code'],
  ids: readonly string[],
  message: string,
): MotionTemplatePlanFailure {
  return { code, ids: [...new Set(ids)].sort(), message };
}

export function inventoryMotionTemplateDependencies(
  envelope: MotionTemplateEnvelopeV1,
  resolutions: readonly MotionTemplateDependencyResolution[],
): MotionTemplatePlanResult<MotionTemplateDependencyInventory> {
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
  const resolutionInspection = inspectMotionTemplateDependencyResolutions(resolutions);
  if (!resolutionInspection.ok) {
    return {
      ok: false,
      failures: [failure(
        MOTION_TEMPLATE_PLAN_ERROR_CODES.INVALID_INSTANCE,
        [],
        'Dependency resolutions must be supplied as an array.',
      )],
    };
  }

  const declaredIds = new Set(decoded.envelope.dependencies.map((item) => item.id));
  const resolutionById = new Map<string, string>();
  const failures: MotionTemplatePlanFailure[] = [];
  for (const resolution of resolutionInspection.values) {
    if (failures.length >= MOTION_TEMPLATE_PLAN_BUDGETS.maxFailures) break;
    if (!declaredIds.has(resolution.dependencyId)) {
      failures.push(failure(
        MOTION_TEMPLATE_PLAN_ERROR_CODES.UNKNOWN_RESOLUTION,
        [resolution.dependencyId],
        'Dependency resolution does not match a declared template dependency.',
      ));
      continue;
    }
    if (resolutionById.has(resolution.dependencyId)) {
      failures.push(failure(
        MOTION_TEMPLATE_PLAN_ERROR_CODES.DUPLICATE_RESOLUTION,
        [resolution.dependencyId],
        'Each template dependency may be resolved only once.',
      ));
      continue;
    }
    resolutionById.set(resolution.dependencyId, resolution.resolvedProjectId);
  }
  if (failures.length > 0) return { ok: false, failures };

  const entries = [...decoded.envelope.dependencies]
    .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
    .map((dependency) => {
      const resolvedProjectId = resolutionById.get(dependency.id);
      return {
        dependencyId: dependency.id,
        kind: dependency.kind,
        sourceProjectId: dependency.sourceProjectId,
        status: resolvedProjectId ? 'resolved' as const : 'missing' as const,
        ...(resolvedProjectId ? { resolvedProjectId } : {}),
      };
    });
  const missingDependencyIds = entries
    .filter((entry) => entry.status === 'missing')
    .map((entry) => entry.dependencyId);
  return {
    ok: true,
    failures: [],
    plan: {
      complete: missingDependencyIds.length === 0,
      entries,
      missingDependencyIds,
    },
  };
}
