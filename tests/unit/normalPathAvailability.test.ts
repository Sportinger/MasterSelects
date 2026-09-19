import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getHostedAgentCapabilityAvailability,
  getHostedAgentExecutionProfileAvailability,
} from '../../src/services/flashboard/FlashBoardHostedAgentTransport';

describe('Normal Path UI availability', () => {
  afterEach(() => vi.restoreAllMocks());

  it('reads fresh server-owned capabilities from the Normal Path endpoint', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => (
      new Response(JSON.stringify({
        availableAgentModes: ['standard', 'logic'],
        availableExecutionProfiles: ['fast'],
        protocolVersion: 'fast-agent-v2',
        reason: 'normal_path',
      }), { headers: { 'Content-Type': 'application/json' } })
    ));

    await expect(getHostedAgentExecutionProfileAvailability()).resolves.toEqual(['fast']);
    await expect(getHostedAgentCapabilityAvailability()).resolves.toEqual({
      agentModes: ['standard', 'logic'],
      modelClasses: ['very-fast', 'fast', 'slow'],
    });
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      '/api/kernel/normal/capabilities',
      '/api/kernel/normal/capabilities',
    ]);
  });
});
