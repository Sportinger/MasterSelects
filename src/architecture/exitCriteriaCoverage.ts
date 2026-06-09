import { completeArchitectureGates } from './gateRegistry';
import type { CompleteExitCriteriaCoverage } from './types';

export const completeExitCriteriaCoverage = completeArchitectureGates.map((gate) => ({
  gateId: gate.id,
  criteria: [
    `${gate.id} has explicit subchecks, write set, forbidden files, focused checks, and exit criteria in the Complete Refactor plan.`,
  ],
  evidence: [
    {
      kind: 'docs',
      path: 'docs/ongoing/Complete-refactor-checklist.md',
      note: 'The checklist tracks gate subchecks and phase readiness.',
    },
    {
      kind: 'docs',
      path: 'docs/ongoing/complete-refactor/execution-queue-and-lanes.md',
      note: 'The execution queue records packet write sets, forbidden files, checks, and stop conditions.',
    },
  ],
})) as readonly CompleteExitCriteriaCoverage[];
