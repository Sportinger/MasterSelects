# Transition Nested Composition Architecture

Status: Implemented statically, 2026-06-25. Runtime Bridge/export smoke checks
are still pending user approval. Reviewed against the codebase by two Codex
explorers and two Claude Opus 4.8 CLI reviewers.

## Goal

Every timeline transition is a hidden nested composition. The visible transition
overlay in the parent timeline is only the controller and visual handle for that
composition. Playback, scrub, RAM preview, export, masks, keyframes, effects,
and cache invalidation must use the same nested composition path as normal comp
clips.

There is no legacy transition render path after this refactor.

## Hard Invariants

- Every `TimelineTransition` has a valid `compositionId`.
- Every transition composition has `transitionComp.kind === 'transition-comp'`.
- Transition compositions are stored in `mediaStore.compositions`, persisted,
  and openable in timeline tabs.
- Transition compositions are hidden from the Media Panel and project item
  browsing.
- The parent timeline never renders transition recipes directly.
- The parent transition overlay never owns render behavior.
- The transition composition duration is exactly the parent transition duration.
- Parent transition time maps directly to transition comp time:
  `compTime = parentTime - transitionBodyStart`.
- Transition presets are templates only. They create or replace composition
  contents; they are not runtime renderers.

## Current Code That Must Change

- `src/services/timeline/transitionCompositionService.ts`
  - Currently creates transition comps only on overlay double-click.
  - Has a generic inner-transition fallback via `buildTransitionTimelineData`.
  - Has a materialized Light Leak path only.

- `src/stores/timeline/editOperations/transitionOperations.ts`
  - `applyTransitionBetweenClips(...)` preserves an existing `compositionId`
    but does not create one.

- `src/services/layerBuilder/LayerBuilderService.ts`
  - Still imports and can call `assemblePreviewTransitionLayers`.

- `src/engine/export/ExportLayerBuilder.ts`
  - Still imports and can call `assembleTransitionLayers`.

- `src/services/compositionRender/transitionEvaluation.ts`
  - Still renders transitions inside compositions with
    `assemblePreviewTransitionLayers`.

- `src/services/layerBuilder/transitionLayerAssembly.ts`
  - Runtime transition compositor. Delete as render path, or shrink to template
    generation helpers only if that keeps less code.

- `src/engine/export/FrameExporter.ts`
  - Prepares transition comps, but export must not have a transition-specific
    render fallback.

- `src/components/timeline/components/TransitionOverlays.tsx`
  - Opens/attaches transition comps on double-click. It should only open the
    already existing hidden comp.
  - Current pointer/double-click handling can call creation twice before props
    refresh, so the new open path must be idempotent.

- `src/components/panels/media/panel/useMediaPanelProjectItems.ts`
  and `src/stores/mediaStore/index.ts`
  - Currently treat all compositions as visible project items.

## Target Data Model

`TimelineTransition.compositionId` becomes required at runtime. Load-time
compatibility can keep the TypeScript field optional until migration is stable,
but all loaded timeline state must be normalized before render.

`TransitionCompositionLink` remains the back-reference:

- `parentCompositionId`
- `parentTransitionId`
- `parentOutgoingClipId`
- `parentIncomingClipId`
- `linkedOutgoingClipId`
- `linkedIncomingClipId`
- `templateType`
- `templateVersion`

Remove body padding from canonical transition comps:

- `timelineData.duration = transition.duration`
- `timelineData.inPoint = 0`
- `timelineData.outPoint = transition.duration`
- `transitionComp.bodyStart = 0`
- `transitionComp.bodyEnd = transition.duration`
- `transitionComp.paddingBefore = 0`
- `transitionComp.paddingAfter = 0`

If edit handles are needed later, implement them as UI handles or source clip
handles inside the comp, not hidden extra comp duration.

## Creation Flow

Replace "open creates composition" with "transition creation creates
composition".

1. The timeline store action applies the pure transition edit operation, then
   requests a hidden transition composition for the resulting pair.
2. The composition generator builds serializable clips/layers for the selected
   preset.
3. The generated comp id is written to both `transitionOut.compositionId` and
   `transitionIn.compositionId`.
4. `TransitionOverlays` double-click opens that comp. It does not create or
   attach it except as a migration fallback for old projects during the refactor.

Do not put composition creation inside `applyTransitionBetweenClips(...)`; that
function is a pure clip reducer and should stay pure.

The smallest clean implementation is a store-level helper:

```ts
ensureTransitionCompositionForPair({
  parentCompositionId,
  outgoingClip,
  incomingClip,
  transition,
  serializableClips,
  compositions,
})
```

It should be the only place that creates or repairs hidden transition comps.

## Template Generation

Every transition type gets a materialized template. Do not keep an inner
runtime transition inside the generated comp.

Examples:

- Dissolve: outgoing clip opacity 1 -> 0, incoming clip opacity 0 -> 1.
- Dip: outgoing/incoming opacity curves plus generated color/solid clip.
- Wipe: incoming clip mask path/position keyframes.
- Light Leak: outgoing clip, incoming masked clip, generated light-streak clip.

Use existing `TransitionDefinition.recipe` metadata as the first template
source. Add custom materializers only where a recipe primitive cannot express
the preset cleanly.

