# Live-Inputs.md — audit 2026-08-02

## Verified (spot checks that held)

- The feature is shipped in `2.4.4` (`package.json`): Media Panel **Add** exposes **Live Input...**, with display, video-device, and composition-feedback choices. Evidence: `src/components/panels/media/import/MediaAddItemsMenu.tsx`, `src/components/panels/media/LiveInputDialog.tsx`, `src/types/liveInput.ts`.
- A Live Input is a Media Panel video item whose runtime connection is keyed by its item ID; timeline clips retain only that ID and use the ordinary video-layer path. Evidence: `src/stores/mediaStore/index.ts`, `src/services/liveInputTimeline.ts`, `src/services/layerBuilder/layerBuilderVideoSources.ts`.
- Independent display/camera streams, disabled capture audio, shared-item source changes, and reconnect-on-double-click are implemented. Evidence: `src/services/mediaRuntime/liveInputRuntime.ts`, `src/components/panels/properties/LiveInputTab.tsx`, `src/components/panels/media/panel/useMediaPanelSelectionCommands.ts`.
- Media Panel live thumbnails use the existing runtime video, are capped at 320x180, update at one second by default, pause off-screen, and the hover preview requests 250 ms frames. Evidence: `src/components/panels/media/LiveInputPreviewCanvas.tsx`, `src/components/panels/media/MediaGridVideoThumb.tsx`, `src/components/panels/media/panel/useMediaPanelPreviewTooltip.tsx`.
- Feedback is composition-bound, prevents placing it in another composition, reconnects through the mounted preview canvas, and uses the documented 8192-pixel 2D mirror limit on the Linux software-canvas path. Evidence: `src/services/liveInputTimeline.ts`, `src/hooks/useLiveInputFeedbackCoordinator.ts`, `src/services/mediaRuntime/liveInputRuntime.ts`.
- Project save/load persists only the source descriptor and ID, clears runtime streams before loading, and shows reconnect work only for in-use display/video-device items across active and stored composition timelines. Evidence: `src/services/project/projectMediaSerialization.ts`, `src/services/project/projectSave.ts`, `src/services/project/projectLoad.ts`, `src/hooks/useLiveInputFeedbackCoordinator.ts`.
- Deleting a Live Input and creating a new project release runtime resources. Evidence: `src/stores/mediaStore/slices/fileManage/deleteActions.ts`, `src/stores/mediaStore/slices/projectSlice.ts`.

## Outdated or wrong (claim → reality, with file evidence)

- “**CLIP Live**” → the Properties tab is labeled **Live**; after a project load the app activates the Clip Properties panel and renders a **Live** reconnect tab when no clip is selected. Evidence: `src/components/panels/properties/index.tsx`, `src/components/panels/properties/LiveInputTab.tsx`, `src/services/project/projectLoad.ts`.
- “On Linux/Mesa” → the shared software-canvas preference applies to Linux generally (excluding Android); it does not detect or limit itself to Mesa. Evidence: `src/utils/canvasPlatform.ts`, `src/services/mediaRuntime/liveInputRuntime.ts`.

## Noteworthy / unusual

- A capture track ending releases the runtime entry and marks the item for reconnection; the feature page had omitted this lifecycle. Evidence: `src/services/mediaRuntime/liveInputRuntime.ts`.
- Live-frame render wakeups are intentionally bounded: a stream requests renders only while the layer has been rendered in the preceding two seconds, rather than unconditionally while paused. Evidence: `src/services/mediaRuntime/liveInputRuntime.ts`, `src/services/layerBuilder/layerBuilderVideoSources.ts`.
- Several visible strings in `LiveInputTab.tsx` contain mojibake (for example, the Connecting label and the composition-feedback help text), despite the surrounding implementation being present. Evidence: `src/components/panels/properties/LiveInputTab.tsx`.
