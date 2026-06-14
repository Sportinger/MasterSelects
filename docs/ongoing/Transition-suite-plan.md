> Status: Ongoing active plan for issue #196. This is planning context, not completed archive.

# Transition Suite Plan

**Issue:** #196, Transition Suite  
**Branch:** `issue-196-transition-suite`  
**Base:** `staging`  
**Date:** 2026-06-14

---

## Current State

Implementation progress on this branch:

- The first-pass registry now exposes Crossfade, Dip to Black, Dip to White,
  Wipe Left, and Wipe Right as serializable primitive recipes.
- Timeline apply/update/remove and drag hover use the shared transition planner
  with virtual centered-on-cut semantics.
- Hover previews distinguish transition body, real source handles, and red
  hold-frame fallback ghosts.
- Preview and export share transition layer assembly, including virtual
  participant source clips for real handles and first/last-frame hold fallback.
- Export frame context and VideoSeeker now include transition participants, and
  parallel decode has source-time prefetch/lookup for virtual handles.
- Wipe transitions render through compositor transition metadata in both normal
  and external-video shader paths.
- Existing timeline transition bodies are selectable and expose a
  transition-scoped Properties tab for duration, handle/hold details, and
  removal.
- Selected transition bodies can be resized from either timeline edge, moved
  left/right by dragging the body, and edited through the Properties tab; all
  paths use shared transition edit operations and planner feedback. Body moves
  snap back to the centered cut position and to source-handle edges; move and
  resize previews keep showing real-handle and red hold-fallback ghosts.
- The Transitions panel is no longer WIP and the user-facing docs are updated.

Original baseline before these packets:

The transition system has the right timeline foundation, but only one real
transition is wired end to end.

- `src/transitions/types.ts` defines `crossfade`, `dip-to-black`,
  `dip-to-white`, `wipe-left`, and `wipe-right`.
- `src/transitions/index.ts` registers only `crossfade`.
- `src/components/panels/TransitionsPanel.tsx` displays whatever the registry
  returns, currently just Crossfade.
- `src/components/timeline/hooks/useTransitionDrop.ts` finds a nearby junction
  and creates a generic ghost preview, but it does not calculate source handles
  or show whether the requested duration can be covered by real media.
- `src/components/timeline/components/TransitionOverlays.tsx` draws existing
  transitions and the current hover as simple junction overlays, without
  source-availability, hold-frame feedback, or interactive selection/resize
  hit targets.
- `src/stores/timeline/editOperations/transitionOperations.ts` applies
  reciprocal `transitionIn` / `transitionOut` metadata and resolves duration
  through the shared planner with only the selected transition minimum enforced.
- `src/services/layerBuilder/LayerBuilderService.ts` detects overlapping linked
  clips, but renders every transition as a two-layer opacity crossfade.
- `src/engine/export/ExportLayerBuilder.ts` currently selects one active clip
  per video track through `clipsByTrack`, so same-track transition overlaps are
  not a reliable export render input yet.
- `src/engine/render/LayerCollector.ts` reverses layer input before
  compositing, so transition helpers must own and document their intended
  top-to-bottom layer order.
- `src/types/dock.ts` still marks the `transitions` panel as WIP.
- `src/services/aiTools/definitions/transitions.ts` advertises only
  `"crossfade"`.
- `docs/Features/Effects.md` documents effect categories, but not the timeline
  transition suite as a user-visible feature.

The important architectural gap is rendering across both preview and export:
registering more transition IDs without renderer changes would create
differently named crossfades, and export currently needs overlap-aware layer
building before it can match preview.

---

## Goals

1. Ship a first complete Transition Suite with:
   - Crossfade
   - Dip to Black
   - Dip to White
   - Wipe Left
   - Wipe Right
2. Preserve the durable timeline data contract while replacing the current
   transition implementation detail that moves the incoming clip:
   - durable clip metadata remains plain serializable data
   - no runtime handles in stores or project data
   - transitions remain same-track, adjacent/overlap clip operations
   - first-pass centered placement keeps the edit point stable and samples
     source handles virtually on both sides instead of shifting clips
3. Make drag hover source-aware:
   - show how much outgoing/incoming source material is available for the
     requested transition
   - show where first/last-frame hold will be used when material runs out
   - keep locked-track, unsupported-type, and missing-junction states visibly
     blocked
4. Make preview and export render visibly distinct transition types from the
   same transition assembly contract.
