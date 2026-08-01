# Motion Design MD2 Authoring and Animation Evidence

Date: 2026-07-31
Gate: `MD2_AUTHORING_AND_ANIMATION_COMPLETE`
Status: complete; Wave D exact-target visual and cross-render evidence recorded

## Implemented closeout

- The unified global graph remains the canonical multi-property editor opened by
  `G`, keyframe double-click, and property-row double-click.
- Selected position nodes expose paired viewport Bezier handles backed by the
  same `position.x` and `position.y` scalar keyframes as the graph.
- Spatial handles are emitted only when both scalar companions exist. Their
  common temporal coordinate is deterministic, clamps each axis before
  combination, and preserves the displayed derivative when scalar handle times
  differ.
- Node and handle drags use the canonical keyframe transaction lifecycle. A
  missing scalar companion receives a stable id, both ids are selected, and the
  complete edit produces one undo step.
- Pointer cancel, window blur, failed begin, and component unmount restore the
  exact prior values and selection. Pointer capture is released safely.
- Handle hit targets are 24 px, focusable button semantics are exposed, and
  arrow/Shift+arrow, Enter, and Escape support keyboard authoring.
- Keyframe selection now lives in the shared history snapshot rather than a
  viewport-only listener. Undo/redo therefore restores selection even after the
  preview has unmounted, and legacy history snapshots remain compatible.

## Automated evidence

Command:

```text
npx vitest run \
  tests/unit/historyKeyframeSelection.test.ts \
  tests/unit/keyframeTransactionLifecycle.test.ts \
  tests/unit/motionPathViewportWaveC.test.tsx \
  tests/unit/motionPathViewportWaveD.test.tsx
```

Original authoring result:

```text
4 test files passed
40 tests passed
```

Wave 0 now also provides a dedicated fail-closed evidence path:

- `scripts/run-motion-design-md2-evidence.mjs` requires one exact dedicated
  `*.localhost` session with a non-empty `motionDesignEvidenceSession` marker,
  a blank timeline, no project, no chat activity, and explicit
  `targetTabId`/`sessionId` routing. It never starts or navigates a browser.
- `run-motion-design-md2-evidence` is a hidden Debug Action, not a chat tool.
  It snapshots and restores timeline, media, history, export, dock layout,
  render dimensions, and the history-debug flag in `finally`.
- The action authors all 15 position-X/Y and opacity keyframes through the
  production AI sequence handler and records the returned stable ids,
  canonical/stored values, resolved times, and easing.
- It exercises the real Preview Edit control and spatial-handle keyboard
  handler, then proves exact one-step undo/redo values, handles, ids, and
  selection. It also opens the real Global Graph, exercises per-series mute,
  show-all, and solo controls, and proves a deliberately short Timeline panel
  expands and restores its exact prior ratio when Graph closes.
- Six PNG surfaces are mandatory: direct/nested preview and export, the actual
  Global Graph SVG, and the actual Motion Path overlay SVG. Direct/nested
  render parity, static-versus-animated differentials, nonblank coverage, and
  optional record/verify baselines are checked before success.
- Nested evidence embeds the post-UI-edit keyframes with the same ids, values,
  times, easing, and handles while remapping only `clipId` to the nested clip.

Combined original plus new MD2 focused result:

```text
8 test files passed
64 tests passed
```

The new runner/fixture/lifecycle/DOM-capture packet contributes 24 tests. Its
Node syntax/help checks, targeted ESLint, the foundation type-boundary ratchet,
and application TypeScript check pass.

The focused ESLint run over the motion-path overlay, geometry, editing hook,
history snapshot capture/apply, and their new tests passed. The app TypeScript
check passed after the MD2 integration; a later whole-tree rerun is tracked by
the Wave 0 integration gate because unrelated concurrent work is still changing
the shared worktree.

## Recorded gate evidence

The exact-target record
[`20260731-225604Z-record.report.json`](./md2/20260731-225604Z-record.report.json)
completed with top-level `success=true` and no failures at sample time 0.32 s.
It records 15 AI-authored keyframes, revision 1 to 31, identical nested
keyframe ids, handle undo/redo with selection restoration, Graph panel expansion
and exact ratio restoration, three parameter rows, plus hide and solo behavior.

The six recorded baselines are direct/nested preview and export, the real
Global Graph SVG capture, and the real Motion Path overlay capture under
[`md2/baselines/`](./md2/baselines/). Preview/export/nested comparisons pass.
The disposable target was exact, blank, unsaved, and chat-free; the user project
was not mutated.
