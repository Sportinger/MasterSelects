import type {
  CompleteArchitectureGate,
  CompleteExitCriteriaCoverage,
} from './types';

/**
 * Motion Design uses the existing phase field only for registry ordering.
 * MDX dependencies are the authoritative execution order.
 */
export const motionDesignArchitectureGates = [
  {
    id: 'MDX0_BASELINE_CLOSED',
    phase: 'P0',
    title: 'MD0-MD2 evidence, regressions, architecture, and docs are green',
    status: 'satisfied',
  },
  {
    id: 'MDX1_OWNERSHIP_REGISTERED',
    phase: 'P0',
    title: 'Motion Design lane write sets and shared integration seams are registered',
    status: 'satisfied',
    dependsOn: ['MDX0_BASELINE_CLOSED'],
  },
  {
    id: 'MDX2_CONTRACTS_FROZEN',
    phase: 'P1',
    title: 'Motion Design 1.0 durable and evaluated contracts are fixture-tested',
    status: 'satisfied',
    dependsOn: ['MDX1_OWNERSHIP_REGISTERED'],
  },
  {
    id: 'MDX3_FOUNDATIONS_INTEGRATED',
    phase: 'P2',
    title: 'MD3 Replicator, MD6 Structure, and MD7 Render Graph are integrated',
    status: 'active',
    dependsOn: ['MDX2_CONTRACTS_FROZEN'],
  },
  {
    id: 'MDX4_PROCEDURAL_MEDIA_INTEGRATED',
    phase: 'P3',
    title: 'MD4 modifiers and MD5 media motion are integrated',
    status: 'active',
    dependsOn: ['MDX3_FOUNDATIONS_INTEGRATED'],
  },
  {
    id: 'MDX5_REUSABLE_CONTENT_INTEGRATED',
    phase: 'P4',
    title: 'MD8 reusable content and semantic AI workflows are integrated',
    status: 'active',
    dependsOn: ['MDX4_PROCEDURAL_MEDIA_INTEGRATED'],
  },
  {
    id: 'MDX6_RELEASE_GREEN',
    phase: 'P8',
    title: 'MD9 release matrix and all Motion Design 1.0 evidence are green',
    status: 'active',
    dependsOn: ['MDX5_REUSABLE_CONTENT_INTEGRATED'],
  },
] as const satisfies readonly CompleteArchitectureGate[];

export const motionDesignArchitectureGateIds = motionDesignArchitectureGates.map(
  (gate) => gate.id,
);

export const motionDesignExitCriteriaCoverage = motionDesignArchitectureGates.map((gate) => ({
  gateId: gate.id,
  criteria: [
    `${gate.id} must satisfy its recorded subchecks, evidence, and regression matrix before the next dependent gate starts.`,
  ],
  evidence: [
    {
      kind: 'docs',
      path: 'docs/plans/motion-design-md0-md9-multilane-execution-plan.md',
      note: 'The active Motion Design plan records ownership, gates, checks, and stop conditions.',
    },
    {
      kind: 'docs',
      path: 'docs/evidence/motion-design/',
      note: 'Phase reports, fixtures, screenshots, and handoff evidence are stored here.',
    },
  ],
})) as readonly CompleteExitCriteriaCoverage[];
