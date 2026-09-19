---
title: "Editable Motion Graphics"
---

MasterSelects can turn a focused FlashBoard request for an animated lower
third into normal timeline content instead of rendering an overlay video.
The result remains editable: text stays as text clips, backgrounds stay as
native Motion shapes, and entrance/exit animation stays in the clip keyframes.

## Current workflow

A request such as:

> At 00:15, create a two-line lower third for Leonie Berger / Production
> Manager. Fly it in from the right with a short overshoot, keep it readable,
> then fade it out.

can take either editor-chat path:

- **Codex Direct** may compose the registered title, Motion, keyframe, and
  review tools itself.
- **Fast** exposes the private `createEditableMotionGraphic` capability. The
  kernel validates the design request and compiles it to the editor-owned
  operation boundary.

The Fast vertical slice currently compiles one lower third into this ordered
program:

1. `timeline.hook.preview.v1` reads the revision-bound timeline preflight.
2. `timeline.hook.commit.v1` creates the complete editable graphic.
3. `timeline.visual.capture-grid.v1` captures six ordered review moments
   covering before, entrance, settle/overshoot, hold, exit, and after.

The editor revalidates and executes every public operation. Private prompts,
design heuristics, and intent compilation remain in the sibling kernel; they
are not added to the browser bundle.

## Native timeline result

A two-line lower third creates four linked visual clips under one stable
`hookId`:

- two native text clips;
- two native Motion backplate clips; and
- position/opacity keyframes on all four clips.

The motion request supports directional entrance and exit phases, easing,
duration, travel distance, and entrance overshoot. A fade phase changes only
opacity. Directional phases animate composition-pixel `position.x` or
`position.y` values, so the stored keyframes remain inspectable and editable
in the normal properties/keyframe UI.

The compiler rejects invalid geometry, colors, non-finite timing, motion
outside the clip duration, and animation that leaves less than 0.5 seconds of
readable hold. When distance is omitted, the editor uses the full composition
width or height so the graphic begins outside the frame.

No video, alpha movie, FFmpeg command, or generated Media Pool item is
created. The user can later change the text, type style, colors, placement,
and animation as ordinary MasterSelects content.

## Transaction and review behavior

The commit participates in the editor's normal transaction/history boundary.
Creating the text, backplates, stable identities, and every keyframe is one
user-facing undo unit. When the hook is created through the AI tool path, a
failure inside that history batch is rolled back to the pre-commit snapshot;
the handler itself does not compensate partial writes, so callers outside the
tool batch (direct handler use) must undo themselves.

Temporal review is required because a single still cannot prove an entrance
or exit. The private capability computes six bounded timeline times and asks
the actual editor renderer for one grid. The provider can inspect that result
and continue with bounded refinement when necessary.

## Current boundary and next work

This is the first functional vertical slice of the larger native production
compiler. `timeline.hook.preview.v1` is currently a revision-bound preflight,
not a shadow-rendered preview of the proposed layers. Therefore the six-frame
visual review happens after the atomic commit.

The next architecture work is a truthful non-mutating preview executor with a
digest-bound preview token, followed by commit of the exact reviewed program.
The durable multi-stage Production workflow (research, creative direction,
planning, assembly, graphics, finishing, review) is also still separate work.

## Verification

The feature is covered by focused tests for:

- strict private capability arguments and plan compilation;
- ordered six-frame review timing;
- invalid timing and readable-hold rejection;
- native position/opacity keyframe authoring;
- public operation-contract digest parity; and
- one-step undo of the complete editor result.

The first live end-to-end acceptance used FlashBoard Fast against a 1920x1080
composition. The kernel created four native clips with 28 keyframes, retained
a 4.5-second readable hold, captured all six temporal review frames, and
created no rendered media item.

## Relevant source

- `src/services/aiTools/handlers/editableHook.ts` (create/update/refine handlers)
- `src/services/aiTools/handlers/editableHookParsing.ts` (request schemas and parsing)
- `src/services/aiTools/handlers/editableHookMotion.ts` (entrance/exit keyframe authoring)
- `src/services/aiTools/handlers/editableHookSubcomposition.ts` (named subcomposition wrapper)
- `src/services/timelineSubcomposition.ts` (`createSubcompositionFromClipIds`)
- `src/services/aiTools/definitions/text.ts`
- `src/services/kernelClient/wp1Spike/publicOperationContracts.ts`
- sibling kernel: `src/agentRuntime/operationFamilies/editableMotionGraphic.ts`


## Tracked terrain graphics

Terrain sequences can be authored as ordinary text, Motion path shapes and nested timeline compositions. Footprint silhouettes, tread, L/R labels, analysis cards and connectors remain editable using the existing tools. Shared tracking bindings project their content onto the retained terrain mesh. Candidate analysis uses staggered starts and durations, rejection states and lock timing; generated timing is represented by clips and keyframes rather than an opaque full-video overlay.

Implementation: `nativeFootprintDesign.ts`, `nativeTerrainGraphics.ts`, `nativeTerrainSchedule.ts`, and `editableTerrainSequence.ts` under `src/services/planarTracking/`. Legacy shader HUDs remain supported.
