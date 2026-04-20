# Issue 77 - Lottie / Rive Implementation Plan

Date: 2026-04-15
Status: Draft
Branch: `77-lottie-rive-animation-files-on-timeline`

## Mission

Add first-class timeline support for Lottie and prepare the repo for Rive without building a second render pipeline.

The first shippable milestone is:

- Lottie `.lottie` and Lottie JSON import
- Lottie clips on video tracks
- deterministic preview scrubbing
- deterministic nested composition preview
- deterministic export
- project save/load and relink
- media panel and timeline UX

Rive is phase 2 on the same canvas-backed architecture. Do not let Rive block Lottie MVP.

## Current Codebase Reality

### Type gates

- `src/stores/mediaStore/types.ts` does not know `lottie` or `rive`.
- `src/types/index.ts` does not know `lottie` or `rive` as clip source types.
- `src/services/project/types/media.types.ts` still restricts project media to `video | audio | image`.
- `src/services/project/types/composition.types.ts` and `src/types/index.ts` serialize explicit `sourceType` unions and must be updated.

### Import and clip creation gates

- `src/stores/timeline/helpers/mediaTypeHelpers.ts` only detects `video | audio | image | model | gaussian-splat | unknown`.
- `src/components/timeline/utils/fileTypeHelpers.ts` and `src/components/panels/media/dropImport.ts` only allow the currently known media types.
- `src/stores/mediaStore/helpers/importPipeline.ts` only extracts metadata and thumbnails for `video | audio | image`.
- `src/stores/mediaStore/slices/fileImportSlice.ts` only has placeholder/import flows for current media types plus gaussian splat.
- `src/stores/timeline/clipSlice.ts` only routes `video`, `audio`, `image`, `model`, and `gaussian-splat`.

### Why this is feasible

- Text and solid clips already prove that canvas-backed sources fit the render stack.
- `src/services/layerBuilder/LayerBuilderService.ts` already builds layers from `source.textCanvas`.
- `src/engine/render/LayerCollector.ts` already uploads `textCanvas` into GPU textures.
- `src/engine/export/ExportLayerBuilder.ts` already exports `textCanvas` layers.
- `src/services/thumbnailRenderer.ts` already renders thumbnails from `textCanvas`.
- `src/services/compositionRenderer.ts` already carries `textCanvas` through composition evaluation.

### Real gaps that must be closed

- Nested preview is incomplete. `LayerBuilderService.buildNestedClipLayer()` does not forward generic canvas-backed clips today.
- The paused-sync path in `src/components/timeline/hooks/useLayerSync.ts` only handles nested video/image clips.
- Save/load, relink, background slot playback, and clipboard restore all branch explicitly on known source types.
- UI files hardcode type badges and icons in `MediaPanel.tsx`, `FileTypeIcon.tsx`, `TimelineClip.tsx`, `useExternalDrop.ts`, and `properties/index.tsx`.

## Frozen Decisions

These decisions are not open for agent debate unless the user explicitly reopens them.

1. Phase 1 is Lottie. Phase 2 is Rive.
2. Lottie runtime for MVP is `@lottiefiles/dotlottie-web`.
3. Do not use Lottie worker mode in MVP. Deterministic scrubbing and export matter more than max concurrency.
4. Rive must use the low-level web runtime, not the React wrapper.
5. Do not add a new compositor or WebGPU source path for Lottie/Rive in phase 1.
6. `TimelineClip.source.type` must become `lottie` or `rive`, but render `Layer.source` should continue to reuse the existing canvas path with `type: 'text'` plus `textCanvas`.
7. Do not rename `textCanvas` in this issue. The name is imperfect, but a generic rename would create unnecessary churn across the render stack.
8. `.json` files must be content-sniffed before they are treated as Lottie. Do not classify every JSON file as Lottie by extension alone.
9. Runtime cursors are clip-local. The same source reused at multiple times must not fight over one playback cursor.
10. Rive audio, data binding, and rich interactive state-machine inputs are out of scope for the first implementation.
11. Do not add new synthetic media-panel item types for Lottie or Rive. They are imported file types, not generated items like text/solid/camera.

