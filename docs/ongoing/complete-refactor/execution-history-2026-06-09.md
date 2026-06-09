# Complete Refactor - Execution History 2026-06-09

Archived from `docs/ongoing/complete-refactor/execution-queue-and-lanes.md` during queue compression.

This file preserves the long packet specs, completion reports, skeptical review notes, and early lane records that were removed from the live queue. Use the live queue for active work; read this archive only when historical packet details are needed.

---

# Complete Refactor - Execution Queue And Lanes

Source: split from `docs/ongoing/Complete-refactor.md` on 2026-06-09.

Back to index: [Complete-refactor.md](../Complete-refactor.md).

## Active Queue Rule

This file is the live queue, not the packet-history archive.

- Keep only the active packet plus the next few queued packets in full detail.
- When a packet completes, collapse it to one or two lines in
  `docs/ongoing/Complete-refactor-checklist.md`.
- Remove or summarize long completed packet specs unless they are still needed
  as reusable templates for the next wave.
- Prefer reusable check profiles over repeating the same `npm run test`, `tsc`,
  and `rg` blocks in every small extraction packet.
- Update this file only for active packet, next packet, gate/write-set,
  blocker, conflict, or verification-result changes.

## Dependency Order

The master orchestrator should execute in this order:

1. Phase 0 baseline and gates.
2. Phase 1 foundation contracts.
3. Phase 1A clip/media-source data versus runtime split.
4. Phase 1B Universal Signal foundation and format matrix.
5. Combined Phase 2/3 contract freeze for stores, project schema, project
   persistence, importers, history, FlashBoard persistence, and runtime leases.
6. Phase 2 store/runtime ownership implementation packets.
7. Phase 3 project persistence/importer implementation packets.
8. Phase 4 Media Panel and FlashBoard.
9. Phase 5 Preview, Export, and Common UI.
10. Phase 6 Render, Audio, WebCodecs, Proxy, Cache.
11. Phase 7 AI tools/dev bridge/smokes.
12. Phase 8 test suite and architecture gates.

Phase 4 and Phase 5 can overlap only after Phase 1A and the combined P2/P3
contract freeze are accepted. Phase 5 and Phase 6 must be sequenced whenever
they touch engine export state, render target store, Preview registration,
render snapshots, output routing, or export runners. Phase 7 can start earlier
for read-only smoke inventory, but bridge source edits should wait until the
product contracts it calls are stable.

## P0/P1 High-Conflict Ownership And Packet Queue

This section is the current bounded preflight packet:

```text
Lane: P0/P1 Orchestration
Packet: P0-P1-PREFLIGHT-001
Mode: implementation, docs-only
Goal: make baseline commands, P0/P1 gates, high-conflict ownership, forbidden
files, checks, and first queued packets explicit before any source refactor.
Allowed write set:
- docs/ongoing/Complete-refactor.md
- docs/ongoing/Complete-refactor-checklist.md
- docs/ongoing/complete-refactor/**
Forbidden files:
- src/**
- tests/**
- scripts/**
- package.json
- package-lock.json
- src/timeline/architecture/**
Current contract: plan/checklist contain gate names and phase-level write sets.
Target contract: P0/P1 have exact scan/check ids, packet-level conflict
ownership, stop conditions, and queued implementation packets.
Expected gates:
- P0_BASELINE_CAPTURED
- P0_BASELINE_REFRESHED
- P0_COMPLETE_ARCHITECTURE_REGISTRY
- P1_TYPE_TIER_DEFINED
- P1_TYPE_TIER_NO_RUNTIME_IMPORTS
- P1_PROJECT_SCHEMA_NO_STORE_IMPORTS
Expected checks:
- rg -n "P0-P1-PREFLIGHT-001|P0S_DOMAIN_LOC|P1S_PROJECT_SCHEMA_NO_PRODUCT_IMPORTS" docs/ongoing/Complete-refactor.md docs/ongoing/Complete-refactor-checklist.md docs/ongoing/complete-refactor
- git status --short -- docs/ongoing/Complete-refactor.md docs/ongoing/Complete-refactor-checklist.md docs/ongoing/complete-refactor
Expected report:
- files split or changed
- checklist items advanced
- verification commands run
- source/tooling packets still blocked or newly approved
Checkpoint policy:
- docs-only packet checkpoints are checklist updates, not commits, unless the
  user requests commit/push
- source/tooling packets may checkpoint only after their focused gate passes
- full build/lint/test is reserved for normal commit, push, merge, release, or
  explicit final readiness under `AGENTS.md`
Execution economy:
- checklist is the running user-visible status source; update phase or queue
  files only when the active packet, gate, write set, blocker, next packet, or
  verification result changes
- do not copy the same packet history into multiple docs
- do not let this queue become the packet-history archive; completed packets
  should collapse into checklist status plus reusable check profiles
- rerun architecture-registry checks only after architecture manifests, gates,
  ledgers, write sets, or registry tests change
- for small adjacent extraction slices, run broad smoke/test bundles at the
  coherent packet boundary; use narrower local checks during intermediate edits
Stop conditions:
- Any needed source/tooling edit is discovered.
- Timeline source or timeline architecture registry would need modification.
- A gate cannot be expressed without first running a new read-only baseline.
```

High-conflict ownership for P0/P1:

| Path or hub | Owner packet | Other packets may | Forbidden until |
|---|---|---|---|
| `src/types/index.ts` | `P1-CONTRACT-001` | read, measure fan-in | `P0-REG-001` green and final skeptical review accepted |
| `src/types/audio.ts`, `src/types/dock.ts`, `src/types/history.ts`, `src/types/vectorAnimation.ts` | `P1-CONTRACT-001` | read | same P1 packet owns focused edits |
| `src/services/project/types/**` | `P1-P3-SCHEMA-FREEZE-001` | read, scan imports | combined P2/P3 contract freeze accepted |
| `src/services/mediaRuntime/**` | `P1A-RUNTIME-LEASE-001` | read, scan runtime handles | P2/P3 store-project freeze or explicit runtime adapter packet accepted |
| `src/signals/**` | `P1B-SIGNAL-DTO-001` | read, scan runtime handles | P1/P3 schema freeze or explicit signal implementation packet accepted |
| `src/importers/**` | `P1B-SIGNAL-DTO-001` | read, scan route matrix | P1/P3 schema freeze or explicit importer implementation packet accepted |
| `src/stores/timeline/**` | protected Timeline integration lane | read only | explicit integration packet for hydration/runtime/signal/render snapshot |
| `src/components/timeline/**` | protected Timeline integration lane | read only | explicit integration packet for hydration/runtime/signal/render snapshot |
| `src/timeline/architecture/**` | protected template/reference | read only | user-approved registry-template edit |
| `src/stores/mediaStore/**`, `src/stores/historyStore.ts`, `src/stores/dockStore.ts`, `src/stores/renderTargetStore.ts` | `P2-STORE-RUNTIME-FREEZE-001` | read, scan | P2/P3 contract freeze accepted |
| `src/engine/**`, `src/components/preview/**`, `src/components/export/**` | later P5/P6 joint packets | read, smoke only | render snapshot/output-router contracts frozen |
| `src/services/aiTools/**` | later P7 smoke quarantine packets | read, smoke inventory only | Phase 0 smoke thresholds accepted |

Queued first source/tooling packets, not started:

```text
Lane: P0 Baseline And Guard Rails
Packet: P0-REG-001 Complete Architecture Registry Preflight
Mode: implementation, architecture-gate tooling only
Goal: create a whole-codebase registry skeleton that generalizes the timeline
registry method without editing timeline registry files.
Read first:
- src/timeline/architecture/types.ts
- src/timeline/architecture/gateRegistry.ts
- src/timeline/architecture/laneWriteManifest.ts
- tests/unit/timelineArchitectureRegistry.test.ts
Allowed write set:
- proposed src/architecture/**
- proposed tests/unit/completeArchitectureRegistry.test.ts
- package.json only if adding a focused script is approved
Forbidden files:
- src/components/**
- src/stores/**
- src/engine/**
- src/services/** except no-op type imports needed by registry tests
- src/timeline/architecture/**
Current contract: whole-codebase gates are Markdown-only.
Target contract: lane ids, gate ids, write sets, forbidden sets, high-conflict
owners, retired/test ledgers, and exit criteria are machine-checkable.
Expected gates:
- P0_COMPLETE_ARCHITECTURE_REGISTRY
- P8_ARCHITECTURE_GATE_SUITE
Expected checks:
- npm run test -- tests/unit/completeArchitectureRegistry.test.ts
- npm run test -- tests/unit/timelineArchitectureRegistry.test.ts
Expected report:
- files read and changed
- registry entries created
- gates made executable
- any packet still Markdown-only
Stop conditions:
- A product source file must change.
- Timeline registry files must change.
- Registry shape would conflict with the timeline method instead of
  generalizing it.
```

```text
Lane: P1 Foundation Contracts
Packet: P1-CONTRACT-001 Type Tier Freeze
Mode: implementation, contracts only
Goal: define focused type-tier entry points and make new broad imports from
src/types/index.ts visible as compatibility debt before moving domain code.
Read first:
- src/types/index.ts
- src/types/audio.ts
- src/types/dock.ts
- src/types/history.ts
- src/services/project/types/**
- src/services/mediaRuntime/types.ts
- src/signals/types.ts
Allowed write set:
- src/types/**
- proposed architecture registry entries from P0-REG-001
- focused import-boundary tests created by P0-REG-001
Forbidden files:
- src/components/**
- src/engine/**
- src/services/project/projectLoad.ts
- src/services/project/projectSave.ts
- src/stores/**
- src/timeline/architecture/**
Current contract: shared type imports are broad and runtime handles can appear
inside shared type surfaces.
Target contract: pure schema, durable domain, runtime lease, render/runtime,
and compatibility facade tiers are explicit and gate-checked.
Expected gates:
- P1_TYPE_TIER_DEFINED
- P1_GLOBAL_TYPES_BARREL_THIN
- P1_TYPE_TIER_NO_RUNTIME_IMPORTS
- P1_RUNTIME_HANDLES_FORBIDDEN_IN_SHARED_SCHEMA
Expected checks:
- P1S_SHARED_SCHEMA_RUNTIME_FREE
- P1S_TYPE_BARREL_FANIN
- npm run test -- tests/unit/completeArchitectureRegistry.test.ts
Expected report:
- type tier entries added or changed
- broad imports measured, not blindly rewritten
- runtime-handle findings classified
Stop conditions:
- Project schema needs store/engine DTO replacement; hand off to
  P1-P3-SCHEMA-FREEZE-001.
- Runtime lease behavior is needed; hand off to P1A-RUNTIME-LEASE-001.
- Any UI/render/export behavior needs movement.
```

```text
Lane: P1A Clip And Media Source Runtime Split
Packet: P1A-RUNTIME-LEASE-001 Media Runtime Lease Contract
Mode: implementation, foundation contracts and tests only
Goal: define the durable media/source reference contract and canonical
mediaRuntime lease ownership before store, project, render, preview, export, or
Media Panel packets migrate runtime fields.
Read first:
- src/types/index.ts
- src/services/mediaRuntime/types.ts
- src/services/mediaRuntime/registry.ts
- src/services/mediaRuntime/clipBindings.ts
- src/stores/timeline/sourceRuntimeSanitizer.ts
- src/stores/timeline/helpers/blobUrlManager.ts
- src/stores/timeline/helpers/webCodecsHelpers.ts
- src/services/project/mediaObjectUrlManager.ts
Allowed write set:
- src/types/**
- src/services/mediaRuntime/**
- tests/unit/persistedStateRuntimeHandles.test.ts
- tests/unit/mediaRuntimeLeaseContracts.test.ts
- proposed architecture registry entries from P0-REG-001
Forbidden files:
- src/components/panels/MediaPanel.tsx
- src/components/timeline/**
- src/stores/timeline/**
- src/services/project/projectLoad.ts
- src/services/project/projectSave.ts
- src/engine/render/RenderDispatcher.ts
- src/components/export/ExportPanel.tsx
- src/timeline/architecture/**
Current contract: runtime fields and handles appear in shared source models,
and several object URL/decoder helpers still sit outside the canonical runtime
owner.
Target contract: `MediaAssetRef`, `TimelineSourceRef`, `MediaRuntimeLease`,
`RuntimeSourceId`, and `RenderFrameSource` are explicit; durable refs contain
ids/metadata only; `services/mediaRuntime` is the single lease domain.
Expected gates:
- P1A_CLIP_SOURCE_DURABLE_RUNTIME_SPLIT
- P1A_MEDIA_FILE_RUNTIME_SIDETABLE
- P1A_SINGLE_RUNTIME_LEASE_DOMAIN
- P1A_RUNTIME_HANDLE_ROUNDTRIP_GUARD
- P1A_HMR_SAFE_RUNTIME_OWNER
Expected checks:
- P1S_SHARED_SCHEMA_RUNTIME_FREE
- P1S_MEDIA_RUNTIME_CANONICAL
- npm run test -- tests/unit/persistedStateRuntimeHandles.test.ts tests/unit/mediaRuntimeLeaseContracts.test.ts
- npm run test -- tests/unit/completeArchitectureRegistry.test.ts
Expected report:
- runtime-handle findings classified by durable, runtime lease, and adapter debt
- contract names added or explicitly deferred
- migration sources mapped to mediaRuntime owner or later adapter packet
Stop conditions:
- `MediaFile.file` or legacy runtime fields would be removed instead of
  side-tabled
- project load/save, Timeline source, MediaPanel, RenderDispatcher, or
  ExportPanel behavior must change
- a second lease manager would be introduced outside `services/mediaRuntime`
```

