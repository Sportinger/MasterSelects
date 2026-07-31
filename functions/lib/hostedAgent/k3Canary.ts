export type HostedAgentK3CorpusCategory =
  | 'analysis'
  | 'edit'
  | 'long-multi-round'
  | 'read'
  | 'visual-verification';

export interface HostedAgentK3CorpusTask {
  category: HostedAgentK3CorpusCategory;
  id: string;
  mutatesEditor: boolean;
}

export interface HostedAgentK3ToolBatchOutcome {
  groupedTransaction: boolean;
  toolNames: string[];
  toolSuccess: boolean[];
  undoEntries: number;
}

export interface HostedAgentK3TaskOutcome {
  creditsCharged: number;
  finalStateDigest: string;
  latencyMs: number;
  narration: string[];
  providerRounds: number;
  toolBatches: HostedAgentK3ToolBatchOutcome[];
}

export interface HostedAgentK3CorpusAdapter {
  run(task: HostedAgentK3CorpusTask): Promise<HostedAgentK3TaskOutcome>;
}

export interface HostedAgentK3ProductionEvidence {
  actualRoutingIntegrated: boolean;
  encryptedMultiInstanceSessionStore: boolean;
  featureFlagRollbackConfigured: boolean;
  multiRoundD1Authority: boolean;
  privateOriginDeployed: boolean;
  productionTelemetrySink: boolean;
  realKieBillingCanary: boolean;
  realProductionSseReplay: boolean;
}

export interface HostedAgentK3LatencyBudget {
  maximumHostedLatencyMs: number;
  maximumOverheadMs: number;
  source: 'controlled-k0' | 'production-canary';
}

export interface HostedAgentK3TaskParity {
  category: HostedAgentK3CorpusCategory;
  failure?: 'adapter_failed' | 'invalid_metrics';
  finalStateEquivalent: boolean;
  groupedUndoEquivalent: boolean;
  id: string;
  latencyWithinBudget: boolean;
  narrationEquivalent: boolean;
  providerRoundsEquivalent: boolean;
  spendEquivalent: boolean;
  toolBehaviorEquivalent: boolean;
}

export interface HostedAgentK3CanaryReport {
  blockingReasons: Array<
    | 'corpus_parity_failed'
    | 'production_evidence_missing'
    | 'production_latency_budget_missing'
    | 'rollback_not_proven'
  >;
  controlledCorpusPassed: boolean;
  cutoverDecision: 'go' | 'no-go';
  productionEvidenceComplete: boolean;
  rollbackProven: boolean;
  tasks: HostedAgentK3TaskParity[];
}

export const HOSTED_AGENT_K3_REPRESENTATIVE_CORPUS: HostedAgentK3CorpusTask[] = [
  { category: 'read', id: 'read-timeline-state', mutatesEditor: false },
  { category: 'edit', id: 'grouped-timeline-edit', mutatesEditor: true },
  { category: 'analysis', id: 'media-analysis', mutatesEditor: false },
  { category: 'visual-verification', id: 'frame-visual-verification', mutatesEditor: false },
  { category: 'long-multi-round', id: 'inspect-edit-verify-loop', mutatesEditor: true },
];

// K0 proved only a local proxy handler ceiling for the 256 KiB fixture. It is
// executable regression input, not a production end-to-end latency SLO.
export const HOSTED_AGENT_K0_CONTROLLED_LATENCY_REFERENCE: HostedAgentK3LatencyBudget = {
  maximumHostedLatencyMs: 2_000,
  maximumOverheadMs: 2_000,
  source: 'controlled-k0',
};

function exactJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validOutcome(outcome: HostedAgentK3TaskOutcome): boolean {
  return Number.isFinite(outcome.creditsCharged)
    && outcome.creditsCharged >= 0
    && /^[a-f0-9]{64}$/.test(outcome.finalStateDigest)
    && Number.isFinite(outcome.latencyMs)
    && outcome.latencyMs >= 0
    && Number.isInteger(outcome.providerRounds)
    && outcome.providerRounds > 0
    && outcome.narration.every((entry) => typeof entry === 'string')
    && outcome.toolBatches.every((batch) => (
      batch.toolNames.length === batch.toolSuccess.length
      && batch.toolNames.every((name) => /^[A-Za-z0-9:_-]{1,160}$/.test(name))
      && batch.toolSuccess.every((success) => typeof success === 'boolean')
      && Number.isInteger(batch.undoEntries)
      && batch.undoEntries >= 0
    ));
}

function groupedUndoEquivalent(
  task: HostedAgentK3CorpusTask,
  legacy: HostedAgentK3TaskOutcome,
  hosted: HostedAgentK3TaskOutcome,
): boolean {
  const grouping = (outcome: HostedAgentK3TaskOutcome) => outcome.toolBatches.map((batch) => ({
    groupedTransaction: batch.groupedTransaction,
    toolCount: batch.toolNames.length,
    undoEntries: batch.undoEntries,
  }));
  if (!exactJson(grouping(legacy), grouping(hosted))) {
    return false;
  }
  if (!task.mutatesEditor) {
    return true;
  }
  return legacy.toolBatches.every((batch) => (
    batch.groupedTransaction && batch.undoEntries === 1
  )) && hosted.toolBatches.every((batch) => (
    batch.groupedTransaction && batch.undoEntries === 1
  ));
}

