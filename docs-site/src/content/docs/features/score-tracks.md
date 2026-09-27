---
title: "Score Tracks"
---

Infrastructure for the upcoming scorewriter (issue #366): a `score` track type
that lives in the timeline's audio section, holds data-only score clips, and
opens a detached score-editor window. The notation surface itself is not built
yet — the current editor window is a placeholder that proves the wiring.

## Creating a score track

Right-click any track header (audio-side headers included) and choose
**+ Add Score Track** from the track context menu, next to the existing Video /
Audio / MIDI entries. Score tracks:

- render at the bottom of the audio section (`isAudioSectionTrackType`),
- insert at the bottom like audio and MIDI tracks,
- use a warm parchment identity tint (`--score-color` in
  `src/styles/tokens.css`, mirrored as `SCORE_TRACK_COLOR` in
  `src/components/timeline/trackColor.ts`) unless a label color is set,
- use the full mixer header like MIDI (type badge, M/S, pan/fader strip in the
  advanced audio layer) with a beamed-note glyph (`ScoreTrackTypeIcon`) as the
  badge; only the MIDI instrument selector stays MIDI-specific,
- join the audible mute/solo group (`isAudibleTrack`) so their M/S buttons
  behave like the other musical lanes, even though they emit no audio yet,
- use the `stack` overlap policy like MIDI: overlapping score clips coexist,
- reject external media drops, like MIDI tracks.

Right-clicking empty space in the track-header column (below the last track,
either section) opens an add-only track menu with the same four add-track
entries, so a track can be inserted without aiming at an existing header.

## Creating score clips

The MIDI pencil tool (`midi-draw`) also draws on score tracks: click-drag on
empty score-lane space paints a clip over the dragged range; a plain click
creates a default 4-second clip (`useMidiClipDraw` →
`addScoreClip` in `src/stores/timeline/midiClipSlice.ts`). Score clips are
data-only clips with `source.type === 'score'` and a placeholder file, like
MIDI/solid/text clips, and they persist through both the in-memory
serialize/load cycle and project save/load.

## Notation data model (`clip.scoreData`)

A score clip's notation lives in `clip.scoreData` (`ScoreData` in
`src/types/scoreClip.ts`, `schemaVersion: 1`): plain-JSON measures holding
Chord/Rest slots with enharmonic pitch spelling (`step/alter/octave`),
exact-fraction beat positions (tuplet-safe rational time), ties, dots,
articulations, stem overrides, and per-measure tuplets. The framework-free
model logic ported from the kikoromantest score editor lives in
`src/services/score/` — `ScoreModel` (slot CRUD + `toScoreData`/`fromScoreData`),
`restFill` (measures always fully filled with rests), `tupletOps`,
`CollisionDetector`, `NoteEntryCoordinator` (beat entry with tie splitting
across barlines and Sibelius-style erosion), plus `fraction`, `pitchSpelling`,
`musicUtils`, and `beatMap` utilities. VexFlow 5 is installed for the upcoming
rendering phase.

`scoreData` is wired through every persistence path like `midiData`: in-memory
serialize/load, project save/load, copy/paste (deep-cloned), and history —
score clips are inline-data clips, so undo/redo restores notation without
scheduling a media reload. Editors commit whole-score snapshots through the
`updateScoreData(clipId, scoreData, { captureHistory?, description? })` store
action; live drags pass `captureHistory: false` and the final commit captures
one undo snapshot (the piano-roll pattern). Splitting a score clip currently
duplicates `scoreData` onto both halves.

## Score editor window

Double-clicking a score clip opens (or focuses) a detached score-editor popup
bound to that clip (`src/components/scoreEditor/ScoreEditorBoot.ts`, modeled on
the piano-roll boot: same-origin popup, shared JS heap and Zustand store, one
window per clip). The boot lazy-loads `ScoreEditor.tsx`; a clip without
`scoreData` opens as an empty four-measure sheet and materializes into the
store on the first edit.

The editor is a full scorewriter (ported from kikoromantest). Two tools:
**entry** (default — hover shows a translucent ghost note, click places it
with overwrite/chord/split-and-tie-overflow semantics; a blue cursor line
marks the keyboard insertion point) and **selection** (Esc — click notes,
rests, ties, accidentals, articulations, or tuplet brackets; drag a notehead
vertically to re-pitch it, one undo step per drag). The toolbar palette and
the complete Sibelius-style shortcut table drive both: `n`/`Esc`/`Space`
modes, `a–g` letter entry, `Shift+a–g` chord add, `r` rest, numpad durations/
accidentals/articulations/tie, `.` dot, `t` triplet mode, `x` stem flip,
arrows navigation, `Ctrl+arrows` octave, `Alt+arrows` chord navigation, and
Delete with the priority chain articulation → accidental → tie → tuplet →
note. Beaming is fully automatic (stock VexFlow per-time-signature groups);
there is deliberately no manual beam control. The sheet zooms 50–200% via
the toolbar control, `Ctrl+wheel`, or `Ctrl+=`/`Ctrl+-`/`Ctrl+0` — pure SVG
viewBox scaling, so hit-testing and layout are zoom-agnostic (layout runs at
the logical width, container ÷ zoom).

