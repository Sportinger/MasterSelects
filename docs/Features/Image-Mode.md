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

- **Left:** Media, AI Studio, AI Segment.
- **Center:** Preview as the canvas. It opens in 2D edit mode with the
  transparency grid. A preview with `initialEditMode` and no
  `initialEditCameraView` starts in canvas edit mode; 3D layouts set a camera
  view and keep their camera edit views. Wheel zoom, middle-button pan,
  transform handles and Shift snapping come from the regular Preview.
- **Right:** Layers and History above Properties, Coloring and Export.
- **No timeline.**

## Layers panel

The `layers` panel type (`src/components/panels/layers/`):

- Lists layers top to bottom with visibility, thumbnail, name, mask and effect
  counts, and lock.
- Click selects the layer's clip, so the Properties inspector and preview
  handles follow. Shift, Ctrl or Cmd adds to the selection. Enter or Space
  selects from the keyboard.
- Double-clicking the name renames the layer.
- Dragging rows reorders the underlying tracks.
- Blend mode and opacity of the selected layer sit at the top. Opacity writes
  through `setPropertyValue`, so it respects keyframes.
- The toolbar adds image, video, text and color layers and deletes the
  selected layer. New layers go above the selected layer. A fresh document's
  empty default tracks are reused before new tracks are created. Deleting a
  layer in an image document also removes its now-empty track.
- Files dropped onto the panel are imported and added as layers.
- **Save as PNG** renders the document at full resolution with transparency
  (`captureCompositionFrameBlob(time, 'png')`) and downloads it. The Export
  panel remains available for JPG, WebP, BMP and other settings.
- With a video composition active, the panel shows the clips under the
  playhead and offers **Image from this frame**.
- Without a composition, or after clicking **New image**, the panel shows the
  new-image form:
  - size presets (HD, 4K, square, 4:5, story, thumbnail, A4 at 300 dpi) or a
    custom size up to 16384 px
  - background: white, black or transparent
  - **Open image file…**
  - **Image from current frame**

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
| Layers panel | `src/components/panels/layers/` |

## Limitations

- **No pixel tools yet:** there is no brush, eraser, clone, healing, or
  marquee, lasso or magic-wand selection. Masks are vector masks; the SAM2
  brush in AI Segment paints a matte prompt.
- No PSD import or export.
- Layer groups are not shown, although tracks already carry `parentTrackId`.
- The Medium and Mobile modifiers apply their own arrangements, which include
  a timeline, over the Image workspace.

Tests: `tests/unit/imageDocumentLayers.test.ts`,
`tests/unit/dockStoreLayouts.test.ts` (Image layout),
`tests/unit/projectCompositionDurationPersistence.test.ts` (still flag).