## Shared Contract To Land First

This wave is serialized. One agent owns it. Nobody else edits these files until this wave lands.

### Files

- `src/types/index.ts`
- `src/stores/mediaStore/types.ts`
- `src/stores/timeline/types.ts`
- `src/services/project/types/media.types.ts`
- `src/services/project/types/composition.types.ts`
- new `src/types/vectorAnimation.ts`

### Minimum contract

Use one dedicated metadata object and one dedicated per-clip settings object. Do not spray new top-level optional fields everywhere.

```ts
export interface VectorAnimationMetadata {
  provider: 'lottie' | 'rive';
  width?: number;
  height?: number;
  fps?: number;
  duration?: number;
  totalFrames?: number;
  animationNames?: string[];
  defaultAnimationName?: string;
  artboardNames?: string[];
  stateMachineNames?: string[];
}

export interface VectorAnimationClipSettings {
  loop: boolean;
  endBehavior: 'hold' | 'clear' | 'loop';
  fit: 'contain' | 'cover' | 'fill';
  backgroundColor?: string;
  animationName?: string;
  artboard?: string;
  stateMachineName?: string;
}
```

### Required contract updates

- `MediaFile.type` includes `lottie` and `rive`.
- `TimelineClip.source.type` includes `lottie` and `rive`.
- `SerializableClip.sourceType` includes `lottie` and `rive`.
- `ProjectMediaFile.type` includes `lottie` and `rive`.
- `ProjectClip.sourceType` includes `lottie` and `rive`.
- `MediaFile` gets `vectorAnimation?: VectorAnimationMetadata`.
- `TimelineClip.source` gets `vectorAnimationSettings?: VectorAnimationClipSettings`.
- `SerializableClip` and `ProjectClip` get `vectorAnimationSettings?: VectorAnimationClipSettings`.

### Acceptance

- `npm run build` passes after the contract wave.
- No render behavior is changed yet.
- No agent edits shared union files in parallel after ownership is assigned.

## Execution Order

1. Land the shared contract wave.
2. Implement the Lottie runtime service and metadata extraction.
3. In parallel, implement import/clip creation, render/export wiring, persistence/reload, and UI.
4. Finish with tests and docs.
5. Start Rive only after Lottie is green.

## Workstream 1 - Import And Clip Ingestion

### Ownership

- `src/stores/timeline/helpers/mediaTypeHelpers.ts`
- `src/components/timeline/utils/fileTypeHelpers.ts`
- `src/components/panels/media/dropImport.ts`
- `src/stores/mediaStore/helpers/importPipeline.ts`
- `src/stores/mediaStore/slices/fileImportSlice.ts`
- `src/stores/timeline/clipSlice.ts`
- new `src/stores/timeline/clip/addLottieClip.ts`
- optional stub `src/stores/timeline/clip/addRiveClip.ts`
- `src/components/timeline/hooks/useExternalDrop.ts`

### Build

- Add `.lottie` and `.riv` extension detection.
- Add async JSON sniffing for Lottie JSON in the import pipeline.
- Route imported Lottie files into a real `MediaFile.type === 'lottie'`.
- Create a Lottie clip placeholder with `source.type = 'lottie'`, `mediaFileId`, `naturalDuration`, `textCanvas`, and default `vectorAnimationSettings`.
- Keep Lottie on video tracks only.
- For `.json` desktop drop, allow a small async classification step before `addClip`. Do not force the old fully-sync fast path for these files.
- Do not attempt Rive runtime here. A stub clip factory is enough if it helps phase 2.

### Acceptance

- Importing a `.lottie` file creates a usable media panel item with dimensions and duration.
- Importing a Lottie JSON file works only when the JSON actually matches Lottie structure.
- Dragging a media panel Lottie item onto a video track creates a `lottie` clip.
- Dragging a Lottie file directly from desktop does not misclassify arbitrary JSON files.

## Workstream 2 - Lottie Runtime And Canvas Lifecycle

### Ownership

