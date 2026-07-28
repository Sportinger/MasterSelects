[Back to Docs](./README.md)

# Tempo, Time Signature And Metronome

**Status:** Implemented (issue #299). Builds on the read-only TempoMap shipped by
[Timeline Rulers](./Timeline-Rulers.md) (#257) and makes it **editable**, makes
tempo drive the **timeline grid and snapping**, makes **MIDI content follow tempo
changes**, and adds a **metronome click**.

---

## What you can do

| Action | Where |
|---|---|
| Show the tempo track | **Rulers → Tempo** — a lane under Bars + Beats |
| Add a tempo or meter change | Right-click the Tempo lane → **Add tempo change** / **Add time signature change** |
| Change an existing one | Right-click its flag → **Change tempo** / **Change time signature** |
| Ramp instead of jump | Right-click its flag → **Ramp from previous tempo** |
| Move a change | Drag its flag (snaps to bars; **Alt** for free placement) |
| Delete a change | Right-click its flag → **Delete** |
| Bar/beat grid behind clips | Enable **Rulers → Bars + Beats** |
| Grid resolution | **Rulers → Bars + Beats → `+`** — Bar / Beat / 1/8 / 1/16 / triplets |
| Metronome | The metronome button right of **Rulers**; its caret opens volume and Every beat / Bars only |

The **project tempo** is the first flag, pinned at the start of the timeline. Its
BPM and meter are editable; it cannot be moved, deleted, or made a ramp — there
is no earlier tempo to glide from, and the map must never be empty.

The tempo lane also appears in the **piano roll**, above its Bars ruler, as a
read-only mirror. It follows the same Rulers → Tempo toggle.

---

## The model

Three ideas carry the whole feature. Each one is a decision that was wrong at
least once during implementation, so the reasoning matters more than the code.

### 1. BPM sets duration; the time signature only groups

A quarter note's duration comes from the BPM. The time signature says how beats
are grouped into bars and which note value is counted — it changes no duration.

So **content is anchored to its quarter-note position**, not to its (bar, beat)
address. Anchoring to bar/beat meant that switching 4/4 → 3/4 at the same tempo
re-addressed every note and physically moved it (a note at 6 s slid to 5 s),
leaving the bars ruler out of sync with the content under it. With quarters:

- a meter change moves **nothing**, for any meter, including 6/8 where the
  counted beat changes from a quarter to an eighth;
- a tempo change moves content by the tempo ratio alone;
- both at once move content by the tempo ratio only.

`remapAcrossMaps` in `src/timeline/tempo/tempoRemap.ts`.

### 2. MIDI is musical; media is linear

Changing the tempo rewrites MIDI clip windows, note starts/durations and the
four CC automation lanes, so a melody written at 120 stays on its bars at 100.
Video, audio and image clips keep their seconds — a film edit must not reflow
because someone set a tempo. Both land in **one undo entry** with the tempo edit.

The test lives in one predicate, `trackFollowsTempo(track)`, which is the seam
for a future per-track `timebase: 'musical' | 'linear'` flag.

Durations are never scaled by a factor: an end is remapped and the remapped
start subtracted, which is the only correct answer across a tempo boundary.

### 3. A tempo mark is a musical object

A flag means "90 BPM **at bar 11**", not "at 40 seconds". Editing an earlier
tempo — or turning this one into a ramp — changes how long the preceding interval
takes, so the flag's **seconds** must move to keep its **bar**. Without that, a
ramp flag placed on bar 11 drifts to bar 11.5.

Every edit therefore re-anchors: each event's quarter position is read in the map
it was placed against, then the seconds are rebuilt under the new tempo profile.
One exception — an **explicitly set position wins**: a flag you drag or insert
lands exactly where you dropped it, or it would slide out from under the cursor.

`reanchorTempoEvents` in `src/timeline/tempo/tempoEdits.ts`.

---

## Ramps

A `ramp` event is *reached* by interpolation: the tempo glides linearly, in time,
from the previous event's BPM to this one across the interval leading into it.
A `jump` (the default) is an instant step.

This is not cosmetic. Beats stop accumulating at a constant rate, so
`TempoMap.ts` integrates a linearly varying tempo: elapsed beats are **quadratic**
in time, and the inverse (beat → seconds) solves that quadratic in closed form,
so it stays exact rather than iterating.

60 → 120 BPM over 8 s covers **12 beats**, not 8 — the average tempo — which is
why a ramp reaches bar 4 where a jump reaches bar 3. Beat lines get progressively
closer through an accelerando and further apart through a ritardando.

Everything downstream inherits it for free: the grid, snapping, the MIDI remap
and the metronome all read the same projection.

The lane shows a dashed sloped line across the ramped interval — rising for a
speed-up, falling for a slow-down — plus a ↗/↘ arrow on the flag.

---

## Grid and snapping

**An enabled Bars + Beats ruler wins the grid.** Enabling the lane is already the
user saying "I am working in bars"; requiring a second, invisible "active lane"
selection on top of that was the seam #257 stored but never used, and it is
retired. `activeRulerLaneId` now means only the lane highlight.

- Bars **replace** the time/frame grid rather than overlaying it.
- Lines thin by pixel spacing using the **same thresholds as the ruler ticks**, so
  the grid and the ruler above it can never disagree about what exists at a
  given zoom: subdivisions drop first, then beats, then bars go to every 2nd/4th.
- Snapping follows the identical rule, so you can only snap to a line you can see.

Grid snapping uses a **pixel-derived threshold** (10 px), not the fixed
`SNAP_THRESHOLD_SECONDS` used for clip edges and the playhead. A 1/16 at 120 BPM
is 0.125 s apart — narrower than that fixed window — so a seconds threshold would
leave grid snapping permanently engaged with overlapping capture zones. Shift
temporarily enables snapping when the toolbar toggle is off; Alt always bypasses
snapping entirely.

Both snap paths are covered: `getSnappedPosition` (clip drags) and
`resolveTimelineClipPointerTime` (tool-driven interactions).

---

## Metronome

A look-ahead scheduler (25 ms timer, 0.12 s window) built on the same pattern as
`midiPlaybackScheduler`: a timeline↔AudioContext anchor, re-anchor on a >0.25 s
seek, silence at non-1x speed, and a dedup set so a beat inside two consecutive
windows fires once.

Beat times come from `iterateBarBeatLines`, so the click tracks meter, mid-window
tempo changes and ramps with no extra math.

The voice is one oscillator plus a gain with a ~40 ms exponential decay —
1000 Hz at full level on the downbeat, 800 Hz at 0.7 otherwise. No assets.

**The click never touches the master bus.** It owns a `GainNode` wired directly to
`AudioContext.destination`; it shares the context via `ensureSharedContext()` but
never registers a node route, so it cannot enter master metering, the master
FX/limiter chain, or any master-bus tap. Export renders through a separate
offline path, so a live-only node is excluded structurally; an `isExporting`
guard sits on top of that.

Metronome settings (on/off, volume, beats vs bars) and the grid resolution are
**per-user localStorage view state**, never project content. Lane visibility, the
tempo map itself and the active lane are **project content** and persist per
composition.

---

## Data model

```ts
TempoEvent {
  id: string          // stable identity for editing, dragging and React keys
  time: number        // seconds; sorted ascending; the first event is pinned at 0
  bpm: number         // clamped to [20, 999]
  numerator: number
  denominator: number // 1 | 2 | 4 | 8 | 16 | 32
  curve?: 'jump' | 'ramp'   // absent reads as 'jump'
}
```

`id` and `curve` are optional in the durable project tier and backfilled on load
by `normalizeRulerLaneState`, so projects saved before this feature open
unchanged with no version bump.

The editable BPM range is **deliberately not** `MIN_TEMPO_BPM` / `MAX_TEMPO_BPM`
from `services/audio/beatOnset/beatGridEstimation.ts` (60 / 200). Those are
octave-folding bins for autocorrelation *detection*; reusing them would reject a
40 BPM largo and a 240 BPM drum'n'bass track.

Invariants live in one pure module and are enforced on every path — at least one
event, the first pinned at 0 and never a ramp, sorted and unique by time, unique
ids, clamped values. Writing onto an occupied bar replaces the event there.

---

## Where the code lives

| Piece | File |
|---|---|
| Tempo projection (bars, beats, quarters, ramps) | `src/timeline/tempo/TempoMap.ts` |
| Editing invariants + musical re-anchoring | `src/timeline/tempo/tempoEdits.ts` |
| Content remap (MIDI follows tempo) | `src/timeline/tempo/tempoRemap.ts` |
| Grid geometry + snap candidates | `src/timeline/tempo/barsGrid.ts` |
| Store actions (history-aware) | `src/stores/timeline/tempoSlice.ts` |
| Tempo lane UI | `src/components/timeline/components/TempoRulerLane.tsx` |
| Body grid canvas | `src/components/timeline/components/TimelineTrackGridCanvas.tsx` |
| Metronome scheduler / voice | `src/services/audio/metronomeScheduler.ts`, `src/engine/audio/metronomeVoice.ts` |
| Toolbar control | `src/components/timeline/MetronomeButton.tsx` |

Tempo edits are **content**, so every action captures a history snapshot — after
the mutation, matching the store's post-state model. Ruler lane toggles remain
view state and stay out of undo.

---

## Not included

- **Count-in.** A real pre-count sounds the click for N bars while content stays
  silent, which needs a new transport phase rather than a playhead roll-back;
  `play()` has nowhere for "running but not advancing". Deferred rather than
  bending playback for it.
- **A separate time-signature track.** Tempo and meter stay one event type; each
  event sets both.
- **Per-track timebase flag.** The predicate seam exists, the schema field
  does not.
- **Tap tempo** and **detect tempo from an audio clip** —
  `beatGridEstimation.ts` already estimates BPM from audio, so wiring "set the
  project tempo from this clip" is a cheap follow-up now that editing exists.
- **Ingesting a tempo map from an imported MIDI file.**
- **Audio time-stretching to follow tempo** — media stays linear by design.
- **Piano-roll note snapping.** Notes are free-placed by decision (#182); an
  optional snap-to-subdivision is an open question.
