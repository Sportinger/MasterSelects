# Complete Refactor - P2-P3 State And Project Persistence

Source: split from `docs/ongoing/Complete-refactor.md` on 2026-06-09.

Back to index: [Complete-refactor.md](../Complete-refactor.md).

### Phase 2 - Store And Runtime Ownership

Goal: make stores durable and predictable, while runtime handles move to
service-owned leases.

Current codebase signals:

- `getState()` usage outside stores is widespread:
  - `timelineCanvasSmoke`: 56
  - `MatAnyoneService`: 48
  - `stress test`: 46
  - `aiTools/bridge`: 33
  - `SAM2Panel`: 32
  - `AudioMixerPanel`: 30
  - `Preview`: 27
  - `useEngine`: 25
  - `projectLoad`: 19
  - `RenderDispatcher`: 16
- runtime-handle-heavy files include GPU/render files, proxy/cache, thumbnails,
  audio recording/routing, WebCodecs, Native3D, and project file services.
- `historyStore.ts` and `dockStore.ts` are both over 1,700 LOC and mix durable
  state, migration, normalization, and app coordination.

Target shape:

- Stores own durable state and action application.
- Selectors live in focused selector modules.
- Command/planner logic lives outside stores.
- Runtime handles are owned by `services/mediaRuntime` or another explicitly
  approved runtime owner from the Phase 1A lease map.
- Project save/load works through schema/importer adapters, not live store
  implementation types.
- `getState()` outside stores is classified, not blindly counted:
  - sanctioned fresh reads in async callbacks may remain
  - controlled adapter/bridge reads are allowlisted
  - module-scope and render-path reads are reduction targets
  - render hot paths must use typed snapshots instead of live store reads

Concrete targets:

- `src/stores/dockStore.ts`: split migration/normalization, layout commands,
  selectors, and store facade.
- `src/stores/historyStore.ts`: split snapshot builders, FlashBoard history
  adapter, project/media/timeline snapshots, and undo/redo store facade.
- `src/stores/mediaStore/slices/fileManageSlice.ts`: split import planner,
  file runtime handling, folder operations, and durable slice actions.
- `src/stores/timeline/**`: keep the new timeline architecture direction, but
  finish runtime-handle removal and store facade narrowing after foundation.

Gates:

- `P2_DURABLE_STORE_BOUNDARY`
- `P2_RUNTIME_LEASE_OWNERS_DEFINED`
- `P2_GETSTATE_USAGE_CLASSIFIED`
- `P2_GETSTATE_MODULE_SCOPE_FORBIDDEN`
- `P2_HISTORY_AND_DOCK_SPLIT`
- `P2_PROJECT_HYDRATION_NOT_STORE_INTERNALS`
- `P2_STORE_PROJECT_CONTRACT_FREEZE`

Checks:

- `getState()` report by file and usage class
- allowlist for adapter/bridge `getState()` reads
- unit tests for dock normalization/migration
- history snapshot/restore tests ported away from internal god-object shape
- project save/load smoke

Do not:

- Do not reduce `getState()` by count alone; classify each usage first.
- Do not persist runtime leases, object URLs, DOM handles, GPU handles, or
  decoder/player instances in stores.
- Do not edit project schema or load/save internals from a store packet except
  through an approved hydration adapter packet.

### Phase 3 - Project Persistence And Current Schema Boundary

Goal: make current project state serializable, schema-owned, and independent
from runtime/store implementation. Old saved-project compatibility is not a
constraint unless the user explicitly reintroduces it later.

Current codebase signals:

- `src/services/project/projectLoad.ts`: 2,003 LOC, 28 fan-out, 19 `getState()`
  usages.
- `src/services/project/projectSave.ts`: 22 fan-out, serializes live stores,
  including FlashBoard.
- `src/services/project/ProjectFileService.ts`: 1,264 LOC and mixes browser
  FSA/native helper/raw/download/project file operations.
- `src/services/project/types/project.types.ts` still includes active
  `flashboard` persisted state; retired board/canvas payloads still need
  classification.
- `src/services/project/types/project.types.ts` and related composition schema
  files currently import live store/engine/runtime-shaped types; this is a
  foundation violation, not just a project-service cleanup.
- old `youtube`, `download`, and `ai-video` panel payloads are retired saved
  data. Active surfaces live in Media Panel and may intentionally break old
  saved projects.
- dock/layout data has both project-file persistence and local persisted UI
  state; the target owner must reconcile both.

Target shape:

- Project schema module owns persisted DTO shapes and imports no stores,
  components, engine modules, or live runtime services.
- Project load/save targets the current schema. Do not build a versioned
  migration registry only to preserve obsolete saved-project payloads.
- Store hydration adapters convert schema data to current durable store state.
- Runtime restore services own leases/object URLs/media handles after hydration.
- Download/YouTube project payloads are deleted or ignored after current Media
  Panel behavior has coverage; obsolete `ProjectFile.youtube` is already
  removed from the current schema.
- FlashBoard saved board/node data is split into active generation metadata and
  retired board-canvas payloads that may be deleted instead of migrated.
- Project UI preferences, dock layout, Media Panel board layout, and direct
  localStorage project UI writes go through an explicit adapter.

Concrete targets:

- `projectLoad.ts`: split into schema validation, media hydration,
  timeline hydration, FlashBoard hydration, dock/layout hydration, runtime
  restore.
- `projectSave.ts`: split into project schema builders by domain.
- `ProjectFileService.ts`: split FSA/native/raw/download operations by IO
  owner.
- `ProjectFlashBoardState`: replace store-shaped persistence with current
  schema-owned active generation metadata. Retired board/canvas payloads do not
  require compatibility importers.
- `project.types.ts` and `composition.types.ts`: no imports from
  `src/stores/**`, `src/engine/**`, or `src/components/**`.
- direct project load/save localStorage sync: move behind
  `projectUiPreferences` or an equivalent project UI adapter.

P1/P3 contract execution state:

- `P1-P3-SCHEMA-FREEZE-001` advanced on 2026-06-09.
- Project schema DTO files now import no stores, components, engine modules,
  runtime services, or broad `src/types` barrel.
- Store/engine-shaped DTOs for generated media items, export state, FlashBoard
  state, sequence metadata, gaussian settings, and timeline payloads are owned
  under `src/services/project/types/**`.
- `tests/unit/projectSchemaBoundary.test.ts` covers product import boundaries,
  zero runtime-handle hits, and current-schema project DTO roundtrip.
- `P3-HYDRATION-ADAPTER-001` completed on 2026-06-09: sequence-frame
  `File`/object-URL fields are no longer persisted project DTO fields, and
  `projectLoad.ts` creates runtime frame handles and URLs from current project
  raw paths or stored handles.
- `P3-DEPRECATED-PAYLOADS-001` completed on 2026-06-09: obsolete
  `ProjectFile.youtube` payloads are no longer part of the current project
  schema; save deletes stale `youtube` payloads, load resets transient YouTube
  state, and YouTube store changes no longer mark projects dirty.
- `P4-P3-UI-LAYOUT-PREFLIGHT-001` completed on 2026-06-09: dock
  `youtube`/`download`/`ai-video` cleanup and retired FlashBoard board/canvas
  classification now have executable gates and retired-path ledger entries.
- Remaining open work: current-project fixture coverage, deprecated payload
  delete/ignore checks for dock/FlashBoard UI-layout payloads, localStorage
  ownership, and the broader store/project contract freeze.

Gates:

- `P3_PROJECT_SCHEMA_BOUNDARY`
- `P3_PROJECT_SCHEMA_NO_STORE_IMPORTS`
- `P3_CURRENT_PROJECT_SCHEMA_ONLY`
- `P3_LEGACY_PROJECT_COMPAT_RETIRED`
- `P3_FLASHBOARD_PERSISTENCE_SPLIT`
- `P3_DEPRECATED_PAYLOADS_DELETED_OR_IGNORED`
- `P3_PROJECT_LOAD_SAVE_NO_DIRECT_LOCALSTORAGE`
- `P3_DOCK_LAYOUT_SINGLE_PERSISTENCE_OWNER`
- `P3_RUNTIME_HANDLE_ROUNDTRIP_GUARD`
- `P3_PROJECT_LOAD_SAVE_SMOKE`

Checks:

- project media persistence tests
- persisted project `structuredClone` and JSON roundtrip tests
- nested restore tests
- autosave recovery tests
- FlashBoard generation metadata save/load tests
- download pending clip migration tests
- current project fixture tests only; old project fixtures are deleted or
  explicitly marked obsolete

Do not:

- Do not import from `src/stores/**`, `src/components/**`, or `src/engine/**`
  inside project schema types.
- Do not add migration machinery just to keep obsolete saved projects loadable.
- Do not let deprecated `youtube`, `download`, `ai-video`, or retired
  FlashBoard board/canvas payloads shape current schema. Delete or ignore them
  after current active behavior is covered.

