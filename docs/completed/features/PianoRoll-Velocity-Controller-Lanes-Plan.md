# Piano-roll velocity + controller-lane shell (Cubase-style)

Issue: `#249` (piano-roll enhancements). Status: **velocity lane shipped** (branch
`249-enhance-pianoroll`). First feature: **velocity** — built across three phases
(registry/helpers + persistence; standalone lane components; PianoRoll
integration). The lane shell is built generic so MIDI CC / pitchbend / aftertouch
lanes drop in later with no UI rewrite; the items under **Deferred** below are the
only remaining work. See the feature bullet in
`docs/completed/features/MIDI-Tracks-Plan.md` for the as-built summary.

## Context

Cubase's Key Editor docks a **controller-lane area** at the bottom of the piano
roll, under the note grid, separated by a draggable divider. It holds one or more
**stacked lanes**; each lane has a left **info panel** (a picker that chooses what
the lane shows — Velocity, CC1 Modulation, CC11 Expression, CC64 Sustain,
Pitchbend, …) aligned under the keyboard column, and a body aligned under the
grid that shares the grid's **horizontal** scroll & zoom but has **no vertical**
scroll.

**Velocity is special:** it is a *per-note property*, not a free event. Its lane
draws **one vertical bar per note**, bottom-anchored, height ∝ velocity, the bar's
left edge aligned to the note's start. CC lanes (future) are free events at time
positions and need new data-model + synth work.

Our piano roll today has no velocity/CC editing surface at all.

## What already exists (so velocity needs no plumbing)

Velocity is **already wired end to end** — this feature is a pure *editing
surface*, not new data/audio:

- `MidiNote.velocity` (0–1) — `src/types/midiClip.ts:19`.
- Scheduler passes it to the synth: `bus.synth.scheduleNote(instrument,
  note.pitch, note.velocity, when, duration)` — `midiPlaybackScheduler.ts:370`.
  Both synths use it as the voice peak gain (`WavetableSynth.ts:65`,
  `MidiSynth.ts:78`).
- Store mutation with the right shape **and** the live-drag/single-undo option
  already exists: `updateMidiNote(clipId, noteId, { velocity },
  { captureHistory })` — `midiClipSlice.ts:150`, `clipActionTypes.ts:52`. Live
  drags pass `captureHistory:false`; the final call captures one snapshot. This
  is the exact pattern the clip-resize handles use.
- The grid already tints notes by velocity (brightness) at `PianoRoll.tsx:1226`.

**CC does NOT exist** (`MidiClipData = { notes }`, no controller events; the synth
has no CC concept). That is deliberately out of scope here; the shell is shaped to
accept it later.

## Decisions (agreed with user)

1. **Forward-compatible stacked-lane shell** (not a one-off velocity strip): a
   lane-type registry + a persisted `lanes: string[]` so CC/pitchbend lanes drop
   in later with no UI rewrite. **Velocity is the only entry now, and the
   interactive `+ / −` add/remove picker is deferred** — the info column is a
   plain "Velocity" label for now (a one-entry picker is dead UI and costs LOC
   against the 700-ceiling). The *data shape* is generic so the real picker is a
   localized add when a second lane type exists. Lanes still stack vertically
   inside a height-resizable docked area.
2. **Drag a bar = move the selection.** If the dragged note is in the current
   selection, all selected notes move together; otherwise only that note moves
   (selection unchanged).
3. **Multi-drag is additive:** every selected note shifts by the **same delta**,
   each clamped to `[0,1]` at the rails. Differences are preserved until a note
   hits a rail (then it pins at 0/1 while the rest keep moving) — this is the
   standard Cubase behavior, and it is why each target clamps individually rather
   than the group clamping as one.
4. **Color by value:** both the lane bars **and the note bodies** are colored by
   velocity value (low→high), sharing **one** `velocity→color` mapping.
