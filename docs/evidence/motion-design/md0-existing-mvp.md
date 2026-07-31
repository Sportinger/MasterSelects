# Motion Design MD0 Existing MVP Evidence

Date: 2026-07-31
Gate: `MD0_EXISTING_MVP_COMPLETE`
Status: automated/code gates pass; disposable visual bridge capture remains

## Implemented surface

- `getMotionCapabilities`
- `getMotionDesign`
- `createMotionShapeClip`
- `updateMotionProperties`
- `updateMotionAppearances`
- `configureMotionReplicator`

The capability response is intentionally limited to the renderer-backed MD0 subset: rectangle, ellipse, color fill, stroke, Grid layout, ten instances per axis, and 100 effective instances.

`executeBatch` now accepts safe backward references such as:

```json
{
  "$batchResult": {
    "action": 0,
    "path": "clipId"
  }
}
```

This permits one batch to create native Motion Design and text clips and then keyframe their returned ids.

## Automated evidence

Command:

```text
vitest run aiToolMotionDesign aiToolBatchCore aiToolDefinitions aiToolPolicy
flashboardChatHarness flashboardChatService motionDesignRendering
motionDesignSurfaceParity propertyRegistry addCompClipNestedRestore
exportLayerBuilder layerBuilderService aiToolStats
```

Result:

```text
13 test files passed
370 tests passed
```

Covered behavior includes:

- definition/handler/policy/catalog parity;
- honest capabilities and renderer limits;
- atomic property validation and stable appearance ids;
- fill/stroke and Grid mutations;
- Motion Design keyframes;
- rounded rectangle save/load;
- one-step undo for a batch-created lower third plus editable text;
- equivalent evaluated state in main preview, nested preview, direct export, and nested export;
- renderer instance, cache, buffer-upload, byte, and CPU encoding telemetry;
- Motion Design fields in `getStats`.

App typecheck:

```text
tsc --noEmit -p tsconfig.app.json
exit 0
```

This passed immediately after the MD0 source changes. A later final rerun encountered eight missing modules imported by concurrently added Transition Preview work outside the Motion Design scope. Those unrelated files were left untouched; the focused Motion/AI rerun still passed 33/33 tests after the final prompt and documentation changes.

## Live bridge evidence

The live bridge was queried read-only after `getTimelineState`, as required by the editor-control contract.

- bridge status: ready;
- engine: ready;
- all six Motion Design tools present on the live tool surface;
- capabilities: rectangle/ellipse, color-fill/stroke, Grid, max 100 instances;
- `getStats.motionDesign.timeline` and `getStats.motionDesign.renderer` present.

The connected editor contained user video and storyboard work. No mutation tool was run against it.

## Remaining evidence

Run the lower-third construction in a disposable browser/project, capture a representative preview frame, run a bounded export frame comparison, and store the fingerprints or screenshots beside this file. The in-app isolated browser surface was unavailable during this implementation run, so this is the only remaining MD0 gate item.
