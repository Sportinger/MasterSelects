[Back to Index](./README.md)

# Text Clips

Text clips are rasterized to a Canvas2D surface, uploaded as a GPU texture, and then treated like regular timeline layers for compositing, effects, masks, transforms, and keyframes.

## Creation

- Text clips are added through the timeline text action and require a video track.
- New text clips currently default to a 5 second duration.
- The default content is `Enter text`.
- New 2D text clips default to area text, with a centered paragraph box that supports wrapping and hard line breaks.
- New 2D text clips use the active composition resolution for their text canvas. Existing text canvases keep their current source resolution during edits so the layer does not rescale while typing.
- Text clips use `src/services/textRenderer.ts` to generate their canvas content.

## Timeline Appearance

- The clip bar shows a `T` icon and a truncated preview of the text content.
- The preview updates when the underlying text changes.

## Properties Panel

`src/components/panels/TextTab.tsx` currently exposes:

- Multi-line text input
- Font family selection
- Font weight selection with auto-adjustment to valid weights for the chosen font
- Font style
- Font size
- Line height
- Letter spacing
- Fill color
- Stroke enable toggle, stroke color, and stroke width
- Horizontal alignment
- Vertical alignment
- Area Text toggle with box X/Y and width/height controls
- Shadow enable toggle, shadow color, shadow offsets, and shadow blur

Text content updates are debounced briefly so typing stays responsive.
Font changes trigger async font loading through `googleFontsService`.

## Preview Editing

When a 2D text clip is selected and the preview is in Edit mode, the preview shows an AE-style text bounds editor over the rendered text.

- Click the active text bounds to type directly in the preview.
- Drag in empty preview space to define a new paragraph bounds rectangle for the selected text clip.
- Drag red vertices to reshape the text bounds.
- Hold Ctrl or Command while dragging to move the whole text bounds path.
- The bounds are stored as `textBounds` using mask-style vertices plus legacy `boxX`, `boxY`, `boxWidth`, and `boxHeight` fallback values.
- Preview text editing is disabled during playback, source monitor, scene navigation, and mask navigation.

## Rendering

`src/services/textRenderer.ts` renders text with Canvas2D and supports:

- Multi-line text
- Area text wrapping and clipping inside the paragraph bounds
- Shape-aware line wrapping for slanted text bounds, using the available polygon width at each line's Y position
- Left, center, and right alignment
- Top, middle, and bottom vertical alignment
- Letter spacing
- Stroke outlines
- Shadows
- Text-on-path rendering through `pathEnabled` and `pathPoints`

The path-rendering code exists in the renderer, but there is no dedicated path editing UI in `TextTab` yet.

## Fonts

`src/services/googleFontsService.ts` currently exposes 50 Google Font families across:

- Sans-serif
- Serif
- Display
- Handwriting
- Monospace

Fonts are loaded by injecting Google Fonts CSS and waiting on `document.fonts.load(...)`.

## Serialization

Text clips persist both the text properties and the generated canvas-backed source data.
On load, the text properties are restored and the canvas is re-rendered.

Relevant files:

- `src/stores/timeline/textClipSlice.ts`
- `src/stores/timeline/constants.ts`
- `src/services/textRenderer.ts`
- `src/services/textLayout.ts`
- `src/components/panels/TextTab.tsx`
- `src/components/preview/TextPreviewEditor.tsx`
- `src/types/index.ts`

## Current Limits

- No gradient fill controls.
- No background box controls.
- No multiple-shadow UI.
- No path editor UI, even though the renderer can draw text along a path from stored data.