- `package.json`
- `package-lock.json`
- new `src/services/vectorAnimation/LottieRuntimeManager.ts`
- new `src/services/vectorAnimation/lottieMetadata.ts`
- new `src/services/vectorAnimation/lottieJsonSniffer.ts`
- new `src/services/vectorAnimation/types.ts`
- `src/stores/mediaStore/slices/fileManageSlice.ts`

### Build

- Add `@lottiefiles/dotlottie-web`.
- Create a clip-keyed runtime manager that owns one hidden `HTMLCanvasElement` plus one Lottie runtime instance per active clip.
- Expose APIs to:
  - load metadata from `File`
  - ensure runtime for a clip
  - render a clip at an exact timeline time
  - update clip settings
  - prune stale clip runtimes
  - destroy all runtimes
- Rehydrate Lottie canvases on `reloadFile()` and `updateTimelineClips()`.
- Derive exact animation time from clip-local time plus `vectorAnimationSettings.loop` and `endBehavior`.
- Populate `clip.source.textCanvas` with the managed canvas so the rest of the stack can reuse it.

### Acceptance

- The same Lottie source can exist in two clips at different times without cursor fights.
- Scrubbing to the same frame twice produces the same canvas output.
- Reloading a missing file restores the Lottie canvas and clears `needsReload`.
- No free-running autoplay loop exists outside timeline time.

## Workstream 3 - Render, Nested Preview, Export, And Thumbnails

### Ownership

- `src/services/layerBuilder/LayerBuilderService.ts`
- `src/components/timeline/hooks/useLayerSync.ts`
- `src/engine/export/ExportLayerBuilder.ts`
- `src/services/thumbnailRenderer.ts`
- `src/services/compositionRenderer.ts`
- touch `src/engine/render/LayerCollector.ts` only if strictly necessary

### Build

- Teach the main layer builder to recognize `clip.source.type === 'lottie'` and reuse `buildTextLayer()` or an equivalent canvas layer path.
- Before building layers, ask `LottieRuntimeManager` to render active Lottie clips at the current playhead time and prune stale runtimes.
- Extend nested preview in both `LayerBuilderService.buildNestedClipLayer()` and `useLayerSync` so nested clips with `textCanvas` are treated like renderable canvas clips, not ignored.
- Extend `ExportLayerBuilder` so Lottie clips and nested Lottie clips export through the existing canvas source path.
- Extend `thumbnailRenderer` and `compositionRenderer` conditions so canvas-backed `lottie` clips are not excluded just because their semantic source type is not `text`.

### Acceptance

- Lottie preview works while paused, while scrubbing, and during playback.
- A Lottie clip inside a nested composition is visible in preview.
- Export uses the same deterministic frame mapping as preview.
- Thumbnails can be generated from Lottie clips without a special export-only renderer.

## Workstream 4 - Persistence, Restore, Background Playback, Clipboard

### Ownership

- `src/stores/timeline/serializationUtils.ts`
- `src/services/project/projectSave.ts`
- `src/services/project/projectLoad.ts`
- `src/services/layerPlaybackManager.ts`
- `src/services/slotDeckManager.ts`
- `src/stores/timeline/clipboardSlice.ts`
- `src/stores/timeline/clip/addCompClip.ts`

### Build

- Save `MediaFile.type === 'lottie'` plus `vectorAnimation` metadata into project files.
- Save `vectorAnimationSettings` on timeline clips and nested clips.
- Restore Lottie clips from project data with placeholder files when necessary, then hand them back to the runtime manager once the real file exists.
- Ensure nested composition hydration and clipboard paste preserve `sourceType === 'lottie'`.
- Extend background slot playback and composition preparation so canvas-backed Lottie clips are kept alive outside the active editor composition.

### Acceptance

- Save, close, reload, and relink preserve Lottie media and clip settings.
- Background composition playback does not silently drop Lottie clips.
- Copy/paste and nested comp duplication preserve Lottie type and settings.

## Workstream 5 - UI, Icons, Properties

### Ownership