5. Promote the Transitions panel from WIP once behavior is covered.
6. Document the user-facing feature and the renderer constraints.

---

## Non-Goals For First Pass

- Slide and zoom transition implementations.
- Arbitrary custom shader transitions.
- Per-transition shader/artistic parameter editing beyond duration, placement,
  and hold policy.
- Cross-track transitions.
- Audio crossfades tied to visual transitions. Linked audio timing must still
  remain unchanged and must not be silently desynced by visual transition
  operations.
- Reworking the entire compositor or effect registry.

Slide and zoom can follow once the render contract supports transition-specific
per-fragment behavior cleanly.

---

## Architecture Direction

### Transition Definitions

Use a hybrid architecture: transitions stay timeline-native two-clip objects,
but their definitions are built from typed, serializable effect/animation
primitives. Do not store transitions as ordinary `clip.effects`, because a
timeline transition owns outgoing/incoming clips, placement, source handles,
hold policy, and preview/export overlap behavior.

First-pass definition shape:

```ts
type TransitionLayerTarget = 'outgoing' | 'incoming' | 'solid';

type TransitionCurve = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out';

type TransitionPrimitive =
  | {
      kind: 'opacity';
      target: TransitionLayerTarget;
      from: number;
      to: number;
      startProgress?: number;
      endProgress?: number;
      curve?: TransitionCurve;
    }
  | {
      kind: 'solid';
      color: '#000000' | '#ffffff';
    }
  | {
      kind: 'mask';
      target: 'outgoing' | 'incoming';
      mask: 'wipe';
      direction: 'left' | 'right';
    };

interface TransitionDefinition {
  id: TransitionType;
  name: string;
  category: TransitionCategory;
  defaultDuration: number;
  minDuration: number;
  maxDuration?: number; // advisory only; timeline duration edits are not hard-capped
  description: string;
  params?: Record<string, TransitionParamDefinition>;
  recipe: TransitionPrimitive[];
}
```

The first-pass suite can still be small:

- Crossfade: incoming opacity primitive over outgoing base layer.
- Dip to Black/White: solid primitive plus outgoing/incoming opacity windows.
- Wipe Left/Right: incoming mask primitive over outgoing base layer.

Keep the first-pass interpreter deliberately narrow: execute only `opacity`,
`solid`, and `mask` primitives. The durable model can reserve room for future
`transform`/3D and `shader-effect` primitives, but those should not be emitted
or interpreted until the two-input renderer, bounds math, and Properties
controls for them are explicitly designed.

The timeline clips should continue storing only `id`, `type`, `duration`, and
`linkedClipId` unless edge placement or source-hold behavior requires optional
plain fields. If added, those fields must stay serializable and backwards
compatible, for example:

```ts
type TransitionPlacement = 'center' | 'end-at-cut' | 'start-at-cut';
type TransitionEdgePolicy = 'hold' | 'require-handles';
```

The transition recipe is resolved from the registry by type before hot
render/export loops, or through a small compiled-recipe cache. Runtime handles,
DOM media objects, canvas objects, decoder state, and generated textures must
not be stored in transition metadata.

### Edge Placement, Handles, And Holds

Dragging a transition from the panel to the timeline should target a concrete
edit edge or junction, not a generic clip body. The hover resolver should find
the nearest same-track candidate and compute a transition plan before drop.

Candidate placement model:

- `center`: transition body straddles the junction. The outgoing clip needs
  right-side source handle after its visible `outPoint`; the incoming clip
  needs left-side source handle before its visible `inPoint`.
- `end-at-cut`: transition body ends at the junction. The incoming clip needs
  left-side source handle before its visible `inPoint`.
- `start-at-cut`: transition body starts at the junction. The outgoing clip
  needs right-side source handle after its visible `outPoint`.

First pass should use the user-facing `center` placement, but should not
create a real timeline overlap by moving clips. The target contract is a
virtual transition body straddling the junction: the edit point stays stable,
the incoming sublayer samples its left source handle before the clip's visible
`inPoint`, the outgoing sublayer samples its right source handle after the
clip's visible `outPoint`, and missing material is represented as first/last-
frame hold when policy allows it. Existing tests that assert
`clipB.startTime = clipAEnd - duration` must be updated as part of the contract
migration.

The hover data model should stay placement aware so `end-at-cut` and
`start-at-cut` can remain explicit alignment options without reworking the
contract. If later work wants a real-overlap edit mode that physically moves
clips, that should be a separate explicit operation, not the default timeline
transition semantics.

