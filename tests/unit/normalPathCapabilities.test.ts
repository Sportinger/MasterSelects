import { describe, expect, it } from 'vitest';

import type { Env } from '../../functions/lib/env';
import { selectNormalPathCapabilities } from '../../functions/lib/hostedAgent/route';

function environment(values: Record<string, string | undefined> = {}): Env {
  return values as unknown as Env;
}

describe('Normal Path capabilities', () => {
  it('always exposes the single Normal Path execution profile', () => {
    expect(selectNormalPathCapabilities(environment())).toEqual({
      availableAgentModes: ['standard'],
      availableExecutionProfiles: ['fast'],
      protocolVersion: 'fast-agent-v2',
      reason: 'normal_path',
    });
  });

  it('exposes Logic only when the exact server-owned flag is enabled', () => {
    expect(selectNormalPathCapabilities(environment({
      HOSTED_AGENT_LOGIC_ENABLED: 'true',
    })).availableAgentModes).toEqual(['standard', 'logic']);
    expect(selectNormalPathCapabilities(environment({
      HOSTED_AGENT_LOGIC_ENABLED: 'TRUE',
    })).availableAgentModes).toEqual(['standard']);
  });
});
