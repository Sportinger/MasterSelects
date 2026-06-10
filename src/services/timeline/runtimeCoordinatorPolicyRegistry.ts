import {
  TIMELINE_RUNTIME_POLICY_IDS,
  type RenderResourceDescriptor,
  type TimelineRuntimeAdmissionDecision,
  type TimelineRuntimeCoordinator,
  type TimelineRuntimeCoordinatorBridgeStats,
  type TimelineRuntimePolicyBridgeStats,
  type TimelineRuntimePolicyDescriptor,
  type TimelineRuntimePolicyId,
} from './runtimeCoordinatorTypes';
import { TIMELINE_RUNTIME_POLICY_DESCRIPTORS } from './runtimeCoordinatorPolicyCatalog';
import {
  addPolicyUsage,
  createBudgetPressure,
  createBudgetReportForResources,
  createEmptyBudgetReport,
  createEmptyPolicyUsage,
  createUsageForResources,
  getRejectedBudgetUnits,
} from './runtimeCoordinatorBudgetUsage';
import { isRenderResourceDescriptor } from './runtimeCoordinatorResourceGuards';

function createEmptyPolicyBridgeStats(
  descriptor: TimelineRuntimePolicyDescriptor
): TimelineRuntimePolicyBridgeStats {
  return {
    descriptor,
    budgetReport: createEmptyBudgetReport(descriptor),
    resources: [],
    sessions: [],
  };
}

function createPolicyBridgeStats(
  descriptor: TimelineRuntimePolicyDescriptor,
  resources: readonly RenderResourceDescriptor[]
): TimelineRuntimePolicyBridgeStats {
  return {
    descriptor,
    budgetReport: createBudgetReportForResources(descriptor, resources),
    resources,
    sessions: resources
      .map((resource) => resource.diagnostics?.session)
      .filter((session): session is NonNullable<typeof session> => Boolean(session)),
  };
}

export function createEmptyPolicyStatsRecord(): Record<
  TimelineRuntimePolicyId,
  TimelineRuntimePolicyBridgeStats
> {
  const entries = TIMELINE_RUNTIME_POLICY_DESCRIPTORS.map((descriptor) => [
    descriptor.id,
    createEmptyPolicyBridgeStats(descriptor),
  ]);
  return Object.fromEntries(entries) as Record<
    TimelineRuntimePolicyId,
    TimelineRuntimePolicyBridgeStats
  >;
}

export function createEmptyTimelineRuntimeBridgeStats(
  generatedAtMs = 0
): TimelineRuntimeCoordinatorBridgeStats {
  return {
    schemaVersion: 1,
    generatedAtMs,
    policyOrder: TIMELINE_RUNTIME_POLICY_IDS,
    policies: createEmptyPolicyStatsRecord(),
    totals: createEmptyPolicyUsage(),
    diagnostics: {
      providers: [],
      sessions: [],
      resources: [],
      messages: [],
    },
  };
}

