# Slot-Grid.md — audit 2026-08-02

## Verified (spot checks that held)

- The grid is fixed at 12 columns by 4 rows, with rows A–D mapped to layer indices 0–3: `src/components/timeline/SlotGrid.tsx` (`GRID_COLS`, `GRID_ROWS`, row rendering).
- Timeline/grid transitions use `slotGridProgress` and the toolbar plus Ctrl/Cmd+Shift+Scroll paths: `src/components/timeline/slotGridAnimation.ts`, `src/components/timeline/TimelineControls.tsx`, and `src/components/timeline/hooks/useTimelineZoom.ts`.
- Filled-slot clicks ensure slot settings, select the slot, activate the Properties panel/`Slot Clip` tab, and—on the default flag setting—open the composition and activate its layer: `src/components/timeline/SlotGrid.tsx`; default flags: `src/engine/featureFlags.ts`.
- Slot trims default to 0 through composition duration with `loop`; `loop`, `hold`, and `clear` are supported: `src/stores/mediaStore/slices/slotSlice.ts`, `src/components/panels/properties/SlotClipTab.tsx`, and `src/services/layerPlayback/playbackTiming.ts`.
- Layer playback uses an independent anchored wall-clock time and applies the slot playback window: `src/services/layerPlaybackManager.ts` and `src/services/layerPlayback/playbackTiming.ts`.
- The live-trigger and warm-deck runtime flags, the six documented deck badge states, and the right-click menu labels all exist: `src/engine/featureFlags.ts`, `src/components/timeline/components/SlotGridDeckBadge.tsx`, and `src/components/timeline/SlotGrid.tsx`.

## Outdated or wrong (claim → reality, with file evidence)

- “`Map MIDI to Slot` … creates a pending slot trigger mapping” → it opens the MIDI panel and sets a `learnTarget`; no slot binding is created until a MIDI input is learned. Evidence: `src/components/timeline/SlotGrid.tsx`, `src/stores/midiStore.ts`, and `src/components/panels/MIDIMappingPanel.tsx`.
- “background layer audio is muted by default” → background video elements are created with `muted = true`, but background audio elements are created without a muted setting and are synchronized for playback. Evidence: `src/services/layerPlayback/clipMediaLoaders.ts` and `src/services/layerPlayback/mediaSync.ts`.
- “deactivating a layer releases that layer back to the next active slot/editor state” → deactivation deletes that layer’s `activeLayerSlots` entry; the playback manager cleans up its media. It does not promote another layer or composition. Evidence: `src/stores/mediaStore/slices/multiLayerSlice.ts`, `src/components/timeline/SlotGrid.tsx`, and `src/services/layerPlaybackManager.ts`.
- Warm-deck wording implied an ordinary available mode → the implementation is present, but `useWarmSlotDecks` is `false` by default and deck preparation/adoption short-circuits while disabled. Evidence: `src/engine/featureFlags.ts` and `src/services/slotDeckManager.ts`.

## Noteworthy / unusual

- Slot Grid exposes shipped controls the previous doc omitted: column-header activation, per-layer opacity sliders, slot mini-timelines/time overlays, and external Media-panel drops that create and assign a composition. Evidence: `src/components/timeline/SlotGrid.tsx` and `src/stores/mediaStore/slices/composition/slotAssignmentActions.ts`.
- Slot assignments and slot-clip settings are project-persisted, while transient active-layer state is not written in the shown project save/load paths. Evidence: `src/services/project/projectSave.ts`, `src/services/project/projectLoad.ts`, and `src/services/project/types/project.types.ts`.
- Slot clip settings are keyed by composition ID, so the settings follow a composition when it moves to another slot rather than being independently stored per slot. Evidence: `src/stores/mediaStore/types.ts` and `src/stores/mediaStore/slices/slotSlice.ts`.
- The feature index is independently stale: `docs/Features/README.md` still reports version 2.0.6 / May 2026 although `package.json` is 2.4.4. It was not changed because it is outside this bounded audit.
