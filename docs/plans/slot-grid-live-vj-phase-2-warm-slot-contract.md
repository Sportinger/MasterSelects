# Slot Grid Live VJ Phase 2 Warm Slot Contract

**Created:** 2026-03-17
**Status:** Accepted for Wave 1 implementation
**Scope:** Freeze the slot-deck lifecycle and ownership model before multi-agent implementation.

---

## Multi-Agent Timing

Yes, this is where the multi-agent phase starts.

But it starts in contract mode, not code-fanout mode.

Use multi-agent work now for:

- independent design opinions
- adversarial review
- packet definition

This contract is now frozen for Wave 1.

---

## Goal

Make assigned slots prewarm reusable playback decks so live triggering can reuse prepared media instead of recreating HTML media elements on each activation.

Phase 2 must improve the live path without redefining:

- editor ownership
- cue/program routing
- output routing
- MIDI behavior

## Feature Gate

Wave 1 Phase 2 implementation must ship behind:

- `flags.useWarmSlotDecks`

Default:

- `false`

---

## Accepted Ownership Model

### 1. Slot decks are slot-owned

A warm deck belongs to a physical slot index, not to the editor and not directly to an active layer.

Deck identity is:

- `slotIndex`
- `compositionId`

If either changes, the old deck is disposed.

### 2. Runtime resources stay out of the store

Prepared media elements, runtime bindings, decoder sessions, and frame providers stay in a service layer.

Recommended owner:

- new `slotDeckManager` service

Reason:

- `layerPlaybackManager` is currently layer-owned and destructive on activation/deactivation
- warm decks are slot-owned and must survive until explicit eviction
- separating deck ownership from active-layer ownership makes multi-agent write scopes cleaner

`slotDeckManager` is the source of truth for prepared decks.

Any store-visible readiness state is a transient projection of that service, not the owner of runtime resources.

### 3. Store state is metadata only

The store should expose transient slot readiness metadata for UI and diagnostics.

Recommended location:

- a new transient media-store slice, keyed by `slotIndex`

Do not persist this state into project files.

---

## Accepted State Contract

```ts
type SlotDeckStatus =
  | 'cold'
  | 'warming'
  | 'warm'
  | 'hot'
  | 'failed'
  | 'disposed';

interface SlotDeckState {
  slotIndex: number;
  compositionId: string | null;
  status: SlotDeckStatus;
  preparedClipCount: number;
  readyClipCount: number;
  firstFrameReady: boolean;
  decoderMode: 'html' | 'webcodecs' | 'native' | 'mixed' | 'unknown';
  lastPreparedAt: number | null;
  lastActivatedAt: number | null;
  lastError: string | null;
  pinnedLayerIndex: number | null;
}
```

### Status meanings

`cold`

- no prepared deck exists for the current slot assignment

`warming`

- deck creation started
- some or all clip sources may still be loading

`warm`

- deck exists and clip sources are retained
- activation should not recreate media elements
- first frame is not yet guaranteed to be immediately renderable

`hot`

- deck exists and has a valid first frame ready for immediate or near-immediate launch

`failed`

- the most recent warm attempt failed
- a later explicit trigger or retry may re-enter `warming`

`disposed`

- a previously prepared deck was intentionally released
- this is an observable cleanup state, not a steady-state playback mode

### Allowed transitions

- `cold -> warming`
- `warming -> warm`
- `warming -> hot`
- `warming -> failed`
- `warm -> hot`
- `hot -> warm`
- `warm -> disposed`
- `hot -> disposed`
- `failed -> warming`
- `disposed -> warming`

---

## Trigger Contract

Phase 1 public actions stay stable:

- `triggerLiveSlot(compositionId, layerIndex)`
- `triggerLiveColumn(colIndex)`

Phase 2 may change their internal behavior, but not their meaning.

### `triggerLiveSlot(...)`

When a deck exists for the slot assignment:

- adopt the prepared deck into the requested live layer
- do not recreate clip media elements
- do not change `activeCompositionId`

When no usable deck exists:

- fall back to the current cold activation path
- queue warmup for that slot if possible

### Activation model

Accepted model:

- layer activation becomes deck adoption by reference
- warmed clips keep stable slot-owned runtime/session ownership until explicit disposal or eviction

Not accepted:

- full clip rehydration on every trigger
- editor composition switching as part of live triggering

---

## Store Boundaries

### State that must remain unchanged in meaning

`activeCompositionId`

- editor ownership only

`openCompositionIds`

- editor tab state only

`activeLayerSlots`

- live layer routing only
- do not store readiness here
- do not overload it with warm-deck metadata

`slotAssignments`

- slot layout only

### New transient state

Recommended name:

- `slotDeckStates: Record<number, SlotDeckState>`

This state should be driven by deck-manager events, not by UI guesses.

