# Motion Design Phase 2 — Authoring and Animation Execution Plan

Status: Complete; Waves A-D and disposable acceptance evidence pass
Date: 2026-07-31
Parent plan: [`motion-design-ai-completion-plan.md`](./motion-design-ai-completion-plan.md)
Working branch: `master`

## Goal

Complete `MD2_AUTHORING_AND_ANIMATION_COMPLETE` without introducing a second
property or keyframe model.

The finished workflow must let AI create a position/opacity
slide-and-overshoot sequence and let a human immediately inspect and edit the
same keyframe ids, values, times, easing, and Bezier handles in the global graph
and preview motion path.

## Wave A Implementation Record — 2026-07-31

Packets 1 and 2 are implemented and gated:

- clip-aware registry descriptors now exclude catalog-only effects and reject
  Motion Shape paths on ordinary clips;
- one owner-aware authoring codec defines 2D half-extent pixels versus
  effective-3D/camera scene units for UI/tool boundaries without rewriting
  stored values;
- `setTransform`, position keyframes, Guided validation, and AI clip reads use
  that contract; AI reads expose authoring `transform`, explicit
  `storedTransform`, and coordinate metadata;
- keyframe transactions preflight all targets, preserve numeric history-batch
  ownership, support deferred update/commit/cancel, restore snapshots and
  selection, and fail atomically across multiple clips/properties;
- cancel/discard precedence, begin-without-drag cleanup, selection-only history,
  foreign batch ownership, locked/missing targets, 2D/3D/camera units, Guided
  Z validation, registry ranges, and exact keyframe ids have focused regressions.

Evidence at this checkpoint: 17 focused files / 373 tests passed, targeted
ESLint passed, application TypeScript passed, production build passed, and the
scoped diff check passed. No live project mutation, commit, or push was used.

Wave B / Packet 3 was completed next. The Motion-path viewport in Wave C must
reuse the existing preview aspect/scale/rotation projection rather than drawing
authoring pixels directly.

## Wave B Implementation Record — 2026-07-31

Packet 3 is implemented and gated:

- the Motion Shape Properties tab now contains a clip-aware registry browser
  with local, non-project-dirtying search;
- exact property paths can be pinned per clip and favorited per user, with pins
  stored only in `motion.ui.pinnedProperties` and favorites stored only in a
  versioned, backward-safe `localStorage` preference;
- unresolved dynamic favorite paths remain stored while registry readers ignore
  them safely until they become valid for a clip again;
- one bounded pure target model combines explicit selection, pins, favorites,
  and animated paths in deterministic priority order with exact clip/path
  deduplication;
- graph mode, onion-skin visibility, and onion frame distance now have validated
  per-user preference adapters without project-schema coupling;
- project round-trip, split, and clipboard regressions prove that pinned path
  arrays survive and clone independently.

Evidence at this checkpoint: 23 focused files / 392 tests passed, targeted
ESLint passed, application TypeScript passed, production build passed, and the
scoped diff check passed. No live project mutation, commit, or push was used.

## Wave C Implementation Record — 2026-07-31

Packets 4 and 6 plus all graph, node-drag, sampling, projection, onion-skin, and
spatial-handle parts of Packet 5 are implemented. A Wave 0 completion audit
reopened Packet 5 and the closeout added the missing scalar-handle-backed
viewport authoring:

- `G` and the Timeline/Graph toolbar toggle switch one persisted per-user view;
  graph mode keeps a compact clip band above the universal multi-series editor;
- series use canonical `${clipId}::${property}` identities, absolute composition
  time, descriptor-aware authoring units, bounded rendering, shared keyframe
  selection, Bezier handles, and one transaction per multi-keyframe drag;
- the former expanded single-property `CurveEditor` is no longer mounted as a
  second visible editor; `G`, double-clicking a keyframe, and double-clicking a
  parameter all open the same global graph over the canonical keyframe map;
- the global graph exposes descriptor-backed parameter rows, per-series
  visibility/solo controls, and temporarily expands the Timeline panel when
  needed, restoring the previous panel ratio when the graph closes;
- the Preview now projects selected editable 2D position keyframes into a
  separate motion-path SVG, supports paired X/Y node upserts and FPS-based onion
  positions, and excludes playback/export, source-monitor, mask, text, camera,
  locked, and 3D modes;
