import { completeArchitectureGates } from './gateRegistry';
import { motionDesignExitCriteriaCoverage } from './motionDesignGateRegistry';
import type { CompleteExitCriteriaCoverage } from './types';

const motionDesignCoverageByGateId = new Map(
  motionDesignExitCriteriaCoverage.map((entry) => [entry.gateId, entry]),
);

export const completeExitCriteriaCoverage = completeArchitectureGates.map((gate) => ({
  ...(motionDesignCoverageByGateId.get(gate.id) ?? {
    gateId: gate.id,
    criteria: [
      `${gate.id} has explicit subchecks, write set, forbidden files, focused checks, and exit criteria in the Complete Refactor plan.`,
    ],
    evidence: [
      {
        kind: 'docs' as const,
        path: 'docs/completed/refactor/Complete-refactor-checklist.md',
        note: 'The checklist tracks gate subchecks and phase readiness.',
      },
      {
        kind: 'docs' as const,
        path: 'docs/completed/refactor/complete-refactor/execution-queue-and-lanes.md',
        note: 'The execution queue records packet write sets, forbidden files, checks, and stop conditions.',
      },
    ],
  }),
})) as readonly CompleteExitCriteriaCoverage[];