Generated clips are normal serializable clips:

- linked outgoing source clip
- linked incoming source clip
- optional generated media clips such as solids, masks, textCanvas-backed
  transition overlays, motion shapes, or future procedural assets

The transition comp timeline is the render source of truth after creation.
Changing transition type intentionally regenerates the comp template. Render-time
code never overwrites manual edits.

## Sync Rules

Parent to transition comp:

- Duration change rescales the transition comp timeline to the new exact
  duration.
- Parent outgoing/incoming trim or media source changes refresh only the linked
  source clip windows.
- Type change regenerates the template.
- Removing a transition deletes or garbage-collects its hidden transition comp.
- Double-click/open only opens the existing comp. It must not create duplicate
  comps when pointer and double-click handlers fire for the same gesture.

Transition comp to parent:

- Timeline duration change updates parent transition duration.
- Closing/switching from a transition comp saves it through the existing
  active-composition save path.
- The parent overlay label/type follows parent transition metadata; the render
  result follows the comp.

Do not sync render internals back into parent clips. The parent only needs
duration, linked ids, and composition id.

## Render Path

Preview:

- `LayerBuilderService` sees an active transition and builds one normal
  `nestedComposition` layer from `transition.compositionId`.
- If the transition comp is not ready, hold/drop through the existing nested
  comp readiness behavior. Do not fall back to recipe rendering.
- Remove `assemblePreviewTransitionLayers` from preview render code.

Composition render:

- `compositionRenderer.evaluateAtTime(...)` must use the same rule for
  transitions inside any composition.
- `buildCompositionTransitionLayersForTrack(...)` should become nested-comp
  layer construction or be deleted.

Export:

- `ExportLayerBuilder` builds the same `nestedComposition` layer.
- Export waits for nested video sources and mask textures through shared nested
  comp readiness.
- Remove `assembleTransitionLayers` from export render code.

Shared helper:

```ts
buildTransitionNestedCompositionLayer(...)
```

Use it from preview, composition render, and export instead of keeping three
versions of the same mapping.

## Media Panel And Navigation

Filter hidden transition comps from visible project item lists:

- `useMediaPanelProjectItems(...)`
- `mediaStore.getItemsByFolder(...)`
- search results and item totals
- rename/delete commands that operate on visible Media Panel selection

Do not remove hidden transition comps from:

- `mediaStore.compositions`
- `getItemById(...)`
- open composition tabs
- project save/load
- renderer lookup
- usage/dependency cleanup

The user can only reach a hidden transition comp through its transition overlay
or an already open tab.

## Persistence And Migration

On project load and before first render, normalize all transitions:

1. For each `transitionOut`/`transitionIn` pair without `compositionId`, create
   a hidden transition comp.
2. For transition comps with padding, rewrite them to exact-duration comps and
   retime clips/keyframes.
3. Delete orphan hidden transition comps whose parent transition no longer
   exists.
4. Persist the normalized state on the next normal save.

Keep this migration idempotent. Running it twice must not duplicate comps.
Keep generated linked clip ids stable during padding removal so existing user
edits and keyframes stay attached.

## Implementation Order

1. Add one idempotent `ensureTransitionCompositionForPair(...)` in
   `transitionCompositionService.ts`, using existing transition recipe metadata
   where possible.
2. Call it from the timeline store action after transition add/update/load
   normalization, not from the pure edit reducer.
3. Filter hidden transition comps from Media Panel visible lists while keeping
   `getItemById`, tabs, renderer lookup, and project save/load unchanged.
4. Add transition removal/orphan cleanup.
5. Extract one shared `buildTransitionNestedCompositionLayer(...)` and use it
   from preview, composition render, and export.
6. Replace composition-internal legacy transition rendering with nested-comp
   layer construction.
7. Delete runtime uses of `assembleTransitionLayers` and
   `assemblePreviewTransitionLayers`.

## Deletions

Delete or demote these after all templates exist:

- `assembleTransitionLayers(...)`
- `assemblePreviewTransitionLayers`
- parent-render use of transition recipe masks, distortion, overlay primitives
- export-specific transition recipe rendering
- generic inner-transition comp generation

Keep transition definitions as preset metadata and template input.

## Checks

Smallest useful checks:

- Unit: adding any transition creates one hidden comp and writes its id to both
  transition edges.
- Unit: Media Panel project items exclude `transitionComp` compositions.
- Unit: migration creates missing comps and does not duplicate on second run.
- Unit: removing a transition removes or orphans-cleans the hidden comp.
- Unit: preview/export layer builders never call legacy transition assembly.
- Bridge smoke: scrub through a transition in parent comp and opened transition
  comp; both show matching frames.
- Bridge smoke: export the transition range and compare against preview frames.

## Done

- No runtime imports of `assembleTransitionLayers` or
  `assemblePreviewTransitionLayers` remain outside template generation.
- All current transition types render through hidden nested compositions.
- Existing projects with legacy transitions load and normalize.
- Transition comps are not visible in the Media Panel.
- Doppelklick on the overlay opens the hidden comp.
- Main preview, opened comp preview, RAM preview, and export use the same nested
  comp output.
