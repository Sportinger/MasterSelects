import { describe, expect, it, vi } from 'vitest';

import {
  HOSTED_AGENT_FAST_V2_BUDGET_POLICY_VERSION,
  HOSTED_AGENT_FAST_V2_CAPABILITY_BUNDLE_VERSION,
  HOSTED_AGENT_FAST_V2_MODEL_POLICY_VERSION,
  HOSTED_AGENT_FAST_V2_PROMPT_VERSION,
  HostedAgentFastV2ReconnectableError,
  HostedAgentFastV2UnsupportedOperationError,
  HostedAgentK2ClientSession,
  adaptHostedAgentFastV2TransportToK2,
  type HostedAgentFastV2FetchTransport,
} from '../../src/services/kernelClient/hostedAgent';

const TURN_ID = 'turn-v2-adapter';
const SESSION_ID = 'session-v2-adapter';

function transport(): HostedAgentFastV2FetchTransport {
  let attempts = 0;
  return {
    cancel: vi.fn(),
    getProtocol: vi.fn(),
    postOperationResult: vi.fn(),
    postOperationSettlement: vi.fn(async () => {
      throw new HostedAgentFastV2UnsupportedOperationError('unsupported');
    }),
    replayEvents: vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new HostedAgentFastV2ReconnectableError('temporary outage');
      }
      return {
        cursor: '2',
        events: [{
          budgetPolicyVersion: HOSTED_AGENT_FAST_V2_BUDGET_POLICY_VERSION,
          capabilityBundleVersion: HOSTED_AGENT_FAST_V2_CAPABILITY_BUNDLE_VERSION,
          eventId: '1',
          kind: 'session-ready' as const,
          maximumIterations: 4,
          maximumSpendCredits: 500,
          modelPolicyVersion: HOSTED_AGENT_FAST_V2_MODEL_POLICY_VERSION,
          promptVersion: HOSTED_AGENT_FAST_V2_PROMPT_VERSION,
          protocolVersion: 'fast-agent-v2' as const,
          sessionId: SESSION_ID,
          snapshotStateFingerprint: `sha256:${'a'.repeat(64)}`,
          snapshotTimelineRevision: 3,
          turnId: TURN_ID,
        }, {
          creditsCharged: 5,
          eventId: '2',
          kind: 'turn-complete' as const,
          message: 'Done.',
          protocolVersion: 'fast-agent-v2' as const,
          rounds: 1,
          sessionId: SESSION_ID,
          turnId: TURN_ID,
        }],
        leaseExpiresAt: '2026-08-01T18:00:00.000Z',
        sessionId: SESSION_ID,
        status: 'completed',
        turnId: TURN_ID,
      };
    }),
    start: vi.fn(),
  };
}

describe('Fast V2 K2 reliability adapter', () => {
  it('translates the V2 reconnectable error into the proven K2 retry path', async () => {
    const v2 = transport();
    const client = new HostedAgentK2ClientSession({
      clientInstanceId: 'client-v2-adapter',
      lease: {
        expiresAt: '2026-08-01T18:00:00.000Z',
        leaseToken: 'lease-v2-adapter',
        sessionId: SESSION_ID,
      },
      toolSchemaVersion: HOSTED_AGENT_FAST_V2_CAPABILITY_BUNDLE_VERSION,
      transport: adaptHostedAgentFastV2TransportToK2(v2),
      turnId: TURN_ID,
    });
    const result = await client.runUntilTerminal({
      execute: async () => {
        throw new Error('unexpected tool batch');
      },
      maximumReconnects: 2,
      reconnectDelayMs: 0,
    });

    expect(result).toEqual({ cursor: '2', status: 'completed' });
    expect(v2.replayEvents).toHaveBeenCalledTimes(2);
  });

  it('fails locally if a V2 event ever asks for a removed client tool surface', async () => {
    const adapted = adaptHostedAgentFastV2TransportToK2(transport());
    await expect(adapted.postToolResults({
      batch: {} as never,
      clientInstanceId: 'client-v2-adapter',
      leaseToken: 'lease-v2-adapter',
      sessionId: SESSION_ID,
      turnId: TURN_ID,
    })).rejects.toBeInstanceOf(HostedAgentFastV2UnsupportedOperationError);
  });
});