Handle availability is source data, not timeline pixel math:

- incoming left handle: `clip.inPoint`
- outgoing right handle: `source.naturalDuration - clip.outPoint`
- requested handle need: derived from duration and placement
- missing handle time: rendered as first-frame or last-frame hold only when the
  transition edge policy allows it

Put this math in a pure transition planner before UI or renderer code depends
on it. The planner should receive outgoing clip, incoming clip, transition
definition, requested duration, placement, edge policy, and source duration
facts, then return:

- resolved duration and transition body range
- timeline timing changes needed by the selected placement, which should be
  empty for first-pass virtual centered placement
- outgoing/incoming transition participant windows, including participants that
  are not normally active under `getClipsAtTime(time)`
- real-media handle coverage per side
- first/last-frame hold coverage per side
- blocked reason or warnings
- source-time override data needed by preview and export

Hover previews, apply/update-duration operations, Properties edits, preview
layer building, and export layer building should all consume this same plan
instead of recomputing duration, handle, or hold rules separately.

Expected hover feedback:

- show the proposed transition body on the timeline before drop
- show real-media handle coverage for each side as the normal/positive ghost
- show first/last-frame hold segments separately when real media is short
- show hold fallback as a negative ghost state, visually distinct from valid
  media coverage: red tint/stripe and a compact overrun duration such as
  `+0.4s hold` or `0.4s past source`, so the user immediately sees how far the
  requested transition extends beyond real source material
- show a blocked state only for structural failures such as no valid junction,
  locked track, unsupported transition type, non-renderable media, or
  `require-handles` with insufficient source material

Reuse the existing timeline preview machinery rather than introducing a
separate overlay system:

- `TimelineToolPreview.ghostRanges` is already the store-level contract for
  drag previews.
- `useClipTrim.ts` already creates trim/ripple/rolling ghost ranges.
- `timelineClipCanvasTrimResource.ts` already calculates source-extension
  ghosts from `inPoint`, `outPoint`, and source duration. Transition hover
  should extract or mirror that calculation in a focused helper instead of
  duplicating canvas math.
- Add transition-specific ghost variants only where the existing
  `transition-drop` variant is not expressive enough, such as real handle
  coverage versus held first/last-frame coverage. At minimum distinguish:
  `transition-real-handle`, `transition-hold-fallback`, and blocked
  `transition-drop`; the hold-fallback variant is the red negative ghost.

Renderer implication:

- Hold frames should be implemented by clamping the transition sublayer's source
  time to the nearest available source frame for the deficient segment.
- This must be done in preview and export through the shared transition
  assembly/source-time contract, not by extending source media objects or
  storing runtime handles.
- Preview and export must not rely only on normal `clipsAtTime` membership for
  transition rendering. A virtual transition can require rendering an incoming
  or outgoing participant outside that clip's normal visible timeline range.
- In export, the source-time override must be available before seek/decode
  (`VideoSeeker` and related decode setup), because clamping only at layer
  construction is too late once the wrong frame has been requested.

### Effect Primitive Reuse And Future Transform Support

The recipe interpreter should reuse existing interpolation, effect parameter,
Properties-panel control, and future transform-control patterns where
practical. It should not reuse them by forcing timeline transitions into the
one-clip `EffectInstance` stack. The shared layer assembly should compile a
transition recipe into runtime layer instructions for outgoing, incoming,
optional generated layers, and optional shader/compositor metadata.

### Shared Transition Layer Assembly

Move transition-specific layer construction out of the main preview
`buildLayers` method and share the assembly rules with export. The helper
should not know about browser media handles, stores, or export decoder state;
instead it should receive the outgoing clip, incoming clip, transition
definition, placement/source-handle plan, progress, and callbacks that build a
clip layer or a runtime solid layer.

The current preview builder mixes sparse slot assignment (`layers[layerIndex] =
layer`) with transition `push(...)` calls. The transition suite should replace
that with one flat ordered layer list for visible normal layers and transition
sublayers. Do not let array index side effects decide z-order.

This keeps durable timeline data plain while making preview and export consume
the same transition stack rules. It also prevents `LayerBuilderService.ts` and
`ExportLayerBuilder.ts` from drifting into separate transition implementations.

The helper must produce unique sublayer IDs because compositor uniform buffers
and caches are keyed by layer ID. IDs should be deterministic and include at
least transition ID, sublayer role, source clip ID when present, and track index
or another stable track discriminator.

