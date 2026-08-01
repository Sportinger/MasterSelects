import { describe, expect, it } from 'vitest';

import {
  decideHostedAgentK3Route,
  parseHostedAgentK3CanaryConfig,
} from '../../src/services/kernelClient/hostedAgent';
import { decideHostedAgentK3ServerRoute } from '../../functions/lib/hostedAgent/k3Control';
import type { HostedAgentK3ProductionEvidence } from '../../functions/lib/hostedAgent/k3Canary';

const enabled = {
  canaryPercent: 100,
  emergencyRollback: false,
  hostedAgentEnabled: true,
};

const productionEvidence: HostedAgentK3ProductionEvidence = {
  actualRoutingIntegrated: true,
  encryptedMultiInstanceSessionStore: true,
  featureFlagRollbackConfigured: true,
  multiRoundD1Authority: true,
  privateOriginDeployed: true,
  productionTelemetrySink: true,
  realKieBillingCanary: true,
  realProductionSseReplay: true,
};

describe('hosted-agent K3 routing and rollback truth', () => {
  it('routes only managed Kie.ai through an eligible canary', () => {
    expect(decideHostedAgentK3Route({
      cohortKey: 'stable-page-cohort',
      config: enabled,
      kernelReachable: true,
      productionPrerequisitesSatisfied: true,
      providerRoute: 'kie-managed-hosted',
    })).toMatchObject({
      executionRoute: 'hosted-agent',
      reason: 'canary_cohort',
    });
  });

  it('never sends Local AI to the kernel', () => {
    expect(decideHostedAgentK3Route({
      cohortKey: 'local-cohort',
      config: enabled,
      kernelReachable: true,
      productionPrerequisitesSatisfied: true,
      providerRoute: 'local-ai',
    })).toEqual({
      canaryBucket: null,
      executionRoute: 'local-direct',
      reason: 'local_stays_local',
    });
  });

  it('uses a stable cohort bucket and excludes a zero-percent cohort', () => {
    const input = {
      cohortKey: 'stable-cohort-42',
      config: { ...enabled, canaryPercent: 37 },
      kernelReachable: true,
      productionPrerequisitesSatisfied: true,
      providerRoute: 'kie-managed-hosted' as const,
    };
    const first = decideHostedAgentK3Route(input);
    const second = decideHostedAgentK3Route(input);
    expect(first.canaryBucket).toBe(second.canaryBucket);
    expect(decideHostedAgentK3Route({
      ...input,
      config: { ...enabled, canaryPercent: 0 },
    })).toMatchObject({
      executionRoute: 'legacy-direct',
      reason: 'canary_not_selected',
    });
  });

  it('proves one-flag and emergency rollback without touching Local AI or project data', () => {
    for (const cohortKey of ['a', 'b', 'c', 'd', 'e']) {
      expect(decideHostedAgentK3Route({
        cohortKey,
        config: { ...enabled, hostedAgentEnabled: false },
        kernelReachable: true,
        productionPrerequisitesSatisfied: true,
        providerRoute: 'kie-managed-hosted',
      })).toMatchObject({
        executionRoute: 'legacy-direct',
        reason: 'feature_disabled',
      });
      expect(decideHostedAgentK3Route({
        cohortKey,
        config: { ...enabled, emergencyRollback: true },
        kernelReachable: true,
        productionPrerequisitesSatisfied: true,
        providerRoute: 'kie-managed-hosted',
      })).toMatchObject({
        executionRoute: 'legacy-direct',
        reason: 'emergency_rollback',
      });
    }
  });

  it('fails closed on missing prerequisites, kernel failure, and invalid environment values', () => {
    expect(decideHostedAgentK3Route({
      cohortKey: 'missing-production',
      config: enabled,
      kernelReachable: true,
      productionPrerequisitesSatisfied: false,
      providerRoute: 'kie-managed-hosted',
    }).reason).toBe('production_prerequisites_missing');
    expect(decideHostedAgentK3Route({
      cohortKey: 'offline-kernel',
      config: enabled,
      kernelReachable: false,
      productionPrerequisitesSatisfied: true,
      providerRoute: 'kie-managed-hosted',
    }).reason).toBe('kernel_unreachable');
    expect(parseHostedAgentK3CanaryConfig({
      canaryPercent: 'not-a-number',
      emergencyRollback: 'false',
      hostedAgentEnabled: 'true',
    })).toEqual({
      canaryPercent: 0,
      emergencyRollback: true,
      hostedAgentEnabled: false,
    });
    expect(parseHostedAgentK3CanaryConfig({})).toEqual({
      canaryPercent: 0,
      emergencyRollback: true,
      hostedAgentEnabled: false,
    });
  });

  it('keeps enablement and percentage server-owned', () => {
    expect(decideHostedAgentK3ServerRoute({
      cohortKey: 'server-controlled',
      env: {
        HOSTED_AGENT_K3_CANARY_PERCENT: '100',
        HOSTED_AGENT_K3_EMERGENCY_ROLLBACK: 'false',
        HOSTED_AGENT_K3_ENABLED: 'true',
      },
      kernelReachable: true,
      productionEvidence,
      providerRoute: 'kie-managed-hosted',
    }).executionRoute).toBe('hosted-agent');
    expect(decideHostedAgentK3ServerRoute({
      cohortKey: 'server-controlled',
      env: {
        HOSTED_AGENT_K3_CANARY_PERCENT: '100',
        HOSTED_AGENT_K3_EMERGENCY_ROLLBACK: 'false',
        HOSTED_AGENT_K3_ENABLED: 'false',
      },
      kernelReachable: true,
      productionEvidence,
      providerRoute: 'kie-managed-hosted',
    })).toMatchObject({
      executionRoute: 'legacy-direct',
      reason: 'feature_disabled',
    });
  });
});