Execution state:

- Completed on 2026-06-09.
- Added durable media/source reference contracts in
  `src/services/mediaRuntime/types.ts`.
- Added canonical runtime handle ownership and migration-source mapping in
  `src/services/mediaRuntime/leaseOwnership.ts`.
- Added persisted-state runtime handle guard in
  `src/services/mediaRuntime/persistedStateGuard.ts`.
- Hardened `src/services/mediaRuntime/registry.ts` so
  `mediaRuntimeRegistry` survives HMR without recreating runtime ownership.
- Added focused checks:
  `tests/unit/persistedStateRuntimeHandles.test.ts` and
  `tests/unit/mediaRuntimeLeaseContracts.test.ts`.
- Verified with:
  `npm run test -- tests/unit/persistedStateRuntimeHandles.test.ts tests/unit/mediaRuntimeLeaseContracts.test.ts tests/unit/foundationTypeBoundary.test.ts tests/unit/completeArchitectureRegistry.test.ts tests/unit/timelineArchitectureRegistry.test.ts`.
- Deferred removal of legacy `MediaFile.file`, broad shared type debt, and
  current clip runtime fields to the P2/P3 store-project freeze and explicit
  Timeline integration packets.

```text
Lane: P1B Universal Signal Foundation
Packet: P1B-SIGNAL-DTO-001 Signal DTO And Format Matrix Contract
Mode: implementation, foundation contracts and tests only
Goal: make universal signal DTOs runtime-free, keep importer File/Blob IO
contained, and define the June-2026 format matrix before media/project/render
lanes depend on signal behavior.
Read first:
- src/signals/**
- src/importers/**
- tests/unit/signals/signalContracts.test.ts
- tests/unit/importers/universalImportOrchestrator.test.ts
- tests/stores/mediaStore/fileImportSignalSlice.test.ts
- tests/unit/signals/signalTimelineRendererAdapter.test.ts
- tests/unit/signals/signalTextRendererAdapter.test.ts
Allowed write set:
- src/signals/**
- src/importers/**
- tests/unit/signals/**
- tests/unit/importers/**
- tests/stores/mediaStore/fileImportSignalSlice.test.ts only for signal fixture coverage
- proposed architecture registry entries from P0-REG-001
Forbidden files:
- src/components/panels/MediaPanel.tsx
- src/components/timeline/**
- src/services/project/projectLoad.ts
- src/services/project/projectSave.ts
- src/engine/render/RenderDispatcher.ts
- src/components/export/ExportPanel.tsx
- src/timeline/architecture/**
Current contract: signal DTOs and importer routing exist, CSV/binary fallback
are covered, but the format matrix, materialization contract, and importer IO
containment are not explicit enough for downstream lanes.
Target contract: signal DTOs are serializable/runtime-free; importer File/Blob
use is contained to importer IO; OBJ/FBX/glTF/GLB, PDF/SVG, DXF/STEP,
JSON/CSV, binary/unknown, and point-cloud families each have route,
materialization, preview/export fallback, and fixture ownership.
Expected gates:
- P1B_SIGNAL_DTO_RUNTIME_FREE
- P1B_UNIVERSAL_IMPORT_ROUTE_MATRIX
- P1B_NO_UNSUPPORTED_FILE_FALLBACK
- P1B_SIGNAL_PROJECT_ROUNDTRIP
- P1B_SIGNAL_TIMELINE_MATERIALIZATION_CONTRACT
- P1B_SIGNAL_PREVIEW_EXPORT_FALLBACK
Expected checks:
- P1S_SIGNAL_DTO_RUNTIME_FREE
- P1B_IMPORTER_IO_CONTAINMENT
- npm run test -- tests/unit/signals/signalContracts.test.ts tests/unit/importers/universalImportOrchestrator.test.ts tests/unit/signals/signalTimelineRendererAdapter.test.ts tests/unit/signals/signalTextRendererAdapter.test.ts
- npm run test -- tests/unit/completeArchitectureRegistry.test.ts
Expected report:
- format matrix entries added
- importer IO hits classified
- fixture coverage kept, added, or deferred with owner
- Timeline materialization handled through existing signal adapter contracts,
  not Timeline source edits
Stop conditions:
- MediaPanel, Timeline source, project load/save, RenderDispatcher, or
  ExportPanel must change
- signal DTOs would carry `File`, `Blob`, DOM, GPU, worker, decoder, or renderer
  instances
- binary fallback is presented as final CAD/PDF/SVG/3D support
```

Execution state:

- Completed on 2026-06-09.
- Added `src/signals/formatMatrix.ts` with the June-2026 format matrix for
  OBJ/FBX/glTF/GLB, PDF/SVG, DXF/STEP, JSON/CSV, binary/unknown, and
  point-cloud families.
- Exported the matrix from `src/signals/index.ts`.
- Added `tests/unit/signals/signalFormatMatrix.test.ts` to prove runtime-free
  signal sources, project-shaped signal DTO roundtrip, format coverage, and
  fallback/materialization contracts.
- Verified with:
  `npm run test -- tests/unit/signals/signalContracts.test.ts tests/unit/signals/signalFormatMatrix.test.ts tests/unit/importers/universalImportOrchestrator.test.ts tests/unit/signals/signalTimelineRendererAdapter.test.ts tests/unit/signals/signalTextRendererAdapter.test.ts tests/unit/completeArchitectureRegistry.test.ts`.
- Deferred project load/save integration to `P1-P3-SCHEMA-FREEZE-001`.

```text
Lane: P1/P3 Contract Freeze
Packet: P1-P3-SCHEMA-FREEZE-001 Project Schema DTO Boundary
Mode: implementation, schema contracts and tests only
Goal: make persisted project DTOs schema-owned and runtime-free before store,
project load/save, FlashBoard, or importers are refactored.
Read first:
- src/services/project/types/**
- src/stores/flashboardStore/types.ts
- src/stores/exportStore.ts
- src/stores/timeline/types.ts
- src/stores/mediaStore/types.ts
- src/types/audio.ts
- src/types/history.ts
Allowed write set:
- src/services/project/types/**
- focused schema import-boundary tests
- proposed architecture registry entries from P0-REG-001
Forbidden files:
- src/services/project/projectLoad.ts
- src/services/project/projectSave.ts
- src/components/**
- src/engine/**
- src/stores/** except read-only source DTO extraction analysis
- src/timeline/architecture/**
Current contract: project types import live store and engine-facing types.
Target contract: project DTOs own persisted shape and do not import stores,
components, engine, or runtime services. Old saved-project compatibility is
not required; obsolete payloads may be deleted or ignored after current active
behavior has coverage.
Expected gates:
- P1_PROJECT_SCHEMA_NO_STORE_IMPORTS
- P1_PROJECT_SCHEMA_OWNS_PERSISTED_TYPES
- P3_PROJECT_SCHEMA_BOUNDARY
- P3_CURRENT_PROJECT_SCHEMA_ONLY
- P3_LEGACY_PROJECT_COMPAT_RETIRED
- P3_DEPRECATED_PAYLOADS_DELETED_OR_IGNORED
Expected checks:
- P1S_PROJECT_SCHEMA_NO_PRODUCT_IMPORTS
- P1S_SHARED_SCHEMA_RUNTIME_FREE
- npm run test -- tests/unit/completeArchitectureRegistry.test.ts
Expected report:
- store-derived DTOs replaced or left as explicit adapter debt
- obsolete project payloads deleted, ignored, or left as explicit retired-path
  debt
- project load/save call sites that require later adapter packets
Stop conditions:
- projectLoad/projectSave behavior must change
- current project save/load behavior is affected
- FlashBoard active contract cannot be represented without a P4/P3 joint packet
```

Execution state:

- Advanced on 2026-06-09; P1 schema import gates are satisfied.
- Added schema-owned DTO modules under `src/services/project/types/**` for
  generated media items, sequence metadata, export state, FlashBoard state,
  gaussian settings, timeline mask/keyframe payloads, and project clip payloads.
- Removed direct project-schema imports from `src/stores/**`, `src/engine/**`,
  runtime services, and the broad `src/types` compatibility barrel.
- Added `tests/unit/projectSchemaBoundary.test.ts`.
- Verified with:
  `npm run test -- tests/unit/projectSchemaBoundary.test.ts tests/unit/foundationTypeBoundary.test.ts tests/unit/completeArchitectureRegistry.test.ts tests/unit/persistedStateRuntimeHandles.test.ts`.
- TypeScript assignability check passed:
  `npx tsc -b --pretty false`.

```text
Lane: P3 Current Project Schema
Packet: P3-DEPRECATED-PAYLOADS-001 Retire Project YouTube Panel Payload
Mode: implementation, project persistence payload only
Goal: remove obsolete YouTube panel state from persisted project DTOs and
project dirty/autosync coupling. Active download/search runtime workflows remain
owned by Media/AI tools, not by project schema.
Read first:
- src/services/project/types/project.types.ts
- src/services/project/projectSave.ts
- src/services/project/projectLoad.ts
- src/services/project/projectLifecycle.ts
- src/stores/youtubeStore.ts
- src/stores/dockStore.ts
- tests/unit/projectMediaPersistence.test.ts
- tests/unit/projectLifecycleAutoSync.test.ts
Allowed write set:
- src/services/project/types/project.types.ts
- src/services/project/types/index.ts
- src/services/project/projectSave.ts
- src/services/project/projectLoad.ts
- src/services/project/projectLifecycle.ts
- tests/unit/projectMediaPersistence.test.ts
- tests/unit/projectLifecycleAutoSync.test.ts
- src/architecture/retiredPathLedger.ts
- docs/ongoing/Complete-refactor.md
- docs/ongoing/Complete-refactor-checklist.md
- docs/ongoing/complete-refactor/**
Forbidden files:
- src/stores/dockStore.ts
- src/types/dock.ts
- src/components/**
- src/stores/** except src/stores/youtubeStore.ts read-only
- src/engine/**
- src/services/mediaRuntime/**
- src/timeline/architecture/**
Current contract: project save/load persists `ProjectFile.youtube`, even though
the old YouTube/download dock panel state is deprecated and active downloads
live in the Media/AI tools workflow.
Target contract: current project schema does not persist YouTube panel state;
loading a project resets the transient YouTube store instead of accepting old
project payloads; YouTube store changes no longer mark projects dirty.
Retired paths in scope:
- ProjectFile.youtube
- ProjectYouTubeState
- ProjectYouTubeVideo
- projectSave YouTube panel serialization
- projectLoad YouTube panel hydration
- projectLifecycle YouTube autosync dirty subscription
Expected gates:
- P3_CURRENT_PROJECT_SCHEMA_ONLY
- P3_LEGACY_PROJECT_COMPAT_RETIRED
- P3_DEPRECATED_PAYLOADS_DELETED_OR_IGNORED
Expected checks:
- rg -n "ProjectYouTube|projectData\\.youtube|ProjectFile\\.youtube|youtube\\?:" src/services/project src/services/projectFileService.ts
- rg -n "useYouTubeStore" src/services/project/projectSave.ts src/services/project/projectLifecycle.ts
- npm run test -- tests/unit/projectMediaPersistence.test.ts tests/unit/projectLifecycleAutoSync.test.ts tests/unit/projectSchemaBoundary.test.ts tests/unit/completeArchitectureRegistry.test.ts
- npx tsc -b --pretty false
Expected report:
- obsolete project payload removed or retired
- active download/search runtime surfaces left intact
- dock panel id cleanup deferred to a P4/P3 UI-layout packet
Stop conditions:
- active Media download workflow must change
- dock panel union/layout cleanup requires edits to src/types/dock.ts or
  src/stores/dockStore.ts
- Timeline, render, export, or media runtime behavior must change
```