The helper should also define layer order explicitly. Use a canonical
top-to-bottom transition stack such as incoming, outgoing, then generated
bottom layers; preview/export adapters can translate that to the engine's
collector order, but tests should verify final visual order rather than relying
on incidental array order.

Expected behavior:

- Crossfade: outgoing remains fully opaque underneath, incoming fades up on
  top. This avoids darkening over a transparent clear buffer.
- Dip: generated runtime solid color layer sits at the bottom; outgoing fades
  down during the first half; incoming fades up during the second half.
- Wipe: outgoing remains fully opaque underneath; incoming stays fully opaque
  and gets runtime wipe metadata so the compositor can reveal it by screen UV.
- Hold-frame segments: the affected sublayer samples the first or last
  available source frame until real source material becomes available again.

Export-specific requirement:

- Replace the export path's one-clip-per-track transition assumption with
  sorted per-track clip groups that include both normal active clips and
  planner-provided transition participants, for example an
  `activeClipsByTrack` plus `transitionParticipantsByTrack` structure. Same-
  track virtual transition bodies can include adjacent clips that are not
  returned by `getClipsAtTime(time)`, so export cannot use `clipsAtTime` alone.
- Keep the single-clip fast path and non-transition export behavior unchanged
  when a track has zero or one active clip and no transition participants.
- Avoid in-place array mutation in render/export hot paths. Use `toSorted()` or
  precomputed sorted groups instead of mutating `trackClips.sort(...)`.
- Feed planner source-time overrides into export seek/decode before
  `ExportLayerBuilder` creates layers, including sequential `VideoSeeker` and
  parallel decode paths, so held first/last frames sample the intended source
  frame.

### Compositor

Wipe transitions require per-fragment alpha gating. Add an optional typed
transition render state to `Layer` and carry it through uniform writing into
both normal and external composite shaders.

Important constraints:

- Keep the normal path unchanged when `layer.transitionRender` is absent.
- Update both `src/shaders/composite.wgsl` and the external composite shader
  path if they share uniform layout assumptions.
- Reuse the existing compositor uniform padding slots if possible so the bind
  group layout and uniform buffer size remain unchanged.
- Avoid canvas-size or OffscreenCanvas changes; this feature should not touch
  the Linux/Mesa timeline canvas risk area.

### UI

The Transitions panel is a palette of draggable transition items, grouped by
category, with preview thumbnails that match each render model. It is not an
effects stack editor: each item is dragged onto a timeline clip edge, clip
junction, or valid overlap target. During hover, the existing timeline ghost
preview path should show the proposed transition body, available source
handles, and any first/last-frame hold segments before the timeline operation
creates reciprocal `transitionIn` / `transitionOut` metadata on the two
same-track clips.

Duration min/max should come from the selected transition definition, not
hardcoded panel constants. The drag payload should stay plain serializable JSON
containing the transition ID and duration.

Existing transitions should render directly on the timeline as editable
transition bodies spanning their planned transition range. The body should show enough
information to identify the type without opening another panel:

- distinct visual treatment by render model: dissolve/dip/wipe
- compact transition name or icon when there is enough width
- visible start/end edges or handles for duration edits
- hover/selection state, with blocked or hold-frame warning state when relevant

After a transition is applied, users should be able to:

- drag either edge of the transition body to shorten or lengthen duration
- drag the body left/right to offset the transition relative to the cut while
  clips stay fixed and source-handle / hold-frame ghost feedback remains visible
- snap body moves to the centered cut position and to the available source
  handle edges; snap duration edits to the same source-handle edges
- use an inspector control to change placement once placement modes are exposed
- select the transition and edit first-pass settings in the Properties panel or
  an equivalent lightweight inspector
- delete the transition from the selected overlay or context menu

When a transition body is selected, the Properties panel should switch from
clip-scoped tabs to a transition-scoped parameter tab. The tab should show the
selected transition name/type, linked outgoing/incoming clips, duration,
placement, edge policy, and any render-model-specific first-pass controls. It
should call transition edit operations rather than mutating clip metadata
directly.

First-pass editable settings:

- transition type
- duration
- placement/alignment: show the current centered placement first; keep
  `end-at-cut` and `start-at-cut` as explicit future alignment options
- edge policy (`hold` vs `require-handles`)

Remove `transitions` from `WIP_PANEL_TYPES` only after:

- all five first-pass transitions are registered
- drag/drop applies them
- existing transitions are visible and selectable on the timeline
- duration edits update reciprocal transition metadata
- preview/export render distinct visuals
- focused tests cover registry, store, and render-layer behavior

---

## Work Packets

### Packet 0: Transition Contract Lock

**Goal:** Lock the first-pass transition contract before UI or renderer work:
centered placement is handle-based and virtual, the edit point stays stable,
clips are not moved, and source handles/hold frames are planned explicitly on
both sides.

**Write set:**

- focused planner contract helper/types under
  `src/stores/timeline/editOperations/` or another timeline-domain location
- `tests/unit/transitionPlanner.test.ts` or equivalent focused contract test
- `src/types/timeline.ts` only if optional durable fields such as placement or
  edge policy are needed

**Checks:**

```bash
npm run test -- tests/unit/transitionPlanner.test.ts
npx tsc -b
```

**Stop condition:** tests define the target model for `end-at-cut`, `center`,
and `start-at-cut`; first-pass centered placement keeps clip start/end timing
stable, computes incoming/outgoing handle and hold-frame coverage, returns
transition participants that may sit outside normal `clipsAtTime`, and
documents how old move-overlap transition metadata is interpreted or migrated.

### Packet 1: Registry And Recipe Definitions

**Goal:** Register all first-pass transitions and expose typed primitive
recipes.

**Write set:**

- `src/transitions/types.ts`
- `src/transitions/index.ts`
- `src/transitions/**`
- `tests/unit/transitionRegistry.test.ts` or equivalent focused registry test

**Checks:**

```bash
npm run test -- tests/unit/transitionRegistry.test.ts
npx tsc -b
```

**Stop condition:** `getAllTransitions()` returns exactly the first-pass suite,
with stable IDs, categories, duration bounds, params, and serializable primitive
recipes for crossfade, dip, and wipe.

### Packet 2: Operation And Hover Coverage

**Goal:** Make timeline operations and drag hover consume the planner contract:
apply/update-duration/remove must use handle-based virtual centered placement,
source-aware hover must use the existing ghost preview contract, and invalid
edits must still be rejected.

**Write set:**

- `tests/unit/timelineEditOperations.test.ts`
- focused hover/history test if split from the timeline operation test
- `src/components/timeline/hooks/useTransitionDrop.ts`
- timeline overlay rendering/layout for transition ghost variants if separate
  from the hook
- `src/stores/timeline/storeTypes/toolTypes.ts`
- `src/stores/timeline/editOperations/transactionTypes.ts`
- `src/stores/timeline/editOperations/transitionOperations.ts`
- shared/extracted trim-source-extension helper if needed, reusing the logic
  currently embedded in `timelineClipCanvasTrimResource.ts`

**Checks:**

```bash
npm run test -- tests/unit/timelineEditOperations.test.ts
```

**Stop condition:** apply, clamp, update-duration, remove, locked-track
rejection, unsupported-type rejection, hover placement, source-handle
availability, and hold-frame fallback are covered for representative
non-crossfade transitions. Applying a first-pass centered transition must not
move either clip; linked audio timing must remain unchanged; hover previews
must not create undo/history entries; hold fallback renders as a red negative
ghost with overrun duration; and `resolveTransitionDuration` must
be removed or reduced to a planner call so duration and edge-policy rules have
one authority.

### Packet 3A: Shared Preview Recipe Interpreter And Layer Order

**Goal:** Build the right preview layer stack for crossfade, dip, and wipe by
compiling transition recipes through one shared assembly contract, while fixing
preview layer ordering to use a flat deterministic layer list instead of mixed
slot assignment and `push(...)`.

**Write set:**

- `src/services/layerBuilder/LayerBuilderService.ts`
- `src/services/layerBuilder/FrameContext.ts`
- `src/services/layerBuilder/types.ts`
- optional focused helper under `src/services/layerBuilder/`
- optional compiled recipe/cache helper under `src/transitions/` or
  `src/services/layerBuilder/`, avoiding per-frame registry scans
- `src/types/layers.ts`
- `tests/unit/layerBuilderService.test.ts`

**Checks:**

```bash
npm run test -- tests/unit/layerBuilderService.test.ts
npx tsc -b
```

**Stop condition:** tests verify layer count/order, opacity curves, dip color
layer presence/color, deterministic transition sublayer IDs, explicit
top-to-bottom ordering, virtual transition participants outside normal
`clipsAtTime`, source-time behavior for real handles versus held edge frames,
cached recipe lookup, and wipe transition render metadata at progress 0, 0.5,
and 1. Tests should exercise the recipe interpreter, not one-off branches for
each named transition.