- selected paired X/Y nodes expose derivative-preserving spatial Bezier handles
  over the same scalar keyframe ids used by the graph; per-axis temporal
  clamping, stable missing-companion ids, one-step transactions, exact
  cancel/blur/unmount rollback, and shared-history selection restore are covered
  by focused tests;
- handle targets expose 24 px focusable button semantics with keyboard nudge,
  Enter, and Escape behavior;
- Preview layer lookup is safe during transient sparse render-graph rebuilds;
- AI `addKeyframe` accepts either the legacy single entry or one fully
  prevalidated atomic sequence of 1–100 entries, reports actual stable ids plus
  canonical/stored values and resolved local times, and creates one undo step;
- Motion capability/state/update tools now expose and validate both Transform
  and rendered Motion descriptors through the shared authoring codec.

Evidence at this checkpoint: 91 focused tests passed across graph, legacy curve,
viewport, transactions, preferences/shortcut integration, AI authoring, Motion
tools, and FlashBoard prompting. Targeted ESLint passed, application TypeScript
passed, the production build passed, and `git diff --check` found no whitespace
errors. No live project mutation, commit, or push was used.

Post-Wave C graph consolidation replaced the second visible inline editor with
the unified global graph entry points and added parameter rows, series
visibility/solo controls, plus temporary Timeline expansion/restoration. The
focused refinement gate passed 22 tests, targeted ESLint, the production build,
and the two relevant architecture contract suites. The dedicated Wave D runner,
fixture, real-UI action, and lifecycle packet add 24 focused tests. Its
disposable visual/cross-render report completed successfully.

The Wave 0 closeout added 40 passing tests across shared history snapshots,
keyframe transactions, Wave C motion paths, and Wave D spatial handles. The
implementation record is captured in
[`md2-authoring-animation.md`](../evidence/motion-design/md2-authoring-animation.md).

The final report is
[`20260731-225604Z-record.report.json`](../evidence/motion-design/md2/20260731-225604Z-record.report.json),
with six Graph, Motion-Path, preview, nested-preview, and export baselines under
[`../evidence/motion-design/md2/baselines/`](../evidence/motion-design/md2/baselines/).

## Working Rules

- Keep `clipKeyframes: Map<clipId, Keyframe[]>` and
  `selectedKeyframeIds` as the only animation source of truth.
- Resolve every authorable property through `PropertyRegistry`.
- Route UI and AI values through one descriptor-aware authoring codec.
- Apply multi-property edits through typed keyframe transactions and one undo
  entry.
- Preserve stored position values. Fix only UI/tool boundary conversion.
- Do not mutate the currently open editor project for implementation or
  verification. Use pure fixtures, store harnesses, or a disposable project.
- Do not commit or push.
- In the shared worktree, every high-conflict file has exactly one writer at a
  time.

## Fixed Product Decisions

### Persistence

- Per-clip pins are exact property paths in
  `motion.ui.pinnedProperties`. They are project content and already survive
  save/load, nesting, split, and clipboard cloning through the existing Motion
  definition boundaries.
- Property favorites are a versioned per-user `localStorage` preference for
  MD2. Project-scoped favorites are not required by the phase gate and would
  unnecessarily expand the dirty project schema.
- Favorites initially store exact property paths. Unresolvable dynamic paths
  remain stored but are ignored by readers. A later semantic `favoriteKey` can
  make appearance favorites portable across clips without changing MD2 data.
- The property search query is session/view state. It must not dirty the
  project on each keystroke. The existing optional
  `motion.ui.propertiesSearch` field remains backward-compatible but is not the
  primary MD2 storage path.
- Graph mode, onion-skin visibility, and onion frame distance are per-user view
  preferences, never project content.

### Position units

- Persisted `position.x/y` values remain normalized compositor values.
- Human- and AI-facing 2D position values use pixels relative to composition
  center.
- The canonical conversion uses composition half-extents, matching the current
  Properties panel and keyframe tools.
- The codec resolves the clip's owning composition, including nested
  compositions. It must not assume the active composition.