function compareTask(
  task: HostedAgentK3CorpusTask,
  legacy: HostedAgentK3TaskOutcome,
  hosted: HostedAgentK3TaskOutcome,
  latencyBudget: HostedAgentK3LatencyBudget,
): HostedAgentK3TaskParity {
  if (!validOutcome(legacy) || !validOutcome(hosted)) {
    return {
      category: task.category,
      failure: 'invalid_metrics',
      finalStateEquivalent: false,
      groupedUndoEquivalent: false,
      id: task.id,
      latencyWithinBudget: false,
      narrationEquivalent: false,
      providerRoundsEquivalent: false,
      spendEquivalent: false,
      toolBehaviorEquivalent: false,
    };
  }
  const toolShape = (outcome: HostedAgentK3TaskOutcome) => outcome.toolBatches.map((batch) => ({
    toolNames: batch.toolNames,
    toolSuccess: batch.toolSuccess,
  }));
  return {
    category: task.category,
    finalStateEquivalent: legacy.finalStateDigest === hosted.finalStateDigest,
    groupedUndoEquivalent: groupedUndoEquivalent(task, legacy, hosted),
    id: task.id,
    latencyWithinBudget: hosted.latencyMs <= latencyBudget.maximumHostedLatencyMs
      && hosted.latencyMs - legacy.latencyMs <= latencyBudget.maximumOverheadMs,
    narrationEquivalent: exactJson(legacy.narration, hosted.narration),
    providerRoundsEquivalent: legacy.providerRounds === hosted.providerRounds,
    spendEquivalent: legacy.creditsCharged === hosted.creditsCharged,
    toolBehaviorEquivalent: exactJson(toolShape(legacy), toolShape(hosted))
      && hosted.toolBatches.every((batch) => batch.toolSuccess.every(Boolean)),
  };
}

function taskPassed(task: HostedAgentK3TaskParity): boolean {
  return task.failure === undefined
    && task.finalStateEquivalent
    && task.groupedUndoEquivalent
    && task.latencyWithinBudget
    && task.narrationEquivalent
    && task.providerRoundsEquivalent
    && task.spendEquivalent
    && task.toolBehaviorEquivalent;
}

function productionEvidenceComplete(evidence: HostedAgentK3ProductionEvidence): boolean {
  return Object.values(evidence).every((value) => value === true);
}

export async function runHostedAgentK3Canary(input: {
  corpus?: HostedAgentK3CorpusTask[];
  hosted: HostedAgentK3CorpusAdapter;
  latencyBudget: HostedAgentK3LatencyBudget;
  legacy: HostedAgentK3CorpusAdapter;
  productionEvidence: HostedAgentK3ProductionEvidence;
  rollbackProven: boolean;
}): Promise<HostedAgentK3CanaryReport> {
  if (
    !Number.isFinite(input.latencyBudget.maximumHostedLatencyMs)
    || input.latencyBudget.maximumHostedLatencyMs <= 0
    || !Number.isFinite(input.latencyBudget.maximumOverheadMs)
    || input.latencyBudget.maximumOverheadMs < 0
  ) {
    throw new Error('The hosted-agent K3 latency budget is invalid.');
  }
  const corpus = input.corpus ?? HOSTED_AGENT_K3_REPRESENTATIVE_CORPUS;
  const tasks: HostedAgentK3TaskParity[] = [];
  for (const task of corpus) {
    try {
      const legacy = await input.legacy.run(task);
      const hosted = await input.hosted.run(task);
      tasks.push(compareTask(task, legacy, hosted, input.latencyBudget));
    } catch {
      tasks.push({
        category: task.category,
        failure: 'adapter_failed',
        finalStateEquivalent: false,
        groupedUndoEquivalent: false,
        id: task.id,
        latencyWithinBudget: false,
        narrationEquivalent: false,
        providerRoundsEquivalent: false,
        spendEquivalent: false,
        toolBehaviorEquivalent: false,
      });
    }
  }
  const controlledCorpusPassed = corpus.length > 0
    && tasks.length === corpus.length
    && tasks.every(taskPassed);
  const evidenceComplete = productionEvidenceComplete(input.productionEvidence);
  const blockingReasons: HostedAgentK3CanaryReport['blockingReasons'] = [];
  if (!controlledCorpusPassed) {
    blockingReasons.push('corpus_parity_failed');
  }
  if (!evidenceComplete) {
    blockingReasons.push('production_evidence_missing');
  }
  if (input.latencyBudget.source !== 'production-canary') {
    blockingReasons.push('production_latency_budget_missing');
  }
  if (!input.rollbackProven) {
    blockingReasons.push('rollback_not_proven');
  }
  return {
    blockingReasons,
    controlledCorpusPassed,
    cutoverDecision: blockingReasons.length === 0 ? 'go' : 'no-go',
    productionEvidenceComplete: evidenceComplete,
    rollbackProven: input.rollbackProven,
    tasks,
  };
}
