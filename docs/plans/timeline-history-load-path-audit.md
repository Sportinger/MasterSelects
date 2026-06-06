# Timeline History Load Path Audit

Status: Phase 0 Agent F audit note.

Scope: persistence/history contracts only. This note records current load paths and migration risks for the future `HistoryTimelineEditState` migration. It does not change behavior.

## Boundary Decision

- Project persistence remains `CompositionTimelineData` plus project/media metadata.
- Canvas rendering derives `TimelineRenderModel` after load and is not project schema.
- Undo/redo should move to `HistoryTimelineEditState`, a serializable edit-state contract that stores runtime references instead of `TimelineClip.source`, `File`, DOM, media element, decoder, GPU, or object URL payloads.
- Runtime rehydration for undo/redo should go through the runtime coordinator adapter rather than directly restoring runtime-bearing `TimelineClip` or `Layer.source` objects.

## Load Path Findings

### `src/services/project/projectLoad.ts`

- `loadProjectToStores()` clears the current timeline, loads the active composition through `timelineStore.loadState(activeComp.timelineData)`, then hydrates project history through `hydrateHistoryStateFromProject(projectData.uiState?.history)`.
- `runPostLoadRestoration()` starts after the main load and can restore thumbnails/cache state, media files, and nested composition content in the background.
- `reloadNestedCompositionClips()` reconstructs nested `TimelineClip[]` from `CompositionTimelineData`, creates `File` objects for generated motion/math clips, creates object URLs for nested media, and attaches video/image/model/vector runtime sources.
- Risk: history restore currently has no contract-level adapter to request the same runtime resources lazily after undo/redo. Nested runtime payloads can re-enter timeline state outside a future data-only history boundary.

### `src/stores/timeline/serializationUtils.ts`

- `getSerializableState()` already emits `CompositionTimelineData` and strips the primary `TimelineClip.source` runtime object into serializable fields.
- `loadState()` is wrapped in `withProjectStoreSyncGuard()` and clears the existing timeline before reconstructing clips.
- Top-level video/audio clips are moving toward metadata-first restore, but nested composition restore still constructs nested clips with `File`, object URL, HTML video/image, WebCodecs, model, vector, and mixdown audio runtime payloads.
- Composition audio clips can create `HTMLAudioElement` instances and regenerate mixdowns during load.
- `clearTimeline()` performs runtime cleanup for current clip sources and nested clips, but history undo/redo does not yet use a serializable edit-state rehydration boundary.

### Background Nested Restore

- Project-file background restore and `serializationUtils.loadState()` both have nested composition restore paths.
- Both paths can attach nested `TimelineClip.nestedClips` and `nestedTracks` plus runtime-bearing nested clip sources.
- Risk: without a single runtime coordinator adapter, undo/redo could either lose nested runtime parity or restore too much work synchronously.

### `src/stores/mediaStore/init.ts`

- Startup initializes media store state from IndexedDB, restores the active composition timeline through `useTimelineStore.getState().loadState(activeComp.timelineData)`, then syncs transcript/analysis badge metadata back to media files.
- Auto-save uses `getSerializableState()` and stores composition timeline data after reference/signature checks.
- This path does not hydrate history from a project-file `uiState.history`; it is an IndexedDB app-state path, not the project-file load path.
- Risk: if history contracts only cover project-file load, IndexedDB startup can still restore runtime-bearing timeline state through `loadState()` without explicit history/runtime diagnostics.

### `src/stores/mediaStore/slices/projectSlice.ts`

- Legacy `saveProject()`, `loadProject()`, `getProjectList()`, and `deleteProject()` were removed from `projectSlice.ts` after a callsite audit found no app users. Current project loading and saving remain owned by `ProjectFileService`.
- `initFromDB()` still restores IndexedDB app-state media data during startup and is still called by `src/stores/mediaStore/init.ts`, but its implementation now delegates to `src/stores/mediaStore/legacyStartupRestore.ts`.
- Remaining risk: the compatibility action name still lives on `projectSlice` for startup wiring, but the legacy IndexedDB restore implementation is no longer embedded in the project UI/runtime slice.

## Required Follow-Up

- History owner: migrate `historyStore` snapshots from `TimelineClip[]` and `Layer[]` to `HistoryTimelineEditState`.
- Runtime owner: implement a `HistoryRuntimeRehydrationAdapter` through the runtime coordinator policy registry.
- Project owner: the unused legacy IndexedDB project actions are removed and `initFromDB()` delegates to an explicitly named legacy startup restore helper. Future migration can remove or rename the compatibility action after startup wiring is updated.
- Test owner: add integration coverage for undo/redo after reload, nested composition undo/redo, and legacy projectSlice compatibility once behavior migration begins.
