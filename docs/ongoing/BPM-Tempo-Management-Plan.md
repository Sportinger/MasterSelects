[Back to Ongoing](./README.md)

# BPM / Tempo Management + Metronome (Plan)

**Status:** In progress — Packets 1, 2 and 4 landed; 3, 5, 6, 7 open.
Issue: #299. Branch: `299-add-bpm-management`.

Turns the read-only `TempoMap` shipped by issue #257 into an **editable tempo
track**, makes tempo actually drive the timeline **grid and snapping**, makes
**MIDI content follow tempo changes**, and adds a **Cubase-style metronome
click** with a toolbar toggle.

Nothing here rewrites the tempo math. `src/timeline/tempo/TempoMap.ts` is
already a correct N-segment conductor; this plan adds editing, propagation,
rendering and audio on top of it.

---

## 1. What already exists

Issue #257 (multi-ruler infrastructure) built the foundation and deliberately
stopped short of editing. See `docs/Features/Timeline-Rulers.md`.

| Piece | Where | State |
|---|---|---|
| Tempo math | `src/timeline/tempo/TempoMap.ts` | `secondsToBarBeat`, `barBeatToSeconds`, `iterateBarBeatLines`. Segment walk over a sorted event list; already correct for N tempo **and** meter changes, including a meter change off the downbeat. Pure, no runtime handles. |
| Data model | `src/types/timeline.ts` | `TempoEvent { time, bpm, numerator, denominator }`, `TempoMap { events }`, `RulerLane`, `RulerLaneFormat`. |
| Defaults / migration | `src/timeline/tempo/rulerDefaults.ts` | `createDefaultTempoMap()` = one 4/4 @ **60 BPM** event; `normalizeRulerLaneState()` backfills old projects on load. |
| Persistence | three explicit field lists | runtime `TimelineState` → `CompositionTimelineData` (`serialization/serializableTimelineState.ts`) → `ProjectComposition` (`projectSave.ts` + `load/loadTimelineHydration.ts`). |
| Store slice | `src/stores/timeline/rulerSlice.ts` | Lane add/remove/active/reorder. Lane state is **view** state, excluded from undo — with an explicit note that a future `tempoMap` *edit* is **content** and must opt into history. |
| Bars ruler | `createBarsLaneTicks` in `src/components/timeline/utils/timelineGrid.ts` + `TimelineRuler.tsx` | Bar/beat ticks projected through the tempo map; DOM divs, viewport-windowed, dpr-aligned (Mesa-safe). |
| Lane menu | `src/components/timeline/RulerLanesMenu.tsx` | "Rulers" checklist, rendered immediately before the View dropdown in `TimelineControls.tsx`. |
| Piano roll reuse | `src/components/pianoRoll/pianoRollGrid.ts` | Reads the same `selectTempoMap` and the same generators, so bar numbers match the timeline by construction. |

**Default tempo is 4/4 @ 60 BPM** — chosen so a bar is exactly 4 s and beats
land on integer seconds. It is a placeholder, not a musical default (see §8).

## 2. What is missing

1. **No editing.** `tempoMap` is written once from defaults. No action, no UI,
   no undo participation.
2. **Tempo does not drive the grid.** The timeline *body* grid
   (`TimelineTrackGridCanvas.tsx` → `createTimelineGridPlan({ zoom, frameRate })`)
   is purely frame/time based and never sees the tempo map. The ruler's bar
   lengths already follow tempo; the lines behind the clips do not.
3. **No grid snapping at all.** Two independent snap paths exist and both stop
   at clip edges, the playhead and 0: `getSnappedPosition`
   (`src/stores/timeline/positioningUtils.ts`, clip drags) and
   `resolveTimelineClipPointerTime`
   (`src/components/timeline/tools/pointer/timelineToolPointerDispatcher.ts`,
   tool-driven interactions, with its own threshold in pixels).
   `activeRulerLaneId` was built as the "which lane does the grid follow" seam
   and is currently read by nothing — and §3.5 retires it in favour of a simpler
   rule.
4. **No metronome.** Nothing in `src/services/audio/` or `src/engine/audio/`
   produces a click.
5. **Content is seconds-based.** `MidiNote.start` / `.duration` are seconds of
   *content* time (`src/services/midi/midiClipTiming.ts`), the four CC lanes in
   `TimelineClip.automation` share that same time base
   (`src/types/midiClip.ts:123`), and clips are placed in seconds. A tempo
   change today re-labels bars but moves nothing.