Execution state:

- Completed on 2026-06-09.
- Removed `ProjectFile.youtube`, `ProjectYouTubeState`, and
  `ProjectYouTubeVideo` from the project DTO surface and project service
  facades.
- Updated project save to delete stale `youtube` payloads from project data
  before writing the current schema.
- Updated project load to reset transient YouTube panel state instead of
  hydrating obsolete project payloads.
- Removed the project autosync dirty subscription for YouTube store changes.
- Added focused tests for stale payload deletion, load-time transient reset, and
  the missing autosync subscription.
- Verified with:
  `npm run test -- tests/unit/projectMediaPersistence.test.ts tests/unit/projectLifecycleAutoSync.test.ts tests/unit/projectSchemaBoundary.test.ts tests/unit/completeArchitectureRegistry.test.ts`.
- TypeScript assignability check passed:
  `npx tsc -b --pretty false`.
- Remaining deprecated-payload work: dock `youtube`/`download`/`ai-video` panel
  type cleanup and retired FlashBoard board/canvas payload classification stay
  open for a P4/P3 UI-layout packet.

```text
Lane: P4/P3 UI Layout Cleanup
Packet: P4-P3-UI-LAYOUT-PREFLIGHT-001 Dock And FlashBoard Retired Payload Gates
Mode: implementation, architecture-gate tooling and docs only
Goal: make dock deprecated panel cleanup and retired FlashBoard board/canvas
classification executable before touching dock, Media Panel, or FlashBoard
source.
Read first:
- src/types/dock.ts
- src/stores/dockStore.ts
- src/stores/flashboardStore/types.ts
- src/components/dock/**
- src/components/panels/media/**
- src/components/panels/flashboard/**
- tests/unit/dockPanelConfigs.test.ts
- tests/unit/dockStoreLayouts.test.ts
Allowed write set:
- src/architecture/**
- docs/ongoing/Complete-refactor.md
- docs/ongoing/Complete-refactor-checklist.md
- docs/ongoing/complete-refactor/**
Forbidden files:
- src/types/dock.ts
- src/stores/dockStore.ts
- src/stores/flashboardStore/**
- src/components/**
- src/services/project/**
- src/engine/**
- src/services/mediaRuntime/**
- src/timeline/architecture/**
Current contract: P4/P3 cleanup is named in Markdown but the whole-codebase
registry does not yet expose dock deprecated-panel and FlashBoard retired-board
gates.
Target contract: the registry contains executable gate ids, lane write sets,
high-conflict ownership, and retired-path ledger entries for the UI-layout
cleanup packet.
Expected gates:
- P3_DOCK_DEPRECATED_PANEL_PAYLOADS_RETIRED
- P4_DOWNLOADS_ACTIVE_IN_MEDIA_PANEL
- P4_MEDIA_BOARD_VS_FLASHBOARD_BOARD_CLASSIFIED
- P4_FLASHBOARD_RETIRED_BOARD_LEDGER
Expected checks:
- npm run test -- tests/unit/completeArchitectureRegistry.test.ts
- rg -n "P3_DOCK_DEPRECATED_PANEL_PAYLOADS_RETIRED|P4_DOWNLOADS_ACTIVE_IN_MEDIA_PANEL|P4_FLASHBOARD_RETIRED_BOARD_LEDGER" src/architecture docs/ongoing
Expected report:
- gate ids added
- high-conflict ownership updated
- retired-path entries added or reassigned
- implementation packet queued but not started
Stop conditions:
- any product UI/store/source edit is required
- Timeline, render, export, project schema, or media runtime source would need
  modification
```

Execution state:

- Completed on 2026-06-09.
- Added executable registry gates for dock deprecated-panel retirement,
  active downloads in Media Panel, Media Board versus FlashBoard Board
  classification, and retired FlashBoard board/canvas ledgering.
- Added `src/types/dock.ts` to high-conflict ownership and assigned dock
  cleanup ownership to the Media/FlashBoard lane for this packet.
- Ledgered deprecated `youtube` and `download` dock panel ids and moved
  `ai-video`/FlashBoard retired-board ledger entries under the new gates.
- Verified with:
  `npm run test -- tests/unit/completeArchitectureRegistry.test.ts tests/unit/dockPanelConfigs.test.ts tests/unit/dockStoreLayouts.test.ts`.
- TypeScript assignability check passed:
  `npx tsc -b --pretty false`.

```text
Lane: P4/P3 UI Layout Cleanup
Packet: P4-P3-UI-LAYOUT-CLEANUP-001 Dock Panel Type Retirement And FlashBoard Board Classification
Mode: implementation, dock/FlashBoard UI-layout cleanup only
Goal: retire dock `youtube`, `download`, and `ai-video` panel types without
breaking active Media download/search workflows, and classify active Media
Board state separately from retired FlashBoard board/canvas payloads.
Read first:
- src/types/dock.ts
- src/stores/dockStore.ts
- src/components/common/Toolbar.tsx
- src/components/dock/DockTabPane.tsx
- src/components/dock/DockPanelContent.tsx
- src/components/panels/media/MediaDownloadComposer.tsx
- src/components/panels/media/MediaAIGenerativeTray.tsx
- src/stores/flashboardStore/types.ts
- tests/unit/dockPanelConfigs.test.ts
- tests/unit/dockStoreLayouts.test.ts
Allowed write set:
- src/types/dock.ts
- src/stores/dockStore.ts
- src/components/common/Toolbar.tsx
- src/components/dock/**
- src/stores/flashboardStore/** only for classification helpers/types
- tests/unit/dockPanelConfigs.test.ts
- tests/unit/dockStoreLayouts.test.ts
- focused FlashBoard retired-path tests created for this packet
- src/architecture/**
- docs/ongoing/Complete-refactor.md
- docs/ongoing/Complete-refactor-checklist.md
- docs/ongoing/complete-refactor/**
Forbidden files:
- src/components/timeline/**
- src/stores/timeline/**
- src/timeline/architecture/**
- src/engine/**
- src/components/export/**
- src/components/preview/**
- src/services/project/**
- src/services/mediaRuntime/**
Current contract: deprecated dock panel types remain in `PanelType` and
project/local layout cleanup aliases old payloads defensively; FlashBoard
store state still mixes active generation data with board/canvas workspace
state.
Target contract: current dock panel contract exposes only active panel types;
old dock payload ids are ignored/deleted under the current-schema-only policy;
FlashBoard active generation metadata and retired board/canvas state have
separate typed classification.
Expected gates:
- P3_DOCK_DEPRECATED_PANEL_PAYLOADS_RETIRED
- P4_DOWNLOADS_ACTIVE_IN_MEDIA_PANEL
- P4_MEDIA_BOARD_VS_FLASHBOARD_BOARD_CLASSIFIED
- P4_FLASHBOARD_RETIRED_BOARD_LEDGER
Expected checks:
- npm run test -- tests/unit/dockPanelConfigs.test.ts tests/unit/dockStoreLayouts.test.ts tests/unit/completeArchitectureRegistry.test.ts
- rg -n "'ai-video'|'youtube'|'download'" src/types/dock.ts src/stores/dockStore.ts src/components/common/Toolbar.tsx src/components/dock
- focused FlashBoard classification test, once added
Expected report:
- retired dock panel ids removed or ignored
- active Media download/search workflow coverage preserved
- FlashBoard active versus retired board/canvas fields classified
Stop conditions:
- active Media download workflow changes
- project schema/load/save behavior must change
- Timeline, render, export, preview, or media runtime source must change
- FlashBoard provider/job behavior must change before an active-contract packet
```

Execution state:

- Completed on 2026-06-09.
- Removed dock `ai-video`, `youtube`, and `download` from the active
  `PanelType` union, `PANEL_CONFIGS`, Toolbar view menu sources, and dock tab
  add/change menus.
- Replaced legacy dock alias/migration behavior with current-schema-only
  delete-or-ignore cleanup: restored layouts drop retired panel ids instead of
  rewriting them to active panel types.
- Added focused restored-layout coverage for dock retired payload ids and kept
  active downloads mapped to `MediaDownloadComposer` inside the Media Panel
  generation tray.
- Added `FLASHBOARD_STATE_CLASSIFICATION` in `flashboardStore/types.ts` and a
  focused test that separates active composer/reference-hover state from
  retired board workspace state (`activeBoardId`, `boards`,
  `selectedNodeIds`, `viewMode`).
- Marked `P3_DOCK_DEPRECATED_PANEL_PAYLOADS_RETIRED`,
  `P4_DOWNLOADS_ACTIVE_IN_MEDIA_PANEL`, and
  `P4_MEDIA_BOARD_VS_FLASHBOARD_BOARD_CLASSIFIED` satisfied.
  `P4_FLASHBOARD_RETIRED_BOARD_LEDGER` was satisfied by the later
  `P4-MEDIA-PANEL-SHELL-PREFLIGHT-001` usage scan.
- Verified with:
  `npm run test -- tests/unit/dockPanelConfigs.test.ts tests/unit/dockStoreLayouts.test.ts tests/unit/flashboardRetiredBoardClassification.test.ts tests/unit/completeArchitectureRegistry.test.ts`.
- TypeScript check passed:
  `npx tsc -b --pretty false`.
- Source retired-id scan passed with no matches:
  `rg -n -e 'DEPRECATED_PANEL_TYPES' -e 'resolvePanelType' -e '''ai-video''' -e '''youtube''' -e '''download''' -e '"ai-video"' -e '"youtube"' -e '"download"' src/types/dock.ts src/stores/dockStore.ts src/components/common/Toolbar.tsx src/components/dock`.
- `git diff --check` passed with line-ending warnings only.

```text
Lane: P4 Media Panel And FlashBoard
Packet: P4-MEDIA-PANEL-SHELL-PREFLIGHT-001 Media Panel Shell And FlashBoard Usage Scan Preflight
Mode: docs/architecture preflight only
Goal: define the Media Panel shell split, FlashBoard composer module tree,
focused smoke tests, and retired FlashBoard board/canvas CSS/node/viewport
usage scan before touching MediaPanel or FlashBoard implementation files.
Read first:
- src/components/panels/MediaPanel.tsx
- src/components/panels/MediaPanel.css
- src/components/panels/flashboard/FlashBoardComposer.tsx
- src/components/panels/flashboard/FlashBoard.css
- src/components/panels/flashboard/useFlashBoardRuntime.ts
- src/stores/flashboardStore/**
- src/services/flashboard/**
- docs/ongoing/complete-refactor/p4-media-panel-and-flashboard.md
Allowed write set:
- docs/ongoing/Complete-refactor.md
- docs/ongoing/Complete-refactor-checklist.md
- docs/ongoing/complete-refactor/**
- src/architecture/** only if new gates/check ledger entries are needed
Forbidden files:
- src/components/**
- src/stores/**
- src/services/**
- src/engine/**
- src/types/**
- tests/**
Current contract: Media Panel and FlashBoard split targets are identified, but
the component/module tree, smoke commands, and retired FlashBoard board/canvas
usage scan are not executable enough for safe source splitting.
Target contract: Media Panel shell, FlashBoard composer modules, retired
board/canvas usage scan, and smoke checks have explicit lanes, write sets,
forbidden files, gates, and stop conditions for the next source packet.
Expected gates:
- P4_MEDIA_PANEL_SHELL_SPLIT
- P4_FLASHBOARD_ACTIVE_CONTRACT
- P4_FLASHBOARD_PROVIDER_TASK_CONTRACT
- P4_FLASHBOARD_RETIRED_BOARD_LEDGER
- P4_MEDIA_BOARD_RENDER_STRATEGY
Expected checks:
- rg -n "MediaPanel|FlashBoardComposer|flashboard-canvas|flashboard-node|viewport|selectedNodeIds" docs/ongoing/complete-refactor src/architecture
- npm run test -- tests/unit/completeArchitectureRegistry.test.ts
Expected report:
- Media Panel module tree and write set ready for source packet
- FlashBoard composer module tree and provider/service adapter split defined
- retired board/canvas CSS/node/viewport usage scan command recorded
- smoke tests and stop conditions ready
Stop conditions:
- source implementation changes are required
- project schema/load/save, Timeline, render, export, preview, or media runtime
  behavior would need to change
```

Execution state:

- Completed on 2026-06-09.
- Read-only evidence:
  `MediaPanel.tsx` 5,544 LOC, `MediaPanel.css` 1,994 LOC,
  `FlashBoardComposer.tsx` 3,565 LOC, `FlashBoard.css` 3,054 LOC,
  `MediaAIGenerativeTray.tsx` 110 LOC, and `MediaAIGenerationQueue.tsx`
  459 LOC.
- Media Panel split target:
  - shell/header/view-mode wiring and tray mount:
    `src/components/panels/media/panel/MediaPanelShell.tsx`
  - list/grid rendering and breadcrumbs:
    `src/components/panels/media/grid/**`
  - import/add menus, folder creation, drop import, and relink/proxy dialogs:
    `src/components/panels/media/import/**`
  - context menu, move-to-folder, labels, delete confirmation, and board
    annotation actions: `src/components/panels/media/context/**`
  - active board view remains in existing `src/components/panels/media/board/**`
    for the first source split; renderer changes wait for a dedicated board
    packet.
- FlashBoard composer split target:
  - `src/components/panels/flashboard/composer/FlashBoardComposerShell.tsx`
  - `PromptEditor.tsx`, `ProviderControls.tsx`, `ReferenceStrip.tsx`,
    `AudioControls.tsx`, `ChatPanel.tsx`, `GenerationActions.tsx`
  - `useFlashBoardComposerState.ts` for UI-only derived state
  - service adapters split into request planner, reference resolver, provider
    runner, and media import adapter before provider/job behavior changes.
- Retired FlashBoard board/canvas usage scan recorded:
  `rg -n "flashboard-(workspace|toolbar|canvas|canvas-area|canvas-inner|canvas-marquee|node|node-|context|queue-badge)|selectedNodeIds|activeBoardId|viewMode|selectActiveBoard|selectSelectedNodes" src/components/panels/flashboard src/stores/flashboardStore src/services/flashboard`.
  Current hits are in `FlashBoard.css`, `FlashBoardComposer.tsx`,
  `useFlashBoardRuntime.ts`, `flashboardStore` board/node slices, and
  selectors.
- Smoke/check set for the next source packet:
  `npm run test -- tests/unit/mediaPanelDropImport.test.ts tests/unit/mediaPanelItemTypeGuards.test.ts tests/unit/mediaPanelSourceMonitor.test.tsx tests/unit/flashboardRetiredBoardClassification.test.ts tests/unit/completeArchitectureRegistry.test.ts`
  plus `npx tsc -b --pretty false`.
- Marked `P4_FLASHBOARD_RETIRED_BOARD_LEDGER` satisfied because the retired
  path is now ledgered and usage-scanned before deletion. Actual deletion waits
  for a later packet with explicit FlashBoard source write sets.

```text
Lane: P4 Media Panel And FlashBoard
Packet: P4-MEDIA-PANEL-SHELL-SPLIT-001 Media Panel Shell Extraction
Mode: implementation, MediaPanel shell split only
Goal: split MediaPanel shell/header/view wiring, grid/list helpers, import
menus, and context-menu actions into role-specific modules without changing
Media Board, FlashBoard, download tray, project schema, Timeline, render, or
media runtime behavior.
Read first:
- src/components/panels/MediaPanel.tsx
- src/components/panels/MediaPanel.css
- src/components/panels/media/board/**
- src/components/panels/media/MediaAIGenerativeTray.tsx
- src/components/panels/media/MediaAIGenerativeTrayExpanded.tsx
- src/components/panels/media/MediaDownloadComposer.tsx
- tests/unit/mediaPanelDropImport.test.ts
- tests/unit/mediaPanelItemTypeGuards.test.ts
- tests/unit/mediaPanelSourceMonitor.test.tsx
Allowed write set:
- src/components/panels/MediaPanel.tsx
- src/components/panels/MediaPanel.css
- src/components/panels/media/panel/**
- src/components/panels/media/grid/**
- src/components/panels/media/import/**
- src/components/panels/media/context/**
- tests/unit/mediaPanel*.test.ts
- docs/ongoing/Complete-refactor.md
- docs/ongoing/Complete-refactor-checklist.md
- docs/ongoing/complete-refactor/**
Forbidden files:
- src/components/panels/flashboard/**
- src/stores/flashboardStore/**
- src/services/flashboard/**
- src/components/timeline/**
- src/stores/timeline/**
- src/timeline/architecture/**
- src/engine/**
- src/components/export/**
- src/components/preview/**
- src/services/project/**
- src/services/mediaRuntime/**
Current contract: `MediaPanel.tsx` owns shell/header, view transitions, list,
grid, active board orchestration, import flows, context menus, dialogs, and
tray bootstrapping in one 5,544 LOC file.
Target contract: `MediaPanel.tsx` becomes a shell/orchestrator below the source
ceiling, with list/grid/import/context modules extracted. Active board renderer
and FlashBoard generation tray behavior remain unchanged.
Expected gates:
- P4_MEDIA_PANEL_SHELL_SPLIT
- P4_MEDIA_STORE_SELECTOR_CONTRACT
- P4_DOWNLOADS_ACTIVE_IN_MEDIA_PANEL
- P4_MEDIA_BOARD_VS_FLASHBOARD_BOARD_CLASSIFIED
Expected checks:
- npm run test -- tests/unit/mediaPanelDropImport.test.ts tests/unit/mediaPanelItemTypeGuards.test.ts tests/unit/mediaPanelSourceMonitor.test.tsx
- npx tsc -b --pretty false
- rg -n "flashboard-|useFlashBoardStore|FlashBoardComposer|MediaDownloadComposer" src/components/panels/MediaPanel.tsx src/components/panels/media/panel src/components/panels/media/grid src/components/panels/media/import src/components/panels/media/context
Expected report:
- `MediaPanel.tsx` reduced toward source ceiling
- extracted modules and CSS sections listed
- Media Board, download tray, and FlashBoard behavior unchanged
- focused checks passed
Stop conditions:
- FlashBoard implementation files must change
- Media Board renderer behavior must change
- project schema/load/save, Timeline, render, export, preview, or media runtime
  behavior must change
```

Execution state:

- Completed first source slice on 2026-06-09.
- Extracted header search UI to
  `src/components/panels/media/panel/MediaPanelSearch.tsx`.
- Extracted header view-mode controls to
  `src/components/panels/media/panel/MediaViewModeControls.tsx`.
- Extracted the duplicated header/context Add item tree to
  `src/components/panels/media/import/MediaAddItemsMenu.tsx`.
- Moved the context menu shape to
  `src/components/panels/media/context/types.ts`.
- Moved duration formatting to
  `src/components/panels/media/grid/format.ts`.
- `MediaPanel.tsx` reduced from 5,544 LOC to 5,369 LOC. The
  `P4_MEDIA_PANEL_SHELL_SPLIT` gate remains active because the shell is still
  above budget and list/grid/context presentation remains in the monolith.
- FlashBoard implementation files, active Media Board renderer behavior,
  download tray behavior, Timeline, render/export/preview, project schema, and
  media runtime were not changed.
- Verified with:
  `npm run test -- tests/unit/mediaPanelDropImport.test.ts tests/unit/mediaPanelItemTypeGuards.test.ts tests/unit/mediaPanelSourceMonitor.test.tsx tests/unit/flashboardRetiredBoardClassification.test.ts tests/unit/completeArchitectureRegistry.test.ts`.
- TypeScript check passed:
  `npx tsc -b --pretty false`.
- Boundary scan result:
  `rg -n "flashboard-|useFlashBoardStore|FlashBoardComposer|MediaDownloadComposer" src/components/panels/MediaPanel.tsx src/components/panels/media/panel src/components/panels/media/grid src/components/panels/media/import src/components/panels/media/context`
  returns only the pre-existing `useFlashBoardStore` AI prompt reference wiring
  in `MediaPanel.tsx`.

```text
Lane: P4 Media Panel And FlashBoard
Packet: P4-MEDIA-PANEL-GRID-CONTEXT-SPLIT-002 Media Panel Grid And Context Extraction
Mode: implementation, MediaPanel grid/context split only
Goal: extract grid item rendering, grid breadcrumb/view helpers, and non-board
context-menu presentation into role-specific modules while preserving active
Media Board, FlashBoard, download tray, project schema, Timeline, render, and
media runtime behavior.
Read first:
- src/components/panels/MediaPanel.tsx
- src/components/panels/MediaPanel.css
- src/components/panels/media/grid/format.ts
- src/components/panels/media/context/types.ts
- src/components/panels/media/board/**
- tests/unit/mediaPanelDropImport.test.ts
- tests/unit/mediaPanelItemTypeGuards.test.ts
- tests/unit/mediaPanelSourceMonitor.test.tsx
Allowed write set:
- src/components/panels/MediaPanel.tsx
- src/components/panels/MediaPanel.css
- src/components/panels/media/grid/**
- src/components/panels/media/context/**
- src/components/panels/media/panel/**
- tests/unit/mediaPanel*.test.ts
- docs/ongoing/Complete-refactor.md
- docs/ongoing/Complete-refactor-checklist.md
- docs/ongoing/complete-refactor/**
Forbidden files:
- src/components/panels/flashboard/**
- src/stores/flashboardStore/**
- src/services/flashboard/**
- src/components/timeline/**
- src/stores/timeline/**
- src/timeline/architecture/**
- src/engine/**
- src/components/export/**
- src/components/preview/**
- src/services/project/**
- src/services/mediaRuntime/**
Current contract: grid item rendering, breadcrumb rendering, context menu
presentation, and most context action wiring still live in `MediaPanel.tsx`.
Target contract: grid rendering and context-menu presentation are moved behind
typed module boundaries, while `MediaPanel.tsx` keeps orchestration state and
active Media Board behavior unchanged.
Expected gates:
- P4_MEDIA_PANEL_SHELL_SPLIT
- P4_MEDIA_STORE_SELECTOR_CONTRACT
- P4_DOWNLOADS_ACTIVE_IN_MEDIA_PANEL
- P4_MEDIA_BOARD_VS_FLASHBOARD_BOARD_CLASSIFIED
Expected checks:
- npm run test -- tests/unit/mediaPanelDropImport.test.ts tests/unit/mediaPanelItemTypeGuards.test.ts tests/unit/mediaPanelSourceMonitor.test.tsx
- npx tsc -b --pretty false
- rg -n "flashboard-|useFlashBoardStore|FlashBoardComposer|MediaDownloadComposer" src/components/panels/MediaPanel.tsx src/components/panels/media/panel src/components/panels/media/grid src/components/panels/media/import src/components/panels/media/context
Expected report:
- `MediaPanel.tsx` further reduced toward source ceiling
- grid/context modules listed with LOC
- active Media Board, download tray, and FlashBoard behavior unchanged
- focused checks passed
Stop conditions:
- FlashBoard implementation files must change
- Media Board renderer behavior must change
- project schema/load/save, Timeline, render, export, preview, or media runtime
  behavior must change
```


```text
Lane: P4 Media Panel And FlashBoard
Packet: P4-MEDIA-PANEL-LIST-PRESENTATION-SPLIT-003 Media Panel List Presentation Extraction
Mode: implementation, MediaPanel list presentation split only
Goal: extract classic list item/row presentation, folder indentation chrome,
and list drag/drop shell into role-specific modules while preserving active
Media Board, FlashBoard, download tray, project schema, Timeline, render, and
media runtime behavior.
Read first:
- src/components/panels/MediaPanel.tsx
- src/components/panels/MediaPanel.css
- src/components/panels/media/grid/**
- src/components/panels/media/context/**
- src/components/panels/media/board/**
- tests/unit/mediaPanelDropImport.test.ts
- tests/unit/mediaPanelItemTypeGuards.test.ts
- tests/unit/mediaPanelSourceMonitor.test.tsx
Allowed write set:
- src/components/panels/MediaPanel.tsx
- src/components/panels/MediaPanel.css
- src/components/panels/media/list/**
- src/components/panels/media/panel/**
- src/components/panels/media/context/**
- tests/unit/mediaPanel*.test.ts
- docs/ongoing/Complete-refactor.md
- docs/ongoing/Complete-refactor-checklist.md
- docs/ongoing/complete-refactor/**
Forbidden files:
- src/components/panels/flashboard/**
- src/stores/flashboardStore/**
- src/services/flashboard/**
- src/components/timeline/**
- src/stores/timeline/**
- src/timeline/architecture/**
- src/engine/**
- src/components/export/**
- src/components/preview/**
- src/services/project/**
- src/services/mediaRuntime/**
Current contract: classic list row rendering, folder indentation chrome,
selection classes, and list drag/drop shell still live in `MediaPanel.tsx`.
Target contract: classic list presentation is moved behind typed module
boundaries, while `MediaPanel.tsx` keeps orchestration state and active Media
Board behavior unchanged.
Expected gates:
- P4_MEDIA_PANEL_SHELL_SPLIT
- P4_MEDIA_STORE_SELECTOR_CONTRACT
- P4_DOWNLOADS_ACTIVE_IN_MEDIA_PANEL
- P4_MEDIA_BOARD_VS_FLASHBOARD_BOARD_CLASSIFIED
Expected checks:
- npm run test -- tests/unit/mediaPanelDropImport.test.ts tests/unit/mediaPanelItemTypeGuards.test.ts tests/unit/mediaPanelSourceMonitor.test.tsx tests/unit/flashboardRetiredBoardClassification.test.ts tests/unit/completeArchitectureRegistry.test.ts
- npx tsc -b --pretty false
- rg -n "flashboard-|useFlashBoardStore|FlashBoardComposer|MediaDownloadComposer" src/components/panels/MediaPanel.tsx src/components/panels/media/panel src/components/panels/media/list src/components/panels/media/context
Expected report:
- `MediaPanel.tsx` further reduced toward source ceiling
- list modules listed with LOC
- active Media Board, download tray, and FlashBoard behavior unchanged
- focused checks passed
Stop conditions:
- FlashBoard implementation files must change
- Media Board renderer behavior must change
- project schema/load/save, Timeline, render, export, preview, or media runtime
  behavior must change
```