export function createTimelineRuntimePolicyRegistry(
  descriptors: readonly TimelineRuntimePolicyDescriptor[] = TIMELINE_RUNTIME_POLICY_DESCRIPTORS
): TimelineRuntimeCoordinator {
  const policiesById = new Map<TimelineRuntimePolicyId, TimelineRuntimePolicyDescriptor>(
    descriptors.map((descriptor) => [descriptor.id, descriptor])
  );
  const resourcesById = new Map<string, RenderResourceDescriptor>();

  const listResourcesForPolicy = (policyId: TimelineRuntimePolicyId): RenderResourceDescriptor[] =>
    Array.from(resourcesById.values()).filter((resource) => resource.policyId === policyId);

  return {
    listPolicies: () => descriptors,
    getPolicy: (policyId) => policiesById.get(policyId) ?? null,
    canRetainResource: (resource): TimelineRuntimeAdmissionDecision => {
      const resourceId = typeof resource.id === 'string' ? resource.id : 'invalid-resource';
      if (!isRenderResourceDescriptor(resource)) {
        return {
          admitted: false,
          resourceId,
          reason: 'invalid-resource-descriptor',
          projectedUsage: createEmptyPolicyUsage(),
          pressure: [],
          rejectedUnits: [],
        };
      }

      const descriptor = policiesById.get(resource.policyId);
      if (!descriptor) {
        return {
          admitted: false,
          resourceId: resource.id,
          policyId: resource.policyId,
          reason: 'unknown-policy',
          projectedUsage: createEmptyPolicyUsage(),
          pressure: [],
          rejectedUnits: [],
        };
      }

      if (!descriptor.allowedResourceKinds.includes(resource.kind)) {
        const projectedUsage = createUsageForResources([resource]);
        const pressure = createBudgetPressure(descriptor.defaultBudget, projectedUsage);
        return {
          admitted: false,
          resourceId: resource.id,
          policyId: resource.policyId,
          reason: 'resource-kind-not-allowed',
          projectedUsage,
          pressure,
          rejectedUnits: [],
        };
      }

      const projectedResources = [
        ...listResourcesForPolicy(resource.policyId).filter((entry) => entry.id !== resource.id),
        resource,
      ];
      const projectedUsage = createUsageForResources(projectedResources);
      const pressure = createBudgetPressure(descriptor.defaultBudget, projectedUsage);
      const rejectedUnits = getRejectedBudgetUnits(pressure);

      return {
        admitted: rejectedUnits.length === 0,
        resourceId: resource.id,
        policyId: resource.policyId,
        reason: rejectedUnits.length > 0 ? 'budget-exceeded' : undefined,
        projectedUsage,
        pressure,
        rejectedUnits,
      };
    },
    retainResource: (resource) => {
      if (!isRenderResourceDescriptor(resource)) {
        return;
      }
      if (!policiesById.has(resource.policyId)) {
        return;
      }
      resourcesById.set(resource.id, JSON.parse(JSON.stringify(resource)) as RenderResourceDescriptor);
    },
    releaseResource: (resourceId) => {
      resourcesById.delete(resourceId);
    },
    clearResources: (scope) => {
      if (!scope?.ownerId && !scope?.policyId) {
        resourcesById.clear();
        return;
      }
      for (const [resourceId, resource] of resourcesById) {
        if (scope.ownerId && resource.owner.ownerId !== scope.ownerId) continue;
        if (scope.policyId && resource.policyId !== scope.policyId) continue;
        resourcesById.delete(resourceId);
      }
    },
    getBudgetReport: (policyId) => {
      if (policyId) {
        const descriptor = policiesById.get(policyId);
        return descriptor ? [createBudgetReportForResources(descriptor, listResourcesForPolicy(policyId))] : [];
      }
      return descriptors.map((descriptor) =>
        createBudgetReportForResources(descriptor, listResourcesForPolicy(descriptor.id))
      );
    },
    getBridgeStats: () => {
      const policyEntries = descriptors.map((descriptor) => {
        const resources = listResourcesForPolicy(descriptor.id);
        return [descriptor.id, createPolicyBridgeStats(descriptor, resources)] as const;
      });
      const policies = Object.fromEntries(policyEntries) as Record<
        TimelineRuntimePolicyId,
        TimelineRuntimePolicyBridgeStats
      >;
      const resources = Array.from(resourcesById.values());
      const totals = Object.values(policies).reduce(
        (sum, policy) => addPolicyUsage(sum, policy.budgetReport.usage),
        createEmptyPolicyUsage()
      );

      return {
        schemaVersion: 1,
        generatedAtMs: Date.now(),
        policyOrder: descriptors.map((descriptor) => descriptor.id),
        policies,
        totals,
        diagnostics: {
          providers: resources
            .map((resource) => resource.diagnostics?.provider)
            .filter((provider): provider is NonNullable<typeof provider> => Boolean(provider)),
          sessions: resources
            .map((resource) => resource.diagnostics?.session)
            .filter((session): session is NonNullable<typeof session> => Boolean(session)),
          resources,
          messages: resources.flatMap((resource) => resource.diagnostics?.messages ?? []),
        },
      };
    },
  };
}
