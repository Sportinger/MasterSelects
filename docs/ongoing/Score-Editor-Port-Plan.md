# Score Editor Port Plan

2026-09-26 · Porting the kikoromantest score editor into the MasterSelects score-clip window.

## Goal

Port the kikoromantest score editor (Vue 3 + VexFlow 5) into the MasterSelects score-clip
popup window, keeping every user interaction it has today. VexFlow stays; Vue is replaced
mutatis mutandis with React; its Tone.js sound engine is replaced by the MasterSelects synth;
its custom ElementRegistry hit-testing is replaced by VexFlow's native SVG interactivity plus
a thin glue layer.

The landing site already exists: score tracks, pencil-drawn score clips, and the placeholder
popup (`src/components/scoreEditor/ScoreEditorBoot.ts` + `ScoreEditor.tsx`, committed in
`95f83752`). Double-clicking a score clip opens the window this editor will fill.

## Locked decisions

1. **Ties: same-pitch only.** Stock VexFlow `StaveTie` everywhere; the hand-drawn flat tie
   (which existed because ties could target any next slot, even rests) is dropped.
2. **Undo: host system.** The score lives as `clip.scoreData` in the timeline store with
   dedicated actions + `captureSnapshot`, exactly like `midiData`. The editor's own
   `UndoRedoManager` is dropped. Fixes one-undo-per-drag-step; drags use the piano roll's
   `captureHistory:false` pattern with a final committing update.
3. **Audition: yes.** Click/entry/pitch-change previews via `previewMidiNote(track.midiInstrument,
   pitch, vel, trackId)` — the exact piano-roll call path (kikoromantest was silent while editing).
4. **Score-track infrastructure** is already committed (`95f83752`).

## What the research found

### kikoromantest (source of the port)

- Single-staff, single-voice editor. The Vue layer is a thin shell (`App.vue` toolbar +
  one-line composables). Controllers (`interactions/*`), engine (`MusicEngine` 1133 LOC,
  `NoteEntryCoordinator` 1032), model (`ScoreModel` 1039, `types/music.ts`, exact `Fraction`
  beats), and renderer (`VexFlowRenderer` 1771) are **framework-free TypeScript** with
  explicit full re-renders — directly portable.
- VexFlow `5.0.0` from npm, unpatched — byte-identical to both `../engine-sources` copies.
- Data model: `Score → Measure → ChordRest slots` with per-pitch spelling (`step/alter/octave`),
  exact-fraction beats, per-measure tuplets, measure always fully filled with rests.
- Its Pinia is installed but unused; docs (roadmap/README) are partly aspirational.
- Interactions (all must survive the port): ghost-note hover preview, click-to-add with
  overwrite/chord/split-and-tie-overflow semantics, triplet mode, single-note selection with
  sub-element picking (tie/accidental/articulation/tuplet-bracket), 150 ms-threshold pitch
  drag, full palette (durations, accidentals with `forceAccidental`/courtesy naturals, dots,
  articulations, beam modes, tuplet, tie), and the complete shortcut table
  (`n`/`Escape`/`Space` modes, Delete priority chain, numpad palette, arrows navigation,
  `Ctrl+arrows` octave, `Alt+arrows` chord nav, `a–g` letter entry, `Shift+a–g` chord add,
  `r` rest, `x` stem flip, `t` tuplet, `Ctrl+Z`/`Ctrl+Shift+Z`).

### VexFlow 5 interactivity (replaces ElementRegistry)

- **No `Pointer` class exists.** But the SVG backend emits a `<g class="vf-stavenote"
  id="vf-…">` per note containing an **invisible pointer hit-rect** (SVG root is
  `pointer-events:none`, so exactly note rects receive events).
- Selection = one delegated `pointerdown` on the SVG + `closest('g.vf-stavenote')` + id
  lookup. We set the **model slot id as the VexFlow element id** at build time
  (`note.setAttribute('id', slotId)`), so DOM → model is a direct map.
- Geometry is native: `stave.getLineForY(y)`/`getYForLine`, `note.getYs()` (chord keys),
  `getAbsoluteX()`, `getBoundingBox()`, `stave.getNoteStartX/EndX()`.
