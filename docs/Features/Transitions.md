# Transitions

GPU-blended transitions between two adjacent clips on the same timeline track
(issue #196 — "Transition Suite").

## Overview

A transition is applied by dragging a transition from the **Transitions** panel
onto a clip junction (where two clips touch). The store creates a small overlap
by moving the incoming clip earlier; during that overlap the compositor renders
both clips and blends them with the transition's GPU shader.

Both playback and export share the same render path (`RenderDispatcher.render`),
so transitions render identically in the exported file.

## Available transitions

| Transition     | Category  | Parameters                |
|----------------|-----------|---------------------------|
| Crossfade      | dissolve  | easing                    |
| Dip to Black   | dissolve  | dip color, easing         |
| Dip to White   | dissolve  | dip color, easing         |
| Wipe Left      | wipe      | softness, easing          |
| Wipe Right     | wipe      | softness, easing          |

Click a placed transition on the timeline to open its editor popover (duration,
type-specific parameters, easing, and remove).

## Architecture

The system mirrors the effect system (`src/effects/`):

- **`src/transitions/`** — registry + per-transition modules. Each module exports
  a `TransitionDefinition` with a WGSL `shader`, `entryPoint`, `uniformSize`,
  `params` schema, and a `packUniforms(params, progress)` function.
  - `_shared/transitionCommon.wgsl` — shared prelude: fullscreen vertex shader,
    `fromTex`/`toTex` bindings, and a fixed 8-float `TransitionUniforms` block
    (`progress` + `p0..p6`).
  - `easing.ts` — `applyEasing` (applied to progress centrally, so every
    transition supports easing) and `hexToRgb` (for color params).

- **`src/engine/render/TransitionPipeline.ts`** — one render pipeline per
  transition (shared bind group layout: sampler, fromTex, toTex, uniform).
  `blend()` runs the transition shader from the isolated from/to textures into
  the blend target.

- **`src/engine/core/RenderTargetManager.ts`** — allocates three transition temp
  textures (`transFrom`, `transTo`, `transBlend`) at output resolution.

- **`src/services/layerBuilder/LayerBuilderService.ts`** — when the playhead is in
  a transition overlap it builds both clips as layers (at their normal opacity)
  and attaches `Layer.transition` metadata (`id`, `type`, `role`, `progress`,
  `params`).

- **`src/engine/render/Compositor.ts`** — detects the from/to pair via the layer
  metadata, renders each clip in isolation over a transparent base (so the result
  is in output space with transform/effects/mask applied), blends them with the
  transition shader, and composites the blended result onto the accumulator with
  an identity transform.

## Data model

- `TimelineTransition` (on a clip's `transitionIn` / `transitionOut`) stores
  `id`, `type`, `duration`, `linkedClipId`, and `params`.
- The same transition `id` and `params` live on both clips (mirrored on opposite
  edges); `updateTransitionParams` keeps them in sync.

## Adding a new transition

1. Create `src/transitions/<name>/index.ts` exporting a `TransitionDefinition`
   plus a `shader.wgsl` implementing a `@fragment fn <name>Fragment(...)` using
   `getFromColor(uv)` / `getToColor(uv)` and the `u.progress` / `u.p0..p6`
   uniforms.
2. Register it in `src/transitions/index.ts`.
3. Add its `TransitionType` literal in `src/transitions/types.ts`.

## Known limitations

- Transitions blend in straight (non-premultiplied) color; clips with partial
  alpha at the edges (heavily scaled/masked clips) can show slight edge
  darkening. Full-frame opaque clips (the common case) are unaffected.
- Transitions between clips **inside a nested composition** are not blended by
  the transition shader yet (the nested-comp renderer is a separate path).
- Transitions apply to two adjacent clips on the same track; three-way overlaps
  are not supported.