---

## Phase 2 Should Change

- add slot-deck metadata state keyed by `slotIndex`
- add a deck owner service that can prepare and dispose slot decks independently of active layers
- warm assigned slots after assignment, replacement, or explicit retry
- let live trigger adopt a prepared deck when available
- add a minimal Slot Grid readiness indicator based on `slotDeckStates`
- make deck disposal explicit on unassign, move, replacement, project clear, and eviction

## Wave 1 API Surface

Use this interface shape for Wave 1 unless implementation evidence forces a smaller adjustment.

```ts
interface SlotDeckManager {
  prepareSlot(slotIndex: number, compositionId: string): void;
  disposeSlot(slotIndex: number): void;
  disposeAll(): void;
  adoptDeckToLayer(slotIndex: number, layerIndex: number, initialElapsed?: number): boolean;
  getSlotState(slotIndex: number): SlotDeckState | null;
}
```

Expected metadata plumbing for UI:

```ts
interface SlotDeckStateActions {
  setSlotDeckState(slotIndex: number, next: SlotDeckState): void;
  clearSlotDeckState(slotIndex: number): void;
}
```

Rules:

- `prepareSlot(...)` may update the slot from `cold` to `warming` synchronously
- `adoptDeckToLayer(...)` returns `true` only when a prepared deck was actually reused
- a failed adopt falls back to the current cold layer activation path
- `slotDeckManager` may write transient store metadata, but it must not mutate editor ownership state

---

## Phase 2 Should Not Change

- `activeCompositionId` semantics
- explicit editor open behavior from Phase 1
- cue/program routing
- `renderTargetStore` slot-routing semantics
- `playbackSlice` editor startup behavior
- MIDI mappings
- quantized launch

---

## Eviction And Disposal Rules

Phase 2 needs explicit containment from day one.

Accepted initial rule set:

- default soft cap: `8` prepared slots
- active live-layer decks are pinned and cannot be evicted
- non-pinned decks use LRU eviction by last activation or last warm completion
- changing a slot assignment disposes the old deck immediately
- unassigning a slot disposes its deck immediately
- `failed` decks are not kept pinned

This is intentionally count-based for the first checkpoint.

Memory-based tuning belongs in later telemetry work.

---

## Packet Split For Implementation Fan-Out

After this contract is frozen, the first safe multi-agent implementation wave is:

`P2-A` deck manager runtime packet

- write scope:
  - new `src/services/slotDeckManager.ts`
  - `src/services/mediaRuntime/*` only as needed for deck ownership integration
- goal:
  - create and dispose slot-owned prepared decks

`P2-B` live layer handoff packet

- write scope:
  - `src/services/layerPlaybackManager.ts`
  - `src/services/layerBuilder/LayerBuilderService.ts`
- goal:
  - adopt prepared decks by reference instead of cold rehydration when possible

`P2-C` store and UI packet

- write scope:
  - `src/stores/mediaStore/types.ts`
  - `src/stores/mediaStore/slices/slotSlice.ts`
  - `src/components/timeline/SlotGrid.tsx`
- goal:
  - expose `slotDeckStates`, invalidation hooks, and minimal readiness UI

`P2-D` test packet

- write scope:
  - tests only
- goal:
  - state transition tests, deck disposal tests, warm-trigger smoke coverage

Review lanes after implementation:

- correctness review
- performance review
- one adversarial runtime audit

---

## Top Risks

### 1. `layerPlaybackManager` is still destructive on activation

Current behavior fully deactivates and releases runtime ownership before rebuilding a layer.

Files:

- `src/services/layerPlaybackManager.ts`

Risk:

- if Phase 2 continues to enter this path for warmed triggers, it will destroy the very deck it wanted to reuse

### 2. `activeLayerSlots` already drives both render ownership and background sync

Current live sync depends on `activeLayerSlots` plus `activeCompositionId`.

Files:

- `src/components/timeline/SlotGrid.tsx`
- `src/services/layerBuilder/LayerBuilderService.ts`

Risk:

- if readiness metadata is overloaded into `activeLayerSlots`, render and editor/live ownership will drift or race

### 3. `slot` routing is still ambiguous in render target resolution

Current render-target slot lookup resolves through `activeLayerSlots`, not the 48-slot grid.

Files:

- `src/stores/renderTargetStore.ts`

Risk:

- any attempt to expose warmed slot identity through output routing in Phase 2 will inherit an existing slot-vs-layer ambiguity

---

## Lead Decision Gate

Implementation fan-out can begin only when the lead explicitly accepts:

- slot-owned deck identity
- transient `slotDeckStates` metadata
- deck adoption by reference as the trigger model
- count-based eviction for the first checkpoint

If any of those are still disputed, stay in design mode.

The lead accepts these points for Wave 1.
