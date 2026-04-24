# Slot Grid

[Back to Index](./README.md)

12x4 live grid overlay for composition triggering, per-slot trim settings, and multi-layer background playback.

---

## Overview

The Slot Grid sits on top of the Timeline panel and turns compositions into launchable slots.

- 4 rows map to playback layers `A` through `D`
- 12 columns provide launch positions per layer
- grid/timeline transitions are animated through `slotGridProgress`
- each active layer keeps its own wall-clock playback state

---

## Opening The Grid

You can switch between the timeline and Slot Grid through:

- the dedicated toolbar toggle button
- `Ctrl+Shift+Scroll` / `Cmd+Shift+Scroll`

Zooming back into the timeline from the grid is only allowed while hovering a filled slot.

---

## Slot Interaction

### Default Click Flow

On the current default path, clicking a filled slot:

1. ensures slot-clip settings exist for that composition
2. selects the slot composition
3. opens the Properties panel to the `Slot Clip` tab
4. opens the composition in the editor and activates it on the corresponding live layer

### Live Trigger Flag

When `window.__ENGINE_FLAGS__.useLiveSlotTrigger` is enabled, the primary click path changes:

- clicking a slot triggers the live layer directly without forcing the editor switch first
- column-header clicks use the same live-trigger path for the whole column

### Other Actions

- re-clicking an active slot restarts playback from the slot `trimIn` point
- clicking an empty slot clears that layer
- dragging moves or swaps slot assignments
- right-clicking a filled slot opens `Open in Editor`, `Map MIDI to Slot`, and `Remove from Slot`
- `Map MIDI to Slot` opens the MIDI Mapping panel, creates a pending slot trigger mapping, and arms MIDI learn mode for that slot

---

## Slot Clip Settings

Each slotted composition has its own slot-playback trim state:

- `trimIn`
- `trimOut`
- `endBehavior`

The current defaults are:

- `trimIn = 0`
- `trimOut = composition duration`
- `endBehavior = loop`

These settings are stored in `mediaStore.slotClipSettings` and edited through the `Slot Clip` properties tab.

Slot launches use the configured slot window, not the composition editor playhead. The `Slot Clip` tab renders the composition tracks, the active trim window, and the current layer playhead in the same timeline surface so the tab reflects the playback state used by `layerPlaybackManager`.

---

## Multi-Layer Playback

Each active slot layer runs independently from the global editor timeline.

- background layers keep their own anchor time
- active layers can keep running even when the editor focus changes
- background layer audio is muted by default
- deactivating a layer releases that layer back to the next active slot/editor state

The background playback plumbing is managed by `layerPlaybackManager`.

---

## Warm Decks

When `window.__ENGINE_FLAGS__.useWarmSlotDecks` is enabled, the grid can prepare reusable slot-owned playback decks before activation.

Deck badges use these states:

| Badge | Meaning |
|------|---------|
| `C` | cold |
| `Wi` | warming |
| `Wa` | warm |
| `H` | hot |
| `F` | failed |
| `D` | disposed |

Warm decks let a prepared slot be adopted onto a live layer with less activation work at trigger time.

---

## Related Features

- [Timeline](./Timeline.md)
- [UI Panels](./UI-Panels.md)
- [Preview](./Preview.md)
- [Media Runtime](./Media-Runtime.md)
