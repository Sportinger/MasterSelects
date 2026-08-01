import { describe, expect, it } from 'vitest';

import type { Env } from '../../functions/lib/env';
import { selectHostedAgentProtocol } from '../../functions/lib/hostedAgent/route';

function environment(values: Record<string, string | undefined>): Env {
  return values as unknown as Env;
}

describe('Fast V2 server-owned protocol selection', () => {
  it('selects Fast V2 only for an explicitly enabled server cohort', () => {
    expect(selectHostedAgentProtocol(environment({
      HOSTED_AGENT_FAST_V2_CANARY_PERCENT: '100',
      HOSTED_AGENT_FAST_V2_EMERGENCY_ROLLBACK: 'false',
      HOSTED_AGENT_FAST_V2_ENABLED: 'true',
    }), 'account-42')).toEqual({
      availableExecutionProfiles: ['fast'],
      protocolVersion: 'fast-agent-v2',
      reason: 'canary_selected',
    });
  });

  it('advertises Verified only for a selected V2 cohort with the exact server flag', () => {
    expect(selectHostedAgentProtocol(environment({
      HOSTED_AGENT_FAST_V2_CANARY_PERCENT: '100',
      HOSTED_AGENT_FAST_V2_EMERGENCY_ROLLBACK: 'false',
      HOSTED_AGENT_FAST_V2_ENABLED: 'true',
      HOSTED_AGENT_VERIFIED_PILOT_ENABLED: 'true',
    }), 'account-42')).toEqual({
      availableExecutionProfiles: ['fast', 'verified'],
      protocolVersion: 'fast-agent-v2',
      reason: 'canary_selected',
    });

    expect(selectHostedAgentProtocol(environment({
      HOSTED_AGENT_FAST_V2_CANARY_PERCENT: '100',
      HOSTED_AGENT_FAST_V2_EMERGENCY_ROLLBACK: 'false',
      HOSTED_AGENT_FAST_V2_ENABLED: 'true',
      HOSTED_AGENT_VERIFIED_PILOT_ENABLED: 'TRUE',
    }), 'account-42').availableExecutionProfiles).toEqual(['fast']);
  });

  it('defaults to emergency rollback when the operator flag is absent', () => {
    expect(selectHostedAgentProtocol(environment({
      HOSTED_AGENT_FAST_V2_CANARY_PERCENT: '100',
      HOSTED_AGENT_FAST_V2_ENABLED: 'true',
    }), 'account-42')).toEqual({
      availableExecutionProfiles: ['fast'],
      protocolVersion: 'hosted-agent-k2-v1',
      reason: 'emergency_rollback',
    });
  });

  it('keeps V1 for disabled, invalid, and out-of-cohort configurations', () => {
    expect(selectHostedAgentProtocol(environment({
      HOSTED_AGENT_FAST_V2_CANARY_PERCENT: '100',
      HOSTED_AGENT_FAST_V2_EMERGENCY_ROLLBACK: 'false',
      HOSTED_AGENT_FAST_V2_ENABLED: 'false',
    }), 'account-42').reason).toBe('feature_disabled');

    expect(selectHostedAgentProtocol(environment({
      HOSTED_AGENT_FAST_V2_CANARY_PERCENT: '101',
      HOSTED_AGENT_FAST_V2_EMERGENCY_ROLLBACK: 'false',
      HOSTED_AGENT_FAST_V2_ENABLED: 'true',
    }), 'account-42').reason).toBe('invalid_configuration');

    expect(selectHostedAgentProtocol(environment({
      HOSTED_AGENT_FAST_V2_CANARY_PERCENT: '0',
      HOSTED_AGENT_FAST_V2_EMERGENCY_ROLLBACK: 'false',
      HOSTED_AGENT_FAST_V2_ENABLED: 'true',
    }), 'account-42')).toEqual({
      availableExecutionProfiles: ['fast'],
      protocolVersion: 'hosted-agent-k2-v1',
      reason: 'outside_canary',
    });
  });

  it('never advertises Verified on a rollback or K2 selection', () => {
    const verifiedEnabled = {
      HOSTED_AGENT_FAST_V2_CANARY_PERCENT: '100',
      HOSTED_AGENT_FAST_V2_ENABLED: 'true',
      HOSTED_AGENT_VERIFIED_PILOT_ENABLED: 'true',
    };
    expect(selectHostedAgentProtocol(environment(verifiedEnabled), 'account-42'))
      .toMatchObject({ availableExecutionProfiles: ['fast'], reason: 'emergency_rollback' });
    expect(selectHostedAgentProtocol(environment({
      ...verifiedEnabled,
      HOSTED_AGENT_FAST_V2_EMERGENCY_ROLLBACK: 'false',
      HOSTED_AGENT_FAST_V2_ENABLED: 'false',
    }), 'account-42')).toMatchObject({
      availableExecutionProfiles: ['fast'],
      protocolVersion: 'hosted-agent-k2-v1',
    });
  });

  it('returns a stable partial-cohort decision for the same account', () => {
    const env = environment({
      HOSTED_AGENT_FAST_V2_CANARY_PERCENT: '37',
      HOSTED_AGENT_FAST_V2_EMERGENCY_ROLLBACK: 'false',
      HOSTED_AGENT_FAST_V2_ENABLED: 'true',
    });
    expect(selectHostedAgentProtocol(env, 'stable-account'))
      .toEqual(selectHostedAgentProtocol(env, 'stable-account'));
  });
});
