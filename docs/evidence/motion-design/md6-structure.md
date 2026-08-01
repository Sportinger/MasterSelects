# MD6 Structure Integration Evidence

Status: implementation integrated; formal gate remains open

Date: 2026-08-01  
Fixture contract: `md6pg1` / `MOTION_PARENT_GRAPH_CONTRACT_VERSION = 1`

## Implemented vertical slice

- The frozen 2D parent-graph planner rejects self-parenting, cycles, missing
  parents, cross-composition links, mixed 2D/3D links, non-finite evaluation,
  duplicate evaluation, and singular world-preservation transforms.
- Set, clear, and reparent preserve the child world transform at the exact
  operation time. The frozen animated-reparent policy is operation-time-only.
- `createMotionNull`, direct Motion Null creation, and atomic
  create-null-and-parent-selected mutations use the shared planner and a single
  undo/redo entry.
- Copy, paste, duplicate, split, deletion, reload, nested restore, and project
  construction sanitize or remap parent edges instead of retaining dangling ids.
- Root preview/export and nested preview/export evaluate parent chains at the
  requested frame time. Transition hydration retains the parent composition.
- The timeline Pick Whip supports pointer capture, Escape cancellation, valid
  drop, clear-parent, target diagnostics, and locked/self/cycle/3D/audio guards.
- Motion Null now has an accessible viewport crosshair with pointer capture,
  constrained and keyboard movement, visible focus, diagnostics, exact-time
  keyframe writes, and centered letterbox-safe geometry. Its transient local
  transform is evaluated through the parent graph so children move live.
- The post-integration review fixed double parent composition, stale-frame
  commits, lost-capture/window-blur cleanup, hidden/missing-track fail-open
  behavior, empty history batches, and unchanged-axis keyframe writes.
- Motion groups are deliberately outside 1.0; the frozen contract records
  `MOTION_PARENT_GROUPS_SUPPORTED = false`. Motion Null remains a non-rendering
  timeline controller rather than a viewport object.

## Automated evidence

- Contract, evaluator, nested preview/export, transition, serialization, and
  restore packet: 12 files / 115 tests passed; TypeScript and scoped ESLint
  passed.
- Pick Whip, link, menu, and interaction-shell packet: 67/67 focused tests
  passed; TypeScript, scoped ESLint, and `git diff --check` passed.
- Main integration rechecks: exact parent/nested/export packet 4 files / 10
  tests passed; standalone Motion Null and AI registry packet 4 files / 47 tests
  passed; Media/Pick Whip integration 3 files / 29 tests passed.
- Final combined MD6 integration run: 17 files / 161 tests passed, covering the
  graph contracts, exact frame evaluation, nested restore, edit sanitization,
  world preservation, 2D/3D invariants, AI, Pick Whip, ParentChildLink, and the
  timeline interaction shell.
- Full application `tsc -b` and the architecture `getState` gate passed; scoped
  ESLint passed and `git diff --check` exited 0 with line-ending warnings only.
- Final viewport review matrix: 13 files / 92 tests passed, including parented
  local/world composition, moving child preview pixels, stale/no-op drags,
  capture loss, focus visibility, exact-time writes, and graph invariants;
  scoped ESLint passed.

## Visible evidence — recorded 2026-08-01, gate closed

Captured in the disposable evidence session
`http://motion-md0-md6md7close2.localhost:5173/?motionDesignEvidenceSession=md6md7close2`
(bridge session `8ac6affc`, no project open, empty timeline; the open user
project was never touched).

- Scene: star shape clip with a 5×3 replicator grid (15 instances) on video-1.
- `createMotionNullAndParent` created `clip-motion-null-1785575859024-1-y7q3o`
  on video-2 and parented the grid clip in one atomic single-entry transaction
  (`history.label: "Create Null and Parent Selection"`); parent-graph revision
  `md6pg1-5be55a3e568c8192` → `md6pg1-6a381e3e9e09973e`.
- `addKeyframe` sequence mode wrote four keyframes on the null
  (`rotation.z` 0→25° and `position.x` 0→260px over 0–2s, ease-in-out) as one
  atomic undo step, with stable keyframe ids and the normalized-storage codec
  visible in the response (260px stored as 0.27083…).
- Screenshots:
  [`md6/null-parent-t0-baseline.jpg`](./md6/null-parent-t0-baseline.jpg) — t=0,
  straight grid, POS X 0.0 / ROT Z 0.0°;
  [`md6/null-parent-t1-children-follow.jpg`](./md6/null-parent-t1-children-follow.jpg)
  — t=1, the whole grid visibly rotated (~12.5°) and shifted right because the
  children follow the animated parent null.
- Undo proof: one `undo` removed all four keyframes (`getKeyframes: []`);
  a second `undo` removed the null and the parent edge as one entry
  (`getTimelineState`: video-2 empty, grid clip restored and unparented).
- Save/reopen parity is deliberately exercised by the automated round-trip
  suites (nested restore, serialization, edit/load remapping — 17 files/161
  tests above) rather than by writing shared browser persistence from the
  disposable session.

`MD6_STRUCTURE_COMPLETE` is closed. Cross-phase full repository release matrix
remains an MD9 gate. No live user project was mutated. No commit or push was
made.
