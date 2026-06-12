[Back to Docs](./README.md)

# Multi-Ruler Infrastructure (Integration Plan)

**Status:** Planned — not yet implemented. This document is the agreed design and
work-packet breakdown for turning the single timeline ruler into a stack of
coexisting ruler lanes. Issue: #257 (different rulers for frame / bars / time —
see them all and snap to the one clicked).

---

## Goal

Turn the single time ruler into a **stack of coexisting ruler lanes** (Time,
Timecode, Frames, Bars+Beats), choosable from a small menu, persisted
per-composition. Bars+Beats is driven by a **TempoMap** that is a constant
4/4 @ 60 BPM today but list-of-events-ready for future tempo / time-signature
changes at arbitrary points.

This phase ships **no grid/snap behavior** — it only stores an
`activeRulerLaneId` so a future grid knows which lane is authoritative ("snap to
the one clicked").

## Background: how professional DAWs do it

DAWs separate two concepts:

- **Timebase rulers** — linear formats that are pure functions of time: seconds,
  timecode (HH:MM:SS:FF), samples, frames. Evenly spaced in pixels.
- **A Conductor / Tempo map** — the structure that makes **Bars+Beats** possible.
  Bars+beats is *not* a linear ruler; it is time projected through a sorted list
  of tempo + time-signature events. Cubase auto-creates a hidden Tempo track and
  Signature track; every bars-related display reads from them.

Key insight (clearest in Ardour's time model): once tempo can vary you **cannot**
convert beats↔seconds with a single arithmetic formula — you must walk the tempo
map segment by segment, because a "distance of 4 beats" is a different number of
seconds depending on where it sits. Cubase's UX for "see them all" is **Ruler
Tracks**: stacked, independent ruler rows that scroll and zoom together.

References: Cubase Ruler Display Formats; Cubase Independent Time Displays; Cubase
Ruler Tracks; Ardour "Representing Time"; Pro Tools tempo maps.

## What we have today

- `src/components/timeline/TimelineRuler.tsx` — a **single** 30px row of DOM
  `<div>` markers (not canvas), rendering only the **visible window**
  (viewport + overscan, dpr-aligned). Mesa-safe; we keep this pattern.
- `src/components/timeline/utils/timelineGrid.ts` — `createTimelineGridPlan()`
  derives "nice" intervals from `zoom + frameRate`. **Important:** it does *not*
  cleanly separate "which format to show" from "tick density." It picks a single
  `mode: 'frame' | 'time'` from zoom (`frameWidthPixels` vs `MIN_FRAME_LINE_PX`)
  and crossfades between the two via `frameGridOpacity` / `timeGridOpacity`. And
  `TimelineRuler` gates label rendering on `gridPlan.mode === 'time'` /
  `=== 'frame'`. There is no "timecode" lane today — timecode is just a label
  style used *inside* frame mode (`formatTimelineTimecode`). So the linear
  formats are **not** drop-in reusable as independent always-on lanes; see
  Packet 4.
- The menu/chrome lives in
  `src/components/timeline/components/TimelineRulerHeaderChrome.tsx` (note the
  `components/` segment), which today renders `TimelineControls` + the single
  `TimelineRuler` inside `.ruler-header` / `.time-ruler-wrapper`.
- `displayMode` is a single global `'time' | 'frames'` toggle, not a stack. Its
  fate once lanes exist must be decided (see Packet 5): the explicit time/frames
  lanes subsume it, so the global toggle should be deprecated/removed rather than
  left to fight the per-lane formats.
- Per-composition persistence round-trips through **three** explicit field lists,
  not one: the runtime `TimelineState` (where the slice lives) →
  `CompositionTimelineData` (`createSerializableTimelineState`'s `Pick<>` in
  `src/stores/timeline/serialization/serializableTimelineState.ts`) →
  `ProjectComposition` (`projectSave.ts` + `load/loadTimelineHydration.ts`).
  `markers` is threaded through all three; the new fields must be too, or they
  silently drop on composition-switch (which round-trips through
  `CompositionTimelineData`, not just file save/load).
- `historyStore` snapshots `markers` / `clips` / `tracks` via explicit field
  lists in `snapshotCapture.ts` / `snapshotApply.ts` / `historyStoreTypes.ts`.
  Undo participation for the new fields is a deliberate decision (see Packet 3).
- `ProjectComposition` (`src/services/project/types/composition.types.ts`) has
  `frameRate, duration, tracks, clips, markers` — **no tempo, no time signature**.
- Snapping (`src/stores/timeline/positioningUtils.ts` `getSnappedPosition`) snaps
  to clip edges + playhead + 0. **There is no grid snapping yet** — matches the
  "forget the grid for now" scope.

## Data model

The entire feature is three fields on `ProjectComposition`, beside the existing
`markers`:

```text
tempoMap: { events: [{ time: 0, bpm: 60, numerator: 4, denominator: 4 }] }
          // >= 1 event, sorted by time. One segment now; N segments later.

rulerLanes: [{ id, format }]
          // ordered top -> bottom. format in 'time' | 'timecode' | 'frames' | 'bars'.
          // UNIQUE per format (no duplicates — two identical rulers are pointless).

activeRulerLaneId: string | null
          // which lane a future grid/snap will follow. Set by clicking the lane body.
```

Invariant enforced in the add-action: at most one lane per `format`. Enabling a
format already present is a no-op. The lane list is therefore effectively an
**ordered set of enabled formats**; the menu is a checklist; stacking order is the
list order.

## Out of scope (this phase)

- Grid snapping behavior (we only store the active lane; no snap logic).
- Tempo / time-signature *editing* UI and multiple tempo segments.
- Drag-to-reorder lanes; per-lane frame-rate variants; lane colors.
- Canvas migration — stays DOM, stays viewport-windowed (Mesa rule).

---

## Work packets

Each packet is bounded: explicit write set, focused `vitest` + `tsc -b`, short
report. Full `build`/`lint`/`test` only at the end before any merge.

### Packet 1 — Schema + defaults + load/save — ✅ Implemented
Done. Canonical runtime types `RulerLaneFormat` / `RulerLane` / `TempoEvent` /
`TempoMap` live in `src/types/timeline.ts` (re-exported from `src/types/index.ts`)
with three optional fields on `CompositionTimelineData`; project-tier mirrors
`ProjectTempoMap` / `ProjectTempoEvent` / `ProjectRulerLane` + three optional fields
on `ProjectComposition`; three **required** fields on the runtime `TimelineState`.
The migration is the pure module `src/timeline/tempo/rulerDefaults.ts`
(`createDefault*` + `normalizeRulerLaneState`, which dedupes lanes by format and
repoints an invalid `activeRulerLaneId`); it is wired into the store init, the
serialize/`loadState` round-trip (both branches — the comp-switch seam), project
save/load, and the three composition factories. Old projects get defaults on load
(no version bump). `historyStore` is deliberately untouched (lane state is view
state — see Packet 3). Covered by `tests/unit/rulerDefaults.test.ts`.

Original spec:
- New types `ProjectTempoMap`, `ProjectTempoEvent`, `ProjectRulerLane` in
  `timeline.types.ts`; add the three fields to `ProjectComposition`.
- Thread the three fields through **all** persistence touchpoints (they are
  separate explicit field lists, easy to miss one):
  - runtime store initial state + `TimelineState` type (`stores/timeline/index.ts`
    + `stores/timeline/types`);
  - `CompositionTimelineData` + the `Pick<TimelineState, …>` and the return object
    in `serialization/serializableTimelineState.ts` (mirror the `markers` line);
  - `projectSave.ts` (near where `markers` is mapped) and
    `load/loadTimelineHydration.ts` (mirror the `markers` map).
- Default injection where compositions are created and on load/restore. Missing
  fields default to: `tempoMap` = single 4/4@60 event; `rulerLanes` = `[{time}]`;
  `activeRulerLaneId` = the time lane. This *is* the migration — old projects just
  get defaults; no version bump needed.
- **Check:** load an old project fixture → fields present and sane; switch
  compositions and back → lanes survive (proves the `CompositionTimelineData`
  round-trip, not just file load).

### Packet 2 — TempoMap pure module — ✅ Implemented
Done. `src/timeline/tempo/TempoMap.ts` exports `secondsToBarBeat`,
`barBeatToSeconds`, and `iterateBarBeatLines`, built on a segment walk over the
events (continuous monotonic "bar phase"; BPM = quarter-notes/min, a beat =
4/denominator quarter notes). Single 4/4@60 reduces to bar N at (N-1)*4s with
beats on integer seconds; multi-segment tempo and meter changes convert across
the boundary. Covered by `tests/unit/tempoMap.test.ts`.

Original spec:
- New `src/timeline/tempo/TempoMap.ts` (pure, no runtime handles — satisfies the
  durable-store rules; sits beside `geometry/` and `projection/`). Functions:
  `secondsToBarBeat(map, t)`, `barBeatToSeconds(map, bar, beat)`,
  `iterateBarBeatLines(map, startT, endT) -> { time, bar, beat, isBarStart }[]`.
- Implemented as a segment walk over `events` (works for 1 or N segments). The
  single-segment case reduces to arithmetic, but the loop is already general.
- **Check:** unit tests — 4/4@60 puts bar N at `(N-1)*4s`, beats at integer
  seconds; a hand-written 2-segment map converts correctly across the boundary.

### Packet 3 — Ruler store slice — ✅ Implemented
Done. `src/stores/timeline/rulerSlice.ts` provides `addRulerLane` (no-op if the
format is present; returns the lane id), `removeRulerLane` (repoints the active
lane if it was removed), `setActiveRulerLane` (validates the id; accepts null),
and `reorderRulerLanes` (the future drag-reorder seam). Lanes are kept in
canonical stacking order (`time → timecode → frames → bars`) via `toSorted()`;
ids are the deterministic `ruler-lane-<format>` (shared `rulerLaneIdForFormat`
in `rulerDefaults`). Wired into the store index, `selectors.ts`
(`selectRulerLanes` / `selectActiveRulerLaneId` / `selectTempoMap` +
`selectRulerLaneActions`), and the test store factory. Lane state is **excluded
from `historyStore`** (view state) — confirmed absent from the snapshot field
lists. Covered by `tests/stores/timeline/rulerSlice.test.ts`.

Original spec:
- New `src/stores/timeline/rulerSlice.ts`, mirroring `markerSlice.ts` but using
  `toSorted()` (not `.sort()` — `markerSlice` predates the rule; don't copy the
  debt): `addRulerLane(format)` (no-op if format present), `removeRulerLane(id)`,
  `setActiveRulerLane(id)`, `reorderRulerLanes(...)` (action present for the
  future; no UI yet). Wire into the store index + `selectors.ts`.
- **Undo decision (must be explicit):** lane toggles + `activeRulerLaneId` are
  *view* state → **exclude** from `historyStore` snapshots. A future `tempoMap`
  *edit* is *content* → it **must** be added to `snapshotCapture` /
  `snapshotApply` / `historyStoreTypes` when that editing lands. Record this
  choice here so the omission is intentional, not silent.
- **Check:** add/remove/uniqueness/active-selection unit tests; an undo across a
  lane toggle does not resurrect/clobber the lane set.

### Packet 4 — Ruler rendering (core) — ✅ Implemented
Done. Format-selection is decoupled from tick-density: `timelineGrid.ts` adds the
pure `createLinearLaneTicks` (time / timecode / frames — fixed format, density
only, no frame↔time crossfade) and `createBarsLaneTicks` (projects the window
through `iterateBarBeatLines`, thinning beats/bars by pixel spacing). The old
`createTimelineGridPlan` is untouched and still drives the timeline *body* grid
(`TimelineTrackGridCanvas`), not the ruler. `TimelineRuler.tsx` now renders one
`.ruler-lane` row per lane (each keeping the viewport-window + overscan + dpr
logic), driven by `lanes` / `tempoMap` / `activeRulerLaneId` props;
`TimelineRulerHeaderChrome` reads those from the store (via `selectRulerLanes` /
`selectTempoMap` / `selectActiveRulerLaneId`) so the ruler stays a pure, testable
component. `.ruler-lane` base CSS added; container height stays 30px (single
default lane) until Packet 5. The old `displayMode` prop is ignored (retired in
Packet 5). Covered by `tests/unit/timelineRulerLanes.test.ts`. **Visually inert
until Packet 5** — the default single Time lane renders identically; the menu is
needed to add a second lane and to grow the container height.

Original spec:
- **This is not "reuse today's logic."** `createTimelineGridPlan` currently
  couples *format selection* with *tick density* (the `mode: 'frame' | 'time'`
  pick + the opacity crossfade), and `TimelineRuler` gates labels on
  `gridPlan.mode`. Decouple it: given a **fixed** lane format, compute only the
  "nice" tick interval(s) at the current zoom — no frame↔time crossfade for an
  explicit lane (a `frames` lane always shows frames, a `time` lane always shows
  time; density adjusts, format does not). The existing zoom-driven crossfade is
  the *old single-row* behavior and is dropped for per-lane rendering.
- Linear formats `time` / `timecode` / `frames` each get their own density +
  label routing (`timecode` is new as a standalone lane — today it only exists as
  a label style inside frame mode). Add a **bars plan generator** that calls
  `iterateBarBeatLines` over the visible window (variable pixel spacing ready;
  constant now). Label formatters: `bar.beat` for bars; reuse
  `formatTimelineTimecode` / `formatTimelineFrameNumber` / `formatTime`.
- `TimelineRuler.tsx` renders **one row per lane** via `.map()` over `rulerLanes`,
  each row keeping the visible-window + overscan + dpr-align logic.
  `TimelineRulerProps` (`types.ts`) gains `lanes` + `tempoMap` +
  `activeRulerLaneId`; `TimelineRulerHeaderChrome.tsx` and `Timeline.tsx` pass
  them from the store.
- **Check:** focused render test — a 2-lane (time+bars) stack emits both tick
  sets; bars labels land at the right pixels for 4/4@60.

### Packet 5 — Menu + layout
- Small checklist dropdown in the `.ruler-header` control strip
  (`components/TimelineRulerHeaderChrome.tsx`) toggling each format →
  `add/removeRulerLane`.
- **Retire the global `displayMode` toggle** here: the explicit time/frames lanes
  subsume it. Remove (or no-op) the old `'time' | 'frames'` control rather than
  leaving it to compete with per-lane formats; clean up the now-unused
  `displayMode` plumbing through `TimelineRuler` props.
- `Timeline.css`: `.time-ruler-wrapper` / `.time-ruler-container` / `.ruler-header`
  height moves from fixed `30px` to `lanes.length × 30px` (CSS var or inline) so
  the header column and ruler stay aligned.
- **Check:** toggling formats adds/removes rows and the header height tracks;
  build + lint.

### Packet 6 — Active-lane selection (hook only)
- Clicking a lane sets `activeRulerLaneId`; active lane gets a subtle highlight
  class. **No snap behavior** — this is the seam the future grid reads.
- **Disambiguation from scrub (must be concrete):** the whole ruler is
  `onMouseDown={onRulerMouseDown}` (scrub) today, and a bare click already
  scrubs. Pick an explicit rule — e.g. select-lane fires on the lane's left
  label/gutter zone while drag-anywhere still scrubs, or scrub stays on
  mouse-move and a click-without-drag on the lane body selects. Do not leave it
  to "distinct from scrub" hand-waving.
- **Check:** click selects, highlight moves; scrubbing/playhead drag still works.

### Packet 7 — Docs
- Update this document from "Planned" to "Implemented" with final specifics; note
  the entry in `README.md` and cross-link from `Timeline.md`.

## Sequencing / parallelism

`1 → 2 → 3` foundation (1 unblocks all; 2 and 3 run in parallel after 1, disjoint
write sets — dispatchable as parallel workers). `4` depends on 2+3. `5` depends on
3+4. `6` depends on 4. `7` last.

## Verification gates

Focused `vitest` + `tsc -b` per packet; full `build`/`lint`/`test` only before
merge (project rules). DOM-only and viewport-windowed throughout — no new Mesa
exposure.

## Faster spike option (not recommended)

Packets 2 + 4 alone (TempoMap + a hardcoded `[time, bars]` stack, no
menu/persistence) would put a working dual ruler on screen fast. **But skip it.**
The spike's only value is "see pixels early," and Packet 4 is exactly where the
single hard refactor lives (decoupling format from tick density in
`timelineGrid`). A hardcoded-stack spike forces that refactor anyway while
throwing away the cheap foundation underneath it. Go straight down
`1 → 2/3 → 4`: the foundation is nearly free, and you pay the hard part once,
with the schema/slice already in place.
