import type {
  HostedAgentK3ProductionEvidence,
} from './k3Canary';
import {
  decideHostedAgentK3Route,
  parseHostedAgentK3CanaryConfig,
  type HostedAgentK3ProviderRoute,
  type HostedAgentK3RouteDecision,
} from '../../../src/services/kernelClient/hostedAgent/k3Routing';

export interface HostedAgentK3ControlEnv {
  HOSTED_AGENT_K3_CANARY_PERCENT?: string;
  HOSTED_AGENT_K3_EMERGENCY_ROLLBACK?: string;
  HOSTED_AGENT_K3_ENABLED?: string;
}

function evidenceComplete(evidence: HostedAgentK3ProductionEvidence): boolean {
  return Object.values(evidence).every((value) => value === true);
}

/**
 * Server-owned canary decision. Client input can select the existing provider
 * route, but cannot enable the feature, alter the cohort percentage, or waive
 * production prerequisites.
 */
export function decideHostedAgentK3ServerRoute(input: {
  cohortKey: string;
  env: HostedAgentK3ControlEnv;
  kernelReachable: boolean;
  productionEvidence: HostedAgentK3ProductionEvidence;
  providerRoute: HostedAgentK3ProviderRoute;
}): HostedAgentK3RouteDecision {
  return decideHostedAgentK3Route({
    cohortKey: input.cohortKey,
    config: parseHostedAgentK3CanaryConfig({
      canaryPercent: input.env.HOSTED_AGENT_K3_CANARY_PERCENT,
      emergencyRollback: input.env.HOSTED_AGENT_K3_EMERGENCY_ROLLBACK,
      hostedAgentEnabled: input.env.HOSTED_AGENT_K3_ENABLED,
    }),
    kernelReachable: input.kernelReachable,
    productionPrerequisitesSatisfied: evidenceComplete(input.productionEvidence),
    providerRoute: input.providerRoute,
  });
}
