import type { CompleteTestMigrationEntry } from './types';

export const completeTestMigrationLedger = [
  {
    path: 'tests/unit/projectMediaPersistence.test.ts',
    classification: 'split',
    ownerLane: 'project-schema-freeze',
    replacementGate: 'P3_PROJECT_SCHEMA_BOUNDARY',
    note: 'Project persistence coverage should move toward current schema, runtime restore, and adapter contract tests.',
  },
  {
    path: 'tests/unit/timelineArchitectureRegistry.test.ts',
    classification: 'keep',
    ownerLane: 'architecture-registry',
    replacementGate: 'P0_COMPLETE_ARCHITECTURE_REGISTRY',
    note: 'Timeline registry test remains the method reference while whole-codebase registry tests are added separately.',
  },
  {
    path: 'tests/unit/importers/universalImportOrchestrator.test.ts',
    classification: 'keep',
    ownerLane: 'universal-signals-importers',
    replacementGate: 'P1B_UNIVERSAL_IMPORT_ROUTE_MATRIX',
    note: 'Universal import tests are active signal foundation coverage.',
  },
] as const satisfies readonly CompleteTestMigrationEntry[];