- Still custom (thin glue, ~150–200 LOC vs. 685 + ~250 of registry population):
  per-render `Map<slotId, StaveNote>` + per-measure `Stave` refs; y→pitch quantization
  (line → diatonic step inverse with clef `lineShift` — VexFlow has no inverse); nearest-slot
  search in empty space; sub-element bbox picking (their glyphs are `pointer-events:none`) —
  but via real `getBoundingBox()`/`modifier.getIndex()`, not SMuFL-codepoint/±1 px hacks.
- Skip VexFlow's own `Registry` class (it never unregisters); our own Map is simpler.
- Selection visuals: pre-draw `setStyle`/`setKeyStyle`/`setStemStyle` (we fully re-render on
  every change anyway). Note: `addClass` is not emitted into the SVG, and `removeClass` has
  an upstream bug — avoid both.

### Customizations in kikoromantest to eliminate

| # | Hack | Replacement |
|---|------|-------------|
| 1 | `HighlightController` (422 LOC): post-render `querySelectorAll` + `getBBox()` recoloring with pixel heuristics | Pre-draw VexFlow styles (`setStyle`, `setKeyStyle`, modifier/tie/tuplet `setStyle`) |
| 2 | Ghost note: full score re-render every 50 ms on hover + SVG index-diff surgery | Ghost styled via `setStyle` in the render pass, or an overlay layer so hover doesn't re-render |
| 3 | `context.save/restore` monkey-patch (Vue-proxy workaround) | Dies with Vue |
| 4 | Private-field pokes (`(accidental as any).index`, tuplet internals, invented bboxes) | `modifier.getIndex()`, `tuplet.getBoundingBox()` |
| 5 | Hand-drawn flat tie | Stock `StaveTie` (decision 1) |
| 6 | Fake clef/timesig/barline bboxes to block entry | `stave.getNoteStartX()/EndX()` |