### Packet 3B: Export Transition Participants And Frame Context

**Goal:** Make export layer building consume the same transition participant
plan as preview, without collapsing same-track transition participants to one
clip per track.

**Write set:**

- `src/engine/export/FrameExporter.ts`
- `src/engine/export/ExportLayerBuilder.ts`
- `src/engine/export/types.ts`
- `src/engine/export/layerBuilder/contracts.ts`
- optional export adapter helper under `src/engine/export/layerBuilder/`
- `tests/unit/exportLayerBuilder.test.ts` or equivalent focused export test

**Checks:**

```bash
npm run test -- tests/unit/exportLayerBuilder.test.ts
npx tsc -b
```

**Stop condition:** export tests verify normal single-clip behavior stays
unchanged, same-track virtual transition participants are grouped without
last-wins `clipsByTrack` collapse, adjacent clips not returned by
`getClipsAtTime(time)` can still participate in a transition body, and preview
and export use the same recipe/participant assembly decisions.

### Packet 3C: Export Source-Time Overrides Before Decode

**Goal:** Feed planner source-time overrides into export seek/decode before
frames are requested, so held first/last frames and real handles sample the
same source times that preview renders.

**Write set:**

- `src/engine/export/VideoSeeker.ts`
- `src/engine/ParallelDecodeManager.ts`
- `src/engine/export/FrameExporter.ts`
- `src/engine/export/types.ts`
- focused export seek/decode tests if present or practical

**Checks:**

```bash
npm run test -- tests/unit/exportLayerBuilder.test.ts
npx tsc -b
```

**Stop condition:** sequential export seeking and parallel decode both receive
planner source-time overrides before frame acquisition; held edge frames seek
to the first/last available source frame; real-handle segments seek to real
source time; and layer construction no longer performs the first source-time
clamp.

### Packet 4: Compositor Wipe Rendering

**Goal:** Make wipe mask primitives visible in preview and export by applying a
shader alpha gate from recipe-compiled transition runtime metadata, after a
mandatory uniform-layout audit.

**Write set:**

- `src/engine/pipeline/compositor/uniforms.ts`
- `src/engine/pipeline/CompositorPipeline.ts`
- `src/engine/pipeline/compositor/externalCompositeShader.ts`
- `src/shaders/composite.wgsl`
- focused tests for uniform packing/no-op behavior

**Checks:**

```bash
npx tsc -b
npm run test -- tests/unit/layerBuilderService.test.ts
npm run test -- tests/unit/exportLayerBuilder.test.ts
```

**Manual/browser checks:**

- Open the app, create two adjacent visual clips, apply Wipe Left and Wipe
  Right, scrub through the overlap.
- Run an AI bridge `debugExport` probe on a short transition range if the dev
  server/browser bridge is available.

**Stop condition:** wipe left/right are visibly different from crossfade in
preview and in export output; the audit documents whether existing uniform
padding is reused or the layout changes; normal and external composite paths
stay in sync; and absent `layer.transitionRender` packs byte-for-byte identical
or explicitly asserted no-op uniform values.

### Packet 5: Transitions Timeline And Panel UX

**Goal:** Make the panel and timeline transition editing production-ready for
the first-pass suite.

**Write set:**

- `src/components/panels/TransitionsPanel.tsx`
- `src/components/panels/TransitionsPanel.css`
- `src/components/timeline/components/TransitionOverlays.tsx`
- timeline interaction hooks/components needed for selecting, resizing, and
  deleting transition bodies
- selection model/actions for a transition selection such as transition ID plus
  linked outgoing/incoming clip IDs
- Properties panel selection/routing files so selected transition bodies show a
  transition parameter tab instead of clip-only tabs
- focused Transition Parameters tab/component
- `src/types/dock.ts`
- `tests/unit/dockPanelConfigs.test.ts`
- focused timeline interaction/render-model tests if present or practical

**Checks:**

```bash
npm run test -- tests/unit/dockPanelConfigs.test.ts
npx tsc -b
```

**Stop condition:** panel groups transitions by category, thumbnails match the
render model, duration controls respect selected definition minimum, drag/drop
payloads remain serializable, valid timeline junctions apply each transition,
existing transition bodies are visible/selectable/editable on the timeline,
transition overlays have real hit targets rather than `pointer-events: none`,
duration edits call the existing update-duration operation, Delete/context-menu
routes through transition removal, first-pass settings are editable in a
transition-scoped Properties tab, and `transitions` is no longer WIP.

