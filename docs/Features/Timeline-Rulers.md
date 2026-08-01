[Back to Docs](./README.md)

# Multi-Ruler Infrastructure

The timeline ruler is a stack of coexisting ruler lanes (Time / Timecode /
Frames / Bars+Beats / Tempo), chosen from the **Rulers** checklist (left of the
View dropdown) and persisted per composition. Bars+Beats is driven by an
editable TempoMap. Issue: #257.

---

## Reused by the piano roll (issue #249)

The piano-roll editor builds its own **Bars + Time ruler and tempo-synced grid**
on this foundation. It reads the **same `TempoMap`** (`selectTempoMap`) and calls
the **same pure tick generators** (`iterateBarBeatLines`, `createBarsLaneTicks`,
`createLinearLaneTicks`, plus the shared `formatTimelineClock`), so bar numbers
and timecodes are **identical to the timeline** at the same musical positions. It
does **not** reuse `TimelineRuler.tsx` (coupled to cache ranges / video-bake
regions / active-lane selection and has no left keyboard column) — only the
generators. The adapter (`components/pianoRoll/pianoRollGrid.ts`) bridges the
piano roll's clip-local x-axis to absolute musical time. The piano-roll ruler
uses an independent horizontal zoom, so only spacing differs; the numbers match
by construction. See `docs/completed/features/MIDI-Tracks-Plan.md`.

---

## Background: how professional DAWs do it

DAWs separate two concepts:

- **Timebase rulers** — linear formats that are pure functions of time: seconds,
  timecode (HH:MM:SS:FF), samples, frames. Evenly spaced in pixels.
- **A Conductor / Tempo map** — the structure that makes **Bars+Beats** possible.
  Bars+beats is *not* a linear ruler; it is time projected through a sorted list
  of tempo + time-signature events. Cubase auto-creates a hidden Tempo track and
  Signature track; every bars-related display reads from them.

Key insight (clearest in Ardour's time model): once tempo can vary you **cannot**
convert beats—seconds with a single arithmetic formula — you must walk the tempo
map segment by segment, because a "distance of 4 beats" is a different number of
seconds depending on where it sits. Cubase's UX for "see them all" is **Ruler
Tracks**: stacked, independent ruler rows that scroll and zoom together.

References: Cubase Ruler Display Formats; Cubase Independent Time Displays;
Cubase Ruler Tracks; Ardour "Representing Time"; Pro Tools tempo maps.

## What we have today

- `src/components/timeline/TimelineRuler.tsx` renders one 30px DOM
  `.ruler-lane` row per enabled lane (not canvas), only for the visible window
  (viewport + overscan, dpr-aligned). Time, Timecode and Frames use
  `createLinearLaneTicks`; Bars+Beats uses `createBarsLaneTicks`; Tempo renders
  editable flags through `components/TempoRulerLane.tsx`. Its context menu adds,
  edits, ramps or deletes tempo/time-signature changes; non-project flags drag
  to bar positions (Alt allows free placement).
- `src/components/timeline/utils/timelineGrid.ts` keeps the legacy zoom-driven
  `createTimelineGridPlan()` for the non-musical body grid, while fixed-format
  lane tick generators are separate. `src/timeline/tempo/barsGrid.ts` supplies
  the TempoMap-driven body grid and its Bar / Beat / 1/8 / 1/16 / triplet
  subdivisions when Bars+Beats is enabled.
- The menu/chrome lives in
  `src/components/timeline/components/TimelineRulerHeaderChrome.tsx` (note the
  `components/` segment), which renders `TimelineControls` + `TimelineRuler`
  inside `.ruler-header` / `.time-ruler-wrapper`; the CSS height is lane-count ×
  30px.
- Individual lanes have fixed formats. The separate toolbar time/frames readout
  remains.
- Per-composition persistence round-trips through **three** explicit field lists:
  the runtime `TimelineState` (where the slice lives) →
  `CompositionTimelineData` (`createSerializableTimelineState`'s `Pick<>` in
  `src/stores/timeline/serialization/serializableTimelineState.ts`) →
  `ProjectComposition` (`projectSave.ts` + `load/loadTimelineHydration.ts`).
  `markers` is threaded through all three; the ruler fields are too, so they do
  not drop on composition-switch (which round-trips through
  `CompositionTimelineData`, not just file save/load).
- `historyStore` snapshots `markers` / `clips` / `tracks` and `tempoMap` via
  explicit field lists in `snapshotCapture.ts` / `snapshotApply.ts` /
  `historyStoreTypes.ts`. Ruler lanes and active-lane selection remain view state.
- `ProjectComposition` (`src/services/project/types/composition.types.ts`) has
  optional `tempoMap`, `rulerLanes` and `activeRulerLaneId` for compatibility
  with project files that omit them.
- Snapping (`src/stores/timeline/positioningUtils.ts` `getSnappedPosition`) snaps
  to clip edges, playhead and 0; when Bars+Beats is enabled it also snaps to the
  visible TempoMap grid subdivision.

## Data model

The feature is three fields on `ProjectComposition`, beside the existing
`markers`:

```text
tempoMap: { events: [{ id, time: 0, bpm: 60, numerator: 4, denominator: 4,
                       curve?: 'jump' | 'ramp' }] }
          // >= 1 event, sorted and unique by time; the first is pinned at 0.

rulerLanes: [{ id, format }]
          // ordered top -> bottom. format in 'time' | 'timecode' | 'frames' | 'bars' | 'tempo'.
          // UNIQUE per format (no duplicates — two identical rulers are pointless).

activeRulerLaneId: string | null
          // selected non-Tempo lane, used only for the lane highlight.
```

The add action enforces at most one lane per `format`. Enabling a format already
present is a no-op. The lane list is therefore an **ordered set of enabled
formats**; the menu is a checklist; stacking order is the list order.
