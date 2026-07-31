import type { CompleteArchitectureGate } from './types';

/**
 * Storyboard Plan Mode gates stay independent from the older Complete Refactor
 * phases. The shared phase field only orders them in the existing registry UI;
 * dependencies below are the authoritative Storyboard execution order.
 */
export const storyboardArchitectureGates = [
  {
    id: 'SB_F0_HOSTED_CHAT_SAFETY',
    phase: 'P0',
    title: 'F0 hosted chat abort, spend, billing, and audit safety',
    status: 'satisfied',
  },
  {
    id: 'SB_N0_NARRATED_NORMAL_AI',
    phase: 'P0',
    title: 'N0 provider-neutral narrated normal AI activity',
    status: 'satisfied',
  },
  {
    id: 'SB_C0_CONTRACT_FREEZE',
    phase: 'P0',
    title: 'C0 storyboard schemas, migrations, and public contracts are frozen',
    status: 'satisfied',
  },
  {
    id: 'SB_K0_HOSTED_AGENT_FEASIBILITY',
    phase: 'P0',
    title: 'K0 hosted-agent transport, identity, billing, and payload feasibility',
    status: 'active',
    dependsOn: ['SB_F0_HOSTED_CHAT_SAFETY'],
  },
  {
    id: 'SB_K1_HOSTED_AGENT_PARITY',
    phase: 'P1',
    title: 'K1 hosted-agent loop matches the existing direct agent behavior',
    status: 'active',
    dependsOn: ['SB_K0_HOSTED_AGENT_FEASIBILITY'],
  },
  {
    id: 'SB_G1_FOUNDATION',
    phase: 'P1',
    title: 'G1 storyboard, chat, candidate, and variant foundations integrate',
    status: 'satisfied',
    dependsOn: [
      'SB_C0_CONTRACT_FREEZE',
      'SB_N0_NARRATED_NORMAL_AI',
    ],
  },
  {
    id: 'SB_K2_HOSTED_AGENT_RELIABILITY',
    phase: 'P2',
    title: 'K2 hosted-agent replay, reconnect, cancellation, and redaction are reliable',
    status: 'active',
    dependsOn: [
      'SB_K1_HOSTED_AGENT_PARITY',
      'SB_N0_NARRATED_NORMAL_AI',
    ],
  },
  {
    id: 'SB_G2_SAFE_DIRECTING',
    phase: 'P2',
    title: 'G2 plan mode, decisions, approval, and animatic interoperate safely',
    status: 'satisfied',
    dependsOn: [
      'SB_F0_HOSTED_CHAT_SAFETY',
      'SB_G1_FOUNDATION',
    ],
  },
  {
    id: 'SB_G3_COMPARISON',
    phase: 'P3',
    title: 'G3 isolated options compare against one unchanged base',
    status: 'satisfied',
    dependsOn: ['SB_G2_SAFE_DIRECTING'],
  },
  {
    id: 'SB_K3_HOSTED_AGENT_CUTOVER',
    phase: 'P3',
    title: 'K3 hosted-agent canary meets parity budgets and retains rollback',
    status: 'active',
    dependsOn: ['SB_K2_HOSTED_AGENT_RELIABILITY'],
  },
  {
    id: 'SB_G4_COMMIT',
    phase: 'P4',
    title: 'G4 selected range commits once with stale and isolation checks',
    status: 'satisfied',
    dependsOn: ['SB_G3_COMPARISON'],
  },
  {
    id: 'SB_G5_RELEASE',
    phase: 'P8',
    title: 'G5 storyboard release evidence, accessibility, stress, and E2E pass',
    status: 'satisfied',
    dependsOn: ['SB_G4_COMMIT'],
  },
] as const satisfies readonly CompleteArchitectureGate[];

export const storyboardArchitectureGateIds = storyboardArchitectureGates.map(
  (gate) => gate.id,
);
