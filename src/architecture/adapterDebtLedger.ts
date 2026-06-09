import type { CompleteAdapterDebtEntry } from './types';

export const completeAdapterDebtLedger = [
  {
    id: 'compat-types-index',
    ownerLane: 'foundation-contracts',
    introducedPhase: 'P1',
    writeSet: ['src/types/index.ts'],
    deleteBy: 'P1_GLOBAL_TYPES_BARREL_THIN',
    acceptanceTests: [
      'P1_TYPE_TIER_DEFINED',
      'P1_RUNTIME_HANDLES_FORBIDDEN_IN_SHARED_SCHEMA',
    ],
    note: 'src/types/index.ts remains a temporary compatibility facade until focused domain entry points replace broad imports.',
  },
  {
    id: 'project-schema-store-imports',
    ownerLane: 'project-schema-freeze',
    introducedPhase: 'P1',
    writeSet: ['src/services/project/types/**'],
    deleteBy: 'P1_PROJECT_SCHEMA_NO_STORE_IMPORTS',
    acceptanceTests: [
      'P1_PROJECT_SCHEMA_NO_STORE_IMPORTS',
      'P3_PROJECT_SCHEMA_BOUNDARY',
    ],
    note: 'Project schema still imports live store or engine-shaped types and must move to schema-owned DTOs.',
  },
  {
    id: 'media-runtime-field-compat',
    ownerLane: 'media-runtime-lease',
    introducedPhase: 'P1A',
    writeSet: ['src/types/**', 'src/services/mediaRuntime/**'],
    deleteBy: 'P2_STORE_PROJECT_CONTRACT_FREEZE',
    acceptanceTests: [
      'P1A_CLIP_SOURCE_DURABLE_RUNTIME_SPLIT',
      'P1A_RUNTIME_HANDLE_ROUNDTRIP_GUARD',
      'P2_STORE_PROJECT_CONTRACT_FREEZE',
    ],
    note: 'Legacy runtimeSourceId/runtimeSessionKey and live handles stay as compatibility debt until the P2/P3 store-project freeze migrates live state behind durable refs and runtime leases.',
  },
] as const satisfies readonly CompleteAdapterDebtEntry[];