5. **0–127 everywhere** in the UI (MIDI standard) with a **numeric readout while
   dragging**, even though storage stays 0–1.
6. **Visible by default**, hideable, and **persistent** — both the show/hide flag
   and the area **height** survive across sessions (`settingsStore` persist).
7. **Deferred fast-follows** (documented, not built now): pencil **paint** sweep,
   **line/ramp** tool, and the CC/pitchbend lanes (data-model + synth work).

## Architecture

### Lane-type registry (forward-compatible)
`src/components/pianoRoll/controllerLanes/pianoRollLaneTypes.ts` (new):

```ts
interface LaneTypeDescriptor {
  id: string;                         // 'velocity', later 'cc1', 'cc11', 'pitchbend'
  label: string;                      // 'Velocity', 'CC1 Modulation', …
  kind: 'note-property' | 'cc';       // velocity is a per-note property
  min: number; max: number;           // display scale (velocity: 0–127)
}
const LANE_TYPES: LaneTypeDescriptor[] = [
  { id: 'velocity', label: 'Velocity', kind: 'note-property', min: 0, max: 127 },
];
```

Also holds the shared scale + color helpers (single source of truth, imported by
the grid too):
- `vel01ToMidi(v) = Math.round(clamp01(v) * 127)` / `midiToVel01(n) = n/127`.
- `velocityToColor(v01)` — a perceptual low→high ramp, readable on the `#181818`
  grid. **Selection-contrast decision (resolved):** the selected-note outline is
  amber `#ffd54a` (`PianoRoll.tsx:1227`), which *loses contrast* against a ramp
  that passes through yellow/orange at high velocity. So the ramp must **avoid
  yellow** — use a **blue→magenta/red** ramp (e.g. HSL hue ~210°→330°), not
  green→red/210°→0°. The amber selection ring then stays distinct at every
  velocity. (If a future ramp wants the yellow band, switch the selection
  indicator to a high-contrast white ring + the existing inset box-shadow
  instead.)

### Docked controller area
`src/components/pianoRoll/controllerLanes/PianoRollControllerArea.tsx` (new):

**Mounting — DO NOT mirror the ruler band as a wrapper row.** The ruler is a
`flexShrink:0` row *above* the body, but the horizontal scrollbar
(`PianoRollScrollbars`) lives **inside** the body, pinned `bottom:0`, and the
scroll viewport is inset by `bottom: PIANO_ROLL_SCROLLBAR` (`PianoRoll.tsx:1027`,
`:1155`). A wrapper-level row after the body would land the lane **below** the
horizontal scrollbar — wrong order, wrong UX (Cubase docks the lane *above* the
h-scrollbar). Instead, add the area as a **third absolutely-positioned band
inside the existing body `<div>`**:

- velocity area: `position:absolute; left:0; right:PIANO_ROLL_SCROLLBAR;
  bottom:PIANO_ROLL_SCROLLBAR; height:areaH` (so it sits directly above the
  existing horizontal scrollbar).
- grow the scroll viewport's bottom inset from `PIANO_ROLL_SCROLLBAR` →
  `PIANO_ROLL_SCROLLBAR + areaH` so the grid shrinks to make room.
- leave `PianoRollScrollbars`' horizontal bar **untouched** at `bottom:0` (it
  correctly ends up below the lane); shorten the **vertical** scrollbar's bottom
  to `PIANO_ROLL_SCROLLBAR + areaH` (the lane has no vertical scroll, so the
  v-bar must stop at the lane's top edge).

This is more minimal than a wrapper row and needs zero change to the h-scrollbar.

**Playhead through the lane is free — keep it.** The single continuous playhead
overlay already spans `top:0; bottom:PIANO_ROLL_SCROLLBAR` over the wrapper and
rides `playheadFollowRef` (translateX = `-scrollLeft`, width `gridWidth`, left
`KEYBOARD_W+1`) — `PianoRoll.tsx:1310`. With the band placed as above, the
playhead line continues straight down through the velocity lane automatically
(identical horizontal extent + follow transform), exactly like Cubase. **Do not**
clamp the overlay's `bottom` to exclude the lane — leaving it as-is is the
correct behavior, not a bug.

- Left **info column** fixed at `KEYBOARD_W` (48px). For now render it as a
  **plain label** ("Velocity") + the value scale — NOT a working `+ / −`
  add/remove picker or dropdown. The registry (`LANE_TYPES`) and the persisted
  `lanes: string[]` shape stay fully generic so the real picker is a localized
  add when a second lane type (CC) actually exists; building the interactive
  picker now is dead UI with one entry and costs LOC we don't have (see the
  700-LOC note under Files).
