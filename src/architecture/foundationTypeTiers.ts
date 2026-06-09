export type FoundationTypeTierId =
  | 'pure-project-schema'
  | 'durable-domain'
  | 'runtime-lease'
  | 'render-runtime'
  | 'compatibility-facade';

export type FoundationTypeEntryPointStatus =
  | 'active'
  | 'planned'
  | 'compatibility-debt';

export type FoundationRuntimeHandlePolicy =
  | 'forbidden'
  | 'lease-owner-only'
  | 'render-runtime-only'
  | 'compatibility-debt';

export interface FoundationTypeEntryPoint {
  id: string;
  tier: FoundationTypeTierId;
  path: string;
  status: FoundationTypeEntryPointStatus;
  gateId: string;
  runtimeHandlePolicy: FoundationRuntimeHandlePolicy;
  retirementGate?: string;
  note: string;
}

export interface FoundationRuntimeHandleClassification {
  path: string;
  ownerTier: FoundationTypeTierId;
  maxCurrentHits: number;
  gateId: string;
  note: string;
}

export interface FoundationProjectSchemaImportClassification {
  path: string;
  maxCurrentHits: number;
  handoffPacket: string;
  gateId: string;
  note: string;
}

export const foundationTypeBoundaryBaselines = {
  directGlobalTypeImportHits: 755,
  allTypesImportFiles: 776,
  sharedSchemaRuntimeHandleTokenHits: 23,
  projectSchemaProductImportHits: 0,
  globalTypesIndexRawLines: 1194,
  globalTypesIndexTargetLines: 150,
} as const;

export const foundationTypeEntryPoints = [
  {
    id: 'project-schema-dto',
    tier: 'pure-project-schema',
    path: 'src/services/project/types/**',
    status: 'active',
    gateId: 'P1_PROJECT_SCHEMA_NO_STORE_IMPORTS',
    runtimeHandlePolicy: 'forbidden',
    note: 'Project schema DTOs must become schema-owned and runtime-free.',
  },
  {
    id: 'audio-contracts',
    tier: 'durable-domain',
    path: 'src/types/audio.ts',
    status: 'active',
    gateId: 'P1_TYPE_TIER_DEFINED',
    runtimeHandlePolicy: 'forbidden',
    note: 'Audio analysis, edit, and project audio contracts are serializable metadata.',
  },
  {
    id: 'dock-contracts',
    tier: 'durable-domain',
    path: 'src/types/dock.ts',
    status: 'active',
    gateId: 'P1_TYPE_TIER_DEFINED',
    runtimeHandlePolicy: 'forbidden',
    note: 'Dock contracts carry UI layout state and deprecated panel retirement metadata.',
  },
  {
    id: 'history-contracts',
    tier: 'durable-domain',
    path: 'src/types/history.ts',
    status: 'active',
    gateId: 'P1_TYPE_TIER_DEFINED',
    runtimeHandlePolicy: 'forbidden',
    note: 'History contracts describe serializable project history state.',
  },
  {
    id: 'vector-animation-contracts',
    tier: 'durable-domain',
    path: 'src/types/vectorAnimation.ts',
    status: 'active',
    gateId: 'P1_TYPE_TIER_DEFINED',
    runtimeHandlePolicy: 'forbidden',
    note: 'Vector animation contracts describe serializable playback settings and metadata.',
  },
  {
    id: 'signal-contracts',
    tier: 'durable-domain',
    path: 'src/signals/types.ts',
    status: 'active',
    gateId: 'P1B_SIGNAL_DTO_RUNTIME_FREE',
    runtimeHandlePolicy: 'forbidden',
    note: 'Signal DTOs are the durable contract for universal import state.',
  },
  {
    id: 'importer-contracts',
    tier: 'durable-domain',
    path: 'src/importers/types.ts',
    status: 'active',
    gateId: 'P1B_UNIVERSAL_IMPORT_ROUTE_MATRIX',
    runtimeHandlePolicy: 'forbidden',
    note: 'Importer contracts describe route metadata; File and Blob IO stay in importer implementations.',
  },
  {
    id: 'media-runtime-lease-contracts',
    tier: 'runtime-lease',
    path: 'src/services/mediaRuntime/types.ts',
    status: 'planned',
    gateId: 'P1A_SINGLE_RUNTIME_LEASE_DOMAIN',
    runtimeHandlePolicy: 'lease-owner-only',
    note: 'Media runtime contracts own live handles only behind the canonical lease domain.',
  },
  {
    id: 'render-target-contracts',
    tier: 'render-runtime',
    path: 'src/types/renderTarget.ts',
    status: 'active',
    gateId: 'P5_RENDER_TARGET_SNAPSHOT_CONTRACT',
    runtimeHandlePolicy: 'render-runtime-only',
    note: 'Render target contracts are runtime-facing and must not leak into project schema.',
  },
  {
    id: 'global-types-index',
    tier: 'compatibility-facade',
    path: 'src/types/index.ts',
    status: 'compatibility-debt',
    gateId: 'P1_GLOBAL_TYPES_BARREL_THIN',
    runtimeHandlePolicy: 'compatibility-debt',
    retirementGate: 'P1_GLOBAL_TYPES_BARREL_THIN',
    note: 'The global type barrel stays temporarily as compatibility debt while focused entry points take over.',
  },
] as const satisfies readonly FoundationTypeEntryPoint[];

export const foundationRuntimeHandleClassifications = [
  {
    path: 'src/types/index.ts',
    ownerTier: 'compatibility-facade',
    maxCurrentHits: 21,
    gateId: 'P1_RUNTIME_HANDLES_FORBIDDEN_IN_SHARED_SCHEMA',
    note: 'Runtime handles in the global type barrel are compatibility debt for P1A lease extraction.',
  },
  {
    path: 'src/types/renderTarget.ts',
    ownerTier: 'render-runtime',
    maxCurrentHits: 2,
    gateId: 'P5_RENDER_TARGET_SNAPSHOT_CONTRACT',
    note: 'Canvas and GPU context references are render-runtime contracts, not project schema DTOs.',
  },
] as const satisfies readonly FoundationRuntimeHandleClassification[];

export const foundationProjectSchemaImportClassifications = [] as const satisfies readonly FoundationProjectSchemaImportClassification[];