```text
Lane: P4 Media Panel And FlashBoard
Packet: P4-MEDIA-PANEL-CONTEXT-ACTIONS-SPLIT-004 Media Panel Context Actions Extraction
Mode: implementation, MediaPanel context action presentation split only
Goal: extract non-board context menu action sections, selected-item action
groups, move-folder submenu presentation, and regenerate-artifact submenu
presentation into role-specific modules while preserving active Media Board,
FlashBoard, download tray, project schema, Timeline, render, and media runtime
behavior.
Read first:
- src/components/panels/MediaPanel.tsx
- src/components/panels/MediaPanel.css
- src/components/panels/media/context/**
- src/components/panels/media/list/**
- src/components/panels/media/grid/**
- tests/unit/mediaPanelDropImport.test.ts
- tests/unit/mediaPanelItemTypeGuards.test.ts
- tests/unit/mediaPanelSourceMonitor.test.tsx
Allowed write set:
- src/components/panels/MediaPanel.tsx
- src/components/panels/MediaPanel.css
- src/components/panels/media/context/**
- src/components/panels/media/panel/**
- tests/unit/mediaPanel*.test.ts
- docs/ongoing/Complete-refactor.md
- docs/ongoing/Complete-refactor-checklist.md
- docs/ongoing/complete-refactor/**
Forbidden files:
- src/components/panels/flashboard/**
- src/stores/flashboardStore/**
- src/services/flashboard/**
- src/components/timeline/**
- src/stores/timeline/**
- src/timeline/architecture/**
- src/engine/**
- src/components/export/**
- src/components/preview/**
- src/services/project/**
- src/services/mediaRuntime/**
Current contract: non-board context menu action groups, folder move submenu,
regenerate-artifact submenu, and selected-item action presentation still live
inside `MediaPanel.tsx`.
Target contract: context action presentation is moved behind typed module
boundaries, while `MediaPanel.tsx` keeps command handlers and orchestration
state.
Expected gates:
- P4_MEDIA_PANEL_SHELL_SPLIT
- P4_MEDIA_STORE_SELECTOR_CONTRACT
- P4_DOWNLOADS_ACTIVE_IN_MEDIA_PANEL
- P4_MEDIA_BOARD_VS_FLASHBOARD_BOARD_CLASSIFIED
Expected checks:
- npm run test -- tests/unit/mediaPanelDropImport.test.ts tests/unit/mediaPanelItemTypeGuards.test.ts tests/unit/mediaPanelSourceMonitor.test.tsx
- npx tsc -b --pretty false
- rg -n "flashboard-|useFlashBoardStore|FlashBoardComposer|MediaDownloadComposer" src/components/panels/MediaPanel.tsx src/components/panels/media/panel src/components/panels/media/context
Expected report:
- `MediaPanel.tsx` further reduced toward source ceiling
- context modules listed with LOC
- active Media Board, download tray, and FlashBoard behavior unchanged
- focused checks passed
Stop conditions:
- FlashBoard implementation files must change
- Media Board renderer behavior must change
- project schema/load/save, Timeline, render, export, preview, or media runtime
  behavior must change
```

```text
Lane: P4 Media Panel And FlashBoard
Packet: P4-MEDIA-PANEL-ANNOTATION-CONTEXT-SPLIT-005 Media Panel Annotation Context Extraction
Mode: implementation, MediaPanel board annotation context split only
Goal: extract board annotation color context presentation into role-specific
modules while preserving active Media Board annotation behavior, FlashBoard,
download tray, project schema, Timeline, render, and media runtime behavior.
Read first:
- src/components/panels/MediaPanel.tsx
- src/components/panels/MediaPanel.css
- src/components/panels/media/context/**
- tests/unit/mediaPanelDropImport.test.ts
- tests/unit/mediaPanelItemTypeGuards.test.ts
- tests/unit/mediaPanelSourceMonitor.test.tsx
Allowed write set:
- src/components/panels/MediaPanel.tsx
- src/components/panels/media/context/**
- tests/unit/mediaPanel*.test.ts
- docs/ongoing/Complete-refactor-checklist.md
- docs/ongoing/complete-refactor/execution-queue-and-lanes.md
Forbidden files:
- src/components/panels/flashboard/**
- src/stores/flashboardStore/**
- src/services/flashboard/**
- src/components/panels/media/board/**
- src/components/timeline/**
- src/stores/timeline/**
- src/timeline/architecture/**
- src/engine/**
- src/components/export/**
- src/components/preview/**
- src/services/project/**
- src/services/mediaRuntime/**
Current contract: board annotation color context presentation still lives in
`MediaPanel.tsx`.
Target contract: annotation context presentation is moved behind typed context
module boundaries, while `MediaPanel.tsx` keeps annotation state and command
handlers.
Expected gates:
- P4_MEDIA_PANEL_SHELL_SPLIT
- P4_MEDIA_BOARD_VS_FLASHBOARD_BOARD_CLASSIFIED
Expected checks:
- npm run test -- tests/unit/mediaPanelDropImport.test.ts tests/unit/mediaPanelItemTypeGuards.test.ts tests/unit/mediaPanelSourceMonitor.test.tsx
- npx tsc -b --pretty false
- rg -n "flashboard-|useFlashBoardStore|FlashBoardComposer|MediaDownloadComposer" src/components/panels/MediaPanel.tsx src/components/panels/media/context
Expected report:
- `MediaPanel.tsx` further reduced toward source ceiling
- annotation context module listed with LOC
- active Media Board annotation behavior unchanged
- focused checks passed
Stop conditions:
- FlashBoard implementation files must change
- Media Board renderer behavior must change
- project schema/load/save, Timeline, render, export, preview, or media runtime
  behavior must change
```

```text
Lane: P4 Media Panel And FlashBoard
Packet: P4-MEDIA-PANEL-DROP-EMPTY-STATES-SPLIT-006 Media Panel Drop And Empty State Extraction
Mode: implementation, MediaPanel drop/empty presentation split only
Goal: extract external drop overlay, no-media empty state, and no-search-results
empty state into role-specific modules while preserving import behavior,
selection behavior, active Media Board, FlashBoard, download tray, project
schema, Timeline, render, and media runtime behavior.
Read first:
- src/components/panels/MediaPanel.tsx
- src/components/panels/MediaPanel.css
- src/components/panels/media/panel/**
- tests/unit/mediaPanelDropImport.test.ts
- tests/unit/mediaPanelItemTypeGuards.test.ts
- tests/unit/mediaPanelSourceMonitor.test.tsx
Allowed write set:
- src/components/panels/MediaPanel.tsx
- src/components/panels/media/panel/**
- tests/unit/mediaPanel*.test.ts
- docs/ongoing/Complete-refactor-checklist.md
- docs/ongoing/complete-refactor/execution-queue-and-lanes.md
Forbidden files:
- src/components/panels/flashboard/**
- src/stores/flashboardStore/**
- src/services/flashboard/**
- src/components/panels/media/board/**
- src/components/timeline/**
- src/stores/timeline/**
- src/timeline/architecture/**
- src/engine/**
- src/components/export/**
- src/components/preview/**
- src/services/project/**
- src/services/mediaRuntime/**
Current contract: drop overlay and empty-state presentation still live in
`MediaPanel.tsx`.
Target contract: drop and empty-state presentation are moved behind typed panel
module boundaries, while `MediaPanel.tsx` keeps import/drop handlers and state.
Expected gates:
- P4_MEDIA_PANEL_SHELL_SPLIT
Expected checks:
- npm run test -- tests/unit/mediaPanelDropImport.test.ts tests/unit/mediaPanelItemTypeGuards.test.ts tests/unit/mediaPanelSourceMonitor.test.tsx
- npx tsc -b --pretty false
- rg -n "flashboard-|useFlashBoardStore|FlashBoardComposer|MediaDownloadComposer" src/components/panels/MediaPanel.tsx src/components/panels/media/panel
Expected report:
- `MediaPanel.tsx` further reduced toward source ceiling
- drop/empty panel modules listed with LOC
- import and search-empty behavior unchanged
- focused checks passed
Stop conditions:
- FlashBoard implementation files must change
- Media Board renderer behavior must change
- project schema/load/save, Timeline, render, export, preview, or media runtime
  behavior must change
```

```text
Lane: P4 Media Panel And FlashBoard
Packet: P4-MEDIA-PANEL-HEADER-ACTIONS-SPLIT-007 Media Panel Header Actions Extraction
Mode: implementation, MediaPanel header/action presentation split only
Goal: extract Media Panel header count, relink prompt, import button, view mode
controls, and Add dropdown shell into a role-specific panel module while
preserving existing import, relink, view-mode, and item creation behavior.
Read first:
- src/components/panels/MediaPanel.tsx
- src/components/panels/MediaPanel.css
- src/components/panels/media/panel/**
- src/components/panels/media/import/**
- tests/unit/mediaPanelDropImport.test.ts
- tests/unit/mediaPanelItemTypeGuards.test.ts
- tests/unit/mediaPanelSourceMonitor.test.tsx
Allowed write set:
- src/components/panels/MediaPanel.tsx
- src/components/panels/media/panel/**
- tests/unit/mediaPanel*.test.ts
- docs/ongoing/Complete-refactor-checklist.md
- docs/ongoing/complete-refactor/execution-queue-and-lanes.md
Forbidden files:
- src/components/panels/flashboard/**
- src/stores/flashboardStore/**
- src/services/flashboard/**
- src/components/panels/media/board/**
- src/components/timeline/**
- src/stores/timeline/**
- src/timeline/architecture/**
- src/engine/**
- src/components/export/**
- src/components/preview/**
- src/services/project/**
- src/services/mediaRuntime/**
Current contract: header count, relink button, import button, view controls,
and Add dropdown shell still live in `MediaPanel.tsx`.
Target contract: header/action presentation is moved behind a typed panel
module boundary, while `MediaPanel.tsx` keeps state, handlers, and store calls.
Expected gates:
- P4_MEDIA_PANEL_SHELL_SPLIT
Expected checks:
- npm run test -- tests/unit/mediaPanelDropImport.test.ts tests/unit/mediaPanelItemTypeGuards.test.ts tests/unit/mediaPanelSourceMonitor.test.tsx
- npx tsc -b --pretty false
- rg -n "flashboard-|useFlashBoardStore|FlashBoardComposer|MediaDownloadComposer" src/components/panels/MediaPanel.tsx src/components/panels/media/panel
Expected report:
- `MediaPanel.tsx` further reduced toward source ceiling
- header/action panel module listed with LOC
- import, relink, Add dropdown, and view-mode behavior unchanged
- focused checks passed
Stop conditions:
- FlashBoard implementation files must change
- Media Board renderer behavior must change
- project schema/load/save, Timeline, render, export, preview, or media runtime
  behavior must change
```

