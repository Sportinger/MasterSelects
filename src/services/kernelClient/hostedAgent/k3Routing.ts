export type HostedAgentK3ProviderRoute =
  | 'kie-managed-hosted'
  | 'local-ai';

export type HostedAgentK3ExecutionRoute =
  | 'hosted-agent'
  | 'legacy-direct'
  | 'local-direct';

export interface HostedAgentK3CanaryConfig {
  canaryPercent: number;
  emergencyRollback: boolean;
  hostedAgentEnabled: boolean;
}

export interface HostedAgentK3RouteDecision {
  canaryBucket: number | null;
  executionRoute: HostedAgentK3ExecutionRoute;
  reason:
    | 'canary_cohort'
    | 'canary_not_selected'
    | 'emergency_rollback'
    | 'feature_disabled'
    | 'kernel_unreachable'
    | 'local_stays_local'
    | 'production_prerequisites_missing';
}

function stableBucket(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % 10_000;
}

function validCanaryPercent(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 100;
}

/**
 * Provider routing truth for the hosted-agent canary.
 *
 * Local AI remains client-owned. Turning `hostedAgentEnabled` off is the
 * one-flag rollback for every managed
 * Kie.ai cohort and requires no project-data migration.
 */
export function decideHostedAgentK3Route(input: {
  cohortKey: string;
  config: HostedAgentK3CanaryConfig;
  kernelReachable: boolean;
  productionPrerequisitesSatisfied: boolean;
  providerRoute: HostedAgentK3ProviderRoute;
}): HostedAgentK3RouteDecision {
  if (input.providerRoute === 'local-ai') {
    return {
      canaryBucket: null,
      executionRoute: 'local-direct',
      reason: 'local_stays_local',
    };
  }
  if (input.config.emergencyRollback) {
    return {
      canaryBucket: null,
      executionRoute: 'legacy-direct',
      reason: 'emergency_rollback',
    };
  }
  if (!input.config.hostedAgentEnabled || !validCanaryPercent(input.config.canaryPercent)) {
    return {
      canaryBucket: null,
      executionRoute: 'legacy-direct',
      reason: 'feature_disabled',
    };
  }
  if (!input.productionPrerequisitesSatisfied) {
    return {
      canaryBucket: null,
      executionRoute: 'legacy-direct',
      reason: 'production_prerequisites_missing',
    };
  }
  if (!input.kernelReachable) {
    return {
      canaryBucket: null,
      executionRoute: 'legacy-direct',
      reason: 'kernel_unreachable',
    };
  }
  const canaryBucket = stableBucket(input.cohortKey);
  if (canaryBucket >= Math.round(input.config.canaryPercent * 100)) {
    return {
      canaryBucket,
      executionRoute: 'legacy-direct',
      reason: 'canary_not_selected',
    };
  }
  return {
    canaryBucket,
    executionRoute: 'hosted-agent',
    reason: 'canary_cohort',
  };
}

export function parseHostedAgentK3CanaryConfig(input: {
  canaryPercent?: string;
  emergencyRollback?: string;
  hostedAgentEnabled?: string;
}): HostedAgentK3CanaryConfig {
  const canaryPercent = Number(input.canaryPercent ?? '0');
  const hostedAgentEnabled = input.hostedAgentEnabled === 'true';
  const emergencyRollback = input.emergencyRollback !== 'false';
  if (!validCanaryPercent(canaryPercent)) {
    return {
      canaryPercent: 0,
      emergencyRollback: true,
      hostedAgentEnabled: false,
    };
  }
  return {
    canaryPercent,
    emergencyRollback,
    hostedAgentEnabled,
  };
}
