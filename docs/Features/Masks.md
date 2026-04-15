# Masks

[Back to Index](./README.md)

MasterSelects supports per-clip vector masks with preview-overlay editing, bezier handles, and GPU compositing through the layer pipeline.

## At A Glance

- Masks are stored on timeline clips as `ClipMask[]`.
- The properties panel exposes rectangle, ellipse, and pen creation.
- The preview overlay supports vertex, handle, edge, and whole-mask dragging.
- Mask changes are serialized with the project.

## Data Model

`ClipMask` currently includes:

- `id` and `name`
- `vertices`
- `closed`
- `opacity`
- `feather`
- `featherQuality`
- `inverted`
- `mode`
- `expanded`
- `position`
- `visible`

`MaskMode` is currently `add`, `subtract`, or `intersect`.
The UI stores that value and persists it, but the current compositor uses the clip-level mask texture plus inversion when rendering. The preview overlay does not implement separate per-mask compositing passes.

## Creating Masks

The properties panel exposes three creation flows:

- Rectangle mask
- Ellipse mask
- Pen mask

Rectangle and ellipse masks can be drawn directly on the preview by dragging.
Pen mode adds points by clicking in the preview.
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
- Visible masks show vertex squares, bezier handle circles, and edge hit areas.
- Whole-mask dragging moves all vertices together.
- Dragging an edge moves the two adjacent vertices together.
- Dragging a vertex moves that vertex.
- Shift-drag on a vertex scales both bezier handles while keeping the vertex fixed.
- `Delete` removes selected vertices.
- `Escape` exits drawing or editing modes.

The overlay uses normalized coordinates internally and maps them to the preview canvas size.

## Mask Properties

The properties panel exposes the following controls per mask:

- Name
- Visibility toggle
- Mode dropdown
- Opacity
- Feather
- Feather quality
- Position X / Y
- Inverted

`featherQuality` is stored as a 1-100 value in the UI and defaults to `50` for new masks.

## Rendering Path

The compositor reads a per-layer mask texture through `maskClipId`.
If a clip has masks, `LayerBuilderService` sets the layer's mask lookup id and an inversion flag.
`MaskTextureManager` falls back to a white texture when no mask texture exists.

Relevant files:

- `src/stores/timeline/maskSlice.ts`
- `src/components/panels/properties/MasksTab.tsx`
- `src/components/preview/MaskOverlay.tsx`
- `src/components/preview/useMaskVertexDrag.ts`
- `src/components/preview/useMaskDrag.ts`
- `src/components/preview/useMaskEdgeDrag.ts`
- `src/components/preview/useMaskShapeDraw.ts`
- `src/engine/texture/MaskTextureManager.ts`

## Limitations

- Animated mask paths are not implemented.
- Mask tracking is not implemented.
- Mask interpolation between shapes is not implemented.
- The mask `mode` field is stored and editable, but it is not currently used as a separate compositing stage in the code we inspected.

