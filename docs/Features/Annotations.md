# Annotations

Annotations are timed text notes attached either to the active composition or
to a source media file. They are review aids, not rendered content: they never
appear in the preview or in exports. Composition annotations are mirrored as
bars in the timeline ruler; source annotations are listed in the Annotations
panel and can seek the Source Monitor.

## Where they live

| Surface | What it does |
|---|---|
| **Annotations** panel (`annotations`, View menu and dock "+" menu) | Lists the annotations of the active composition and of the media file currently loaded in the Source Monitor, with text editing, delete, and click-to-seek |
| Timeline ruler bars | One bar per composition annotation above the ruler lanes; hidden through **Annotation Bars** in the timeline view menu |
| Ruler context menu | **Add annotation** at the clicked time (two-second default length); on a bar **Link to clip** / **Detach from clip** |
| Reader popover | Double-click a bar, or focus it and press Enter/Space, to read the full text without truncation |

## Interactions on the ruler

- Drag a bar to move it; drag its start/end handles to trim. Positions are
  quantized to the composition frame rate and clamped to the composition, or to
  the linked clip when the annotation is clip-scoped.
- Keyboard: the bar and both handles are focusable. Arrow keys nudge by one
  frame, Shift+Arrow by ten. Enter or Space opens the reader; Escape closes it.
- Linking to a clip stores the annotation relative to the clip start, so the
  note follows the clip when it is moved. If several clips overlap at the
  requested time, a tooltip asks you to click the intended clip (Escape
  cancels). **Detach from clip** converts the note back to composition time.
- Annotation edits go through `updateComposition`, so they are part of the
  project dirty state and of undo/redo like any other composition change.

## Data model and persistence

`SourceAnnotation` (`src/types/sourceAnnotation.ts`): `id`, `text`,
`startTime`, `endTime`, `createdAt`, optional `scope` (`composition` |
`clip`) and `clipId`. Times are seconds; for `clip` scope they are relative to
the clip start.

- Composition annotations persist in the project as
  `ProjectComposition.annotations` (`projectSave.ts`,
  `load/loadTimelineHydration.ts`).
- Media annotations persist as `ProjectMediaFile.sourceAnnotations`
  (`projectMediaSerialization.ts`, `load/loadMediaHydration.ts`) and live on
  `MediaFile.sourceAnnotations` at runtime.
- The **Annotation Bars** visibility flag is session state in
  `src/stores/annotationStore.ts` and is not persisted.

## Source files

- `src/components/panels/annotations/AnnotationsPanel.tsx`, `.css`
- `src/components/timeline/hooks/useRulerAnnotations.ts` (projection, drag,
  nudge, create, link, reader state)
- `src/components/timeline/components/RulerAnnotationBars.tsx`,
  `RulerAnnotationPortals.tsx`, `src/components/timeline/TimelineAnnotations.css`
- `src/components/timeline/TimelineRulerActionMenu.tsx` (context-menu entries)
- `src/components/preview/SourceMonitor.tsx` (playback reporting and seek
  requests through `annotationStore`)

## Known limitations

- Creating an annotation from the ruler uses a native `window.prompt` dialog;
  the Annotations panel offers the inline editor.
- Source annotations are not drawn on the Source Monitor itself; they are
  list-and-seek only.
- The Annotations panel is not part of any factory layout and must be added
  through the View menu or the dock "+" menu.