- `src/components/panels/MediaPanel.tsx`
- `src/components/panels/media/FileTypeIcon.tsx`
- `src/components/timeline/TimelineClip.tsx`
- `src/components/panels/properties/index.tsx`
- new `src/components/panels/properties/LottieTab.tsx`
- optional `src/components/panels/properties/RiveTab.tsx`
- `src/App.css` if styling is needed

### Build

- Add media and timeline icons for `lottie` and `rive`.
- Show semantic clip badges based on `source.type`.
- Add a Lottie properties tab with at least:
  - loop toggle
  - end behavior
  - fit
  - animation selection for multi-animation `.lottie`
  - background color if the runtime exposes it cleanly
- Keep Lottie clips finite by default. Do not mark them as "infinite" like text/solid/camera.
- Do not add Media Panel "create new Lottie" menu items. Imported file UX is enough.

### Acceptance

- Imported Lottie items are visually distinct in the media panel and timeline.
- Properties edits update preview without re-importing the file.
- Multi-animation `.lottie` packages can switch the active animation from the properties panel.

## Workstream 6 - Tests And Docs

### Ownership

- `tests/unit/importPipeline.test.ts`
- `tests/stores/timeline/clipSlice.test.ts`
- `tests/stores/mediaStore/fileManageSlice.test.ts`
- `tests/unit/layerBuilderService.test.ts`
- `tests/unit/exportLayerBuilder.test.ts`
- `tests/unit/serialization.test.ts`
- `tests/unit/projectMediaPersistence.test.ts`
- `tests/unit/mediaPanelDropImport.test.ts`
- `docs/Features/Media-Panel.md`
- `docs/Features/Timeline.md`
- add a focused feature doc if the existing docs become too noisy

### Build

- Add detection tests for `.lottie` and Lottie JSON sniffing.
- Add clip creation tests for `source.type === 'lottie'`.
- Add reload tests for Lottie relink.
- Add layer builder and export tests proving Lottie is routed through the canvas path.
- Add serialization and project persistence round-trip tests.
- Update feature docs with supported file types, limitations, and property behavior.

### Acceptance

- `npm run build`
- `npx vitest run tests/unit/importPipeline.test.ts tests/stores/timeline/clipSlice.test.ts tests/stores/mediaStore/fileManageSlice.test.ts tests/unit/layerBuilderService.test.ts tests/unit/exportLayerBuilder.test.ts tests/unit/serialization.test.ts tests/unit/projectMediaPersistence.test.ts tests/unit/mediaPanelDropImport.test.ts`

## Rive Phase 2

Do not start this until Lottie is green.

### Scope

- Imported `.riv` files
- artboard selection
- one deterministic linear animation path first
- optional single state machine selection after the linear path works

### Rules

- Use the same canvas-backed render strategy as Lottie.
- Do not use `rive-react` as the core runtime.
- Cache parsed file data if helpful, but keep render cursors clip-local.
- Leave Rive audio and rich data binding out of the first pass.

## Shared Hot Spots That Must Not Be Edited Casually In Parallel

- `src/types/index.ts`
- `src/stores/mediaStore/types.ts`
- `src/services/project/types/media.types.ts`
- `src/services/project/types/composition.types.ts`
- `src/stores/timeline/serializationUtils.ts`
- `src/services/project/projectSave.ts`
- `src/services/project/projectLoad.ts`
- `src/services/layerBuilder/LayerBuilderService.ts`
- `src/components/timeline/hooks/useExternalDrop.ts`
- `package.json`
- `package-lock.json`

## Definition Of Done

Treat this issue as done only when all of the following are true:

- A user can import `.lottie` and Lottie JSON files into the media panel.
- A user can drag a Lottie media item to a video track and get a real Lottie clip.
- Scrubbing, paused preview, playback, nested comps, thumbnails, and export all render deterministically.
- Save/load and relink preserve Lottie media and clip settings.
- The same Lottie source can be reused multiple times on the timeline at different times.
- Build passes and the targeted tests pass.
- Rive has a follow-up implementation path that reuses the same architecture instead of reopening the design from scratch.
