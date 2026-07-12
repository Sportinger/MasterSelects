# Transition Compositions

[<- Back to Index](./README.md) | [Timeline](./Timeline.md)

Transition compositions make a timeline transition editable as a linked composition while preserving the source clips' real timing.

## Mapped-v3 Source Layout

A mapped-v3 composition has exactly one full-duration outgoing source clip and one full-duration incoming source clip. Both span the complete transition composition; they are not split into coverage segments at the cut. Panel expansions and generated overlays may add editable layers, but do not replace that source pair.

Each source uses `TransitionSourceMap` v2, which keeps three time domains separate:

- source media time for decoding;
- original parent-clip animation time for the user's transforms, effects, masks, speed curves, reverse playback, holds, and keyframes;
- composition-local recipe time for generated transition animation.

The mapped animation combines the original and generated edits without reinterpreting the source. Invalid v2 data fails closed: the affected layer is omitted and stale mask texture state is removed rather than inventing a time or animation.

## Transition Templates

There are 74 active runtime transitions. The generic compiler materializes 73 of them from their recipes; Light Leak uses its dedicated mapped builder for its outgoing, masked incoming, and light-streak layers. The 20 planned definitions are metadata only and are not available to preview, runtime, or export.

The generic compiler is `templateVersion` 4; Light Leak is `templateVersion` 3. These are recipe-template revisions, not the `sourceLayout: mapped-v3` format name.

Recipes materialize normal editable layers: opacity, transforms, effects, masks, overlays, and blend windows. Procedural, pattern, and clock masks retain semantic `transitionRender.progress` state instead of being flattened. Cross and star reveals use distinct mask shapes. Scene-3D transitions materialize 3D layers, and recipe rotations are converted into the timeline's degree domain. Blend changes are resolved in composition-local, half-open windows.

## Runtime Parity

Preview, live runtime, paused-frame sync, mask-texture updates, and export all resolve the same source map and mapped animation. Before a transition has been opened or saved as a composition, preview and export build that same mapped-v3 scene transiently; no project state is created just to render it. Holds stay on their mapped frame; reverse or variable-speed source playback keeps its signed timing. The nested transition composition is the transition rendered by the parent timeline.

Dynamic nested video sources are recollected within a timeline frame instead of reusing a same-time nested texture, so a late decoded source frame updates the mapped composite without a separate transition renderer.

## Editing And Legacy Upgrades

Double-click a transition body to open its linked composition. If it is a legacy segmented composition, MasterSelects asks before changing it:

- **OK** creates a fresh mapped-v3 composition, retains the legacy composition as a hidden linked backup, and records the upgrade as one undo batch.
- **Cancel**, or an upgrade failure, opens the legacy composition unchanged.

There is no silent auto-migration. The backup is saved with the project and remains available after reload; deleting the mapped transition composition also removes its linked backup.

## Troubleshooting And Verification

If a composition still shows split source clips, it is legacy and must be explicitly upgraded. A mapped-v3 composition shows one full-duration source clip per side, with any panel or generated layers separately editable.

Mapped continuity keeps the source owners alive across the transition instead of handing off between segments. For a playback investigation, refresh, wait 5 seconds, then use the AI bridge's `getStats`, `getStatsHistory`, and `getPlaybackTrace` around the transition. No final benchmark figures are recorded here; measure the target media and browser path.
