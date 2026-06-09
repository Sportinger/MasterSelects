export const completeArchitectureGateStatuses = [
  'active',
  'satisfied',
  'retired',
] as const;

export type CompleteArchitectureGateStatus =
  (typeof completeArchitectureGateStatuses)[number];

export type CompleteRefactorPhase =
  | 'P0'
  | 'P1'
  | 'P1A'
  | 'P1B'
  | 'P2'
  | 'P3'
  | 'P4'
  | 'P5'
  | 'P6'
  | 'P7'
  | 'P8';

export interface CompleteArchitectureGate {
  id: string;
  phase: CompleteRefactorPhase;
  title: string;
  status: CompleteArchitectureGateStatus;
  dependsOn?: readonly string[];
  retiredByGate?: string;
}

export type CompleteRefactorLaneStatus = 'active' | 'planned' | 'done';

export interface CompleteRefactorLane {
  id: string;
  name: string;
  owner: string;
  status: CompleteRefactorLaneStatus;
  writeSet: readonly string[];
  forbiddenWriteSet: readonly string[];
  exitGates: readonly string[];
  highConflictFiles?: readonly string[];
  activeUntilGate?: string;
}

export interface CompleteHighConflictOwnership {
  path: string;
  laneId: string;
}

export interface CompleteAdapterDebtEntry {
  id: string;
  ownerLane: string;
  introducedPhase: CompleteRefactorPhase;
  writeSet: readonly string[];
  deleteBy: string;
  acceptanceTests: readonly string[];
  activeUntilGate?: string;
  note: string;
}

export type CompleteRetiredPathClassification =
  | 'delete now'
  | 'delete at gate'
  | 'keep';

export interface CompleteRetiredPathEntry {
  id: string;
  path: string;
  classification: CompleteRetiredPathClassification;
  ownerLane: string;
  deleteBy?: string;
  keepReason?: string;
  replacementGate?: string;
  note: string;
}

export type CompleteTestMigrationClassification =
  | 'port'
  | 'replace'
  | 'split'
  | 'delete'
  | 'keep';

export interface CompleteTestMigrationEntry {
  path: string;
  classification: CompleteTestMigrationClassification;
  ownerLane: string;
  replacementGate: string;
  note: string;
}

export interface CompleteExitCriteriaEvidence {
  kind: 'test' | 'source' | 'docs' | 'manual-check' | 'scan';
  path: string;
  note: string;
}

export interface CompleteExitCriteriaCoverage {
  gateId: string;
  criteria: readonly string[];
  evidence: readonly CompleteExitCriteriaEvidence[];
}
