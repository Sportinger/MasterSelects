// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  buildHostedAgentAssertionClaims,
  signHostedAgentServiceAssertion,
  verifyHostedAgentServiceAssertion,
} from '../../functions/lib/hostedAgent/assertion';

const secret = 'k0-test-service-assertion-secret-with-at-least-32-characters';

function claims(now = new Date('2026-07-30T12:00:00.000Z')) {
  return buildHostedAgentAssertionClaims({
    clientInstanceId: 'client-1',
    maximumIterations: 1,
    maxTurnSpendCredits: 20,
    model: 'gpt-5-6-terra',
    nonce: 'nonce-1',
    now,
    providerProtocol: 'openai-responses',
    sessionId: 'session-1',
    toolExecutionMode: 'normal',
    turnId: 'turn-1',
    userId: 'user-1',
  });
}

describe('hosted-agent K0 service assertion', () => {
  it('binds the authenticated identity, turn, model, protocol, and maximum spend', async () => {
    const issuedAt = new Date('2026-07-30T12:00:00.000Z');
    const assertion = await signHostedAgentServiceAssertion(claims(issuedAt), secret);
    const verified = await verifyHostedAgentServiceAssertion(
      assertion,
      secret,
      new Date('2026-07-30T12:01:00.000Z'),
    );

    expect(verified).toMatchObject({
      clientInstanceId: 'client-1',
      maximumIterations: 1,
      maxTurnSpendCredits: 20,
      model: 'gpt-5-6-terra',
      protocolVersion: 'hosted-agent-k2-v1',
      providerProtocol: 'openai-responses',
      sessionId: 'session-1',
      sub: 'user-1',
      toolExecutionMode: 'normal',
      turnId: 'turn-1',
    });
    expect(assertion).not.toContain('user-1');
  });

  it('rejects tampering and expiry', async () => {
    const issuedAt = new Date('2026-07-30T12:00:00.000Z');
    const assertion = await signHostedAgentServiceAssertion(claims(issuedAt), secret);
    const segments = assertion.split('.');
    const tampered = `${segments[0]}.${segments[1]}.${segments[2].slice(0, -1)}x`;

    await expect(
      verifyHostedAgentServiceAssertion(
        tampered,
        secret,
        new Date('2026-07-30T12:00:30.000Z'),
      ),
    ).rejects.toMatchObject({ code: 'assertion_invalid' });
    await expect(
      verifyHostedAgentServiceAssertion(
        assertion,
        secret,
        new Date('2026-07-30T12:02:01.000Z'),
      ),
    ).rejects.toMatchObject({ code: 'assertion_expired' });
  });
});
