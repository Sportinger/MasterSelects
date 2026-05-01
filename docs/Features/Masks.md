# Masks

[Back to Index](./README.md)

MasterSelects supports per-clip vector masks with preview-overlay editing, selectable vertices, bezier handle modes, and GPU compositing through the layer pipeline.

## At A Glance

- Masks are stored on timeline clips as `ClipMask[]`.
- The properties panel exposes rectangle, ellipse, and pen creation.
- The preview overlay supports vertex selection, handle mode toggles, edge insertion, edge dragging, and whole-mask dragging.
- Mask outlines are projected through the active layer transform, so 2D and 3D movement, scale, and rotation keep the editable overlay aligned with the rendered mask.
- When the mask tab is active, the normal preview Edit Mode toggle becomes navigation-only: wheel zoom and Alt/MMB pan stay available, but layer transform handles are disabled.
- Mask outlines are only shown while the mask tab is open. Opening the tab activates the current mask for editing; leaving the tab hides the overlay again.
- Mask changes are serialized with the project.

## Data Model

`ClipMask` currently includes:

- `id` and `name`
- `vertices`
- `closed`
- `opacity` (legacy/persisted, not rendered or exposed in the active panel)
- `feather`
- `featherQuality`
- `inverted`
- `mode`
- `expanded`
- `position`
- `enabled`
- `visible`

`MaskMode` is currently `add`, `subtract`, or `intersect`.
`enabled` controls whether a mask contributes to the rendered mask texture.
`visible` controls only the preview overlay outline and edit handles.
Each `MaskVertex` can store `handleMode` as `none`, `mirrored`, or `split`.
Per-mask inversion is baked into the generated mask texture before GPU compositing, so mixed normal/inverted masks on the same clip do not rely on a clip-wide inversion flag.

## Creating Masks

The properties panel exposes three creation flows:

- Rectangle mask
- Ellipse mask
- Pen mask

Rectangle and ellipse masks can be drawn directly on the preview by dragging.
Pen mode adds points by clicking in the preview.
Dragging while placing a pen point creates bezier handles.
When the pen is near an existing edge, the overlay previews the inserted point; clicking inserts a vertex at that exact curve position.
Clicking the first point closes the path once at least three vertices exist.

`MaskEditMode` currently includes:

- `none`
- `drawing`
- `editing`
- `drawingRect`
- `drawingEllipse`
- `drawingPen`

## Editing In Preview

The preview overlay is implemented in `src/components/preview/MaskOverlay.tsx`.

- Active masks render as SVG paths over the preview.
- The SVG overlay is sized to the displayed canvas, not the full preview wrapper, so pointer coordinates stay aligned when the preview is letterboxed.
- Visible masks show vertex squares, selected-vertex highlights, bezier handle circles, and edge hit areas.
- Selected bezier vertices always show their handles, including when the outline is hidden or a handle is currently zero-length.
- Mask geometry is edited in layer-local UV space and projected to the preview with the current layer transform.
- Whole-mask dragging moves all vertices together.
- Dragging an edge moves the two adjacent vertices together.
- Clicking an edge with the pen tool inserts a new vertex.
- Dragging a vertex moves that vertex.
- Dragging a selected vertex with multiple vertices selected moves the selected vertices together.
- Clicking a vertex selects it and keeps it selected until the selection changes.
- Arrow keys nudge selected vertices. Shift increases the step; Alt uses a fine step.
- `Tab` toggles preview Edit Mode. With the mask tab active, this enables only canvas zoom/pan for detailed mask work and does not move or scale layers.
- Shift-drag on a vertex scales both bezier handles while keeping the vertex fixed.
- Shift while placing a pen handle constrains the handle angle.
- Alt while placing a pen handle creates a one-sided handle.
- Double-clicking a vertex cycles its handle mode.
- `B` cycles selected vertices between corner, linked handles, and split handles.
- `Delete` removes selected vertices.
- `Escape` exits drawing or editing modes.
- `Enter` closes the active open path when it has at least three vertices.

The overlay uses normalized layer-local coordinates internally. Pointer input is unprojected through the current layer transform before updating vertices, handles, edges, or whole masks.

## Mask Properties

The properties panel exposes the following controls per mask:

- Name
- Visibility toggle
- Mode dropdown
- Render enabled toggle
- Feather
- Feather quality
- Position X / Y
- Inverted
- Selected vertex handle mode

`featherQuality` is stored as a 1-100 value in the UI and defaults to `50` for new masks.
Lower values use a lower-resolution CPU blur path for faster previews; higher values preserve more edge detail.
Feather is applied per mask before mask-mode compositing, so a later subtract mask can still cut into an earlier feathered add mask.
Mask opacity is intentionally not exposed in the mask panel. Layer opacity is handled by the normal transform controls.

## Shortcuts

Mask shortcuts are registered through the central shortcut registry:

- `P`: Pen mask tool
- `V`: Edit active mask path
- `R`: Rectangle mask tool
- `E`: Ellipse mask tool
- `Enter`: Close active mask path
- `Alt+I`: Invert active mask
- `Alt+H`: Toggle active mask outline
- `B`: Toggle selected vertex handle mode
- `Ctrl/Cmd+A`: Select all vertices in the active mask
- `Delete`: Delete selected vertices
- Arrow keys: Nudge selected vertices
- `Tab`: Toggle preview Edit Mode; in mask editing this is canvas navigation only

## Rendering Path

The compositor reads a per-layer mask texture through `maskClipId`.
If a clip has enabled masks, `LayerBuilderService` sets the layer's mask lookup id.
Export layers set the same `maskClipId`, and `ExportMaskTextures` generates full-resolution mask textures for WebCodecs, FFmpeg, and single-frame export before each render pass.
`MaskTextureManager` falls back to a white texture when no mask texture exists.
The mask is sampled in layer-local `clampedUV`, which keeps the rendered mask attached to the layer through position, scale, rotation, and perspective transforms.
When a 2D clip is promoted into the shared 3D scene as a plane, `NativeSceneRenderer` passes the same mask texture into the plane shader and samples it in plane UV space, so the mask follows 3D rotation and perspective instead of becoming a screen-space overlay.
Per-mask opacity is ignored when generating the mask texture; layer opacity remains the opacity control.

Relevant files:

- `src/stores/timeline/maskSlice.ts`
- `src/components/panels/properties/MasksTab.tsx`
- `src/components/preview/MaskOverlay.tsx`
- `src/components/preview/useMaskVertexDrag.ts`
- `src/components/preview/useMaskDrag.ts`
- `src/components/preview/useMaskEdgeDrag.ts`
- `src/components/preview/useMaskShapeDraw.ts`
- `src/engine/texture/MaskTextureManager.ts`
- `src/engine/export/ExportMaskTextures.ts`
- `src/engine/native3d/NativeSceneRenderer.ts`
- `src/engine/native3d/shaders/PlanePass.wgsl`

## Limitations

- Animated mask paths are not implemented.
- Mask tracking is not implemented.
- Mask interpolation between shapes is not implemented.
- Mask mode is applied while generating the combined CPU mask texture.