```text
Lane: P4 Media Panel And FlashBoard
Packet: P4-MEDIA-PANEL-CLASSIC-LIST-CHROME-SPLIT-008 Media Panel Classic List Chrome Extraction
Mode: implementation, MediaPanel classic-list presentation split only
Goal: extract classic list wrapper, column headers, virtual spacers, and
marquee overlay presentation into role-specific list modules while preserving
row rendering, column sizing/sorting/dragging, selection, marquee, import,
active Media Board, FlashBoard, download tray, project schema, Timeline,
render, and media runtime behavior.
Read first:
- src/components/panels/MediaPanel.tsx
- src/components/panels/MediaPanel.css
- src/components/panels/media/list/**
- tests/unit/mediaPanelDropImport.test.ts
- tests/unit/mediaPanelItemTypeGuards.test.ts
- tests/unit/mediaPanelSourceMonitor.test.tsx
Allowed write set:
- src/components/panels/MediaPanel.tsx
- src/components/panels/media/list/**
- tests/unit/mediaPanel*.test.ts
- docs/ongoing/Complete-refactor-checklist.md
- docs/ongoing/complete-refactor/execution-queue-and-lanes.md
Forbidden files:
- src/components/panels/flashboard/**
- src/stores/flashboardStore/**
- src/services/flashboard/**
- src/components/panels/media/board/**
- src/components/panels/media/panel/**
- src/components/timeline/**
- src/stores/timeline/**
- src/timeline/architecture/**
- src/engine/**
- src/components/export/**
- src/components/preview/**
- src/services/project/**
- src/services/mediaRuntime/**
Current contract: classic list wrapper, column header rendering, virtual
spacers, and marquee overlay presentation still live in `MediaPanel.tsx`.
Target contract: classic-list chrome presentation is moved behind typed list
module boundaries, while `MediaPanel.tsx` keeps state, handlers, and row data.
Expected gates:
- P4_MEDIA_PANEL_SHELL_SPLIT
Expected checks:
- npm run test -- tests/unit/mediaPanelDropImport.test.ts tests/unit/mediaPanelItemTypeGuards.test.ts tests/unit/mediaPanelSourceMonitor.test.tsx
- npx tsc -b --pretty false
- rg -n "flashboard-|useFlashBoardStore|FlashBoardComposer|MediaDownloadComposer" src/components/panels/MediaPanel.tsx src/components/panels/media/list
Expected report:
- `MediaPanel.tsx` further reduced toward source ceiling
- classic-list chrome modules listed with LOC
- column sizing/sorting/dragging and marquee behavior unchanged
- focused checks passed
Stop conditions:
- FlashBoard implementation files must change
- Media Board renderer behavior must change
- project schema/load/save, Timeline, render, export, preview, or media runtime
  behavior must change
```

```text
Lane: P4 Media Panel And FlashBoard
Packet: P4-MEDIA-PANEL-GRID-CHROME-SPLIT-009 Media Panel Grid Chrome Extraction
Mode: implementation, MediaPanel grid presentation split only
Goal: extract grid wrapper, breadcrumb placement, grid container, and grid
marquee overlay presentation into role-specific grid modules while preserving
grid item rendering, folder navigation, selection, marquee, import, active
Media Board, FlashBoard, download tray, project schema, Timeline, render, and
media runtime behavior.
Read first:
- src/components/panels/MediaPanel.tsx
- src/components/panels/MediaPanel.css
- src/components/panels/media/grid/**
- tests/unit/mediaPanelDropImport.test.ts
- tests/unit/mediaPanelItemTypeGuards.test.ts
- tests/unit/mediaPanelSourceMonitor.test.tsx
Allowed write set:
- src/components/panels/MediaPanel.tsx
- src/components/panels/media/grid/**
- tests/unit/mediaPanel*.test.ts
- docs/ongoing/Complete-refactor-checklist.md
- docs/ongoing/complete-refactor/execution-queue-and-lanes.md
Forbidden files:
- src/components/panels/flashboard/**
- src/stores/flashboardStore/**
- src/services/flashboard/**
- src/components/panels/media/board/**
- src/components/panels/media/list/**
- src/components/panels/media/panel/**
- src/components/timeline/**
- src/stores/timeline/**
- src/timeline/architecture/**
- src/engine/**
- src/components/export/**
- src/components/preview/**
- src/services/project/**
- src/services/mediaRuntime/**
Current contract: grid wrapper, breadcrumb placement, grid container, and grid
marquee overlay presentation still live in `MediaPanel.tsx`.
Target contract: grid chrome presentation is moved behind typed grid module
boundaries, while `MediaPanel.tsx` keeps state, handlers, and item data.
Expected gates:
- P4_MEDIA_PANEL_SHELL_SPLIT
Expected checks:
- npm run test -- tests/unit/mediaPanelDropImport.test.ts tests/unit/mediaPanelItemTypeGuards.test.ts tests/unit/mediaPanelSourceMonitor.test.tsx
- npx tsc -b --pretty false
- rg -n "flashboard-|useFlashBoardStore|FlashBoardComposer|MediaDownloadComposer" src/components/panels/MediaPanel.tsx src/components/panels/media/grid
Expected report:
- `MediaPanel.tsx` further reduced toward source ceiling
- grid chrome modules listed with LOC
- folder navigation, grid selection, and marquee behavior unchanged
- focused checks passed
Stop conditions:
- FlashBoard implementation files must change
- Media Board renderer behavior must change
- project schema/load/save, Timeline, render, export, preview, or media runtime
  behavior must change
```

```text
Lane: P4 Media Panel And FlashBoard
Packet: P4-MEDIA-PANEL-FEEDBACK-TRAY-SHELL-SPLIT-010 Media Panel Feedback And Tray Shell Extraction
Mode: implementation, MediaPanel feedback/tray shell presentation split only
Goal: extract floating action feedback portal and generation-tray mount shell
into role-specific panel modules while preserving feedback text placement,
generation tray expanded state, download tray behavior inside the generation
tray, active Media Board deep-zoom suppression, FlashBoard, project schema,
Timeline, render, and media runtime behavior.
Read first:
- src/components/panels/MediaPanel.tsx
- src/components/panels/MediaPanel.css
- src/components/panels/media/panel/**
- src/components/panels/media/MediaAIGenerativeTray.tsx
- tests/unit/mediaPanelDropImport.test.ts
- tests/unit/mediaPanelItemTypeGuards.test.ts
- tests/unit/mediaPanelSourceMonitor.test.tsx
Allowed write set:
- src/components/panels/MediaPanel.tsx
- src/components/panels/media/panel/**
- tests/unit/mediaPanel*.test.ts
- docs/ongoing/Complete-refactor-checklist.md
- docs/ongoing/complete-refactor/execution-queue-and-lanes.md
Forbidden files:
- src/components/panels/flashboard/**
- src/stores/flashboardStore/**
- src/services/flashboard/**
- src/components/panels/media/board/**
- src/components/panels/media/grid/**
- src/components/panels/media/list/**
- src/components/panels/media/MediaAIGenerativeTray.tsx
- src/components/panels/media/MediaAIGenerativeTrayExpanded.tsx
- src/components/panels/media/MediaDownloadComposer.tsx
- src/components/timeline/**
- src/stores/timeline/**
- src/timeline/architecture/**
- src/engine/**
- src/components/export/**
- src/components/preview/**
- src/services/project/**
- src/services/mediaRuntime/**
Current contract: floating feedback portal and generation tray mount condition
still live in `MediaPanel.tsx`.
Target contract: feedback and generation-tray shell presentation are moved
behind typed panel module boundaries, while `MediaPanel.tsx` keeps state and
handlers.
Expected gates:
- P4_MEDIA_PANEL_SHELL_SPLIT
Expected checks:
- npm run test -- tests/unit/mediaPanelDropImport.test.ts tests/unit/mediaPanelItemTypeGuards.test.ts tests/unit/mediaPanelSourceMonitor.test.tsx
- npx tsc -b --pretty false
- rg -n "flashboard-|useFlashBoardStore|FlashBoardComposer|MediaDownloadComposer" src/components/panels/MediaPanel.tsx src/components/panels/media/panel
Expected report:
- `MediaPanel.tsx` further reduced toward source ceiling
- feedback/tray shell modules listed with LOC
- floating feedback, generation tray, and download tray behavior unchanged
- focused checks passed
Stop conditions:
- FlashBoard implementation files must change
- active Media Board behavior must change
- generation tray internals or MediaDownloadComposer must change
- project schema/load/save, Timeline, render, export, preview, or media runtime
  behavior must change
```

```text
Lane: P4 Media Panel And FlashBoard
Packet: P4-MEDIA-PANEL-BOARD-SELECTOR-PREFLIGHT-011 Media Panel Board And Selector Boundary Preflight
Mode: preflight, read-only source inspection plus docs/checklist update only
Goal: define the next source packet for splitting remaining MediaPanel board,
folder/import-status, and media-store selector boundaries. The preflight must
produce explicit write sets, forbidden files, focused checks, and stop
conditions before any active Media Board renderer, media store selector, project
schema, Timeline, render, export, or media runtime source changes.
Read first:
- src/components/panels/MediaPanel.tsx
- src/components/panels/media/board/**
- src/stores/mediaStore/**
- src/components/panels/media/**
- docs/ongoing/Complete-refactor-checklist.md
- docs/ongoing/complete-refactor/p4-media-panel-and-flashboard.md
Allowed write set:
- docs/ongoing/Complete-refactor-checklist.md
- docs/ongoing/complete-refactor/execution-queue-and-lanes.md
Forbidden files:
- src/components/panels/MediaPanel.tsx
- src/components/panels/media/**
- src/stores/mediaStore/**
- src/components/panels/flashboard/**
- src/stores/flashboardStore/**
- src/services/flashboard/**
- src/components/timeline/**
- src/stores/timeline/**
- src/timeline/architecture/**
- src/engine/**
- src/components/export/**
- src/components/preview/**
- src/services/project/**
- src/services/mediaRuntime/**
Current contract: remaining large MediaPanel work is dominated by active Media
Board orchestration, direct store reads/actions, folder/import-status handling,
and board/search/reveal coordination.
Target contract: next source packet has one bounded ownership slice with exact
read set, write set, forbidden files, focused checks, and stop conditions.
Expected gates:
- P4_MEDIA_PANEL_SHELL_SPLIT
- P4_MEDIA_STORE_SELECTOR_CONTRACT
- P4_MEDIA_BOARD_RENDER_STRATEGY
- P4_MEDIA_BOARD_PROJECT_ROUNDTRIP
Expected checks:
- rg -n "useMediaStore|useMediaStore\\.getState|mediaBoard|MediaBoard|folder|import" src/components/panels/MediaPanel.tsx src/components/panels/media/board src/stores/mediaStore
- rg -n "flashboard-|useFlashBoardStore|FlashBoardComposer|MediaDownloadComposer" src/components/panels/MediaPanel.tsx src/components/panels/media
Expected report:
- next source packet id and allowed/forbidden write sets
- whether the next source packet is board extraction, selector preflight, or
  folder/import-status extraction
- focused checks for that next source packet
- no source files changed
Stop conditions:
- source edits are needed before write sets are explicit
- source inspection shows the next safe slice would cross Media Board renderer,
  media store selector, project schema, Timeline, render/export/preview, or
  media runtime ownership without a joint packet
```

```text
Lane: P4 Media Panel And FlashBoard
Packet: P4-MEDIA-PANEL-BOARD-VIEW-HOST-SPLIT-012 Media Board View Host Boundary Extraction
Mode: implementation, MediaPanel-to-MediaBoardView host extraction only
Goal: extract the `renderMediaBoardView` JSX/prop-host boundary from
`MediaPanel.tsx` into a role-specific Media Board host module while preserving
all Media Board layout, storage, renderer, gesture, drag/drop, thumbnail,
annotation, search, selection, and project behavior.
Read first:
- src/components/panels/MediaPanel.tsx
- src/components/panels/media/board/MediaBoardView.tsx
- src/components/panels/media/board/types.ts
- tests/unit/mediaPanelDropImport.test.ts
- tests/unit/mediaPanelItemTypeGuards.test.ts
- tests/unit/mediaPanelSourceMonitor.test.tsx
Allowed write set:
- src/components/panels/MediaPanel.tsx
- src/components/panels/media/board/MediaBoardView.tsx
- src/components/panels/media/board/MediaBoardHost.tsx
- tests/unit/mediaPanel*.test.ts
- docs/ongoing/Complete-refactor-checklist.md
- docs/ongoing/complete-refactor/execution-queue-and-lanes.md
Forbidden files:
- src/components/panels/media/board/layout.ts
- src/components/panels/media/board/storage.ts
- src/components/panels/media/board/constants.ts
- src/components/panels/media/board/overviewCanvas.ts
- src/components/panels/media/board/types.ts except read-only verification
- src/components/panels/flashboard/**
- src/stores/flashboardStore/**
- src/services/flashboard/**
- src/stores/mediaStore/**
- src/components/timeline/**
- src/stores/timeline/**
- src/timeline/architecture/**
- src/engine/**
- src/components/export/**
- src/components/preview/**
- src/services/project/**
- src/services/mediaRuntime/**
Current contract: `MediaPanel.tsx` owns the `renderMediaBoardView` JSX and
passes every Media Board prop directly to `MediaBoardView`.
Target contract: `MediaPanel.tsx` passes the same props to a typed
`MediaBoardHost` boundary; `MediaBoardView` behavior and renderer internals are
unchanged.
Expected gates:
- P4_MEDIA_PANEL_SHELL_SPLIT
- P4_MEDIA_BOARD_RENDER_STRATEGY
Expected checks:
- npm run test -- tests/unit/mediaPanelDropImport.test.ts tests/unit/mediaPanelItemTypeGuards.test.ts tests/unit/mediaPanelSourceMonitor.test.tsx
- npx tsc -b --pretty false
- rg -n "renderMediaBoardView|MediaBoardHost|export interface MediaBoardViewProps" src/components/panels/MediaPanel.tsx src/components/panels/media/board
- rg -n "flashboard-|useFlashBoardStore|FlashBoardComposer|MediaDownloadComposer" src/components/panels/MediaPanel.tsx src/components/panels/media/board
Expected report:
- `MediaPanel.tsx` further reduced toward source ceiling
- Media Board host module listed with LOC
- Media Board renderer/layout/storage files unchanged except optional
  `MediaBoardViewProps` export in `MediaBoardView.tsx`
- focused checks passed
Stop conditions:
- Media Board layout, storage, constants, overview canvas, gesture behavior, or
  renderer markup must change
- media store selectors/actions must change
- FlashBoard, project schema/load/save, Timeline, render, export, preview, or
  media runtime behavior must change
```

