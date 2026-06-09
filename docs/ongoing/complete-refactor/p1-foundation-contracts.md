# Complete Refactor - P1 Foundation Contracts

Source: split from `docs/ongoing/Complete-refactor.md` on 2026-06-09.

Back to index: [Complete-refactor.md](../Complete-refactor.md).

### Phase 1 - Foundation Contracts

Goal: remove global coupling pressure before touching domain god objects.

Why first:

- `src/types/index.ts` has 755 direct relative import hits across `src` and
  `tests`, 776 files importing somewhere under `src/types`, and 1,194 raw
  newline-counted LOC.
- `src/stores/timeline/index.ts` and timeline submodules have 368 relative
  import files; the public facade is 356 LOC.
- `src/stores/mediaStore/index.ts` and media-store submodules have 220 relative
  import files; the public facade is 462 LOC.
- `src/services/logger.ts` is 443 LOC and should remain a stable
  utility, not become an architecture dependency sink.
- high fan-out files such as `RenderDispatcher`, `Preview`, `MediaPanel`,
  `projectLoad`, `timeline/index`, and `fileManageSlice` depend on these hubs.

Target shape:

- Replace the global type dump with domain type entry points:
  - media contracts
  - timeline contracts
  - project schema contracts
  - render/audio contracts
  - dock/UI contracts
  - AI-tool contracts
  - effect/vector contracts
- Keep `src/types/index.ts` as a thin compatibility facade only during the
  migration, then retire broad imports at gates.
- Split store contracts into:
  - durable state type
  - action API
  - selectors
  - command/planner API
  - runtime lease API
- Project schema must not import live store types directly. Example current
  risk: `project.types.ts` imports `ProjectFlashBoardState` from the
  FlashBoard store type module.

Concrete targets:

- `src/types/index.ts`: split below 150 LOC or retire as a narrow barrel.
- `src/stores/timeline/index.ts`: public facade only, below 250 LOC.
- `src/stores/mediaStore/index.ts`: public facade only, below 250 LOC.
- `src/types/dock.ts`: keep deprecated panel type retirement explicit but do
  not let active UI depend on deprecated panels.
- `src/services/project/types/project.types.ts`: own project-persistence schema
  instead of importing live runtime/store types.

Gates:

- `P1_TYPE_TIER_DEFINED`
- `P1_GLOBAL_TYPES_BARREL_THIN`
- `P1_TYPE_TIER_NO_RUNTIME_IMPORTS`
- `P1_PROJECT_SCHEMA_NO_STORE_IMPORTS`
- `P1_STORE_PUBLIC_FACADES_DEFINED`
- `P1_PROJECT_SCHEMA_OWNS_PERSISTED_TYPES`
- `P1_RUNTIME_HANDLES_FORBIDDEN_IN_SHARED_SCHEMA`

Checks:

- import-boundary test for domain type entry points
- static scan for `File`, `Blob`, object URLs, `HTMLMediaElement`,
  `VideoFrame`, `ImageBitmap`, `GPU*`, workers, and service singletons in
  project schema/shared pure contracts
- fan-in/fan-out report must show fewer direct imports from `src/types/index.ts`
  after each implementation packet

Do not:

- Do not move domain UI, render, export, or project load/save behavior while the
  type tiers are still being frozen.
- Do not create broad replacement barrels such as `helpers.ts`, `utils.ts`, or
  another global type dump.
- Do not let project schema import live store, engine, component, or runtime
  service types.

P1 executable static-check catalog:

- `P1S_PROJECT_SCHEMA_NO_PRODUCT_IMPORTS`

```powershell
rg -n '\.\./\.\./\.\./(stores|components|engine)|@/(stores|components|engine)' src/services/project/types --glob '*.ts'
```

This check is expected to fail until the P1/P3 contract-freeze packet replaces
project schema imports from live store or engine types with schema-owned DTOs.

- `P1S_SHARED_SCHEMA_RUNTIME_FREE`

```powershell
rg -n '\b(File|Blob|FileSystemFileHandle|HTMLMediaElement|HTMLVideoElement|HTMLAudioElement|HTMLCanvasElement|AudioContext|VideoFrame|ImageBitmap|GPU[A-Za-z]+|Worker|WebCodecsPlayer|NativeDecoder)\b|createObjectURL|revokeObjectURL' src/types src/services/project/types src/signals --glob '*.ts' --glob '*.tsx'
```