- `setTransform`, property descriptor reads/writes, `getKeyframes`,
  `addKeyframe`, global graph labels/dragging, and viewport path editing use the
  same codec.
- Responses expose both canonical authoring values and stored normalized values
  where that distinction exists.

### Global graph

- `TimelineCurveMode = 'timeline' | 'graph'`.
- Graph mode is an alternate timeline view, not another expanded property row.
  Timeline bars remain in a compact top band; curves occupy the lower surface.
- A series identity is `${clipId}::${property}`.
- The series model combines explicit selection, pins, favorites, and animated
  properties, deduplicates them, and ignores stale/non-animatable descriptors.
- X coordinates use absolute composition time. Writes resolve back to
  clip-local time.
- Each property series has its own descriptor-aware Y transform. The active
  series owns the visible value grid and unit label; other series remain
  color-coded. This makes position and opacity editable together without mixing
  incompatible raw units.
- The model supports multiple selected clips, while the required release
  scenario uses one selected Motion clip. Visible series/key counts are bounded
  to prevent unbounded SVG work.

### Multi-edit semantics

- Horizontal dragging moves all selected visible keyframes by the same time
  delta, clamped deterministically per clip.
- Vertical dragging changes selected keyframes only in the active property
  series. Cross-property vertical deltas are undefined because units differ.
- Explicit bulk time/easing operations may target all selected properties.
- Every drag begins, updates, commits, or cancels one owned keyframe
  transaction. Pointer cancel, blur, and unmount cannot leave a history batch
  open.
- Missing or locked targets fail before any mutation. Partial application is
  not acceptable for MD2 atomic operations.

### Viewport motion paths

- A separate absolute SVG overlay sits above the existing edit canvas. It does
  not draw into or clear `useLayerDrag`'s canvas.
- Only the selected editable 2D clip is shown. Camera/3D, source monitor,
  playback/export, mask editing, and text-bound editing are excluded.
- Path samples use the existing scalar keyframe interpolation for
  `position.x/y`, then project through the same preview overlay geometry as the
  rendered layer.
- Path nodes are the union of X/Y keyframe times. Dragging a node upserts both
  axes in one transaction; a missing companion axis is created from its
  evaluated value.
- Spatial handles are views over the paired scalar Bezier handles. Their value
  offsets become screen-space X/Y tangents; their temporal offsets stay in the
  existing keyframes. If the axes disagree, the sampled path remains
  authoritative and a handle drag aligns the pair explicitly.
- Onion skins are translucent position samples at current time plus/minus a
  configurable number of composition frames. They never create keyframes.

### AI surface

- Keep the existing `addKeyframe` tool name. Preserve the legacy single-entry
  input and add an atomic `sequence` input. Exactly one mode is accepted.
- A sequence contains 1–100 normal keyframe requests; it is not a new persisted
  animation format.
- Prevalidate clip ownership/lock, descriptor existence, animatable numeric
  type, range, time, easing, and duplicate `(property, resolvedTime)` pairs
  before the first write.
- `getMotionCapabilities`, `getMotionDesign`,
  `updateMotionProperties`, `getKeyframes`, and `addKeyframe` consume the same
  resolved descriptor/codec service.
- Motion capability responses include Transform properties required for
  animation, not only `shape.*`, `appearance.*`, and `replicator.*`.
- Descriptor views expose first-class `range`, `unit`, `enumValues`, and
  `aliases` while retaining the existing `ui` object for compatibility.
- Sequence results return the actual stable keyframe id, created/updated state,
  requested value/time, canonical value, stored value, and resolved clip-local
  time for each item.

## Existing Foundations to Reuse

| Concern | Existing foundation |
|---|---|
| Registry search | `PropertyRegistry.search()` already handles path, label, group, aliases, and animatable filtering |
| Dynamic Motion paths | Motion descriptor providers already generate clip-specific appearance paths |
| Pin schema/persistence | `motion.ui.pinnedProperties` is already cloned by timeline/project/nested persistence |
| Keyframes | `clipKeyframes` and `selectedKeyframeIds` |
| Curve math | `curveEditorMath.ts`, `CurveEditor.tsx`, and existing Bezier interpolation |
| Typed edits | `KeyframeTransactionOperation` and property-curve transaction hooks |
| Preview geometry | `editModeOverlayMath.ts`, `canvasInContainer`, view zoom/pan, and existing inverse position delta |
| AI Motion surface | Existing Motion definitions, handlers, policy, batch support, and capability view |
| User preferences | `src/stores/timeline/viewPreferences.ts` local-storage pattern |