```text
Lane: P4 Media Panel And FlashBoard
Packet: P4-MEDIA-PANEL-BOARD-ANNOTATION-DATA-SPLIT-013 Media Board Annotation Data Extraction
Mode: implementation, Media Board annotation data/helper extraction only
Goal: extract Media Board annotation type, color contract, storage key,
load/save, and normalization helpers from `MediaPanel.tsx` into a role-specific
board annotation module while preserving annotation UI, drag, resize, edit,
selection, context-menu, and localStorage behavior.
Read first:
- src/components/panels/MediaPanel.tsx
- src/components/panels/media/context/MediaAnnotationContextMenu.tsx
- src/components/panels/media/board/MediaBoardView.tsx
- tests/unit/mediaPanelDropImport.test.ts
- tests/unit/mediaPanelItemTypeGuards.test.ts
- tests/unit/mediaPanelSourceMonitor.test.tsx
Allowed write set:
- src/components/panels/MediaPanel.tsx
- src/components/panels/media/board/annotations.ts
- tests/unit/mediaPanel*.test.ts
- docs/ongoing/Complete-refactor-checklist.md
- docs/ongoing/complete-refactor/execution-queue-and-lanes.md
Forbidden files:
- src/components/panels/media/board/MediaBoardView.tsx
- src/components/panels/media/board/MediaBoardHost.tsx
- src/components/panels/media/board/layout.ts
- src/components/panels/media/board/storage.ts
- src/components/panels/media/board/constants.ts
- src/components/panels/media/board/overviewCanvas.ts
- src/components/panels/media/board/types.ts
- src/components/panels/flashboard/**
- src/stores/flashboardStore/**
- src/services/flashboard/**
- src/stores/mediaStore/**
- src/components/timeline/**
- src/stores/timeline/**
- src/timeline/architecture/**
- src/engine/**
- src/components/export/**
- src/components/preview/**
- src/services/project/**
- src/services/mediaRuntime/**
Current contract: `MediaPanel.tsx` owns Media Board annotation durable data
shape, color options, clamp/normalize helpers, localStorage key, load/save, and
the UI/gesture callbacks.
Target contract: Media Board annotation durable data and persistence helpers
live in `media/board/annotations.ts`; `MediaPanel.tsx` keeps annotation UI,
gesture callbacks, context-menu wiring, and selection state for this packet.
Expected gates:
- P4_MEDIA_PANEL_SHELL_SPLIT
- P4_MEDIA_BOARD_RENDER_STRATEGY
Expected checks:
- npm run test -- tests/unit/mediaPanelDropImport.test.ts tests/unit/mediaPanelItemTypeGuards.test.ts tests/unit/mediaPanelSourceMonitor.test.tsx
- npx tsc -b --pretty false
- rg -n "MediaBoardAnnotation|MEDIA_BOARD_ANNOTATIONS_STORAGE_KEY|loadMediaBoardAnnotations|saveMediaBoardAnnotations" src/components/panels/MediaPanel.tsx src/components/panels/media/board/annotations.ts
- rg -n "flashboard-|useFlashBoardStore|FlashBoardComposer|MediaDownloadComposer" src/components/panels/MediaPanel.tsx src/components/panels/media/board
Expected report:
- annotation type/constants/storage helpers are isolated in a board role module
- `MediaPanel.tsx` reduced toward source ceiling
- annotation UI, gestures, context menu, and renderer markup unchanged
- focused checks passed
Stop conditions:
- annotation renderer markup, drag/resize math, context menu presentation, or
  MediaBoardView behavior must change
- board layout/storage/constants/overview canvas/type contracts must change
- media store selectors/actions must change
- FlashBoard, project schema/load/save, Timeline, render, export, preview, or
  media runtime behavior must change
```
- Sequence-frame `File` hydration debt moved to explicit packet
  `P3-HYDRATION-ADAPTER-001` because project load/save edits are forbidden in
  this schema-only packet.
- Deprecated payload deletion/ignore work remains open for
  `P3_DEPRECATED_PAYLOADS_DELETED_OR_IGNORED`.

```text
Lane: P3 Project Hydration Adapter
Packet: P3-HYDRATION-ADAPTER-001 Sequence Frame Runtime Field Removal
Mode: implementation, hydration adapter only
Goal: remove sequence-frame File/object-URL fields from persisted project DTOs
while preserving current-schema save/load behavior. Runtime File handles and
object URLs are constructed only by project load hydration from project raw
paths or stored handles.
Read first:
- src/services/project/types/schema.types.ts
- src/services/project/projectLoad.ts
- src/services/project/projectSave.ts
- tests/unit/projectSchemaBoundary.test.ts
Allowed write set:
- src/services/project/types/schema.types.ts
- src/services/project/projectLoad.ts
- tests/unit/projectSchemaBoundary.test.ts
- src/architecture/foundationTypeTiers.ts
- src/architecture/gateRegistry.ts
- src/architecture/retiredPathLedger.ts
- docs/ongoing/Complete-refactor.md
- docs/ongoing/Complete-refactor-checklist.md
- docs/ongoing/complete-refactor/**
Forbidden files:
- src/services/project/projectSave.ts except read-only verification
- src/stores/**
- src/components/**
- src/engine/**
- src/services/mediaRuntime/**
- src/timeline/architecture/**
Current contract: project sequence-frame DTOs still expose optional File and
object-URL fields as classified adapter debt.
Target contract: persisted sequence-frame DTOs contain paths and serializable
metadata only; load hydration creates runtime frame File handles and object URLs
as adapter outputs.
Retired paths in scope:
- ProjectModelSequenceFrame.file
- ProjectModelSequenceFrame.modelUrl
- ProjectGaussianSplatSequenceFrame.file
- ProjectGaussianSplatSequenceFrame.splatUrl
Expected gates:
- P3_PROJECT_SCHEMA_BOUNDARY
- P3_CURRENT_PROJECT_SCHEMA_ONLY
- P3_LEGACY_PROJECT_COMPAT_RETIRED
- P3_RUNTIME_HANDLE_ROUNDTRIP_GUARD
Expected checks:
- P1S_PROJECT_SCHEMA_NO_PRODUCT_IMPORTS
- P1S_SHARED_SCHEMA_RUNTIME_FREE
- npm run test -- tests/unit/projectSchemaBoundary.test.ts tests/unit/foundationTypeBoundary.test.ts tests/unit/completeArchitectureRegistry.test.ts tests/unit/persistedStateRuntimeHandles.test.ts
- npx tsc -b --pretty false
Expected report:
- project DTO fields removed
- projectLoad hydration reads runtime data from current project raw paths or
  handles only
- old persisted sequence-frame File/object-URL payloads are ignored by policy
Stop conditions:
- projectSave must start persisting runtime handles or object URLs
- Timeline, store, component, engine, export, or media runtime behavior must
  change
- current-schema project save/load assignability fails
```

Execution state:

- Completed on 2026-06-09.
- Removed `file`, `modelUrl`, and `splatUrl` runtime fields from persisted
  sequence-frame DTOs in `src/services/project/types/schema.types.ts`.
- Updated `src/services/project/projectLoad.ts` so runtime `File` handles and
  object URLs are adapter outputs created from current project raw paths or
  stored handles.
- Tightened `tests/unit/projectSchemaBoundary.test.ts` so project DTO files must
  have zero runtime-handle hits.
- Marked `P3_PROJECT_SCHEMA_BOUNDARY` satisfied in the architecture registry;
  `P2_STORE_PROJECT_CONTRACT_FREEZE`, current-schema fixture coverage, and
  deprecated payload deletion/ignore work remain open.
- Retired the old persisted sequence-frame `File`/object-URL fields in
  `src/architecture/retiredPathLedger.ts`.
- Verified with:
  `npm run test -- tests/unit/projectSchemaBoundary.test.ts tests/unit/foundationTypeBoundary.test.ts tests/unit/completeArchitectureRegistry.test.ts tests/unit/persistedStateRuntimeHandles.test.ts tests/unit/mediaRuntimeLeaseContracts.test.ts tests/unit/signals/signalFormatMatrix.test.ts tests/unit/signals/signalContracts.test.ts tests/unit/importers/universalImportOrchestrator.test.ts tests/unit/timelineArchitectureRegistry.test.ts tests/unit/projectMediaPersistence.test.ts`.
- TypeScript assignability check passed:
  `npx tsc -b --pretty false`.

## Final Skeptical Review - 2026-06-09

Scope reviewed:

- root index and checklist
- P0/P1/P1A/P1B phase files
- P0/P1 high-conflict ownership table
- queued first source/tooling packets
- current source layout for project schema imports, runtime handles, signals,
  importers, mediaRuntime, and existing signal tests

Findings and decisions:

| Finding | Decision | Result |
|---|---|---|
| `P1A-RUNTIME-LEASE-001` and `P1B-SIGNAL-DTO-001` were named as high-conflict owners but not defined as packets. | Accepted. | Added both queued packets with read sets, write sets, forbidden files, gates, checks, reports, and stop conditions. |
| `P1S_PROJECT_SCHEMA_NO_PRODUCT_IMPORTS` and `P1S_TYPE_BARREL_FANIN` used quote-heavy regex commands that are brittle in PowerShell. | Accepted. | Replaced with PowerShell-safe `rg` patterns that avoid embedded quote escaping. |
| `P1S_SIGNAL_DTO_RUNTIME_FREE` scanned importers even though importers legitimately own `File`/`Blob` IO. | Accepted. | Narrowed DTO runtime-free scan to `src/signals/**` and added `P1B_IMPORTER_IO_CONTAINMENT` for importer IO classification. |
| `tests/unit/completeArchitectureRegistry.test.ts` and `tests/unit/persistedStateRuntimeHandles.test.ts` did not exist at review time. | Accepted as a sequencing constraint. | `P0-REG-001` created `completeArchitectureRegistry.test.ts`; `P1A-RUNTIME-LEASE-001` created `persistedStateRuntimeHandles.test.ts` and `mediaRuntimeLeaseContracts.test.ts`. |
| Existing source scans confirm project schema imports live store/engine types and shared type barrels still carry runtime handles. | Accepted as expected failing baseline. | Gates remain open; these failures are target evidence for P1/P1A/P1-P3 packets, not reasons to broaden source edits now. |
| Timeline source and `src/timeline/architecture/**` must remain protected. | Accepted. | All queued packets list Timeline edits as forbidden except future explicit integration packets. |

Final review decision:

- `P0-P1-PREFLIGHT-001` is complete enough as a docs-only preflight packet.
- Product source refactors remain blocked.
- `P0-REG-001` is the only source/tooling packet approved by this review. It
  may not edit product domains, Timeline source, or `src/timeline/architecture/**`.
- P1, P1A, and P1B contract packets are now complete; P1/P3 implementation
  remains bounded by the schema-freeze write set and forbidden files.

## P0-REG-001 Completion Report - 2026-06-09

Files changed:

- `src/architecture/**`
- `tests/unit/completeArchitectureRegistry.test.ts`

Coupling reduced:

- Whole-codebase gates, lanes, write sets, forbidden sets, high-conflict
  ownership, adapter debt, retired paths, test migration, and exit criteria are
  now machine-checkable instead of Markdown-only.
- Timeline remains a protected reference surface. No Timeline source or
  `src/timeline/architecture/**` files were edited.

Checks run:

- `npm run test -- tests/unit/completeArchitectureRegistry.test.ts tests/unit/timelineArchitectureRegistry.test.ts`
  - passed: 2 files, 66 tests

Remaining gates:

- `P0_BASELINE_REFRESHED` is recorded in the P0 phase file and checklist.
- Runtime smoke gates remain open: render/playback, export, proxy/cache, audio,
  and preview lifecycle still need browser/dev-bridge runs before they become
  regression gates.
- P1, P1A, and P1B contract preflights are complete. The next foundation
  packet is `P1-P3-SCHEMA-FREEZE-001`; broad product source refactors remain
  blocked.

```text
Lane: P0 Baseline And Guard Rails
Packet: P0-BASELINE-REFRESH-001 Baseline Refresh
Mode: read-only plus docs
Goal: regenerate current baseline metrics from the worktree and update the P0
phase file/checklist so no stale planning number is used as a gate.
Read first:
- docs/ongoing/complete-refactor/p0-baseline-and-guard-rails.md
- src/architecture/**
- tests/unit/completeArchitectureRegistry.test.ts
Allowed write set:
- docs/ongoing/complete-refactor/p0-baseline-and-guard-rails.md
- docs/ongoing/Complete-refactor-checklist.md
- docs/ongoing/Complete-refactor.md only if current execution state changes
Forbidden files:
- src/**
- tests/**
- scripts/**
- package.json
- package-lock.json
- src/timeline/architecture/**
Current contract: baseline numbers are planning signals from earlier scans.
Target contract: refreshed LOC, large-file, fan-in/barrel, `getState()`,
runtime-handle, CSS/global-selector, and smoke-inventory summaries are recorded
with command ids and date.
Expected gates:
- P0_BASELINE_CAPTURED
- P0_BASELINE_REFRESHED
Expected checks:
- P0S_DOMAIN_LOC
- P0S_LARGE_FILES
- P0S_BROAD_BARRELS_AND_FANIN
- P0S_GETSTATE_USAGE
- P0S_RUNTIME_HANDLE_BOUNDARY
- P0S_CSS_GLOBAL_SELECTOR
- P0S_SMOKE_INVENTORY
Expected report:
- commands run and summarized
- counts updated or explicitly left as planning-only
- source files not modified
Stop conditions:
- a scan requires instrumentation source changes
- output is too large to summarize cleanly in the P0 phase file
- current worktree changes make a metric ambiguous
```

## P1-CONTRACT-001 Completion Report - 2026-06-09

Files changed:

- `src/architecture/foundationTypeTiers.ts`
- `src/architecture/gateRegistry.ts`
- `src/architecture/index.ts`
- `tests/unit/foundationTypeBoundary.test.ts`
- P0/P1 execution docs and checklist

Coupling reduced:

- Type tiers are now machine-checkable instead of only described in Markdown.
- New direct imports from the broad `src/types/index.ts` facade are visible via
  `tests/unit/foundationTypeBoundary.test.ts`.
- Current runtime-handle hits in shared type surfaces are classified as either
  compatibility-facade debt or render-runtime contracts.
- Current project-schema imports from store/engine-shaped types are classified
  for `P1-P3-SCHEMA-FREEZE-001` instead of being normalized inside P1.

Checks run:

- `npm run test -- tests/unit/foundationTypeBoundary.test.ts tests/unit/completeArchitectureRegistry.test.ts tests/unit/timelineArchitectureRegistry.test.ts`
  - passed: 3 files, 70 tests

Remaining gates:

- `P1_GLOBAL_TYPES_BARREL_THIN` remains open until the broad type barrel is
  actually shrunk or retired below the target budget.
- `P1_TYPE_TIER_NO_RUNTIME_IMPORTS` and
  `P1_RUNTIME_HANDLES_FORBIDDEN_IN_SHARED_SCHEMA` remain open until P1A/P1-P3
  packets remove the classified runtime-handle debt.
- Project schema DTO ownership remains with `P1-P3-SCHEMA-FREEZE-001`.

## First Orchestrator Execution Wave

The first real execution wave should still be read-only, but it is concrete
codebase work, not meta-planning.

Run up to 6 agents:

1. Foundation map agent
   - read `src/types`, `src/stores`, `src/services/project/types`,
     `src/services/mediaRuntime`, `src/signals`, and `src/importers`
   - output target type tiers, store facades, forbidden runtime handles, and
     Phase 1A clip/media runtime split plus Phase 1B signal DTO constraints
2. Store/runtime agent
   - read `src/stores`, `src/hooks/useEngine.ts`, high `getState()` hotspots
   - output runtime lease owners and `getState()` usage classification plan
3. Project/importer agent
   - read `src/services/project`, project feature docs, FlashBoard persistence
   - output current project schema split, legacy payload deletion/ignore plan,
     localStorage/UI-preferences adapter, and retired-path ledger candidates
4. Media/FlashBoard agent
   - read `MediaPanel`, `mediaStore`, `FlashBoardComposer`, FlashBoard services
   - output active contract, shell split, Media Board versus FlashBoard Board
     classification, retired board/canvas paths
5. Preview/export/UI agent
   - read Preview, ExportPanel, overlays, dock/common CSS
   - output render-target snapshot dependency, export session contract, and CSS
     global/z-index/retired-class split plan
6. Hotpath/smoke agent
   - read RenderDispatcher, WebCodecsPlayer, proxy/cache, audio, aiTools smokes
   - output performance-smoke matrix, audio context ownership map, proxy/cache
     close/revoke gates, and hot-path split invariants

The orchestrator then synthesizes these findings into this plan, the checklist,
and the first implementation packets.

## Lane Records

The plan should track at least these lanes:

- Foundation contracts: type tier, barrels, dependency map, runtime-free shared
  contracts.
- Universal signals and importers: signal DTOs, universal import route matrix,
  artifact storage, timeline materialization, preview/export fallback, and
  renderer/runtime adapter boundary.
- Store architecture: timeline, media, history, dock, settings, render targets,
  selectors, commands, IO, runtime leases.
- Project persistence: load/save, importers, hydration, autosave, history,
  artifacts, and retired project data classification.
- Media Panel and media store: panel shell, board/grid/tray composition,
  subscriptions, generated media, imports, persistence.
- FlashBoard and AI generation: active generation request, queue/job state,
  provider task, media import, prompt/pricing/catalog/chat services.
- Preview: target canvas registration, overlays, camera/input, source monitor,
  render-target lifecycle.
- Export: UI shell, runners, progress, audio/GIF/WebCodecs/FFmpeg boundaries.
- Audio: recording, analysis, routing, engine, mixer, proxies, lifecycle.
- Render/core/codecs: WebGPU/WebCodecs, dispatcher, players, cache ownership,
  hot-path invariants.
- Proxy/thumbnail/cache/media runtime services.
- AI tools/dev bridge/guided actions/smoke handlers.
- Common UI/dock/toolbar/dialogs/CSS architecture.
- Tests, scripts, tools, and diagnostics where they shape architecture.

Each lane must record:

- current contract
- target contract
- intended write set
- forbidden files
- high-conflict files
- exit gates
- focused checks
- performance or runtime invariants
- retired paths
- test migration classification

## FlashBoard Legacy Position

FlashBoard should be an early lane inside the whole-codebase plan, not a
separate unplanned cleanup before the plan.

The old dock-level `AI Generative` / `ai-video` tab appears to be retired
legacy:

- `ai-video` remains in the dock panel type union as a deprecated dock-layout
  payload candidate that may be deleted or ignored.
- `DockPanelContent` no longer renders an `ai-video` panel.
- Toolbar and dock add/change menus filter deprecated panel types.

Likely retired candidates:

- old `.flashboard-workspace`, `.flashboard-toolbar`, `.flashboard-canvas*`,
  `.flashboard-node*`, resize, drag, and context-menu CSS
- `selectedNodeIds`
- `viewMode: 'board'`
- board `viewport`
- node `position` and `size`
- `createReferenceNode`
- `moveNode`
- `resizeNode`
- `duplicateNode`
- old z-order actions

Still-active pieces that must not be deleted blindly:

- `MediaAIGenerativeTray` and `useFlashBoardRuntime`
- `FlashBoardComposer`
- `MediaAIGenerationQueue`
- `FlashBoardJobService`
- `FlashBoardMediaBridge`
- pricing, catalog, prompt refinement, and chat services
- project save/load/history persistence for generation state and metadata

Active contract:

```text
media generation request -> queue/job state -> provider task -> media import
```

Everything outside that active contract should be classified as retained target
architecture or retired legacy. Old-project compatibility is not required.

## Canvas And Performance Rule

Do not convert UI to canvas by default.

Reuse the timeline rendering method only where there is a real hot path or a
measured DOM update bottleneck, such as dense visual timelines, board/preview
drawing, or large interactive visual surfaces.

Composer, form, settings, toolbar, and command UI should remain normal
React/DOM unless the baseline proves otherwise.

Render/core/WebCodecs/audio/export work must start from performance baselines
and smoke gates. Splitting a hot-path file is not success unless lifecycle
ownership, cache ownership, and runtime invariants improve.

## AI Bridge And Smoke Quarantine

`aiTools/bridge.ts` and dev smoke/stress test files are architecture debt, but they
also protect current behavior.

Plan rule:

- do not delete or shrink verifier surfaces before replacement smokes exist
- separate product architecture from dev-only bridge policy
- record which smoke or bridge handler proves each refactor gate
- classify bridge-only behavior as verifier, product behavior, or retired
  diagnostic path

## Execution Readiness Gate

Before a source implementation packet starts, the orchestrator must have:

- lane order and dependency graph
- current and target contracts for all shared foundations
- write sets and forbidden files for every lane
- high-conflict ownership for shared hubs
- executable gates and focused checks
- runtime invariants and lease ownership
- baseline metrics and performance guardrails
- retired-path ledger entries
- test-migration ledger entries
- stale-doc and retired-data decisions
- skeptical review findings and accepted/rejected changes
- orchestrator-ready worker packets for the first execution wave
- max-6 parallel scheduling plan with conflicts and sequencing notes

A plan that only lists god objects, LOC targets, or file splits is incomplete.
It must name the coupling reduced and the check that proves it.

## Parallel Agent Use

Parallel agents should be used in both planning and execution when the work can
be split cleanly. The master orchestrator decides the wave, assigns packets,
and integrates the results.

Allowed parallel waves:

- planning and baseline scans
- contract/design reviews
- implementation packets with disjoint write sets
- verification packets that run gates, smokes, tests, and diff review
- cleanup/classification packets for tests, retired paths, CSS, and docs

Use up to 6 parallel worker agents when useful. Parallelism is encouraged for
separate domains such as Foundation, Project, Media/FlashBoard, Preview/Export,
Render/Audio/Proxy, and AI Tools, but only after shared contracts and forbidden
files are clear.

Do not parallelize packets that touch the same shared hub or unresolved
contract. These must be sequenced:

- shared type tier and `src/types/index.ts`
- project schema/load/save/importers
- media runtime lease owner
- timeline/media/history/dock store facades
- render target lifecycle and engine export state
- `RenderDispatcher`, `WebGPUEngine`, `Preview`, `ExportPanel`
- `MediaPanel`, `mediaStore`, `FlashBoardComposer`, FlashBoard persistence
- AI bridge and smoke handler registries

Every worker packet must state:

- lane
- mode: read-only, implementation, or verification
- read set
- allowed write set
- forbidden files
- current contract
- target contract
- expected gates/checks
- expected report
- stop conditions

Implementation workers must not broaden scope when they discover extra debt.
They report it and let the orchestrator schedule a new packet.

## Immediate Next Step

Execute `P4-MEDIA-PANEL-BOARD-ANNOTATION-DATA-SPLIT-013` as the next bounded
packet.

Constraints:

1. Extract only Media Board annotation data types, constants, storage key,
   load/save, and normalization helpers.
2. Do not edit annotation UI, drag/resize math, context menu presentation,
   Media Board layout, storage, constants, overview canvas, or renderer markup.
3. Do not edit media store selectors/actions in this packet.
4. Do not edit FlashBoard, Timeline, render, export, project schema/load/save,
   media runtime, or `src/timeline/architecture/**`.

