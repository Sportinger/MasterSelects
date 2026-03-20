# Slot Grid Live VJ Phase 0 Contracts

**Created:** 2026-03-17
**Status:** Accepted contract for the Hot Trigger MVP
**Scope:** Freeze the minimum interaction and state contract required before Phase 1 implementation.

---

## Goal

Make Slot Grid live triggering independent from editor composition switching without changing the current behavior by default.

This contract covers:

- Phase 0 contract freeze
- Phase 1 live trigger behavior
- temporary latency measurement plan until deeper Phase 6 telemetry lands

This contract does not cover:

- warm deck lifecycle implementation
- cue/program separation
- MIDI mappings
- quantized launch

---

## Feature Gate

Phase 1 must ship behind:

- `flags.useLiveSlotTrigger`

Default:

- `false`

When `false`, Slot Grid keeps the current editor-first behavior.

When `true`, Slot Grid uses the live-trigger contract below.

---

## State Ownership

`activeCompositionId`

- editor ownership only
- identifies the composition loaded into the editor timeline
- may change only through explicit editor actions such as `openCompositionTab(...)` or `setActiveComposition(...)`

`openCompositionIds`

- editor tab state only
- must not change as a side effect of live triggering

`activeLayerSlots`

- live layer routing state
- maps slot-grid rows to composition ids
- is the only state Phase 1 live triggering may mutate

`slotAssignments`

- static slot placement only
- not a live-playback state

---

## Accepted Actions

### `triggerLiveSlot(compositionId, layerIndex)`

Purpose:

- perform a live trigger on one Slot Grid row

Semantics:

- assigns the composition to `activeLayerSlots[layerIndex]`
- removes the same composition from any previous live layer
- does not change `activeCompositionId`
- does not change `openCompositionIds`
- does not call editor composition switching
- does not load timeline state

### `triggerLiveColumn(colIndex)`

Purpose:

- perform a live trigger for every populated row in one Slot Grid column

Semantics:

- resolves slot assignments for the target column
- replaces `activeLayerSlots` with the triggered column result
- does not change `activeCompositionId`
- does not change `openCompositionIds`
- does not call editor composition switching

### `openCompositionTab(compositionId, options)`

Purpose:

- explicit editor action only

Semantics for the Hot Trigger MVP:

- remains the path that may update `activeCompositionId`
- may restore timeline state
- may use `playFromStart`
- is no longer part of single-click live triggering when `flags.useLiveSlotTrigger` is enabled

---

## Slot Grid Interaction Contract

When `flags.useLiveSlotTrigger` is `true`:

- single click on a filled slot triggers `triggerLiveSlot(...)`
- single click on a column header triggers `triggerLiveColumn(...)`
- opening a composition in the editor becomes a secondary explicit action
- the explicit editor path for Phase 1 is:
  - double click on a filled slot
  - or the slot context menu action `Open in Editor`

When `flags.useLiveSlotTrigger` is `false`:

- Slot Grid preserves the current editor-first click behavior

---

## Render And Playback Invariants

Phase 1 must preserve these rules:

- live triggering must not depend on `finishCompositionSwitch()`
- live triggering must not require `timelineStore.loadState(...)`
- if a triggered composition is also the current editor composition, render ownership may move through the existing primary-layer path while its row stays assigned in `activeLayerSlots`
- existing explicit editor workflows must continue to work

Known limitation accepted for the Hot Trigger MVP:

- Phase 1 still launches cold media for background layers
- low-latency warmup is deferred to Phase 2

---

## Temporary Readiness Definitions

These definitions are frozen now so later phases do not rename them ad hoc.

`cold`

- no prepared live runtime exists for the slot

`warming`

- preparation has started but first-frame readiness is not yet guaranteed

`warm`

- the slot has a reusable runtime or prepared media element that should avoid full setup on trigger

`hot`

- the next trigger should show a valid first frame immediately or close to one frame

Phase 1 implementation target:

- preserve the names
- no requirement yet to move slots beyond `cold` by default

---

## Manual Latency Measurement Plan

Until Phase 6 telemetry lands, use a manual smoke pass for each checkpoint.

Measure:

- cold single-slot trigger
- repeated trigger of the same slot
- two-slot switching on the same row
- trigger while keeping a different composition open in the editor

Record:

- whether the editor changed unexpectedly
- whether the first frame appeared immediately, with a visible delay, or stalled
- whether repeated triggers feel faster, unchanged, or worse

Pass condition for Phase 1:

- single-click live triggering works without forcing an editor switch
- explicit editor open still works
- no obvious regression in current playback correctness beyond accepted cold-start delay

---

## Deferred To Phase 2

The following remain intentionally unfrozen for this checkpoint:

- warm deck lifecycle owner
- memory budget and eviction policy
- runtime handoff model
- deck disposal rules
- hot-slot readiness telemetry
