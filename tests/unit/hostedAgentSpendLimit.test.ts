import { describe, expect, it } from 'vitest';
import { maximumHostedAgentTurnSpendCredits } from '../../functions/lib/hostedAgent/route';

describe('hosted-agent spend limits', () => {
  it('raises only the local development ceiling for expensive agent profiles', () => {
    expect(maximumHostedAgentTurnSpendCredits('development')).toBe(2_000);
    expect(maximumHostedAgentTurnSpendCredits('production')).toBe(500);
    expect(maximumHostedAgentTurnSpendCredits()).toBe(500);
  });
});