Keep as-is (they encode real behavior stock VexFlow doesn't cover): custom accidental-display
rules (`forceAccidental`, courtesy naturals, tie suppression) and custom beam grouping with
manual beam modes.

### MasterSelects host integration

- **Audition:** `previewMidiNote()` (`src/services/audio/midiPlaybackScheduler.ts:429`).
  Host fix needed: for score tracks it falls back to a bare synth wired to `destination`
  (bus routing gated on `track.type === 'midi'` at :157) — route score tracks through their
  track bus too.
- **In-window Play:** no public sequence API; use `createSynthForInstrument(track.midiInstrument,
  audioRoutingManager.ensureSharedContext(), dest)` + `scheduleNote(...)` per event, `stopAll()`
  to stop. The transport/`midiPlaybackScheduler` never plays score clips today — timeline
  playback/export integration is a later, separate step.
- **Popup rules (piano-roll precedent):** bind all listeners and shortcuts to the popup's
  document (`ownerDocument`, `shortcutFocusPolicy`); call `undo()`/`redo()` from
  `stores/historyStore` directly; only `<link>` stylesheets are mirrored into the popup, so
  editor chrome uses inline styles or CSS injected into `win.document` (VexFlow SVG is
  self-styled).
- **Tempo:** keep `score.tempo` initially; end state is the timeline tempo map — quarters are
  canonical (`secondsToQuarters`/`quartersToSeconds` in `src/timeline/tempo/TempoMap.ts`).
- **`scoreData` integration points:** `src/types/timeline.ts` (TimelineClip + SerializableClip),
  `composition.types.ts` (ProjectClip), `serializableTimelineState.ts`,
  `loadStateGeneratedClipRestore.ts` (score branch currently restores no data),
  `projectCompositionSerialization.ts`, `loadTimelineHydration.ts`, clipboard.
  History gotchas: add `'score'` to the `inline-data` list in `historyTimelineEditState.ts`
  and to `isSelfContainedGeneratedClip` in `historyTimelineRestoreState.ts`, or undo/redo
  marks score clips `needsReload`.
- **Dependency:** add `vexflow ^5.0.0` as a plain npm dependency (repo precedent; no vendoring)
  + a `THIRD_PARTY_NOTICES.md` entry. Consider `optimizeDeps`/`manualChunks` in `vite.config.ts`.

## Port architecture

**Reused nearly as-is (framework-free):** `types/music.ts`, `utils/fraction.ts`,
`utils/pitchSpelling.ts`, `utils/musicUtils.ts`, `utils/beatMap.ts`, `ScoreModel`,
`NoteEntryCoordinator`, `CollisionDetector` (the used part), the interaction controllers
(`EditorState` becomes React state; explicit re-render calls stay), and the renderer's
note-building/beam/tuplet/layout logic.

**Replaced:** ElementRegistry → VexFlow SVG ids + thin glue; HighlightController → pre-draw
styles; ghost-note DOM surgery → styled ghost/overlay; Tone.js `PlaybackEngine` → extracted
pure `scoreToEvents(score)` (tie-merge, tuplet-aware — the only audio logic worth keeping)
feeding the host synth; `UndoRedoManager` → host historyStore; document-level
`ShortcutManager` listener → popup-document listener via `shortcutFocusPolicy`.

**Constraints:** 700 LOC ceiling per product file — `VexFlowRenderer` (1771), `MusicEngine`
(1133), `ScoreModel` (1039), `NoteEntryCoordinator` (1032) must be split along real seams
(renderer → layout / note building / spanners; engine → facade / entry / model ops).
No runtime handles in stores or project data (`scoreData` is plain JSON). HMR singletons
parked in `import.meta.hot.data` where applicable.

## Phases

1. **Foundation** — add `vexflow` dependency; port model/types/utils + `ScoreModel` +
   `NoteEntryCoordinator` (split to ≤700 LOC) under `src/components/scoreEditor/` (or
   `src/services/score/` for the pure model); define `ScoreData` (the kikoromantest `Score`
   JSON, `schemaVersion: 1`); add `clip.scoreData` + store slice actions
   (`updateScoreData`, note-level ops as needed) with `captureSnapshot`; wire all
   serialization/history integration points listed above.
2. **Rendering** — port `VexFlowRenderer` minus the six hacks; model-id → SVG element ids;
   pre-draw selection styles; container width from the popup window (drop the hardcoded
   1000 px); stock `StaveTie` (same-pitch ties, incl. across line breaks).
3. **Interaction** — port controllers into the popup React component; new thin hit-test layer
   (Map + stave geometry + y→pitch inverse); full shortcut table on the popup document;
   ghost-note preview without full re-render per mousemove.
4. **Audio** — `scoreToEvents(score)`; audition via `previewMidiNote` on click/entry/pitch
   change; in-window Play/Stop via `createSynthForInstrument` + `scheduleNote`; host fix for
   score-track preview bus routing.
5. **Verification** — port the framework-free Vitest suites from kikoromantest (`ScoreModel`,
   `NoteEntryCoordinator`, `fraction`, `pitchSpelling`, `musicUtils`); targeted new tests for
   `scoreData` persistence round-trip; live checks in the popup (entry, selection, drag,
   shortcuts, undo, audition, play); `npm run build` once at the end.

## Known quirks to fix in passing

- Hardcoded `CONTAINER_WIDTH 1000` → popup width.
- Non-x/4 meters only partly correct (several places use `timeSignature.numerator` as the
  quarter-beat count) — document, fix where cheap.
- Arrow/pitch drag derives natural spelling from y and loses accidentals — preserve `alter`
  on drag like `pitchUp/Down` does.
- `a–g` letter entry requires a selection to anchor the cursor — acceptable initially, note
  for later.
- Key signature is stored but never rendered/used — out of scope for the first port.

## Later follow-ups (explicitly out of scope now)

- Transport playback and audio export of score clips (extend `midiPlaybackScheduler` /
  `AudioExportPipeline`, gated today to `'midi'`).
- Timeline tempo-map integration (store beats natively; project via `quartersToSeconds`).
- Score clip canvas preview painter (notation thumbnail on the timeline clip).
- MusicXML import/export; multi-voice/multi-stave; zoom.