### Packet 6: AI Tooling And Docs

**Goal:** Update automation surface and user-facing docs.

**Write set:**

- `src/services/aiTools/definitions/transitions.ts`
- `docs/Features/Transitions.md`
- `docs/Features/README.md`
- possibly `docs/Features/Effects.md` for cross-linking

**Checks:**

```bash
rg -n "Currently supported: \"crossfade\"|transition suite|Transitions" src docs
npx tsc -b
```

**Stop condition:** docs describe the suite, limitations, and usage; AI tool
schema names all supported first-pass transition IDs.

---

## Acceptance Checklist

- [ ] Five first-pass transition definitions are registered.
- [ ] First-pass transitions are defined as serializable primitive recipes,
      not as unrelated hardcoded renderer branches.
- [ ] A pure transition planner is the shared source of truth for duration,
      placement, handle availability, hold-frame coverage, and blocked states.
- [ ] First-pass centered placement keeps the edit point stable and samples
      source handles virtually on both sides instead of moving clips.
- [ ] Transition participants can be rendered even when they are outside normal
      `getClipsAtTime(time)` membership.
- [ ] Drag/drop from the Transitions panel applies each supported type.
- [ ] Existing transitions render as visible timeline bodies with type-specific
      treatment.
- [ ] Existing transition bodies can be selected, deleted, and resized to edit
      duration.
- [ ] Selecting a transition opens/shows transition parameters in the
      Properties tab instead of clip-only controls.
- [ ] First-pass transition settings are editable after apply through
      transition edit operations.
- [ ] Hovering a transition over a clip edge/junction uses the existing
      timeline ghost preview path to show available outgoing and incoming
      source handles.
- [ ] Hovering with insufficient source material shows first/last-frame hold
      segments instead of silently blocking when hold policy is allowed.
- [ ] Hold fallback hover segments use a red negative ghost state with a clear
      overrun duration, separate from real-media handle coverage.
- [ ] Hover previews use the lightweight tool preview path and do not create
      undo/history entries.
- [ ] Timeline metadata stores only serializable transition state.
- [ ] Undo/redo restores transition metadata, transition body range, and
      source-time planning correctly.
- [ ] Linked audio timing is not silently changed by visual transition apply,
      resize, remove, or undo/redo.
- [ ] Locked tracks block transition edits.
- [ ] Crossfade, dip, and wipe render differently while scrubbing.
- [ ] Preview layer building uses a flat deterministic layer list; transition
      sublayers do not rely on mixed sparse index assignment and `push(...)`.
- [ ] Export output matches preview for the transition body.
- [ ] Export layer building handles same-track transition participants instead
      of collapsing to one active clip per track.
- [ ] Export seek/decode receives transition source-time overrides before layer
      construction.
- [ ] Transition sublayer IDs are deterministic and include transition, role,
      source clip, and track identity.
- [ ] Transition recipes are resolved or cached outside hot per-frame loops.
- [ ] Wipe compositor uniform changes include a mandatory no-transition/no-op
      packing test for normal and external paths.
- [ ] Transitions panel is removed from WIP classification.
- [ ] Feature docs are updated.
- [ ] Normal pre-commit chain passes on the final HEAD:

```bash
npm run build
npm run lint
npm run test
```

---

## Risks And Mitigations

- **Risk:** New IDs render as crossfades.
  **Mitigation:** Do not promote panel from WIP until render tests and browser
  checks prove visible differences.

- **Risk:** The recipe model becomes a premature full graph system.
  **Mitigation:** Keep first-pass executable primitives limited to opacity,
  solid, and mask. Add transform, shader-effect, or 3D-specific primitives only
  when a concrete transition and renderer contract require them.

- **Risk:** The current implementation's move-overlap behavior and the target
  handle/hold UX describe incompatible transition models.
  **Mitigation:** Add Packet 0 and lock the target contract before UI or
  renderer work. First-pass centered placement should be virtual and
  handle-based: the edit point stays stable, source handles are sampled
  explicitly on both sides, and old tests expecting the incoming clip to move
  are migrated deliberately.

- **Risk:** The renderer becomes five named special cases despite the recipe
  definitions.
  **Mitigation:** Test through the recipe interpreter and keep named
  transition IDs at the registry/definition level.