- A **scroll-follow track**, width `gridWidth`, slid by the viewport's
  `scrollLeft` via the **same imperative `translateX` pattern as the ruler /
  playhead** — add a `velocityFollowRef` updated inside the existing
  `handleGridScroll`/`syncRulerScroll` path (no React state on scroll → notes
  don't re-render).
- A **top drag divider** to resize the area height (and per-lane dividers when
  stacked). Its mousemove/up listeners go on the lane's **`ownerDocument`** (the
  popup), same as every other drag here, and `height` is clamped to a sane
  `[min, max]` so the lane can't collapse or balloon past the viewport. Height +
  which lanes are shown come from `settingsStore`.

### Velocity lane
`src/components/pianoRoll/controllerLanes/PianoRollVelocityLane.tsx` (new):
- Renders **one DOM `div` bar per in-window note** (NOT a canvas — DOM divs match
  how notes already render and dodge the Mesa silent-blank class for GPU canvases;
  see CLAUDE.md §9). Bar geometry mirrors the grid note exactly:
  `left = marginPx + contentTimeToClipLocal(effWindow, note.start) * pxPerSec`,
  bottom-anchored, `height = clamp01(velocity) * laneInnerH`,
  `background = velocityToColor(velocity)`. Out-of-window notes shown dimmed
  (mirror the grid's out-of-window treatment). **Ghost notes are skipped entirely
  here AND stay grey in the grid** — they belong to *other* clips (#232) and must
  read as "not yours"; velocity-coloring them would make them compete with the
  real notes (see the Files note — do NOT recolor ghost fills).
- Backgrounds are **solid fills, no repeating gradients** on the full-`gridWidth`
  track (Mesa tiling seam guard, CLAUDE.md §9).

### Drag interaction (one undo per gesture)
1. **mousedown** on a bar → capture `startY`, and the **target set**: if the note
   is in `selectedIds`, all selected notes; else just this note. Snapshot each
   target's starting velocity.
2. **mousemove** → `delta = (startY - curY) / laneInnerH` (full lane height = full
   0–1 swing). For each target: `updateMidiNote(clipId, id,
   { velocity: clamp01(start_i + delta) }, { captureHistory:false })`. Show a
   numeric readout = `vel01ToMidi(draggedNoteVelocity)` near the cursor / in the
   info column.
3. **mouseup** → one committing `updateMidiNote(... draggedId ...)` (default
   `captureHistory`) so the whole gesture is a **single** undo step. Listeners go
   on the **popup's document** (the piano roll runs in a detached window — see the
   existing note at `PianoRoll.tsx:686`) so mouseup actually fires.

### Persistence
`src/stores/settingsStore.ts` — add a small forward-compatible blob + setter,
included in `partialize` (localStorage):

```ts
pianoRollControllerArea: {
  visible: boolean;        // default true
  height: number;          // px, default ~96
  lanes: string[];         // ordered lane-type ids shown; default ['velocity']
};
setPianoRollControllerArea(patch: Partial<…>): void;
```

`lanes` already supports the future stacked CC lanes without a schema change.

## Files

- `src/components/pianoRoll/controllerLanes/pianoRollLaneTypes.ts` (new) —
  registry + scale/color helpers.
- `src/components/pianoRoll/controllerLanes/PianoRollControllerArea.tsx` (new) —
  docked area, info column, scroll-follow track, height divider, lane picker.
- `src/components/pianoRoll/controllerLanes/PianoRollVelocityLane.tsx` (new) —
  bars + drag/readout interaction.
- `src/components/pianoRoll/PianoRoll.tsx` — **minimal** additions only: mount the
  area inside the body band per the Architecture mounting note (grow the viewport
  bottom inset by `areaH`), add `velocityFollowRef` to the existing scroll
  handler, pass geometry (`pxPerSec`, `marginPx`, `effWindow`,
  `contentTimeToClipLocal`), notes, `selectedIds`, `updateMidiNote`; swap the note
  body fill at `:1226` **and the out-of-window note fill at `:1172`** to
  `velocityToColor`. **Leave the ghost-note fill (`:1191`) grey** — see the
  velocity-lane note.
  **700-LOC ceiling — this is a real CI risk, not a footnote.** PianoRoll.tsx is
  already **1335 LOC**, far over the 700 ceiling (a reconciled ratchet that
  forbids growth). Every addition here nets lines. Mitigations, in order: keep
  `velocityToColor`/`vel01ToMidi`/`midiToVel01` in `pianoRollLaneTypes.ts`
  (imported, never inlined); keep ALL lane DOM + drag logic in the new files; and
  if the net add still trips the ratchet, extract one self-contained existing
  block out of PianoRoll.tsx to stay flat (candidates: the ~70-line keyboard-column
  render, or the `ToolButton` component). Budget for this — don't discover it at
  commit time.

## Verification

1. `npx tsc -b` clean; eslint clean on touched files; `npm run test` for the
   focused MIDI/piano-roll suites. **Confirm the 700-LOC ceiling ratchet on
   `PianoRoll.tsx` still passes** (apply the extraction mitigation if the net add
   trips it — see Files).
2. Open a MIDI clip's piano roll → velocity lane visible by default under the
   grid; bars line up x-wise with their notes; bar height + note body color track
   velocity; both read on the 0–127 scale.
3. Drag a bar up/down → live preview, numeric readout shows 0–127, **one** undo
   restores it.
4. Select several notes, drag one of their bars → all selected shift by the same
   amount (differences preserved, clamped at 0/127); one undo restores all.
5. Drag an **unselected** note's bar → only that note changes; selection unchanged.
6. Resize the area via the divider and toggle hide/show → both persist across a
   reload.
7. Horizontal scroll/zoom: bars stay aligned under their notes (follow track
   matches the ruler); out-of-window notes show dimmed bars, no edit.
8. Playhead: the cursor line runs as ONE continuous line from the ruler, through
   the grid, and down through the velocity lane (no seam/gap at the lane's top);
   the h-scrollbar sits below the lane, the v-scrollbar stops at the lane's top.
9. Ghost notes (from other overlapping clips) stay grey in the grid and have no
   bar in the lane.
10. Linux/Mesa: lane renders (DOM divs, solid fills) — no blank band at zoom.

## Deferred (fast-follows, same plumbing)

- **Interactive lane picker** — the `+ / −` add/remove + lane-type dropdown over
  `LANE_TYPES`, landing with the first non-velocity lane (the registry +
  `lanes: string[]` already accommodate it).
- **Pencil paint** — click-sweep horizontally to set many bars in one stroke
  (one undo per stroke).
- **Line/ramp tool** — drag a straight line for a linear velocity ramp.
- **CC / pitchbend / aftertouch lanes** — needs `MidiClipData.controllers[]`
  (clip-relative events), `IMidiSynth` control application (CC11→gain, CC64→note
  hold, CC1→mod, pitchbend), and scheduler support. The registry + `lanes[]`
  persisted shape already accommodate the UI side.