Current classified baseline: 20 matching lines / 23 raw token hits. Hits are
limited to `src/types/index.ts` compatibility debt and
`src/types/renderTarget.ts` render-runtime contracts.

- `P1S_TYPE_BARREL_FANIN`

```powershell
rg -n 'from [''"]((\.\./)+src/types|(\.\./)+types)[''"]' src tests --glob '*.ts' --glob '*.tsx'
```

- `P1S_SIGNAL_DTO_RUNTIME_FREE`

```powershell
rg -n '\b(File|Blob|HTMLMediaElement|HTMLVideoElement|HTMLAudioElement|AudioContext|VideoFrame|ImageBitmap|GPU[A-Za-z]+|Worker|WebCodecsPlayer|NativeDecoder)\b|createObjectURL|revokeObjectURL' src/signals --glob '*.ts' --glob '*.tsx'
```

- `P1B_IMPORTER_IO_CONTAINMENT`

```powershell
rg -n '\b(File|Blob|FileReader)\b|createObjectURL|revokeObjectURL' src/importers --glob '*.ts' --glob '*.tsx'
```

Importer IO hits are expected, but must stay inside import planning,
file-identity, and provider modules. A hit in signal DTOs, project schema, UI,
or renderer adapters fails the relevant boundary gate.

- `P1S_MEDIA_RUNTIME_CANONICAL`

```powershell
rg -n 'RuntimeSourceId|MediaRuntimeLease|runtimeSourceId|runtimeSessionKey|createObjectURL|revokeObjectURL|new\s+WebCodecsPlayer|new\s+AudioContext|new\s+Worker' src/types src/stores src/services src/engine --glob '*.ts' --glob '*.tsx'
```

- `P1S_PERSISTED_STATE_ROUNDTRIP_GUARD`

```powershell
npm run test -- tests/unit/persistedStateRuntimeHandles.test.ts
```

`P1S_PERSISTED_STATE_ROUNDTRIP_GUARD` is a reserved check name. It becomes
executable in the P1A/P3 guard packet and must cover both `structuredClone` and
JSON roundtrip behavior.

P1 target type tiers:

- Pure project/schema DTO tier: `src/services/project/types/**` and future
  schema-owned DTO modules. This tier may import only other schema/pure type
  modules. It must not import stores, components, engine, runtime services, DOM
  types, GPU types, `File`, `Blob`, `VideoFrame`, object URLs, workers, or
  service singletons.
- Durable domain contract tier: existing focused files such as
  `src/types/audio.ts`, `src/types/dock.ts`, `src/types/history.ts`,
  `src/types/vectorAnimation.ts`, `src/signals/types.ts`, and
  `src/importers/types.ts`. This tier may describe serializable editor state,
  user intent, and metadata, but not live allocations.
- Runtime lease tier: `src/services/mediaRuntime/types.ts`,
  `src/services/mediaRuntime/registry.ts`, and runtime owner modules. This tier
  may own `File`, object URL, `VideoFrame`, `ImageBitmap`, decoder/player,
  audio, worker, and GPU-facing handles. New owners must follow the HMR
  singleton survival pattern in `AGENTS.md`.
- Render/runtime tier: engine and renderer descriptors that are consumed by
  `RenderDispatcher`, WebGPU, WebCodecs, preview, and export. These types must
  not leak back into project schema or pure shared contracts.
- Compatibility facade tier: `src/types/index.ts` remains a temporary public
  facade only. New implementation packets must not add broad imports from this
  file unless the packet explicitly records the compatibility debt and its
  retirement gate.

P1 compatibility retirement order:

1. Freeze schema-owned project DTOs and replace project-schema imports from
   live store/engine types.
2. Introduce narrow domain entry points for timeline/media/render/audio/signal
   contracts where an existing focused file does not already exist.
3. Move new imports to the focused entry points; leave old imports through
   `src/types/index.ts` as compatibility debt only.
4. Add a fan-in reduction target to each packet that touches a broad type
   import.
5. Retire or shrink `src/types/index.ts` only after no product packet still
   depends on it as a broad type dump.

P1 contract execution state:

- `P1-CONTRACT-001` completed on 2026-06-09.
- Type tiers are recorded in `src/architecture/foundationTypeTiers.ts`.
- `tests/unit/foundationTypeBoundary.test.ts` freezes the current broad
  `src/types/index.ts` fan-in, classifies current runtime-handle debt, and
  records the P1/P3 handoff for project-schema imports from store/engine-shaped
  types.
- Runtime-handle removal is intentionally not done in this packet. It belongs
  to `P1A-RUNTIME-LEASE-001` and the later P1/P3 schema freeze.

### Phase 1A - Clip And Media Source Runtime Split

Goal: split durable clip/media-source data from runtime handles before store,
project, render, or media-domain implementation lanes begin.

Why this is required:

- Shared foundation models already carry runtime handles such as `File`,
  `HTMLVideoElement`, `HTMLAudioElement`, `WebCodecsPlayer`, `NativeDecoder`,
  `VideoFrame`, `GPUTexture`, object URLs, and canvas-related types.
- `TimelineClipSource`, media source data, and `MediaFile` are used across
  stores, project load/save, render, preview, export, and media runtime.
- If these models stay mixed, later phases can only wrap the old coupling.

Target shape:

- Durable state stores ids, paths, hashes, media metadata, project references,
  and runtime keys only.
- Runtime handles live behind `services/mediaRuntime` as the canonical runtime
  lease domain.
- Existing runtime sources such as `blobUrlManager`, `sourceRuntimeSanitizer`,
  `webCodecsHelpers`, proxy/cache runtime handles, project hydration handles,
  and media object URL managers migrate into or behind this domain.
- Introduce explicit concepts such as:
  - `MediaAssetRef`
  - `TimelineSourceRef`
  - `MediaRuntimeLease`
  - `RuntimeSourceId`
  - `RenderFrameSource`
- Avoid a second competing lease framework. Reuse and harden the existing
  `mediaRuntime` direction.

Gates:

- `P1A_CLIP_SOURCE_DURABLE_RUNTIME_SPLIT`
- `P1A_MEDIA_FILE_RUNTIME_SIDETABLE`
- `P1A_SINGLE_RUNTIME_LEASE_DOMAIN`
- `P1A_RUNTIME_HANDLE_ROUNDTRIP_GUARD`
- `P1A_HMR_SAFE_RUNTIME_OWNER`

Checks:

- `P1S_SHARED_SCHEMA_RUNTIME_FREE` via
  `tests/unit/foundationTypeBoundary.test.ts`
- persisted-state `structuredClone` and JSON roundtrip guard via
  `tests/unit/persistedStateRuntimeHandles.test.ts`
- runtime lease owner map via
  `tests/unit/mediaRuntimeLeaseContracts.test.ts` includes `File`,
  `FileSystemFileHandle`, object URLs,
  `HTMLMediaElement`, `VideoFrame`, `ImageBitmap`, `GPU*`, `AudioContext`,
  workers, decoder/player instances, and service singletons
- HMR singleton survival check for `mediaRuntimeRegistry` via
  `tests/unit/mediaRuntimeLeaseContracts.test.ts`

Do not:

- Do not build a second lease framework beside `services/mediaRuntime`.
- Do not remove `MediaFile.file` or clip runtime fields before a side-table or
  lease migration path exists.
- Do not edit `MediaPanel`, `projectLoad`, `projectSave`, `RenderDispatcher`,
  or `ExportPanel` to close this phase unless a later packet explicitly owns
  that write set.

P1A execution state:

- `P1A-RUNTIME-LEASE-001` completed on 2026-06-09.
- `src/services/mediaRuntime/types.ts` defines `MediaAssetRef`,
  `TimelineSourceRef`, `MediaRuntimeLease`, `RuntimeSourceId`, and
  `RenderFrameSource`.
- `src/services/mediaRuntime/leaseOwnership.ts` makes
  `services/mediaRuntime` the canonical owner for all runtime handle kinds and
  records Timeline/project helper paths as migration sources, not competing
  lease managers.
- `src/services/mediaRuntime/persistedStateGuard.ts` rejects persisted live
  handles through runtime field names, blob/object URLs, runtime objects,
  `structuredClone`, and JSON roundtrip checks.
- `src/services/mediaRuntime/registry.ts` now preserves
  `mediaRuntimeRegistry` through HMR.
