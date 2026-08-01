# Text-Clips.md — audit 2026-08-02

## Verified (spot checks that held)

- Text clips are Canvas2D-rendered and used as text-canvas layers: `src/services/textRenderer.ts`, `src/engine/texture/TextureManager.ts`, and `src/engine/export/layerBuilder/textLayers.ts`.
- Creation is restricted to video tracks, defaults to five seconds and `Enter text`, and uses `src/services/textRenderer.ts` through the generated-canvas runtime: `src/stores/timeline/textClipSlice.ts` and `src/stores/timeline/constants.ts`.
- `src/components/panels/TextTab.tsx` provides the documented typography, alignment, area-text, stroke, and single-shadow controls, including the 50 ms text debounce and font-weight adjustment.
- The preview editor supports direct textarea editing, empty-space bounds creation, vertex/edge reshaping, Shift snapping, and Ctrl/Command whole-bounds movement: `src/components/preview/TextPreviewEditor.tsx`; its availability is gated by edit mode, typing mode, source monitor, playback, mask mode, and scene navigation in `src/components/preview/usePreviewModeState.ts`.
- Canvas rendering supports multiline text, polygon-aware area-text wrapping/clipping, alignment, letter spacing, stroke, shadow, and Bezier-path text: `src/services/textRenderer.ts`, `src/services/textLayoutEngine/textShapeWrapping.ts`.
- The 50-family Google Fonts catalog and CSS-plus-`document.fonts` loading are present in `src/services/googleFontsService.ts`.
- No gradient-fill, text-background, multiple-shadow, or properties-panel path-editor controls were found in `src/components/panels/TextTab.tsx`.

## Outdated or wrong (claim → reality, with file evidence)

- New 2D text clips default to area text, with a centered paragraph box -> new clips use an area-text box spanning the full composition (`x: 0`, `y: 0`, composition width and height), not a centered box. Evidence: `src/stores/timeline/textClipSlice.ts` (`getInitialTextProperties`).
- Existing text canvases keep their current source resolution during edits -> `updateTextProperties` renders at the active composition resolution and rescales `textBounds` plus legacy box fields when dimensions differ. Evidence: `src/stores/timeline/textClipSlice.ts` (`shouldResizeCanvas`, `rescaleTextBoundsPath`, and `renderTimelineTextCanvasRuntime`).
- Text clips persist both the text properties and the generated canvas-backed source data -> serialisation stores `textProperties`; loading recreates a canvas from those properties and active-composition dimensions. Evidence: `src/stores/timeline/serialization/serializableTimelineState.ts`, `src/stores/timeline/serialization/loadStateGeneratedClipRestore.ts`, and `src/services/project/projectSave.ts`.
- The document omitted shipped AI text operations -> `getTextProperties`, `createTextClip`, `updateTextProperties`, `setTextBox`, and `addTextBoundsKeyframe` are registered in `src/services/aiTools/definitions/text.ts` and implemented by `src/services/aiTools/handlers/text.ts`.

## Noteworthy / unusual

- The text-bounds path is now animatable from the Area Text section and through the AI `addTextBoundsKeyframe` tool; the document only made a general keyframe claim. Evidence: `src/components/panels/TextTab.tsx`, `src/services/aiTools/definitions/text.ts`, and `src/services/aiTools/handlers/text.ts`.
- Although there is no TextTab path editor, AI tools can set `pathEnabled` and Bezier `pathPoints`; this is a capability gap between the automation surface and properties UI. Evidence: `src/services/aiTools/definitions/text.ts`, `src/services/aiTools/handlers/text.ts`, and `src/components/panels/TextTab.tsx`.
- Text clips have no built-in background-box control, but `createEditableTitleStack` creates text rows with separate native Motion rectangle backplates. Evidence: `src/services/aiTools/definitions/text.ts` and `src/services/aiTools/handlers/editableTitleStack.ts`.
- The text tool-definition descriptions contain visible mojibake (`ƒ?T`) in apostrophes, a likely encoding defect unrelated to the feature documentation. Evidence: `src/services/aiTools/definitions/text.ts`.
