[Back to Index](./README.md)

# Text Clips

Text clips are rasterized to a Canvas2D surface, uploaded as a GPU texture, and then treated like regular timeline layers for compositing, effects, masks, transforms, and keyframes.

## Creation

- Text clips are added through the timeline text action and require a video track.
- New text clips currently default to a 5 second duration.
- The default content is `Enter text`.
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
- Shadow enable toggle, shadow color, shadow offsets, and shadow blur

Text content updates are debounced briefly so typing stays responsive.
Font changes trigger async font loading through `googleFontsService`.

## Rendering

`src/services/textRenderer.ts` renders text with Canvas2D and supports:

- Multi-line text
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
- `src/components/panels/TextTab.tsx`
- `src/types/index.ts`

## Current Limits

- No gradient fill controls.
- No background box controls.
- No multiple-shadow UI.
- No path editor UI, even though the renderer can draw text along a path from stored data.

