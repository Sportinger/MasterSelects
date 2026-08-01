# Masks.md &mdash; audit 2026-08-02

## Verified (spot checks that held)

- `ClipMask` still stores the documented mask fields and `MaskMode` is `add`, `subtract`, or `intersect`; `MaskVertex.handleMode` remains `none`, `mirrored`, or `split`. Evidence: `src/types/masks.ts`.
- The Masks tab and SVG overlay implement the documented rectangle, ellipse, and pen flows; projected layer-local editing; visible-mask outlines; selected vertices; handles; edge hit areas; and pen edge insertion. Evidence: `src/components/panels/properties/MasksTab.tsx`, `src/components/preview/MaskOverlay.tsx`, `src/components/preview/maskOverlay/MaskOverlayChrome.tsx`, `src/components/preview/maskOverlay/usePenMaskDraw.ts`, and `src/components/preview/useMaskShapeDraw.ts`.
- The documented keyframe property formats, mask copy/paste remapping, removal cleanup, edge-feather serialization, and variable-topology interpolation are present. Evidence: `src/types/animationProperties.ts`, `src/stores/timeline/maskSlice.ts`, `src/services/project/maskSerialization.ts`, and `src/stores/timeline/keyframes/maskPathTopology.ts`.
- The shortcut list is current: P/R/E, Ctrl/Cmd+C/V, Enter, Alt+I/H, B, Ctrl/Cmd+A, Delete, arrows, and Tab are registered or handled by the mask UI. Evidence: `src/services/shortcutPresets.ts`, `src/components/preview/MaskOverlay.tsx`, and `src/components/preview/usePreviewModeState.ts`.
- Preview/export texture generation, white fallback, layer-local sampling, and 3D plane-mask support are implemented. Evidence: `src/hooks/engine/useEngineMaskTextureSync.ts`, `src/utils/maskRenderer.ts`, `src/engine/texture/MaskTextureManager.ts`, `src/engine/export/ExportMaskTextures.ts`, `src/services/compositionRender/layerEvaluation.ts`, `src/engine/native3d/NativeSceneRenderer.ts`, and `src/engine/native3d/shaders/PlanePass.wgsl`.
- No mask-tracking implementation was found in the client code. Evidence: searches of `src/components/`, `src/services/`, and `src/stores/`; the mask interaction code is confined to the overlay, vector masks, and SAM2/MatAnyone panel paths.

## Outdated or wrong (claim &rarr; reality, with file evidence)

- "Whole-mask dragging uses an internal mask offset; visible shape animation is driven by the `Mask Path` stopwatch" and the later unconditional statement that whole-mask dragging leaves topology unchanged &rarr; this is true only for static masks. When Mask Path recording is armed or path keyframes already exist, the drag translates every vertex and commits a Mask Path keyframe; otherwise it writes the hidden numeric position properties. Evidence: `src/components/preview/maskPathDragPreview.ts` and `src/components/preview/useMaskDrag.ts`.
- "Playback creates a temporary collapsed vertex on the nearest surviving neighbor" &rarr; topology interpolation now reconstructs temporary vertices along surviving Bezier segments. It collapses to an anchor only when a source has a single surviving vertex. Evidence: `src/stores/timeline/keyframes/maskPathTopology.ts`.

## Noteworthy / unusual

- Mask ordering is a shipped UI capability (`Move mask up` / `Move mask down`) and order matters because `generateMaskTexture` composes enabled masks sequentially with add, subtract, and intersect operations. It was omitted from the feature doc. Evidence: `src/components/panels/properties/masksTab/MaskItem.tsx`, `src/stores/timeline/maskSlice.ts`, and `src/utils/maskRenderer.ts`.
- AI tools expose `getMasks`, rectangle/ellipse/custom creation, mask and vertex updates/removal, and whole-path keyframes; those tools were omitted from the feature doc. Evidence: `src/services/aiTools/definitions/masks.ts`, `src/services/aiTools/handlers/masks.ts`, and `src/services/aiTools/handlers/timelineHandlerRegistry.ts`.
- `ClipMask.opacity` is still persisted and accepted by AI tools but is deliberately ignored by mask texture generation; layer opacity is the rendered opacity control. Evidence: `src/types/masks.ts`, `src/services/aiTools/definitions/masks.ts`, and `src/utils/maskRenderer.ts`.
- Feather quality is typed with an older `0=low/1=medium/2=high` comment, while the active UI and renderer use a clamped 1-100 value (1-33, 34-66, 67-100). Evidence: `src/types/masks.ts`, `src/components/panels/properties/masksTab/MaskEdgeSection.tsx`, and `src/utils/maskRenderer.ts`.
