import { describe, expect, it } from 'vitest';

import {
  HOSTED_AGENT_K0_CONTROLLED_LATENCY_REFERENCE,
  HOSTED_AGENT_K3_REPRESENTATIVE_CORPUS,
  runHostedAgentK3Canary,
  type HostedAgentK3CorpusAdapter,
  type HostedAgentK3CorpusTask,
  type HostedAgentK3ProductionEvidence,
  type HostedAgentK3TaskOutcome,
} from '../../functions/lib/hostedAgent/k3Canary';

const completeEvidence: HostedAgentK3ProductionEvidence = {
  actualRoutingIntegrated: true,
  encryptedMultiInstanceSessionStore: true,
  featureFlagRollbackConfigured: true,
  multiRoundD1Authority: true,
  privateOriginDeployed: true,
  productionTelemetrySink: true,
  realKieBillingCanary: true,
  realProductionSseReplay: true,
};

const missingEvidence: HostedAgentK3ProductionEvidence = {
  actualRoutingIntegrated: false,
  encryptedMultiInstanceSessionStore: false,
  featureFlagRollbackConfigured: false,
  multiRoundD1Authority: false,
  privateOriginDeployed: false,
  productionTelemetrySink: false,
  realKieBillingCanary: false,
  realProductionSseReplay: false,
};

function fixtureOutcome(
  task: HostedAgentK3CorpusTask,
  latencyMs: number,
): HostedAgentK3TaskOutcome {
  const taskIndex = HOSTED_AGENT_K3_REPRESENTATIVE_CORPUS.findIndex(
    (candidate) => candidate.id === task.id,
  );
  const mutation = task.mutatesEditor;
  return {
    creditsCharged: task.category === 'long-multi-round' ? 18 : 6,
    finalStateDigest: String(Math.max(0, taskIndex) + 1).repeat(64),
    latencyMs,
    narration: [
      `narration-digest-${task.id}-0`,
      `narration-digest-${task.id}-1`,
    ],
    providerRounds: task.category === 'long-multi-round' ? 3 : 2,
    toolBatches: [{
      groupedTransaction: mutation,
      toolNames: mutation
        ? ['getTimelineState', 'moveTimelineClip']
        : [`inspect_${task.category.replace(/-/g, '_')}`],
      toolSuccess: mutation ? [true, true] : [true],
      undoEntries: mutation ? 1 : 0,
    }],
  };
}

function adapter(
  latencyMs: number,
  mutate?: (
    outcome: HostedAgentK3TaskOutcome,
    task: HostedAgentK3CorpusTask,
  ) => HostedAgentK3TaskOutcome,
): HostedAgentK3CorpusAdapter {
  return {
    async run(task) {
      const outcome = fixtureOutcome(task, latencyMs);
      return mutate?.(structuredClone(outcome), task) ?? outcome;
    },
  };
}

describe('hosted-agent K3 parity canary evaluator', () => {
  it('passes the five-category controlled corpus but keeps production NO-GO without external evidence', async () => {
    const report = await runHostedAgentK3Canary({
      hosted: adapter(120),
      latencyBudget: HOSTED_AGENT_K0_CONTROLLED_LATENCY_REFERENCE,
      legacy: adapter(100),
      productionEvidence: missingEvidence,
      rollbackProven: true,
    });

    expect(report.tasks.map((task) => task.category)).toEqual([
      'read',
      'edit',
      'analysis',
      'visual-verification',
      'long-multi-round',
    ]);
    expect(report.controlledCorpusPassed).toBe(true);
    expect(report.cutoverDecision).toBe('no-go');
    expect(report.blockingReasons).toEqual([
      'production_evidence_missing',
      'production_latency_budget_missing',
    ]);
    expect(JSON.stringify(report)).not.toContain('narration-digest');
  });

  it('can return GO only with full evidence, a production latency budget, and rollback proof', async () => {
    const report = await runHostedAgentK3Canary({
      hosted: adapter(120),
      latencyBudget: {
        maximumHostedLatencyMs: 500,
        maximumOverheadMs: 100,
        source: 'production-canary',
      },
      legacy: adapter(100),
      productionEvidence: completeEvidence,
      rollbackProven: true,
    });
    expect(report).toMatchObject({
      blockingReasons: [],
      controlledCorpusPassed: true,
      cutoverDecision: 'go',
      productionEvidenceComplete: true,
      rollbackProven: true,
    });
  });

  it('fails closed on tool, undo, final-state, spend, narration, round, and latency drift', async () => {
    const hosted = adapter(700, (outcome, task) => {
      if (task.category === 'edit') {
        outcome.toolBatches[0].toolSuccess[1] = false;
        outcome.toolBatches[0].undoEntries = 2;
        outcome.finalStateDigest = 'f'.repeat(64);
        outcome.creditsCharged += 6;
        outcome.narration.push('unexpected-narration');
        outcome.providerRounds += 1;
      }
      return outcome;
    });
    const report = await runHostedAgentK3Canary({
      hosted,
      latencyBudget: {
        maximumHostedLatencyMs: 500,
        maximumOverheadMs: 100,
        source: 'production-canary',
      },
      legacy: adapter(100),
      productionEvidence: completeEvidence,
      rollbackProven: true,
    });
    const edit = report.tasks.find((task) => task.category === 'edit');
    expect(edit).toMatchObject({
      finalStateEquivalent: false,
      groupedUndoEquivalent: false,
      latencyWithinBudget: false,
      narrationEquivalent: false,
      providerRoundsEquivalent: false,
      spendEquivalent: false,
      toolBehaviorEquivalent: false,
    });
    expect(report.cutoverDecision).toBe('no-go');
    expect(report.blockingReasons).toContain('corpus_parity_failed');
  });

  it('requires an independently proven one-flag rollback', async () => {
    const report = await runHostedAgentK3Canary({
      hosted: adapter(120),
      latencyBudget: {
        maximumHostedLatencyMs: 500,
        maximumOverheadMs: 100,
        source: 'production-canary',
      },
      legacy: adapter(100),
      productionEvidence: completeEvidence,
      rollbackProven: false,
    });
    expect(report.cutoverDecision).toBe('no-go');
    expect(report.blockingReasons).toEqual(['rollback_not_proven']);
  });
});
