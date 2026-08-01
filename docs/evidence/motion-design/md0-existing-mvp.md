# Motion Design MD0 Existing MVP Evidence

Date: 2026-07-31
Gate: `MD0_EXISTING_MVP_COMPLETE`
Status: complete; disposable lower-third, preview/nested-preview, export, undo/redo, and save/reopen evidence recorded

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

Original implementation command:

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

Wave 0 adversarial closeout added a hidden, non-chat evidence tool plus an exact
disposable-session runner. The runner rejects non-loopback bridge bases before
reading the token, requires one run-specific `*.localhost` URL, targets its
session id explicitly, refuses saved/chat-active/shared-origin targets, and
verifies the returned session id. The evidence action always restores timeline,
media, history, and render dimensions, including partial-failure paths.

Current closeout results:

```text
motionDesignMd0Evidence.test.ts: 12/12 passed
MD0 adjacent regression: 6 files, 110/110 passed
registry/policy/evidence integration: 3 files, 68/68 passed
targeted ESLint: passed
tsc --noEmit -p tsconfig.app.json: passed
npm run build:deploy: passed (10,400 modules)
```

App typecheck command:

```text
tsc --noEmit -p tsconfig.app.json
exit 0
```

This passed after the final Wave 0 integration changes.

## Live bridge evidence

The live bridge was queried read-only after `getTimelineState`, as required by the editor-control contract.

- bridge status: ready;
- engine: ready;
- all six Motion Design tools present on the live tool surface;
- capabilities: rectangle/ellipse, color-fill/stroke, Grid, max 100 instances;
- `getStats.motionDesign.timeline` and `getStats.motionDesign.renderer` present.

The connected editor contained user video and storyboard work. No mutation tool was run against it.

## Recorded gate evidence

The exact-target runner completed successfully in a unique, unsaved, chat-free
disposable session. The final record is
[`md0/report.json`](./md0/report.json); its direct and nested representative
frames are [`lower-third-direct-t1.png`](./md0/lower-third-direct-t1.png) and
[`lower-third-nested-t1.png`](./md0/lower-third-nested-t1.png).

The record proves the 13-action AI batch, a six-second locked composition,
one-step undo to zero clips, redo to both clips with the final text selection,
stable opacity keyframes, composition save/reopen, direct/nested frame parity,
two successful export runs with nonempty encoded blobs, and complete state
restoration. The final record was refreshed after the history-runtime and
explicit-duration fixes; `failures` is empty.

The record retains two deliberate scope limits: persistence currently
proves the normal composition serializer save/reopen path rather than a complete
IndexedDB/project-file reload, and export proves the FrameExporter preview
fingerprint plus a nonempty encoded blob without decoding MP4/WebM bytes back to
pixels. These limits remain visible and cannot silently close a broader gate.