## Known Defects That Must Be Fixed First

1. Clip-aware registry search currently starts with every static descriptor,
   including effect templates for effects not installed on the clip.
2. Position conversions disagree: Properties and keyframes use half-extents,
   while `setTransform` uses full composition dimensions.
3. `updateMotionProperties` validates a whole clip but writes only
   `updatedClip.motion`, so it cannot share Transform descriptors safely.
4. `addKeyframe` does not resolve/validate a descriptor and may return the wrong
   id when inserting or updating a non-final keyframe.
5. Keyframe transactions can partially apply locked/missing targets, do not
   truly restore on cancel, and do not own their history batch safely.
6. `CurveEditor` uses hard-coded property defaults/raw stored values instead of
   descriptor metadata and authoring units.
7. The preview edit canvas is cleared by `useLayerDrag`; a second drawer cannot
   safely share it.

## Seven Implementation Packets

### 1. Shared registry contract and authoring codec

Deliver:

- clip-search availability so catalog-only effect templates are excluded while
  installed dynamic effect descriptors remain searchable;
- a resolved authoring descriptor view with:
  `path`, `label`, `group`, `valueType`, `animatable`, `currentValue`,
  `defaultValue`, `range`, `unit`, `enumValues`, `aliases`;
- descriptor-aware validate, `toStorage`, and `fromStorage` helpers using the
  clip's owning composition;
- a shared atomic full-clip property update planner;
- characterization tests for existing stored positions and the active-versus-
  owning-composition case;
- migration of the `setTransform` and keyframe position boundaries to this
  codec without rewriting persisted data.

Primary files:

- `src/types/propertyRegistry.ts`
- `src/services/properties/PropertyRegistry.ts`
- `src/services/properties/effectProperties.ts`
- `src/services/properties/transformProperties.ts`
- new `src/services/properties/propertyAuthoring.ts`
- `src/services/motionDesign/mvpCapabilities.ts`
- `src/services/aiTools/handlers/transform.ts`
- tests for property registry, descriptors, and position units

Exit:

- one resolver produces identical metadata/conversion for Properties, Graph,
  Viewport, and AI;
- legacy position fixtures render unchanged;
- non-installed effect templates do not appear in clip search.

### 2. Atomic keyframe transaction kernel

Deliver:

- preflight validation of every operation and target before mutation;
- transaction-owned history batches that do not close outer AI batches;
- real begin/update/commit/cancel snapshots and restoration;
- deterministic multi-clip/multi-property time clamping;
- a generic edit planner/hook reused by timeline diamonds, graph, and viewport;
- `viewport-motion-path` transaction intent;
- one undo/redo entry after arbitrarily many drag updates.

Primary files:

- `src/stores/timeline/editOperations/transactionTypes.ts`
- `src/stores/timeline/editOperations/keyframeTransactionOperations.ts`
- new `src/stores/timeline/editOperations/keyframeTransactionPlanning.ts`
- new generic keyframe transaction hook
- focused transaction/history tests

Exit:

- mixed valid operations apply atomically;
- any locked/missing/invalid target produces zero changes;
- cancel, blur, and unmount restore state and close only the owned batch;
- outer `executeBatch` history remains intact.

### 3. Registry search, per-clip pins, and user favorites

Deliver:

- searchable registry-backed property browser in the Motion Properties panel;
- pin/unpin on exact clip-local paths;
- favorite/unfavorite using a versioned user preference;
- shared selector that yields selected, pinned, favorited, and animated
  descriptor targets in deterministic priority order;
- graph, onion, and graph-mode preference adapters in one preference-owned
  module.

Primary files:

- new `src/components/panels/properties/MotionPropertyBrowser.tsx`
- minimal integration in `MotionShapeTab.tsx`
- new pure model under `src/services/motionDesign/`
- `src/stores/timeline/viewPreferences.ts`
- only if needed, a narrow Motion UI store action that avoids render invalidation
- UI/model/persistence tests

