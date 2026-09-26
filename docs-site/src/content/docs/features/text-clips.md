---
title: "Text Clips"
---

Text clips are rasterized to a Canvas2D surface, uploaded as a GPU texture, and then treated like regular timeline layers for compositing, effects, masks, transforms, and keyframes.

## Creation

- Text clips are added through the timeline text action and require a video track.
- New text clips default to a 5 second duration.
- The default content is `Enter text`.
- New 2D text clips default to area text, with a full-composition paragraph box that supports wrapping and hard line breaks.
- New and edited 2D text clips use the active composition resolution for their text canvas. When that resolution changes, the text bounds and legacy box fields are rescaled during the edit.
- Text clips use `src/services/textRenderer.ts` to generate their canvas content.

## Timeline Appearance

- The clip bar shows a `T` icon and a truncated preview of the text content.
- The preview updates when the underlying text changes.

## Properties Panel

`src/components/panels/TextTab.tsx` exposes:

- Multi-line text input
- Compact font family selection
- Font-weight preview pills with all standard slots visible; unavailable weights are dark and disabled
- Normal/italic style preview pills
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
The ordinary Text tab shares the same compact typography controls as Dynamic
Captions without exposing any caption-specific source, timing, line, or word-
highlight settings.
Area-text bounds can be keyframed from the Area Text section.

## Animated Numbers (`{value}` tokens)

Text content can print a live number that changes every frame, so counters and
speed readouts need one clip instead of many static ones.

| Token | Output |
|---|---|
| `{value}` | Value with up to 2 decimals, trailing zeros trimmed (`6.83`, `1`) |
| `{value:N}` | Value with exactly N decimals (0-6), e.g. `{value:2}` → `1.00` |
| `{value*K:N}` | Value scaled by K first, e.g. `{value*100:0}%` → `683%` |
| `{time}` / `{time:N}` | Clip-local seconds |

Unknown `{...}` text stays literal. The Content section shows:

- **Value**: a keyframeable number (`text.value`) with slider, numeric field
  and stopwatch; animate it like any other property for a counting number.
- **Follow**: optionally drive Value from another clip's numeric property at
  the same timeline time (`valueLink: { clipId, property }`), e.g. a video's
  `speed` to show its speed ramp live, or `opacity` / `position.x`. When a link
  is set, the Property picker lists that clip's animatable numeric properties
  and the own Value row is hidden. A missing linked clip falls back to Value.

Formatting happens in `src/services/text/textValueTemplate.ts`; per-frame
resolution (own keyframes or link) happens in `renderTextFrame`
(`src/services/text/textFrameRuntime.ts` + `textValueLink.ts`), which the
preview, nested compositions, node previews, and export share. A template clip
re-rasterizes only when the formatted string or its styling changes. Static
rasters (thumbnails, inactive compositions) print the base Value.

## Preview Editing

When a 2D text clip is selected and the preview is in Edit mode, the preview shows an AE-style text bounds editor over the rendered text.

- Click the active text bounds to type directly in the preview.
- Drag in empty preview space to define a new paragraph bounds rectangle for the selected text clip.
- Drag red vertices to reshape the text bounds.
- Hold Shift while creating, moving, or resizing bounds to snap to the source canvas edges and center guides.
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

## Automation

The AI tool surface can create and update editable text clips, set an area-text box, inspect text properties, add text-bounds keyframes, and supply `pathEnabled` and `pathPoints`.

## Fonts

`src/services/googleFontsService.ts` exposes 50 Google Font families across:

- Sans-serif
- Serif
- Display
- Handwriting
- Monospace

Fonts are loaded by injecting Google Fonts CSS and waiting on `document.fonts.load(...)`.

## Serialization

Text clips persist their text properties. On load, the text canvas is recreated from those properties at the active composition resolution.

Relevant files:

- `src/stores/timeline/textClipSlice.ts`
- `src/stores/timeline/constants.ts`
- `src/services/textRenderer.ts`
- `src/services/textLayout.ts`
- `src/components/panels/TextTab.tsx`
- `src/components/preview/TextPreviewEditor.tsx`
- `src/services/aiTools/definitions/text.ts`
- `src/services/aiTools/handlers/text.ts`
- `src/types/index.ts`