Every mutation commits the whole score to `clip.scoreData` via
`updateScoreData`, so undo/redo is the HOST history system (`Ctrl+Z` works in
the popup and on the main window); external changes to the clip's data reload
the editor live. All listeners and shortcuts bind to the popup's own
document. Structure: framework-free controllers
(`ScoreSelectionController`, `ScorePaletteController`,
`ScoreKeyboardController`, `ScoreMouseController`, `scoreShortcuts`) around
`ScoreEditorEngine` (`src/services/score/ScoreEditorEngine.ts` — the editing
semantics: duration changes with rest backfill/erosion and Dorico-style
overflow tie-splits, ties, articulations, stems) and `MouseNoteEntry`
(pixel entry). Hit testing is VexFlow-native
(`src/services/score/render/ScoreHitTester.ts`): live Stave/StaveNote
geometry plus the model slot ids in the SVG — no harvested bounding-box
registry.

## Notation rendering (`src/services/score/render/`)

`VexFlowScoreRenderer` re-renders the full score into SVG on every change:
`scoreLayout` (proportional measure widths and line breaks against the live
container width), `scoreNoteFactory` (StaveNotes with the custom
accidental-display rules, dots, articulation order), and `scoreSpanners`
(bracketed tuplets and stock `StaveTie` ties — same-pitch only, two partial
arcs across a line break). Everything VexFlow can decide is left to VexFlow:
beaming is `Beam.generateBeams` with the time signature's default groups (no
manual beam modes), stem direction is `autoStem` (the model's stem-flip
override is applied through VexFlow's own `setStemDirection`), tie curve
direction is the StaveTie default, and whole-measure rests center via
`alignCenter`. The deliberate exception is the accidental-display policy
(measure-context suppression, courtesy naturals, tie suppression), which is
editor semantics, not engraving. Selection and the ghost-note preview are applied as
VexFlow styles *before* drawing (no post-render SVG recoloring or DOM
surgery); the ghost draws into its own non-interactive overlay group. Each
slot's StaveNote carries the model slot id as its VexFlow element id, so the
SVG contains `<g class="vf-stavenote" id="vf-<slotId>">` for the upcoming
hit-test layer, and the renderer exposes a per-render snapshot (note refs,
staves, tuplets, measure bounds, line layout).

VexFlow 5 registers its music fonts (Bravura/Academico) on the MAIN
document's `FontFaceSet` at import; `scoreFonts.ts` copies those FontFaces
into the popup document and awaits readiness before the first render —
without this the popup renders tofu glyphs. VexFlow is split into its own
lazy chunk (`manualChunks` + dynamic import in the boot), so the main bundle
does not carry the notation stack. Renderers expect measures to be fully
filled; writers repair gaps (`repairAllMeasureGaps`) before committing.

## Audio: audition and in-window playback

Score tracks default to the **Wavetable Synth** (GM Acoustic Grand Piano) —
`createTimelineTrack` stamps `midiInstrument` on score tracks like MIDI
tracks, and `setTrackMidiInstrument` accepts both types. Editing auditions
through the exact piano-roll path: `previewMidiNote(track.midiInstrument,
midi, velocity, trackId)` fires on note click-select, every entry (mouse,
letter keys, chord adds, tuplet placements), and every pitch change (arrows,
octave jumps, drags). `midiPlaybackScheduler.preview` now routes score tracks
through their track bus (volume/pan/EQ/FX/master) instead of the bare
destination fallback.

The toolbar ▶ **Play** button plays the whole sheet in-window:
`scoreToEvents(score)` (`src/services/score/scoreToEvents.ts`) flattens the
notation to schedulable events — tuplet-exact timing via `actualDuration`,
same-pitch tie chains merged into single sustained notes, seconds at
`score.tempo` — and `ScorePlayer` schedules them on a host synth
(`createSynthForInstrument` + the shared AudioContext, GM samples preloaded
before start). ⏹ stops immediately (`stopAll`). Timeline transport/export
playback of score clips is still a later, separate step.

## Kernel boundary note

The pinned v1 kernel fingerprint contract only understands
`audio | midi | video` tracks. Score tracks are filtered out before
fingerprinting (`isPublicTimelineFingerprintTrackTypeV1`); their clips are
fingerprint-ineligible, so a timeline's digest is unchanged by score tracks.
The contract constants themselves are untouched.
