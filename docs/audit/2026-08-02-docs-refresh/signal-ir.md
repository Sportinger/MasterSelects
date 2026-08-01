# Signal-IR.md — audit 2026-08-02

## Verified (spot checks that held)

- The core Signal DTOs, guards, normalization helpers, and legacy mappings exist under `src/signals/` (`src/signals/types.ts`, `src/signals/guards.ts`, `src/signals/normalize.ts`, `src/signals/mappings.ts`). `SignalAsset`, `SignalRef`, `SignalArtifact`, `SignalGraph`, and `SignalOperatorDescriptor` are exported by `src/signals/index.ts`.
- The documented legacy mappings hold for video, audio, image/solid, text, model, gaussian splat/avatar, Lottie/Rive, composition, and unknown values in `src/signals/mappings.ts`.
- Capability policy is fail-closed: `src/runtime/capabilities/policy.ts` denies missing/unknown providers, mismatched policies, unknown capabilities, and missing grants. The documented capability examples are in `src/runtime/capabilities/types.ts`.
- Extension manifests and registry queries cover importer role, file signature, signal kind, runtime, and capability in `src/extensions/types.ts` and `src/extensions/registry.ts`.
- Project artifacts are SHA-256 content-addressed and stored at `Cache/artifacts/sha256/<shard>/<hash>/` when a project handle is available (`src/artifacts/ArtifactStore.ts`, `src/artifacts/ids.ts`, `src/artifacts/fileSystemStorageAdapter.ts`, `src/services/project/core/constants.ts`). IndexedDB is both a manifest index and no-project-folder byte store (`src/artifacts/projectDBArtifactIndex.ts`, `src/artifacts/projectDBStorageAdapter.ts`).
- Signal assets are imported from the Media Panel route, persisted in project `signals`, hydrated on load, and represented as `signal` items (`src/stores/mediaStore/slices/fileImport/singleFileImportActions.ts`, `src/stores/mediaStore/slices/fileImport/importPlanning.ts`, `src/services/project/projectSave.ts`, `src/services/project/load/loadSignalsHydration.ts`).
- The renderer dispatcher tries model, then gaussian splat, then the text-summary fallback; materialized clips retain `signalAssetId`, `signalRefId`, and `signalRenderAdapterId` (`src/runtime/renderers/signalTimelineRendererAdapter.ts`, `src/runtime/renderers/signalTextRendererAdapter.ts`, `src/types/timeline.ts`).
- The worker host/client slice and the versioned `masterselects:runtime@0.1.0` WIT importer ABI are present (`src/runtime/worker/hostCore.ts`, `src/runtime/worker/client.ts`, `src/runtime/wasm/WasmImporterHost.ts`, `wit/masterselects/runtime.wit`).

## Outdated or wrong (claim → reality, with file evidence)

- “The current builtin CSV and binary importers” → JSON and JSONL are also handled by the registered builtin JSON importer; malformed JSON routes to the binary fallback. Evidence: `src/importers/UniversalImportOrchestrator.ts`, `src/importers/providers/index.ts`, and `src/importers/providers/jsonImporter.ts`.
- The importer description names CSV and unsupported files but omits the shipped JSON/JSONL Signal route. JSON/JSONL produce `metadata` and `binary` refs, while CSV produces `table`, `metadata`, and `binary`. Evidence: `src/importers/providers/jsonImporter.ts` and `src/importers/providers/csvImporter.ts`.
- The model adapter tool list omits `.fbx`. The adapter delegates to `isModelFile`, whose supported extensions are OBJ, FBX, glTF, and GLB. Evidence: `src/runtime/renderers/signalTimelineRendererAdapter.ts` and `src/stores/timeline/helpers/mediaTypeHelpers.ts`.
- “Worker and Wasm execution are the runtime boundaries for provider work” overstates the current integration. The default universal importer registers only builtin CSV, JSON, and binary providers; `WasmImporterHost` is an adapter API and is not registered there. Evidence: `src/importers/UniversalImportOrchestrator.ts`, `src/runtime/wasm/WasmImporterHost.ts`, and `src/runtime/wasm/fixtures/csvBinaryImporter.ts`.

## Noteworthy / unusual

- `src/signals/formatMatrix.ts` explicitly marks model, PDF/SVG, CAD, and point-cloud Signal-provider routes as `needs-provider`; its planned fixtures show that the generic renderer adapters do not mean these formats are currently imported as rich SignalAssets.
- The binary fallback performs lightweight header sniffing (PDF, PNG, JPEG, GIF, ZIP, GZIP, GLB, and RIFF variants) and stores diagnostic metadata, but it remains a binary/metadata signal rather than domain rendering (`src/importers/providers/binaryFallbackImporter.ts`).
- The worker runtime includes only probe-style standard handlers (`runtime.echo`, `runtime.hash.sha256`, `runtime.csv.inspect`), and its own README lists capability checks, provider discovery, and artifact-store writes as future integration points (`src/runtime/worker/standardHandlers.ts`, `src/runtime/worker/README.md`).
- The current product notice still frames rich document, CAD/vector, point-cloud, and external Wasm rendering as the next layer (`src/version.ts`), consistent with the format matrix rather than a fully universal rich-rendering implementation.