Exit:

- search results come only from registry descriptors valid for the clip;
- pins survive project round-trip and clone independently on split/clipboard;
- favorites survive user-preference reload and never leak into project content;
- stale dynamic paths neither crash nor disappear from stored preferences.

### 4. Global multi-curve graph mode

Deliver:

- pure `CurveSeries` builder and series identity;
- extracted reusable curve canvas/math while retaining the current single-series
  `CurveEditor` wrapper;
- `GlobalCurveEditor` with legend, active-series grid/units, multi-selection,
  Bezier handles, and bounded rendering;
- timeline/graph toggle and `G` shortcut;
- compact timeline bar band above the graph;
- all edits routed through Packet 2 transactions.

Primary files:

- `src/components/timeline/CurveEditor.tsx`
- `src/components/timeline/CurveEditorHeader.tsx`
- `src/components/timeline/utils/curveEditorMath.ts`
- new `src/components/timeline/utils/curveGraphModel.ts`
- new `src/components/timeline/GlobalCurveEditor.tsx`
- `src/components/timeline/TimelineKeyframesCurveEditor.css`
- exclusive integration owner for `Timeline.tsx`, `TimelineTrack.tsx`,
  `TimelineBodySurface.tsx`, toolbar/controller, store state/barrels/selectors
- graph/model/component tests

Exit:

- position and opacity display together with independent units;
- graph points are the same ids selected in normal timeline mode;
- graph edits change the canonical keyframe map and one undo reverses them;
- switching modes creates no copied animation state.

### 5. Viewport 2D paths, handles, and onion positions

Deliver:

- pure path grouping/sampling/projection/inverse geometry;
- separate SVG overlay above the edit canvas;
- paired X/Y node selection and one-transaction drag/upsert;
- scalar-handle-backed spatial handles;
- previous/next frame position samples and user preferences;
- exclusions for non-editable preview modes.

Primary files:

- new `src/components/preview/motionPathGeometry.ts`
- new `src/components/preview/MotionPathOverlay.tsx`
- new `src/components/preview/useMotionPathEditing.ts`
- small reusable projection seam in `editModeOverlayMath.ts`
- exclusive integration in `Preview.tsx`, `PreviewCanvasMount.tsx`, and preview CSS
- geometry, component, transaction, and preference tests

Exit:

- sampled path equals `getInterpolatedTransform` at the same local times;
- a node/handle drag modifies the same scalar keyframes shown in the graph;
- overlay coordinates remain correct under pan, zoom, aspect mismatch, rotation,
  and non-uniform scale;
- onion samples use composition FPS and do not mutate state.

### 6. AI descriptor parity and atomic sequences

Deliver:

- capability/state descriptor metadata from Packet 1, including Transform;
- registry-validated static updates across Transform and Motion fields;
- `addKeyframe` legacy single mode plus atomic sequence mode;
- exact keyframe upsert result lookup rather than array-tail lookup;
- canonical/stored values and resolved times in responses;
- `getKeyframes` inverse conversion through the same codec;
- concise playbook for entrance, exit, explicit overshoot keyframes, stagger, and
  equal-value hold bracketing.

Primary files:

- `src/services/aiTools/definitions/keyframes.ts`
- `src/services/aiTools/handlers/keyframes.ts`
- `src/services/aiTools/definitions/motionDesign.ts`
- `src/services/aiTools/handlers/motionDesign.ts`
- retire or delegate `keyframePositionUnits.ts`
- `src/services/flashboard/FlashBoardChatPlaybooks.ts`
- `src/services/flashboard/FlashBoardChatPrompt.ts`
- AI definition/handler/policy/batch/parity tests

Exit:

- a mixed-invalid sequence writes nothing;
- a valid X/Y/opacity sequence writes one canonical transaction and one undo;
- earlier-time insertion and existing-time update return the correct ids;
- static Motion updates and keyframe values use the same descriptor rules.

### 7. Integration scenario, regressions, and evidence

Deliver:

- a deterministic fixture for slide → overshoot → settle → hold;
- UI/AI byte-level keyframe parity assertions;
- graph/viewport/timeline id and handle parity assertions;
- representative preview, nested-preview, and export samples at start,
  overshoot, settle, and hold;