- **Risk:** Transition hover duplicates or diverges from trim ghost behavior.
  **Mitigation:** Reuse `TimelineToolPreview.ghostRanges` and extract/mirror
  the existing trim source-extension calculation instead of creating a separate
  transition overlay system.

- **Risk:** Transition hover churns the transaction/history pipeline.
  **Mitigation:** Hover should set lightweight tool previews directly or
  through an explicit preview-only path; add a test that drag hover does not
  create undo/history entries.

- **Risk:** Transition hover lies about available material.
  **Mitigation:** Derive handle availability from `inPoint`, `outPoint`, and
  `source.naturalDuration`, and test enough-handle, partial-hold, and blocked
  cases.

- **Risk:** Hold-frame support changes clip timing unexpectedly.
  **Mitigation:** Treat hold as transition-local source-time clamping, not as a
  destructive trim or media extension. Preserve edit timing for first-pass
  centered placement; linked audio timing must remain unchanged unless a future
  audio transition feature intentionally edits it.

- **Risk:** Preview/export miss virtual transition participants because they
  are not in normal `clipsAtTime` at the current time.
  **Mitigation:** Planner output must include transition participant windows,
  and preview/export frame contexts must combine normal active clips with those
  participants before layer assembly and decode.

- **Risk:** Duration clamping drifts between planner and operations.
  **Mitigation:** Remove duplicate duration authorities such as standalone
  operation-only clamps, or reduce them to planner calls. Edge policy (`hold`
  versus `require-handles`) must be part of the same planner decision.

- **Risk:** Export clamps source time too late.
  **Mitigation:** Planner output must feed export seek/decode before
  `ExportLayerBuilder` creates layers; add a regression covering held edge
  frames in exported overlap ranges.

- **Risk:** Compositor uniform layout drift breaks external video paths.
  **Mitigation:** Update normal and external shader paths together and keep the
  no-transition defaults identical to current behavior. Run a mandatory
  uniform-padding audit before Packet 4 and prefer existing padding slots over
  changing buffer size or bind group layout.

- **Risk:** Preview and export diverge.
  **Mitigation:** Share the transition stack assembly rules and add an export
  regression test for two same-track transition participants, including a
  virtual participant outside normal `clipsAtTime`, that would previously be
  collapsed or missed by `clipsByTrack`.

- **Risk:** Layer order is accidentally correct in preview but wrong in export.
  **Mitigation:** Define canonical transition stack order and test final visual
  order in both adapters, accounting for `LayerCollector` reversing input.

- **Risk:** Preview layer order is corrupted by mixing sparse index assignment
  with transition `push(...)` calls.
  **Mitigation:** Replace the preview builder's layer collection with a flat
  deterministic ordered list for normal layers and transition sublayers.

- **Risk:** `LayerBuilderService.ts` becomes a transition dumping ground.
  **Mitigation:** Keep transition layer assembly in a focused helper with
  preview/export adapters.

- **Risk:** Duplicate transition sublayer IDs cause stale uniforms or cache
  collisions.
  **Mitigation:** Generate deterministic IDs that include transition ID, source
  clip ID, sublayer role, and track identity.

- **Risk:** Linked audio desyncs when a visual transition changes clip timing.
  **Mitigation:** First-pass virtual transitions should not move linked clip
  timing. Add tests for apply/resize/remove/undo so linked audio is either
  unchanged or intentionally handled by a future audio-transition packet.

- **Risk:** Transition lookup adds unnecessary per-frame overhead.
  **Mitigation:** Resolve or cache compiled recipes by transition type before
  the render/export hot path, and use sorted active-clip groups without
  in-place mutation.

- **Risk:** Project files with old crossfade metadata break.
  **Mitigation:** Keep `TimelineTransition.type` as string-compatible durable
  data and resolve unknown types through existing unsupported validation.

- **Risk:** Docs imply slide/zoom support before it exists.
  **Mitigation:** Keep slide/zoom explicitly deferred in first-pass docs.

---

## Suggested First Implementation Step

Start with Packet 0, then Packet 1. Do not implement panel UX or renderer work
until the contract tests prove the first-pass centered model is virtual,
handle-based, and does not move either clip. Then wire operations and hover
through the planner, using the existing ghost preview path without
history churn. After that, implement 3A preview assembly and flat layer order,
3B export participant grouping, and 3C export source-time overrides. Do not
touch compositor shader files until the registry, planner, store operations,
source-handle planning, virtual participant grouping, and preview/export layer
stack tests are green.
