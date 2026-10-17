[Back to Index](./README.md)

# Image Mode

The **Image** workspace edits still images with layers, masks, blend modes,
color tools and AI, using the same composition model as the video editor.

## Image documents

An image document is an ordinary composition with `still: true`
(`src/stores/mediaStore/types.ts`):

- The canvas size is the composition size.
- The duration is locked to `IMAGE_DOCUMENT_DURATION` (5 s,
  `src/services/imageDocument/imageLayers.ts`). Time is never shown in the
  Image workspace.
- **A layer is the first clip of a video track.** Track order is layer order,
  top to bottom. Layers span the whole duration.
- Undo, project storage, export, masks, effects, color correction, the
  Properties inspector and the AI agent's timeline tools all work unchanged.
- An image document can be nested into a video composition like any other
  composition. In the Video workspace it appears as a 5 s timeline whose
  layers are clips.

The `still` flag is persisted with the composition
(`projectCompositionSerialization.ts`, `loadTimelineHydration.ts`, repository
field classification).

## Workspace

The factory layout `factory-image-edit`
(`src/stores/dockStore/imageLayoutDefaults.ts`) is the **Image** button in the
bottom workspace bar:

- **Left edge:** the Tools strip (Move, Hand, Zoom, Text, mask tools, AI
  Segment). See [UI Panels](./UI-Panels.md#tools-panel).
- **Left:** Media, AI Studio, AI Segment.
- **Center:** Preview as the canvas. It opens in 2D edit mode with the
  transparency grid. A preview with `initialEditMode` and no
  `initialEditCameraView` starts in canvas edit mode; 3D layouts set a camera
  view and keep their camera edit views. Wheel zoom, middle-button pan,
  transform handles and Shift snapping come from the regular Preview.
- **Right:** Layers and History above Properties, Coloring and Export.
- Rulers are on.
- **No timeline.**

## Layers panel

The `layers` panel type (`src/components/panels/layers/`) is not specific to
images. It shows a layer view of the active composition in every workspace:

- In an image document it lists every layer.
- In a video composition it lists the clip under the playhead on each video
  track, so it follows scrubbing. The header says **at playhead**.
- The Image workspace stacks it above Properties. The Video workspace has it as
  a tab next to Properties.

Rows:

- Each layer row has visibility, a disclosure arrow, a thumbnail (a swatch for
  color layers), the name with mask and effect counts, and lock.
- Click selects the layer's clip, so the Properties inspector and preview
  handles follow. Shift, Ctrl or Cmd adds to the selection. Enter or Space
  selects from the keyboard; the left and right arrow keys collapse and expand
  the row.
- Double-clicking the name renames the layer. Dragging rows reorders the
  underlying tracks.
- **The disclosure arrow shows the layer's masks and effect stack** as child
  rows, like layer masks and smart filters in Photoshop. This is the same
  `masks` and `effects` data as the Properties tabs:
  - Masks show their mode and whether they are inverted, and can be switched
    on or off.
  - Effects can be switched on or off and dragged to reorder the stack
    (`reorderClipEffect`). They show the registry's display name.
  - Clicking a child row selects the layer and opens the matching Properties
    tab (`openLayerProperties`).

Controls:

- Blend mode and opacity of the selected layer sit at the top. Opacity writes
  through `setPropertyValue`, so it respects keyframes.
- The toolbar adds image, video, text and color layers and deletes the
  selected layer:
  - New layers go above the selected layer.
  - A fresh document's empty default tracks are reused before new tracks are
    created.
  - In an image document a layer spans the document. In a video composition
    the new clip starts at the playhead.
  - Deleting a layer in an image document also removes its now-empty track.
- Files dropped onto the panel are imported and added as layers.
- Header actions:
  - **New image**
  - **Image from this frame** (video compositions only)
  - **Save as PNG**: renders the composition at full resolution with
    transparency (`captureCompositionFrameBlob(time, 'png')`) and downloads it
- Without a composition, or after clicking **New image**, the panel shows the
  new-image form:
  - size presets (HD, 4K, square, 4:5, story, thumbnail, A4 at 300 dpi) or a
    custom size up to 16384 px
  - background: white, black or transparent
  - **Open image file…**
  - **Image from current frame**

## Preview

- The Image workspace preview opens with pixel rulers (`Shift+R` toggles
  them). Drag out of a ruler to create a guide; layers snap to visible guides
  while you move them. See [Preview](./Preview.md#guides).
- The workspace has no Timeline panel, so `EditorPlaybackRuntimeHost` syncs
  the render layers that preview hit-testing and transform handles use.
- For image documents the time transport is replaced by a zoom bar with Fit,
  1:1, zoom steps and the zoom level. See [Preview](./Preview.md#rulers-and-still-image-zoom).

## Entry points

- **Image** in the workspace bar.
- **Edit as Image** in the Media panel context menu of an image file. This
  creates an image document at the photo's size with the photo as its first
  layer.
- **Image from this frame / current frame**: renders the active composition at
  the playhead to a PNG. The PNG is imported into the project with
  `forceCopyToProject` and opened as a new image document.
- Opening an image document from the Media panel switches to the Image
  workspace.
- Opening a video composition while already in the Image workspace no longer
  adds a Timeline panel; the Layers panel shows its playhead layers instead.

## Code

| Area | File |
| --- | --- |
| Layer derivation, track reuse | `src/services/imageDocument/imageLayers.ts` |
| Create, open, add layers, frame capture, PNG export | `src/services/imageDocument/imageDocumentService.ts` |
| Workspace layout | `src/stores/dockStore/imageLayoutDefaults.ts` |
| Layers panel, mask and effect child rows | `src/components/panels/layers/` |
| Preview rulers and still-image zoom bar | `src/components/preview/PreviewRulers.tsx`, `previewRulerTicks.ts`, `PreviewCanvasZoomBar.tsx`, `usePreviewCanvasZoom.ts` |
| Guides | `src/services/compositionGuides.ts`, `src/components/preview/PreviewGuides.tsx`, `usePreviewGuideDrag.ts`, `previewGuideMath.ts` |
| Tools strip and canvas tools | `src/components/panels/tools/`, `src/stores/canvasToolStore.ts`, `src/services/canvasTools.ts`, `src/components/preview/usePreviewCanvasToolPointer.ts` |
| Layer sync without a Timeline panel | `src/components/common/HeadlessLayerSync.tsx`, `src/components/timeline/hooks/timelineLayerSyncOwners.ts` |

## Limitations

- **No pixel tools yet:** the Tools strip has no brush, eraser, clone,
  healing, or marquee, lasso or magic-wand selection. Masks are vector masks; the SAM2
  brush in AI Segment paints a matte prompt.
- No PSD import or export.
- Layer groups are not shown, although tracks already carry `parentTrackId`.
- The Medium and Mobile modifiers apply their own arrangements, which include
  a timeline, over the Image workspace.

Tests: `tests/unit/imageDocumentLayers.test.ts`, `tests/unit/previewRulerTicks.test.ts`,
`tests/unit/previewGuides.test.ts`, `tests/unit/timelineLayerSyncOwners.test.tsx`,
`tests/unit/ToolsPanel.test.tsx`, `tests/unit/dockPanelSizing.test.ts` (Tools width),
`tests/unit/dockStoreLayouts.test.ts` (Image layout),
`tests/unit/projectCompositionDurationPersistence.test.ts` (still flag, guides).