- updates to Motion Design, Keyframes, Timeline, AI Integration, and active-plan
  documentation;
- `docs/evidence/motion-design/md2-authoring-animation.md`.

Verification order:

1. focused new unit/model/store tests;
2. existing Curve Editor, keyframe, history, Motion, AI, project, and preview
   regression suites;
3. architecture registry/gate tests;
4. app TypeScript check;
5. touched-file ESLint;
6. production Vite build;
7. disposable-project visual evidence only after automated gates are green.

Exit:

- every `MD2_AUTHORING_AND_ANIMATION_COMPLETE` clause is evidenced;
- the required AI-to-human handoff works without conversion or schema drift;
- no live user project was changed;
- no commit or push was made.

## Dependency and Parallelization Plan

```text
Wave A
  Packet 1: registry + authoring codec
  Packet 2: transaction kernel                 (parallel, disjoint owner)

Wave B
  Packet 3: search/pins/preferences

Wave C, after Packets 1–3 contracts are frozen
  Packet 4: graph implementation
  Packet 5: viewport implementation            (parallel)
  Packet 6: AI implementation                  (parallel)

Wave D
  Packet 7: main-agent integration, regressions, evidence
```

The graph and viewport agents may add new isolated files early, but no
integration file is patched until the foundation contracts are green.

## Shared-Worktree Ownership

| Owner | Exclusive write scope |
|---|---|
| Foundation | Property registry/types, authoring codec, capability descriptor view, unit tests |
| Transaction | Keyframe transaction operation/types/planner and transaction tests |
| Property UX/preferences | Motion property browser, pins/favorites models, all MD2 additions to `viewPreferences.ts` |
| Graph | Curve Editor extraction, graph model/component/CSS, graph tests |
| Viewport | Motion-path geometry/hook/overlay, preview mount integration, viewport tests |
| AI | AI definitions/handlers, tool response contracts, playbook/prompt, AI tests |
| Main integration | Dirty timeline integration files, store barrels/types/selectors, architecture gates, docs/evidence |

Rules:

- Before touching a dirty file, reread it and inspect its current diff.
- No two agents edit `Timeline.tsx`, `TimelineTrack.tsx`,
  `TimelineBodySurface.tsx`, `PreviewCanvasMount.tsx`,
  `MotionShapeTab.tsx`, store barrels/types, or AI registries concurrently.
- Agents do not format unrelated files.
- New tests use distinct filenames per packet.
- If concurrent work changes an owned file, its owner pauses and the main agent
  integrates the smallest additive hunk.

## Acceptance Matrix

| Gate | Required proof |
|---|---|
| Registry parity | Search excludes catalog-only descriptors; AI/UI receive the same descriptor fields |
| Unit parity | Position values round-trip through the owning composition codec |
| Persistence | Clip pins project-round-trip; favorites and view toggles user-round-trip |
| Atomicity | Multi-property/multi-keyframe edit has zero partial failure and exactly one undo |
| Graph identity | Timeline and graph select/edit the same keyframe ids |
| Viewport identity | Node/handle edits change those same X/Y keyframes |
| Render parity | Preview, nested preview, and export evaluate equal positions at fixture times |
| AI parity | AI sequence and equivalent UI transaction produce equivalent keyframe records |
| Safety | Locked targets, stale paths, invalid sequences, and cancelled drags leave state unchanged |
| Worktree safety | No user project mutation, no unrelated overwrite, no commit, no push |

## Required Scenario Fixture

For one selected Motion shape clip, author in a single atomic sequence:

- `t=0.00`: offscreen X, base Y, opacity `0`;
- `t=0.32`: slightly beyond the final X position, opacity `1`;
- `t=0.48`: final X/Y position, opacity `1`;
- a later equal-value pair to prove a hold where needed.

Then verify:

1. the AI response reports every actual id and resolved clip-local time;
2. graph mode shows position X, position Y, and opacity from the same keyframe
   map;
3. a human graph drag changes one transaction and one undo restores it;
4. a viewport node/handle drag changes the paired position keyframes;
5. preview, nested preview, and export agree at the representative times.