## 3. Decisions

### 3.1 Timebase: MIDI follows tempo, media does not

Chosen model (option 2 of three considered):

- **MIDI clips and their notes are musical.** Changing the tempo map rewrites
  their seconds through `old map → bar/beat → new map`, in the **same undo
  entry** as the tempo edit. A melody written at 120 stays on its bars at 100.
- **Video / audio / image clips are linear.** They keep their seconds. A film
  edit does not reflow because someone set a tempo.
- **No schema change for this.** Seconds stay the source of truth everywhere;
  the remap is a command, not a new storage format.

The "which content follows tempo" test lives in **one** pure predicate,
`trackFollowsTempo(track)` in `src/timeline/tempo/tempoRemap.ts`. Upgrading
later to Cubase's real model (a persisted per-track `timebase: 'musical' |
'linear'` flag, MIDI defaulting to musical) is then a one-line change in that
predicate plus the schema field — not a rewrite.

Trade-off accepted: repeated tempo edits accumulate float drift, because the
remap is lossy in the last bits. Mitigated by an exact-round-trip unit test
(120 → 60 → 120 restores within epsilon); not worth a stored beat position.

### 3.2 Tempo and meter stay one event type

`TempoEvent` already carries `bpm` **and** `numerator`/`denominator`. Cubase
splits these into a Tempo track and a Signature track. We keep them combined:
each event sets both, the flag reads `120 · 4/4`. Splitting means touching the
pure `TempoMap` walk and all three persistence tiers again for a case (meter
change at a different bar than a tempo change) that costs one extra event to
express today. Revisit only if that becomes annoying in practice.

### 3.3 Jump only, no ramps

Tempo changes are instant steps. Linear ramps (accelerando) would require the
segment walk to integrate over a varying tempo instead of dividing by a constant
`barSeconds` — real work in `TempoMap.ts`, and every consumer
(`iterateBarBeatLines` callers, the remap, the metronome) inherits it. Out of
scope; the event list stays forward-compatible with adding a `curve` field.

### 3.4 The click never touches the master bus

The metronome connects its own `GainNode` **directly to
`AudioContext.destination`**, sharing the context via
`audioRoutingManager.ensureSharedContext()` but *not* registering a node route.
Reasons: it must not enter master metering or the master FX/limiter chain, must
not be captured by any master-bus tap, and must never reach an export. Export
renders through a separate offline path, so a live-only node is excluded
structurally; an explicit `isExporting` guard is added anyway.

### 3.5 An enabled Bars ruler wins the grid

**The Bars+Beats lane being enabled is what switches the body grid to bars** —
not `activeRulerLaneId`. Enabling the lane is already the user saying "I am
working in bars"; making them additionally *select* it as the active lane to get
a matching grid is a second, invisible step, and the state where a Bars ruler
sits directly above a 5-second grid is simply wrong-looking (at 60 BPM the 4 s
bars and the 5 s time lines only coincide every 20 s).

Consequences:

- `TimelineTrackGridCanvas` switches to the tempo grid whenever a lane with
  format `'bars'` exists in `rulerLanes`; otherwise today's frame/time grid,
  unchanged.
- Bars **replace** the time/frame grid rather than overlaying it — one grid at a
  time, the DAW convention.
- Snapping follows the identical rule, so what you see is what you snap to.
- `activeRulerLaneId` therefore no longer drives the grid. It stays what it
  visibly is: the lane highlight. Issue #257 stored it as the "which lane does
  the grid follow" seam; that seam is retired here rather than kept as a second,
  hidden switch.

### 3.6 Metronome + grid settings are user preferences, not project content

`metronomeEnabled`, click volume, beats-vs-bars, count-in bars and the grid
subdivision are per-user view state. They follow the existing
`snappingEnabled` pattern exactly: a field on the timeline store, persisted via
`src/stores/timeline/viewPreferences.ts` (`readStored*` / `persist*`
localStorage helpers). They do **not** go into `ProjectComposition`.

## 4. Data model changes

Only one persisted field changes shape:

```text
TempoEvent {
  id: string          // NEW. Stable identity for drag/edit/React keys.
  time: number        // seconds; sorted ascending; first event pinned at 0
  bpm: number         // clamped to [MIN_TEMPO_BPM, MAX_TEMPO_BPM]
  numerator: number
  denominator: number
}
```

`id` is **required at runtime, optional in the project tier**
(`ProjectTempoEvent`), and backfilled by `normalizeRulerLaneState` for any
project saved before this feature — same shape of migration as #257 used, no
version bump.

Invariants, enforced in one pure module and covered by tests:

- at least one event; the first is pinned at `time === 0` and cannot be deleted
  or moved (it is the project tempo — its BPM/meter are editable);
- events sorted ascending by `time`, **unique** by time (inserting on an
  occupied bar replaces that event);
- `bpm` clamped to `[MIN_EDITABLE_TEMPO_BPM, MAX_EDITABLE_TEMPO_BPM]` = **[20,
  999]**, new constants living beside `tempoEdits.ts`. Do **not** reuse
  `MIN_TEMPO_BPM` / `MAX_TEMPO_BPM` from
  `src/services/audio/beatOnset/beatGridEstimation.ts`: those are `60` / `200`
  and exist as **octave-folding bins for autocorrelation detection**, not as a
  legal authoring range. Clamping the editor to them would block 40 BPM largo
  and 240 BPM drum'n'bass, and would park the current default (60) exactly on
  the lower boundary. The detection constants stay where they are and are
  relevant only to the future "set project tempo from this clip's detected beat
  grid" follow-up (§7), which clamps its *estimate* into the editable range;
- `numerator >= 1`, `denominator` in `{1,2,4,8,16,32}`.

`RulerLaneFormat` gains `'tempo'`; canonical stacking order becomes
`time → timecode → frames → bars → tempo` (tempo sits directly under the bars
ruler, as requested).

## 5. Work packets

Bounded per repo rules: explicit goal, write set, checks, short report.
Focused `vitest` + `npx tsc -b` per packet; full `build`/`lint`/`test` only
before merge.

### Packet 1 — Tempo editing core (store + invariants + undo) — **DONE**

**Goal:** the tempo map becomes editable content with correct undo.

**Landed 2026-07-27** (not committed). Full gate green on the working tree:
`npm run build`, `npm run lint`, `npm run test` (631 files / 5630 tests) all
pass. New files: `src/timeline/tempo/tempoEdits.ts`,
`src/stores/timeline/tempoSlice.ts`, `tests/unit/tempoEdits.test.ts`,
`tests/stores/timeline/{tempoSlice,tempoHistory}.test.ts`.

One extra bug surfaced while mutation-testing the undo suite and is fixed here:
`createHistoryTimelineRestoreState` feeds its result straight into the store's
shallow-merging `setState`, so returning `tempoMap: undefined` for a history
entry captured before #299 would have **clobbered the live tempo map** instead of
leaving it alone. It now falls back to `currentTimeline.tempoMap` — which is what
the `HistoryTimelineRestoreCurrentState` parameter is for. Covered by a test that
strips the field from both snapshot tiers.

- New pure `src/timeline/tempo/tempoEdits.ts`: `insertTempoEvent`,
  `updateTempoEvent`, `removeTempoEvent`, `normalizeTempoMap` — sort, dedupe by
  time, pin the first event, clamp BPM/meter, backfill missing ids. No store,
  no React.
- `TempoEvent.id` added (runtime required, project tier optional); mirror in
  `ProjectTempoEvent` (`src/services/project/types/timeline.types.ts`).
- **`normalizeRulerLaneState` stops being a pass-through.** Today it only
  checks `partial.tempoMap.events?.length` and hands the object straight back
  (`rulerDefaults.ts:79-81`). It must now run the map through
  `normalizeTempoMap` — that single load seam is what backfills ids, pins event
  0 and repairs hand-edited/imported data for every project saved before this
  feature. Still no version bump.
- New `src/stores/timeline/tempoSlice.ts`: `addTempoChange(time, bpm, meter?)`,
  `updateTempoChange(id, patch)`, `removeTempoChange(id)`,
  `setProjectTempo(bpm)`.
- **History pattern (copy `midiClipSlice.ts` exactly, and note the order):**
  the store snapshots the **post-edit** state, so each action runs
  `set(...)` → `invalidateCache()` → `captureSnapshot('<label>')` —
  `captureSnapshot` comes **after** the mutation, not before
  (`midiClipSlice.ts:122-124`). Capturing first would record the pre-edit state
  under the new label and shift the whole undo stack by one entry.
  `invalidateCache()` is not optional here: once Packet 2 lands, a tempo edit
  moves clip `startTime`/`duration`.
- **Undo threading — `tempoMap` must be added everywhere `markers` appears
  (12 sites across 5 files):** `historyStoreTypes.ts` (2), `snapshotCapture.ts`
  (3), `snapshotApply.ts` (1), `historyTimelineEditState.ts` (**3** — lines
  147, 164 and 561), `historyTimelineRestoreState.ts` (3). Missing one silently
  drops tempo on undo. `rulerLanes` / `activeRulerLaneId` stay **excluded**
  (still view state).
- **No persistence change is needed.** `tempoMap` already flows through
  `serialization/serializableTimelineState.ts` and `serializationUtils.ts`;
  adding a field *inside* `TempoEvent` rides along. Do not "fix" those files.
- Wire the slice into `stores/timeline/index.ts`, `selectors.ts`, and the test
  store factory.

**Write set:** `src/timeline/tempo/{tempoEdits.ts,rulerDefaults.ts}`,
`src/types/timeline.ts`, `src/services/project/types/timeline.types.ts`,
`src/stores/timeline/{tempoSlice.ts,index.ts,selectors.ts,storeTypes/*}`,
`src/stores/historyStore/*`, `src/stores/timeline/historyTimeline*.ts`,
`tests/unit/tempoEdits.test.ts`, `tests/stores/timeline/tempoSlice.test.ts`.

**Checks:** invariant unit tests (pin, sort, dedupe, clamp — including that 40
and 240 BPM are *accepted*, so the detection range was not reused by mistake);
a pre-#299 map with no ids is normalized on load; undo across a tempo edit
restores the previous map and one redo re-applies it (verifies the
capture-after-mutate order); save → load → composition-switch → back
round-trips the events with ids.

### Packet 2 — Content follows tempo (MIDI remap) — **DONE**

**Goal:** a tempo edit moves MIDI content and leaves media alone, in one undo
entry.

**Landed 2026-07-27.** Full gate green: build, lint, test (634 files / 5671
tests). New `src/timeline/tempo/tempoRemap.ts`; `barBeatToSeconds` fixed below
the first segment and `barBeatToSecondsAt` added; `tempoSlice.commit` now
remaps clips and the map in one `set` under one snapshot.

Both fixes were mutation-checked: disabling the below-first-segment branch fails
3 tests, and dropping the automation remap fails 1 — neither is silently
passing. Note identity, `noteAbsoluteStart` exactness, negative `inPoint`,
CC automation, cross-boundary note ends and a full 120 -> 60 -> 120 timeline
round trip are all covered.

- New pure `src/timeline/tempo/tempoRemap.ts`:
  - `remapAcrossMaps(oldMap, newMap, t)` = `barBeatToSecondsAt(newMap,
    secondsToBarBeat(oldMap, t))`. `secondsToBarBeat` already returns a
    fractional beat and `barBeatToSeconds` already accepts one, so the round
    trip needs **no new math** in `TempoMap.ts` — but note the signature is
    `barBeatToSeconds(map, bar, beat)`, i.e. two numbers, **not** a `BarBeat`
    object. Add the thin `barBeatToSecondsAt(map, { bar, beat })` wrapper in
    `TempoMap.ts` and use it, rather than passing the object through.
  - `trackFollowsTempo(track)` → `track.type === 'midi'` (the future
    per-track-timebase seam, §3.1).
  - `remapMidiClip(clip, oldMap, newMap)`: anchor `A = clip.startTime -
    clip.inPoint` is the absolute time of the clip's content origin. Remap
    `A' = remapAcrossMaps(A)`, then `inPoint' = remap(A + inPoint) - A'`,
    `outPoint' = remap(A + outPoint) - A'`, `note.start' = remap(A + start) -
    A'`, and note ends by remapping `start + duration` (never by scaling a
    duration with a constant factor — wrong across a tempo boundary). This
    keeps `noteAbsoluteStart` exact: `startTime' = A' + inPoint' =
    remap(clip.startTime)`. Duration follows from `outPoint' - inPoint'`.
  - **Automation lanes remap with the same formula.** `TimelineClip.automation`
    (`src/types/timeline.ts:175` and `:282`) carries the four CC lanes added by
    issue #298, and `AutomationPoint.time` is documented as *"seconds, content
    time (same base as `MidiNote.start`)"* (`src/types/midiClip.ts:123`). Every
    lane's points therefore go through `point.time' = remap(A + time) - A'`
    exactly like note starts. Skipping this desyncs every filter sweep and
    pitch bend from its notes on the first tempo edit — it is not optional.
- **Required fix in `TempoMap.ts`:** `barBeatToSeconds` currently mishandles a
  target phase *below* the first segment's `startPhase` — with >1 segment the
  range test fails for every segment and it falls through to the **last**
  segment, returning nonsense. (`segments[0].startPhase` is always 0, so this
  is exactly the `bar <= 0` case.) MIDI clips legitimately have negative content
  time (`inPoint < 0` after a left-extend, see `midiClipTiming.ts`), so this is
  reachable. Extrapolate from segment 0 when `targetPhase < segments[0].startPhase`.
- **Adjacent hazard in the same function, worth covering while it is open:**
  `targetPhase` is recomputed inside the loop using *each candidate segment's*
  `numerator`, then tested against phase boundaries derived from the previous
  segment. Where two segments carry different meters, that makes the range test
  slightly inconsistent for a fractional beat right at the boundary. Not a
  rewrite — just add the meter-change boundary case to the test file.
- `tempoSlice` actions call the remap and commit clips + tempo map in a single
  `set`, then `invalidateCache()` and one `captureSnapshot` (Packet 1 ordering).

**Write set:** `src/timeline/tempo/{tempoRemap.ts,TempoMap.ts}`,
`src/stores/timeline/tempoSlice.ts`, `tests/unit/tempoRemap.test.ts`,
`tests/unit/tempoMap.test.ts`.

**Checks:** 120 → 60 doubles every MIDI note's absolute start and duration;
CC automation points move with the notes they shape (a cutoff point sitting on
a note's start still sits on it after the edit); video/audio clips are
byte-identical; 120 → 60 → 120 round-trips within epsilon; a note in a clip
with negative `inPoint` survives; a two-segment map remaps across the boundary
correctly; a meter change off the downbeat round-trips; one undo reverts both
tempo and notes.

### Packet 3 — Tempo ruler lane (edit UI)

**Goal:** the lane the user asked for — under the bars ruler, toggled from the
Rulers checklist.

- `RulerLaneFormat` gains `'tempo'`; add to `RULER_LANE_FORMAT_ORDER` in
  `rulerSlice.ts` (last) and to `LANE_OPTIONS` in `RulerLanesMenu.tsx`
  (label "Tempo").
- The tempo lane is **not selectable as the active lane** — it is an editor,
  not a timebase. Guard in `setActiveRulerLane` and skip the click-select
  handler for that format in `TimelineRuler.tsx`.
- New `src/components/timeline/components/TempoRulerLane.tsx`, rendered by
  `TimelineRuler` when `lane.format === 'tempo'`. Same Mesa-safe contract as
  the other lanes: plain DOM, **visible window + overscan only**, dpr-aligned
  via `alignTimelineGridPixel`. No canvas.
- Flag rendering + interaction (modelled on the marker overlays and
  `MarkerContextMenu.tsx`):
  - flag label `120 · 4/4`; the pinned first event is visually distinct and not
    draggable;
  - **double-click empty lane** → insert an event at the nearest bar
    (`barBeatToSeconds`), inheriting the previous event's meter;
  - **drag a flag** horizontally → move, snapped to bars, Alt for free
    placement; drop onto an occupied bar replaces;
  - **double-click a flag** → inline numeric BPM input (Enter commits, Esc
    cancels);
  - **right-click** → Edit BPM / Time signature… / Delete.
- **Pointer conflict with ruler scrubbing.** Every lane row already owns
  `onPointerDown` for playhead scrubbing, with a click-vs-drag test via
  `laneClickStartXRef` (`TimelineRuler.tsx:170-180`). A flag lives *inside* that
  row, so flag `pointerdown` must `stopPropagation()` — otherwise dragging a
  tempo flag also scrubs the transport, and double-clicking the empty lane
  fights the click-selects-lane handler.
- Lane height reuses `RULER_LANE_HEIGHT_PX` (30), so
  `--timeline-ruler-height` already grows correctly.

**Write set:** `src/types/timeline.ts`, `src/stores/timeline/rulerSlice.ts`,
`src/components/timeline/{RulerLanesMenu.tsx,TimelineRuler.tsx}`,
`src/components/timeline/components/TempoRulerLane.tsx`,
`src/components/timeline/Timeline.css`,
`tests/unit/tempoRulerLane.test.ts`.

**Checks:** enabling Tempo adds a row and grows the header; flags land at the
right pixels for a two-event map; insert/move/delete produce the expected map;
clicking the tempo lane does not change `activeRulerLaneId`.

### Packet 4 — Tempo-driven body grid + snapping — **DONE**

**Goal:** "BPM changes the grid" becomes literally true behind the clips, and
clips snap to bars/beats.

**Landed 2026-07-27** (not committed), out of plan order — the mismatch was
visible in the app (4 s bars over a 5 s time grid) and §3.5 removed the
dependency on Packet 3. Full gate green: build, lint, test (633 files / 5648
tests).

Three deviations from the packet as written, all deliberate:

1. **New pure module `src/timeline/tempo/barsGrid.ts`** rather than putting
   `createBarsGridPlan` in `components/timeline/utils/timelineGrid.ts`. Both the
   canvas (components) and both snap paths (stores) consume it, and a store
   importing from `components/` would have been the repo's first such import.
   `timelineGrid.ts` re-exports it and now takes `MIN_BEAT_TICK_PX` /
   `MIN_BAR_TICK_PX` from there, so ruler ticks and grid lines share one set of
   thresholds by construction.
2. **The shared snap surface is the grid generator, not a full candidate
   provider.** `collectBarsGridSnapTimes` is consumed by both
   `getSnappedPosition` and `resolveTimelineClipPointerTime`. Merging their
   clip-edge/playhead candidates too — as the packet sketched — would have
   changed existing snap behaviour in the tool path (it excludes nothing, the
   store path excludes the moving clip and its linked partner), i.e. regression
   risk outside this packet's goal. That duplication predates #299 and is left
   as-is.
3. **The subdivision selector lives inside the Rulers menu**, below a divider
   and only while a bars lane is enabled, instead of as a second toolbar
   dropdown. It is meaningless without a bars ruler, and the toolbar is already
   dense.

One bug found by the snapping tests and fixed: `createBarsGridPlan` overscanned
its window forward by one beat but not backward, so a beat straddling the left
edge lost all of its sub-beat lines — visible as missing subdivisions at the
left of the viewport, and as a subdivision that draws but refuses to snap.

- New pure `createBarsGridPlan({ tempoMap, zoom, startTime, endTime,
  subdivision })` in `timelineGrid.ts`, returning **explicit line times**
  (bar / beat / subdivision, with a major flag) rather than a uniform interval —
  tempo lines are non-uniform, so the existing interval-based
  `paintGridLines` cannot express them. Add a sibling `paintGridLinesAt(times)`
  in `TimelineTrackGridCanvas.tsx`.
- The plan **thins by pixel spacing**, the way `createBarsLaneTicks` already
  does with `MIN_BEAT_TICK_PX` / `MIN_BAR_TICK_PX` — drop subdivisions, then
  beats, as zoom falls, so the body grid never degenerates into a solid block.
- `TimelineTrackGridCanvas` selects the plan from **lane presence** (§3.5): a
  lane with format `'bars'` enabled → tempo grid, replacing the time/frame
  lines; no bars lane → today's frame/time grid, byte-identical to now. The
  canvas reads `rulerLanes`, not `activeRulerLaneId`.
- **Snapping — same enable rule, and the threshold must become pixel-derived.**
  Grid candidates are added whenever the bars lane is enabled and snapping is
  on, so what you see is what you snap to.
  `SNAP_THRESHOLD_SECONDS` is a fixed `0.15` (`stores/timeline/constants.ts:74`)
  and zoom-independent. A 1/16 at 120 BPM is `0.125 s` apart — *narrower than
  the threshold* — so reusing it would leave grid snapping permanently engaged
  with overlapping capture zones and semi-arbitrary nearest-wins picks at low
  zoom. Grid candidates use a pixel budget converted to seconds at the current
  zoom instead. Both halves of that already exist in the repo and should be
  reused rather than reinvented: `TIMELINE_TOOL_SNAP_THRESHOLD_PX = 10`
  (`tools/pointer/timelineToolPointerDispatcher.ts:5`) and the seconds↔pixel
  conversion in `components/timeline/utils/clipDragSnapping.ts:26`. Clip-edge
  and playhead candidates keep their existing seconds threshold; the Alt bypass
  is untouched.
- **There are two snapping paths, and both need the grid.**
  `getSnappedPosition` (`positioningUtils.ts`) serves clip drags, but
  `resolveTimelineClipPointerTime`
  (`tools/pointer/timelineToolPointerDispatcher.ts:295-326`) has its **own**
  `getSnapTargets` (clip edges + playhead) and its own alt/threshold logic for
  tool-driven interactions. Patching only the former leaves tool drags and
  trims un-snapped to bars. Extract one shared pure candidate provider —
  `collectTimelineSnapCandidates({ clips, playheadPosition, tempoGrid })` — and
  have both call sites consume it. That keeps the two paths from drifting again
  and is the reason this packet touches the tools directory at all.
- Grid subdivision selector: `'bar' | 'beat' | '1/8' | '1/16' | '1/8T' |
  '1/16T'`, stored via `viewPreferences.ts` (localStorage, like
  `snappingEnabled`), exposed as a small dropdown beside the Rulers menu.

**Write set:** `src/components/timeline/utils/{timelineGrid.ts,clipDragSnapping.ts}`,
`src/components/timeline/components/TimelineTrackGridCanvas.tsx`,
`src/components/timeline/tools/pointer/timelineToolPointerDispatcher.ts`,
`src/stores/timeline/{positioningUtils.ts,viewPreferences.ts,index.ts,playbackSlice.ts,constants.ts}`,
`src/components/timeline/TimelineControls.tsx`,
`tests/unit/barsGridPlan.test.ts`, `tests/stores/timeline/gridSnap.test.ts`.

**Checks:** at 120 BPM 4/4 the grid lines land on 0.5 s beats / 2 s bars and
follow a mid-timeline tempo change; a drag near a bar line snaps to it; the
same drag through the tool pointer path snaps identically; at 1/16 subdivision
and low zoom the snap threshold shrinks with the pixel budget instead of
capturing every position; Alt still bypasses; with no bars lane enabled the
canvas output and both snap paths are byte-identical to today.

### Packet 5 — Metronome click engine

**Goal:** an audible, sample-accurate click driven by the tempo map.

- New `src/services/audio/metronomeScheduler.ts`, structured on
  `midiPlaybackScheduler.ts` (the proven template): 25 ms timer, 0.12 s
  look-ahead, `anchorCtxTime`/`anchorTimeline` mapping, seek re-anchor above
  0.25 s drift, silence + re-anchor when `playbackSpeed !== 1`, flush on
  stop/pause. Subscribes to `isPlaying` like the MIDI scheduler does. HMR
  singleton per `CLAUDE.md` §9.
- Beat source is `iterateBarBeatLines(tempoMap, windowStart, windowEnd)` — it
  already returns exactly the tick times plus `isBarStart`. No new math.
- New `src/engine/audio/metronomeVoice.ts`: pure
  `scheduleClick(ctx, destination, when, isDownbeat, volume)` — one
  `OscillatorNode` (sine/triangle) + `GainNode` with a fast exponential decay,
  ~40 ms. Downbeat ≈ 1000 Hz at full level, other beats ≈ 800 Hz at ~0.7. No
  assets, no sample loading. (Cubase's click is the same idea: one tone, pitch
  and level distinguish the downbeat.)
- Routing per §3.4: own gain → `ctx.destination`; guard on `isExporting`.

**Write set:** `src/services/audio/metronomeScheduler.ts`,
`src/engine/audio/metronomeVoice.ts`, the scheduler bootstrap next to
`ensureMidiPlaybackScheduler()`, `tests/unit/metronomeScheduler.test.ts`.

**Checks:** with a fake clock, a 120 BPM map schedules clicks at 0.5 s spacing
with a downbeat every 4; a tempo change mid-window shifts subsequent clicks; a
seek flushes and re-anchors; nothing is scheduled at 2x or while exporting.

### Packet 6 — Metronome UI, preferences, count-in

**Goal:** the toggle the user asked for, right of the Rulers dropdown.

- Store field `metronomeEnabled` + `readStoredMetronomeEnabled` /
  `persistMetronomeEnabled` in `viewPreferences.ts`, plus click volume, mode
  (`'beats' | 'bars'`) and count-in bars — all mirroring `snappingEnabled`
  exactly (`stores/timeline/index.ts` init + a toggle in `playbackSlice.ts`).
- New `src/components/timeline/MetronomeButton.tsx`, rendered immediately
  after `<RulerLanesMenu />` in `TimelineControls.tsx`. Metronome glyph,
  `btn-active` when on, small popover: volume slider, beats/bars-only, count-in
  (0 / 1 / 2 bars).
- **Count-in** rolls the transport back N bars before starting and clicks
  through the lead-in. This is the only part of the feature that touches the
  transport; if it fights `playbackSlice`, ship the toggle + volume first and
  land count-in as a follow-up packet rather than bending playback.

**Write set:** `src/components/timeline/{MetronomeButton.tsx,TimelineControls.tsx}`,
`src/stores/timeline/{viewPreferences.ts,playbackSlice.ts,index.ts,selectors.ts,storeTypes/*}`,
`src/components/timeline/Timeline.css`.

**Checks:** toggle survives reload; enabling mid-playback starts clicking on
the next beat; disabling stops immediately; export output contains no click.

### Packet 7 — Docs

- New `docs/Features/Tempo-And-Metronome.md`; flip `docs/Features/Timeline-Rulers.md`
  from "ships no grid/snap behavior" to the real state and cross-link;
  `docs/Features/README.md` index entry; update this file's status and move it
  to `docs/completed/` when green.

## 6. Sequencing

```text
1 ──┬── 2 ──┐
    └── 3   ├── 4 ──┐
5 ── 6 ─────┴───────┴── 7
```

Packets 1 and 5 are disjoint and can start in parallel (tempo store vs audio
scheduler). 2 and 3 both depend on 1 and have disjoint write sets. 4 depends on
1 only (§3.5 keys the grid off lane presence, not the active lane), so it can
land before 3. 6 depends on 5. 7 last.

## 7. Out of scope

- Tempo **ramps** / accelerando (§3.3).
- A separate time-signature track (§3.2).
- Per-track `timebase` flag — the predicate seam exists, the schema field does
  not (§3.1).
- **Tap tempo** and **detect tempo from an audio clip**. Note that
  `src/services/audio/beatOnset/beatGridEstimation.ts` already estimates BPM
  from audio — wiring "set project tempo from this clip's detected beat grid"
  is a natural, cheap follow-up once editing exists.
- Ingesting the tempo map from imported MIDI files.
- Audio time-stretching to follow tempo (media stays linear by design).
- Piano-roll note snapping (see open question below).

## 8. Open questions

None of these block starting Packet 1.

1. **Default BPM.** New compositions currently get 60. Musically 120 is the
   normal default, but any project saved since #257 carries 60 explicitly, so
   changing the default only affects *new* compositions — and it would shift
   bar numbers for pre-#257 projects that get defaults backfilled on load.
   Recommendation: keep 60 for backfill, use 120 for newly created
   compositions. Needs a yes/no. Decide it together with the editable-range
   constants (§4): with the detection range's `MIN_TEMPO_BPM = 60` the current
   default would sit exactly on the clamp boundary, which is part of why that
   range is the wrong one to reuse.
2. **Piano-roll snapping.** Notes are free-placed by deliberate decision
   (issue #182). Now that a musical grid exists, should the piano roll get an
   optional snap-to-subdivision (off by default), or stay free?
3. **Count-in scope.** Ship in Packet 6, or split out (§Packet 6)?
4. **Keyboard shortcut for the click.** Cubase/Logic use `C`. Needs a conflict
   check against existing timeline/piano-roll bindings before assigning.

## 9. Risks

- **Undo threading (Packet 1).** `tempoMap` has to be added to 12 sites across
  5 history files. Missing one loses tempo on undo silently. Mitigation: the
  packet's check is an undo test, not a type check.
- **Snapshot ordering (Packet 1).** The store's history model captures the
  **post-edit** state; calling `captureSnapshot` before the `set` shifts the
  undo stack by one and is invisible to `tsc`. Mitigation: the packet's check
  includes a redo, which the wrong order fails.
- **`barBeatToSeconds` below the first segment (Packet 2).** Real bug, reachable
  through negative MIDI content time; fixed as part of the packet.
- **Forgotten content in the remap (Packet 2).** MIDI clips carry more
  content-time data than notes — the four CC automation lanes share
  `MidiNote.start`'s time base. Anything content-time added to MIDI clips in
  future must join `remapMidiClip`. Mitigation: the remap takes the whole clip,
  not a note array, so the omission is visible at the call site.
- **Two snapping implementations (Packet 4).** Grid candidates added to only one
  of them is the likely failure. Mitigation: the packet extracts a shared
  candidate provider and tests both paths with the same drag.
- **Non-uniform grid painting (Packet 4).** The body grid canvas currently
  assumes a constant interval. It must move to explicit line positions, keeping
  the viewport-window + dpr discipline — no full-width canvas, per the Mesa
  rules in `CLAUDE.md` §9.
- **Remap drift.** Accepted and tested (§3.1).

## 10. Verification gates

Focused `vitest` + `npx tsc -b` per packet. Full `npm run build`,
`npm run lint`, `npm run test` — all three, no fail-fast — before any commit at
a normal-command boundary. DOM-only and viewport-windowed throughout; the click
adds no GPU surface, so no new Mesa exposure.
