# Media-Panel.md — audit 2026-08-02

## Verified (spot checks that held)

- v2.4.4 is the current package version (`package.json`).
- The three persisted view modes are `classic`, `icons`, and `board` (`src/components/panels/media/panel/types.ts`, `src/components/panels/media/panel/useMediaPanelShellState.ts`).
- The File System Access picker, drag/drop handle capture, nested-folder import, clipboard-image import, and three-at-a-time ordinary-file batches are implemented (`src/components/panels/media/panel/useMediaPanelAddImportCommands.ts`, `src/components/panels/media/dropImport.ts`, `src/components/panels/media/panel/useMediaPanelSelectionCommands.ts`, `src/stores/mediaStore/slices/fileImport/batchImportActions.ts`).
- Legacy media, vector animation, Premiere-project, Gaussian-splat/model, and Signal import routes exist; Signal artifacts use a project `Cache/artifacts/` store when a project is open and IndexedDB otherwise (`src/stores/mediaStore/slices/fileImport/importPlanning.ts`, `src/stores/mediaStore/slices/fileImport/batchImportActions.ts`, `src/stores/mediaStore/helpers/importPipeline.ts`).
- Source thumbnails are generated once per elapsed second and cached in memory/IndexedDB; the 500 MB large-file threshold and 98% proxy-completeness threshold remain (`src/services/thumbnailCache/generation.ts`, `src/stores/mediaStore/constants.ts`, `src/stores/mediaStore/helpers/proxyCompleteness.ts`).
- Project-local RAW copies, proxy/thumbnail hash reuse, relinking, project-wide file deletion, and the documented media-store slice paths are present (`src/stores/mediaStore/helpers/importPipeline.ts`, `src/stores/mediaStore/slices/fileManage/deleteActions.ts`, `src/stores/mediaStore/slices/fileManage/deleteRuntimeCleanup.ts`, `src/stores/mediaStore/slices/`).

## Outdated or wrong (claim → reality, with file evidence)

- “Adjustment Layer — Coming soon” and the matching Not Implemented entry → Adjustment layers are shipped through the Media Panel Add menu, timeline `addMotionAdjustmentClip`, Properties UI, and the MD7 compositor path. Evidence: `src/components/panels/media/import/MediaAddItemsMenu.tsx`, `src/components/panels/MediaPanel.tsx`, `src/stores/timeline/motionClipSlice.ts`, `src/components/panels/properties/MotionAdjustmentTab.tsx`, `docs/evidence/motion-design/md7-adjustment-render-graph.md`.
- The Add menu list is incomplete and calls the 3D effector “Splat Effector” → Current menu includes Import files, Live Input, a nested 3D menu (Mesh, 3D Text, Camera, Light, 3D Effector, Gaussian Splat), Motion Null, Adjustment Layer, Math Scene, and Motion Shape primitives. Evidence: `src/components/panels/media/import/MediaAddItemsMenu.tsx`.
- “Timeline text clips use Roboto, 72px” → `DEFAULT_TEXT_PROPERTIES` uses Arial, 72px. Evidence: `src/stores/timeline/constants.ts`.
- New compositions “start with one Video track and one Audio track” → the default timeline has Video 2, Video 1, and Audio. Evidence: `src/stores/timeline/constants.ts`, `src/stores/mediaStore/slices/composition/crudActions.ts`.
- Proxy FPS is “Always 30” → it is `min(30, source FPS)` when source FPS is known; only the fallback is 30. Evidence: `src/stores/mediaStore/helpers/proxyCompleteness.ts`, `src/stores/mediaStore/slices/proxySlice.ts`.
- The context-menu proxy description is stale → proxy, scene-cut detection, thumbnail regeneration, WAV audio proxy, waveform, and spectral regeneration are grouped under **Regenerate**. Evidence: `src/components/panels/media/context/MediaContextRegenerateSubmenu.tsx`.
- `removeFolder` “moves children to parent” → it reparents only files, compositions, and Signal assets. Nested folders and text/solid/mesh/camera/light/effector/math/motion-shape items are not reparented by that slice. Evidence: `src/stores/mediaStore/slices/folderSlice.ts`.
- The MediaFile interface is too narrow → imported types also include `model`, `gaussian-avatar`, and `gaussian-splat`; it has audio-proxy, waveform, scene-cut, analysis, live-input, and proxy-format fields. Evidence: `src/stores/mediaStore/types.ts`.
- Store architecture omits `duplicateSlice` and the current inline item collections/actions → `duplicateSlice` is installed, while index actions also cover live inputs, lights, effectors, math scenes, and motion shapes. Evidence: `src/stores/mediaStore/index.ts`, `src/stores/mediaStore/slices/duplicateSlice.ts`.
- Test counts are stale (106/101) → the two listed files currently contain 121 and 113 `it`/`test` cases respectively; there are also dedicated Signal-import and Media Panel unit tests. Evidence: `tests/stores/mediaStore/fileManageSlice.test.ts`, `tests/stores/mediaStore/compositionSlice.test.ts`, `tests/stores/mediaStore/fileImportSignalSlice.test.ts`, `tests/unit/mediaPanel*.test.ts*`.

## Noteworthy / unusual

- Board annotations are shipped (create, edit/lock, resize, persist in `localStorage`) but were absent from the feature doc. Evidence: `src/components/panels/media/board/annotations.ts`, `src/components/panels/media/board/MediaBoardAnnotationLayer.tsx`.
- Live Input is stored as a video media item but has no retained file/blob URL; it reconnects from persisted source settings. Evidence: `src/stores/mediaStore/index.ts`, `src/components/panels/media/LiveInputDialog.tsx`, `src/services/mediaRuntime/liveInputRuntime.ts`.
- Project saves now persist all Media Panel-created item collections in project data as well as maintaining legacy localStorage mirrors. Evidence: `src/services/project/projectSave.ts`, `src/stores/mediaStore/init.ts`.
- Folder deletion has the reparenting gap noted above, which can leave non-file child items or nested folders with a deleted `parentId`; project-load normalization repairs several item categories, but not the folder tree itself. Evidence: `src/stores/mediaStore/slices/folderSlice.ts`, `src/services/project/load/loadSignalsHydration.ts`.