- Focused check passed:
  `npm run test -- tests/unit/persistedStateRuntimeHandles.test.ts tests/unit/mediaRuntimeLeaseContracts.test.ts tests/unit/foundationTypeBoundary.test.ts tests/unit/completeArchitectureRegistry.test.ts tests/unit/timelineArchitectureRegistry.test.ts`.
- Legacy `MediaFile.file`, existing broad shared type debt, and current clip
  runtime fields remain deferred to the P2/P3 store-project freeze and explicit
  Timeline integration packets.

### Phase 1B - Universal Signal Foundation

Goal: make the "every file becomes a visual signal" target explicit before
project, media, and renderer lanes lock their contracts.

Current codebase signals:

- `src/signals/**` already defines `SignalAsset`, `SignalRef`,
  `SignalArtifact`, `SignalGraph`, and operator descriptors.
- `src/importers/UniversalImportOrchestrator.ts` already routes files through
  signal providers or legacy media import.
- CSV import and binary fallback already exist, but CAD/PDF/SVG/3D/data
  renderer expectations need explicit ownership.
- Project files already persist `ProjectSignalState`.

Target shape:

- Universal import produces persisted signal DTOs plus runtime materialization
  leases, not ad-hoc unsupported-file branches.
- Signal project DTOs stay serializable and runtime-free.
- Format support is tracked with a matrix for OBJ, FBX, glTF/GLB, PDF, SVG,
  DXF, STEP, JSON, CSV, binary, point clouds, and unknown files.
- Timeline placement, preview materialization, export fallback, and project
  roundtrip are defined for each format family.

Concrete targets:

- `src/signals/types.ts`: pure signal DTOs only.
- `src/importers/**`: import planning, file identity, provider registry, and
  fallback routing stay isolated from UI and render runtime.
- renderer/materialization adapters own preview/export conversion from signal
  refs to textures, geometry, tables, or diagnostic surfaces.
- project schema may import pure signal DTOs only if those DTOs remain
  runtime-free; otherwise mirror them into project schema.

Gates:

- `P1B_SIGNAL_DTO_RUNTIME_FREE`
- `P1B_UNIVERSAL_IMPORT_ROUTE_MATRIX`
- `P1B_NO_UNSUPPORTED_FILE_FALLBACK`
- `P1B_SIGNAL_PROJECT_ROUNDTRIP`
- `P1B_SIGNAL_TIMELINE_MATERIALIZATION_CONTRACT`
- `P1B_SIGNAL_PREVIEW_EXPORT_FALLBACK`

Checks:

- runtime-handle scan for `src/signals/**` and signal project DTOs via
  `tests/unit/signals/signalFormatMatrix.test.ts`
- importer IO containment plus CSV and binary fallback fixtures via
  `tests/unit/importers/universalImportOrchestrator.test.ts`
- signal contract fixture via `tests/unit/signals/signalContracts.test.ts`
- timeline materialization and preview/export adapter fixtures via
  `tests/unit/signals/signalTimelineRendererAdapter.test.ts` and
  `tests/unit/signals/signalTextRendererAdapter.test.ts`
- format matrix entry for each June-2026 target family via
  `src/signals/formatMatrix.ts`

Do not:

- Do not solve universal import by adding one-off UI branches in Media Panel.
- Do not put `File`, `Blob`, DOM, GPU, worker, decoder, or renderer instances
  in signal DTOs.
- Do not treat binary fallback as the final CAD/PDF/SVG/3D renderer strategy.

P1B execution state:

- `P1B-SIGNAL-DTO-001` completed on 2026-06-09.
- `src/signals/formatMatrix.ts` defines the June-2026 format matrix for
  OBJ/FBX/glTF/GLB, PDF/SVG, DXF/STEP, JSON/CSV, binary/unknown, and
  point-cloud families.
- Unknown files remain routed to binary `SignalAsset` fallback, but the matrix
  explicitly marks binary fallback as preservation, not final renderer support.
- `tests/unit/signals/signalFormatMatrix.test.ts` proves runtime-free signal
  source files, format matrix coverage, timeline/preview/export fallback
  surfaces, and project-shaped signal DTO JSON/structured clone roundtrip.
- Existing CSV, unknown binary fallback, and renderer adapter tests stayed
  green.
- Project load/save integration remains deferred to
  `P1-P3-SCHEMA-FREEZE-001`.
