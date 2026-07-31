# MasterSelects Motion Design + AI Completion Plan

Status: Active implementation plan
Date: 2026-07-31
Historical plan: [`../completed/plans/motion-design-system-plan.md`](../completed/plans/motion-design-system-plan.md)
Current implementation reference: [`../Features/Motion-Design.md`](../Features/Motion-Design.md)
Parallel execution plan: [`motion-design-md0-md9-multilane-execution-plan.md`](./motion-design-md0-md9-multilane-execution-plan.md)

## Purpose

Finish Motion Design as a first-class MasterSelects editing system and expose every completed capability to the AI in the same implementation slice.

The historical plan remains useful architectural context, but it predates the current AI tool policy, mutation/revision envelopes, worker-first render work, and the partially implemented Grid Replicator. This document is the active source of truth for completing the feature from the current codebase.

Motion Design 1.0 is not an attempt to clone After Effects or embed another editor. It is a native 2D motion-graphics layer system that shares the MasterSelects timeline, property registry, keyframe store, media runtime, compositor, project format, export path, undo history, and semantic AI tools.

## Current Baseline

The original work was not removed. The current tree already contains:

| Area | Current state |
|---|---|
| Motion schema | Versioned shape, null, adjustment, group, appearance, and replicator contracts exist |
| Shape rendering | Rectangle, ellipse, polygon, and star rendering is an implementation candidate through the native WebGPU Motion path |
| Appearance | Ordered color fill, stroke, linear/radial gradient, opacity, visibility, and supported blend behavior is an implementation candidate |
| Animation | Numeric shape, appearance, and Grid Replicator properties use the shared property/keyframe system |
| Grid Replicator | Count, spacing, pattern offset data, position spacing contribution, and opacity fade render through instanced draws, currently capped at 100 instances |
| Editor creation | Motion Rectangle and Motion Ellipse media items can be created and placed on video tracks |
| Timeline integration | Motion shapes support normal clip timing, transforms, effects, masks, copy/paste, splitting, and nesting paths |
| Persistence | Motion definitions survive project save/load and nested-composition restore |
| Render surfaces | Main preview, nested compositions, and export receive motion shape layers |
| Tests | Motion helper, property registry, timeline restore, and architecture coverage exists |
| AI | The MD0 semantic tool group is exposed for capability/state reads, rectangle/ellipse creation, current properties/appearances, and Grid configuration; later-phase capabilities remain intentionally unavailable |
| Structural layers | Null, adjustment, and group data is scaffolded, but no complete authoring/render workflows exist |
| Advanced appearance | MD1 primitive/appearance work is an implementation candidate pending pixel goldens; texture fills remain deferred to MD5 |
| Advanced animation | Property browser/pins, unified global graph mode, shared keyframe transactions, and viewport motion paths are implementation candidates; disposable Wave D parity evidence remains |
| Advanced replicators | Linear/radial layouts, transform offsets, modifiers, falloffs, direct media replication, and 10k-instance performance are not complete |
| Feature flags | The stale `useMotionDesignSystem` and `useMotionReplicators` placeholders were retired in MD0; the existing Shape/Grid MVP is always part of the native layer path |

The baseline is therefore a working Shape MVP, not a finished Motion Design product.

## Motion Design 1.0 Scope

Motion Design 1.0 includes:

- rectangle, ellipse, polygon, and star shape layers;
- ordered appearance stacks with color fills, strokes, linear/radial gradients, texture fills, visibility, opacity, and blend modes;
- registry-backed property search, favorites/pins, multi-curve graph editing, and viewport position paths;
- grid, linear, and radial GPU-instanced replicators;
- deterministic position, rotation, scale, opacity, random, noise, oscillator, field, and falloff behavior;
- image, video, and nested-composition texture sources without per-instance decoder duplication;
- null parenting, explicit grouping semantics, and adjustment layers;
- versioned presets and motion templates;
- a small deterministic expression language for `time`, `index`, `count`, trigonometry, and seeded random values;
- semantic AI inspection and mutation tools for every shipped capability;
- preview, nested-composition, save/load, undo/redo, and export parity.

The following are outside Motion Design 1.0:

- a general JavaScript or After Effects expression runtime;
- arbitrary third-party plugin execution;
- 3D mesh, splat, or particle replicators;
- a full vector illustration/path editor;
- nondeterministic simulations;
- a second timeline or an embedded external motion editor.

Arbitrary Bezier shape authoring, audio-reactive motion, particle systems, and 3D promotion can be planned after the 1.0 contracts are stable.

## Non-Negotiable Completion Rule

A capability is not complete when only its schema, UI, renderer, or AI tool exists.

Every capability must ship as one vertical slice containing:

1. a durable versioned data contract;
2. shared validation and domain operations;
3. editor creation and editing UI;
4. property registry descriptors for every authorable value;
5. keyframe behavior where the property is animatable;
6. semantic AI read and mutation operations;
7. AI definition, handler, policy, dispatcher, and model-catalog parity;
8. one undoable transaction with mutation entity/revision reporting;
9. project save/load and migration behavior;
10. main preview, nested composition, and export parity;
11. unit, store, UI, bridge, and render tests appropriate to the feature;
12. updated feature documentation and visible evidence.

If one item is missing, the capability remains in progress.

## Target Architecture

```text
Editor UI ───────────────┐
                        ├─> shared Motion Design commands and validators
AI tools / bridge ──────┘             │
                                      v
                           timeline/media store transaction
                                      │
                    PropertyRegistry + keyframe evaluation
                                      │
                         evaluated MotionFrameState
                                      │
                  MotionRenderer / media instance renderer
                                      │
                 existing compositor and render-frame snapshot
                         /            |             \
                    preview       nested comp       export
```

Rules:

- React owns authoring controls, not evaluated per-frame or per-instance state.
- AI handlers must call the same store/domain operations used by the UI.
- AI tools must not patch arbitrary Motion Design JSON.
- Property paths are validated through the property registry before mutation.
- Procedural instances remain compact definitions and GPU buffers, never timeline clip duplication.
- Preview and export consume the same evaluated frame state.
- Runtime media handles stay outside persisted Motion Design data.
- Random and noise behavior is deterministic from explicit seeds.
- Structural changes use batchable, undoable transactions.

## AI Tool Surface

Avoid one tool per field. The model-facing catalog is capped, so Motion Design should use a compact semantic group backed by the property registry.

### Initial tool group

| Tool | Purpose |
|---|---|
| `getMotionCapabilities` | Return supported layer kinds, primitives, appearance kinds, layouts, modifiers, limits, and registry-backed property descriptors |
| `getMotionDesign` | Return the resolved Motion Design state for a clip, including stable appearance/modifier ids |
| `createMotionShapeClip` | Create a rectangle, ellipse, polygon, or star with timing and initial appearance |
| `updateMotionProperties` | Apply one or more validated registry property updates atomically |
| `updateMotionAppearances` | Add, update, remove, show/hide, or reorder appearance items through structured operations |
| `configureMotionReplicator` | Enable/disable and configure the supported layout and offsets |

Later phases extend the same group or add only structurally necessary tools:

- `updateMotionReplicatorModifiers`
- `setMotionTextureSource`
- `createMotionNull`
- `setClipParent`
- `createMotionAdjustment`
- `createMotionGroup`
- `saveMotionPreset`
- `applyMotionPreset`
- `saveMotionTemplate`
- `instantiateMotionTemplate`
- `setMotionExpression`

### AI behavior requirements

- Read tools are low-risk and available to chat, bridge, console, and internal callers.
- Mutations are medium-risk unless they replace/delete material content.
- All mutations return affected entity ids and revision envelopes.
- `executeBatch` must support all Motion Design mutation tools as one undo point.
- Tool responses return stable ids needed by later calls.
- `addKeyframe` must advertise and validate registry-backed Motion Design properties.
- FlashBoard prompts and playbooks must describe the capability without hard-coded internal ids.
- The AI must be able to inspect composition dimensions and safe areas before positioning graphics.
- The AI should verify important results with bounded `captureFrame` calls, not open-ended self-edit loops.
- No motion tool is considered exposed until definition/handler/policy/dispatcher/model-catalog parity tests pass.

## Phase 0 — Rebaseline the Existing Shape MVP and Expose It to AI

Goal: make the functionality that already exists a complete, supported vertical slice.

### Product and engine work

- Confirm rectangle/ellipse creation from Media Panel, timeline context paths, and direct store commands.
- Add a shared Motion Design command/validation service and route existing UI/store actions through it where practical.
- Define a public capability descriptor from the current property registry and engine limits.
- Resolve the stale feature flags: either remove them or make them real, tested rollout gates.
- Add Motion Design counts, instance counts, buffer uploads, and render timing to debug stats.
- Add direct tests that a motion layer reaches main preview, nested composition, and export using equivalent evaluated state.

### AI work

- Add `getMotionCapabilities`.
- Add `getMotionDesign`.
- Add `createMotionShapeClip` for rectangle and ellipse.
- Add `updateMotionProperties` for current shape, fill, stroke, transform-compatible, and Grid Replicator properties.
- Add `updateMotionAppearances` for the current fill/stroke subset.
- Add `configureMotionReplicator` for the current Grid subset.
- Extend `addKeyframe` documentation and validation with Motion Design property descriptors.
- Register definitions, handlers, policies, batch execution, prompts, and parity tests.

### Exit gate `MD0_EXISTING_MVP_COMPLETE`

- The AI creates and edits the same rectangle/ellipse available in the UI.
- A rounded rectangle with fill, stroke, transform, and animated opacity survives save/reload.
- The same frame matches in preview, nested composition, and export.
- A multi-call AI construction can be undone in one step through `executeBatch`.
- Tool definition, handler, policy, mutation-envelope, and bridge registry parity tests pass.
- Existing targeted Motion Design tests remain green.

### Required scenario

From an empty composition, the AI creates a lower-third background plate, creates editable text with the existing text tools, animates both layers in and out, verifies a representative frame, and leaves the whole construction as one undo group.

### MD0 implementation record — 2026-07-31

Implementation and automated gates are complete:

- the six-tool semantic Motion Design surface is registered for definitions, handlers, policies, mutation classification, FlashBoard selection, prompts, and playbooks;
- capability responses advertise only rectangle, ellipse, color fill, stroke, and the current 100-instance Grid subset;
- shared registry validation rejects unsupported paths atomically;
- `executeBatch` supports safe backward references to earlier action results, enabling create-then-animate constructions without invented ids;
- a real store/history test creates a lower-third plate plus editable text, adds keyframes to both, and removes the entire construction with one undo;
- a rounded fill/stroke rectangle with opacity keyframes survives timeline serialization and reload;
- preview, nested-preview, direct-export, and nested-export builders receive identical evaluated Motion Design state;
- debug stats report Motion Design clip/instance counts, renderer caches, buffer uploads/bytes, and CPU encoding time;
- the unused Motion Design/Replicator feature-flag placeholders are removed;
- the targeted regression run passed 370 tests across 13 suites, and `tsc --noEmit -p tsconfig.app.json` passed immediately after the MD0 source changes;
- the live dev bridge exposed all six tools, returned the expected capability limits, and returned the new Motion Design stats object with `engineReady=true`.

Evidence: [`../evidence/motion-design/md0-existing-mvp.md`](../evidence/motion-design/md0-existing-mvp.md).

One evidence item remains before checking `MD0_EXISTING_MVP_COMPLETE`: capture the visual lower-third fixture in a disposable browser/project and compare a representative preview/export frame. The connected editor contained user media and storyboard work, so the implementation run deliberately performed read-only bridge checks only; no live project content was changed.

A later final typecheck rerun was blocked by concurrently added, out-of-scope Transition Preview imports whose modules were not yet present. The earlier green MD0 typecheck and all targeted Motion/AI regressions remain recorded; the unrelated transition files were not modified.

## Phase 1 — Complete Shape Primitives and Appearance Stacks

Goal: turn the Shape MVP into a useful graphics layer.

### Product and engine work

- Implement polygon and star geometry/rendering with points, radii, and corner controls.
- Support ordered appearance items rather than one implicit fill and stroke.
- Add add/remove/reorder/duplicate/show-hide appearance operations.
- Implement linear and radial gradient rendering with stable stop ids.
- Implement per-appearance opacity and blend mode.
- Keep stroke alignment and padding correct for every primitive.
- Ensure masks and clip effects still apply after appearance composition.
- Add appearance preset serialization without embedded media.

### AI work

- Extend `getMotionCapabilities` with the new primitives and appearance descriptors.
- Extend `createMotionShapeClip` with complete primitive parameters.
- Extend `updateMotionAppearances` with gradients, ordering, visibility, and blend modes.
- Return created appearance and gradient-stop ids.
- Add a structured preset application operation when preset storage exists.

### Exit gate `MD1_SHAPES_AND_APPEARANCES_COMPLETE`

- UI and AI can build the same multi-appearance shape.
- Appearance reorder preserves keyframes because ids remain stable.
- Polygon/star, gradient, stroke, blend, effect, and mask results match between preview and export.
- Copy/paste, split, duplicate, nesting, and project round-trip preserve the full stack.
- Golden tests cover every primitive and appearance family.

Implementation candidate: the engine, UI, AI, registry, persistence, split
cloning, preset serialization, shader compilation, and preview/nested/export
state-parity work is in place. Evidence is recorded in
[`../evidence/motion-design/md1-shapes-appearances.md`](../evidence/motion-design/md1-shapes-appearances.md).
The final gate remains unchecked until disposable-browser preview/export pixel
goldens are captured; the connected editor project was not mutated for evidence.

### Required scenario

The AI creates a branded title card with a rounded gradient plate, two strokes, controlled appearance ordering, and an animated reveal.

## Phase 2 — Complete Motion Authoring and Animation UX

Goal: make existing keyframe power practical for both humans and AI.

Detailed execution plan:
[`motion-design-phase2-authoring-execution-plan.md`](./motion-design-phase2-authoring-execution-plan.md).

### Product work

- Add property search powered only by the property registry.
- Implement per-clip pinned properties and user/project favorites.
- Add a global graph mode that displays selected, pinned, or favorited curves together.
- Reuse the existing keyframe store and Bezier interpolation; do not create a second animation store.
- Add viewport position paths for selected 2D layers.
- Support dragging path points and handles into the same position keyframes.
- Add optional previous/next sampled onion-skin positions.
- Add multi-property and multi-keyframe editing with one undo transaction.

### AI work

- Make `getMotionCapabilities` return animatable state, value type, range, unit, enum values, and aliases.
- Allow `updateMotionProperties` and `addKeyframe` to consume the same descriptors.
- Add atomic multi-property keyframe sequences without inventing a parallel animation format.
- Return normalized values and resolved clip-local times.
- Add playbook guidance for entrances, exits, overshoot, stagger, and hold timing.

### Exit gate `MD2_AUTHORING_AND_ANIMATION_COMPLETE`

- UI and AI mutations produce identical property/keyframe data.
- Graph mode edits the same keyframes shown on the timeline.
- Viewport path edits match preview/export motion.
- Pins/favorites survive their chosen project or user persistence boundary.
- No motion property requires a bespoke AI-only schema.

### Required scenario

The AI creates a two-stage slide-and-overshoot entrance, while a human can immediately inspect and adjust the same position/opacity curves in global graph mode.

## Phase 3 — Complete the Core Replicator

Goal: deliver a deterministic, high-performance procedural instance system.

### Product and engine work

- Replace the current 100-instance MVP allocation with capacity management suitable for at least 10,000 simple instances.
- Implement Grid, Linear, and Radial layouts.
- Implement per-instance position, rotation, scale, and opacity offsets.
- Support cumulative and absolute offset modes.
- Implement grid pattern offsets and radial auto-orient.
- Keep bounds calculation, stroke padding, culling, and texture allocation safe at large counts.
- Cache instance buffers by stable definition/revision and update only dirty data.
- Report instance count, upload count, compute/draw timing, and truncation in stats.

### AI work

- Extend `configureMotionReplicator` with all layouts and offsets.
- Validate counts and limits using live capability descriptors.
- Return requested and effective instance counts.
- Add a safe explicit bake-to-composition command later; never bake by default.

### Exit gate `MD3_REPLICATOR_CORE_COMPLETE`

- 10,000 simple instances remain interactive on supported hardware.
- No per-instance React objects, timeline clips, media decoders, or persisted records are created.
- Layout and offset animation is deterministic.
- Preview, nested composition, export, save/load, undo, and AI parity pass.
- Excessive requested counts fail or clamp visibly and predictably.

### Required scenario

The AI creates a 40-by-25 animated pattern, changes spacing and rotation offsets over time, and receives the effective 1,000-instance result from the tool response.

## Phase 4 — Replicator Modifiers and Falloffs

Goal: add expressive procedural motion without losing determinism.

### Product and engine work

- Implement ordered Random, Noise, Oscillator, and Field modifiers.
- Power target selection from compatible property registry descriptors.
- Add explicit seed controls and stable per-instance index semantics.
- Implement shape-referenced falloffs with feather, invert, and clip behavior.
- Move complex evaluation to compute/storage buffers where appropriate.
- Cache compiled modifier plans and invalidate them by stable ids/revisions.

### AI work

- Add structured modifier add/update/remove/reorder operations.
- Expose valid target properties and parameter ranges through capabilities.
- Require explicit or returned seeds for random/noise creation.
- Add and remove falloff references using clip ids, never UI labels alone.

### Exit gate `MD4_MODIFIERS_AND_FALLOFFS_COMPLETE`

- Identical project state, frame time, and seed produce identical pixels.
- Modifier reorder preserves ids and keyframes.
- Missing falloff clips fail closed with a visible diagnostic.
- AI and UI can reproduce the same modifier stack.
- Performance remains bounded and is observable through stats.

### Required scenario

The AI creates a radial field with seeded scale/opacity noise and an animated ellipse falloff, then reproduces the same frame after project reload.

## Phase 5 — Texture Fills and Direct Media Replicators

Goal: connect Motion Design to real image, video, and composition content.

### Product and engine work

- Implement image, video, and nested-composition texture fills.
- Add independent texture position, scale, rotation, fit, fill, stretch, tile, and time controls.
- Reuse the existing media runtime and render-frame snapshot contracts.
- Decode/render each unique source time once and reuse the texture across instances.
- Implement freeze, reverse, loop, ping-pong, and deterministic per-instance time offset.
- Add direct image, video, and nested-composition replicator targets without clip duplication.
- Define missing/relinked media behavior in project persistence.

### AI work

- Add `setMotionTextureSource` with media/composition ids and structured timing rules.
- Extend capabilities with allowed source kinds and runtime limits.
- Let the AI inspect media items before attaching a source.
- Return resolved source ids, timing policy, and missing-media diagnostics.
- Never accept arbitrary local paths through a Motion Design tool.

### Exit gate `MD5_MEDIA_MOTION_COMPLETE`

- A shared-time video wall uses one source decode/render path per frame time.
- Texture fills and direct media replicators match in preview and export.
- Missing media can be relinked without losing Motion Design settings.
- Per-instance time offsets are deterministic and bounded.
- AI attachment and replacement operations are undoable and policy compliant.

### Required scenario

The AI creates a tiled video wall from one imported source, offsets source time by instance index, and exports it without allocating one decoder per tile.

## Phase 6 — Null Layers, Parenting, and Groups

Goal: make multi-layer motion constructions manageable.

### Product work

- Add user-facing null creation and viewport handles.
- Complete 2D parent creation, pick-whip/selection UX, and world-transform preservation.
- Add an `Add Null Parent` command for mixed selected 2D layers.
- Define mixed 2D/3D parenting behavior explicitly and block unsupported mappings.
- Decide and implement group semantics: lightweight group layers only if they remain clearer than nested composition reuse.
- Add lock, visibility, label, selection, trimming, copy/paste, and project behavior.

### AI work

- Add `createMotionNull`.
- Add validated `setClipParent` and `clearClipParent`.
- Add a batch operation that creates a null and reparents selected clips while preserving world transforms.
- Add group creation/ungrouping only after group semantics are stable.
- Return parent graph revisions and affected clip ids.

### Exit gate `MD6_STRUCTURE_COMPLETE`

- A null can drive shape, text, image, and video children in 2D.
- Creating or removing a parent preserves child world transforms.
- Unsupported mixed-space parenting fails with a clear reason.
- Undo restores the exact previous parent graph.
- AI and UI use the same parent graph operations.

### Required scenario

The AI builds a lower third from a plate and two text clips, creates one null parent, and moves/scales the complete construction without flattening it.

## Phase 7 — Adjustment Layers and Render Graph

Goal: make adjustment layers real compositor operations.

### Product and engine work

- Establish the render-graph boundary required to operate on accumulated lower-layer textures.
- Implement adjustment clips as ordered compositor operations.
- Apply supported effects only to layers below the adjustment layer within its time range.
- Define masks, opacity, blend, nesting, and multiple-adjustment ordering.
- Keep main preview, target preview, nested composition, and export semantics identical.
- Remove or make real the `useRenderGraph` rollout flag.

### AI work

- Add `createMotionAdjustment`.
- Reuse existing effect tools on adjustment clips after compatibility validation.
- Expose supported/unsupported effects through capability inspection.
- Return affected layer range and ordering information.

### Exit gate `MD7_ADJUSTMENT_LAYERS_COMPLETE`

- Blur/color effects affect lower layers only and respect timeline ordering.
- Multiple adjustment layers compose deterministically.
- Nested composition and export results match main preview.
- Unsupported effects fail before mutation.
- AI can create, configure, move, trim, and remove an adjustment layer through existing semantic tools.

### Required scenario

The AI adds a timed color-and-blur adjustment over a montage section while leaving a title layer above it unaffected.

## Phase 8 — Presets, Templates, Expressions, and AI Workflows

Goal: turn low-level primitives into reusable content creation.

### Product work

- Add versioned project-local shape, appearance, graph/easing, and replicator presets.
- Add versioned `.msmotion` templates for selected clips, keyframes, relationships, appearances, and replicators.
- Reference source media by project id and report missing dependencies.
- Implement a tiny pure expression evaluator for `time`, `index`, `count`, `sin`, `cos`, and seeded `random`.
- Validate expressions at authoring time and fail closed at render time.
- Add template categories for lower thirds, title cards, callouts, logo reveals, loops, kinetic text, and video walls.

### AI work

- Add preset/template inspect, save, and instantiate tools.
- Add expression set/clear tools using the same parser as the UI.
- Add high-level playbooks that compose semantic tools rather than patching project data.
- Add a bounded create → inspect → capture representative frames → adjust workflow.
- Record the template/preset version and source ids in tool results.

### Exit gate `MD8_REUSABLE_AI_CONTENT_COMPLETE`

- Template round-trip preserves timing, keyframes, ids/relationships, and supported media references.
- Expressions produce identical values in preview and export.
- Invalid expressions never execute arbitrary code.
- The AI can construct or instantiate each required content category.
- One batch undo removes an instantiated construction.

### Required scenario

From a natural-language brand brief, the AI instantiates a lower-third template, substitutes text/colors/timing, previews representative frames, and leaves editable native layers.

## Phase 9 — Release Hardening

Goal: promote Motion Design 1.0 from active development to a supported feature.

### Work

- Add explicit schema migrations and fixtures for every historical Motion Design project version.
- Test legacy rectangle/ellipse projects created before this plan.
- Verify clipboard, duplicate, split, trim, ripple, nesting, relink, save-as, autosave, undo, and redo.
- Add WebGPU device-loss and HMR resource cleanup tests.
- Add Linux/Mesa render evidence before touching or approving GPU changes.
- Add preview/export golden fixtures across primitives, appearances, replicators, media, nulls/groups, and adjustments.
- Add large-project and long-duration stress fixtures.
- Audit memory, texture dimensions, instance limits, decoder reuse, and buffer churn.
- Remove stale flags and dead scaffolding.
- Update Motion Design, Keyframes, GPU Engine, Timeline, Project Persistence, Export, AI Integration, and AI Bridge documentation.
- Capture visible evidence for core human and AI journeys.

### Exit gate `MD9_MOTION_DESIGN_1_0_RELEASE`

- All phase gates `MD0` through `MD8` are green.
- Build, architecture, unit, store, UI, bridge, render, export, and stress suites pass.
- No model-exposed tool lacks a handler or policy entry.
- No Motion Design mutation bypasses validation, history, or revision reporting.
- No documented capability remains schema-only.
- Feature documentation describes observed behavior rather than roadmap claims.

## Test and Evidence Matrix

| Layer | Required coverage |
|---|---|
| Contracts | Defaults, schema validation, migrations, stable ids, JSON round-trip |
| Property registry | Descriptor discovery, aliases, value validation, read/write parity, animatable types |
| Store/domain | Creation, structural edits, batch undo, clipboard, split/trim, parenting, history restore |
| AI registry | Definition/handler/policy/catalog parity, caller access, tool cap behavior |
| AI mutation | Validation failures, entity/revision envelopes, batch undo, stable returned ids |
| Renderer | Primitive/appearance/modifier fixtures, bounds, capacity, deterministic buffers |
| Parity | Main preview, target preview, nested composition, and export fingerprints |
| Media runtime | One-source decode reuse, missing media, relink, time modes, cleanup |
| UI | Creation menus, Properties controls, graph mode, motion paths, drag/drop, accessibility |
| Performance | 10k instances, texture limits, buffer uploads, frame time, memory cleanup |
| End-to-end | AI lower third, branded title, procedural pattern, video wall, null-parent construction, adjustment montage |

Evidence should live under `docs/evidence/motion-design/` and include the project/fixture version, render host, GPU/runtime details, representative screenshots, export fingerprints, and the exact tool sequence for AI scenarios.

## Implementation Boundaries

Primary locations:

| Concern | Location |
|---|---|
| Durable types | `src/types/motionDesign.ts`, `src/services/project/types/**` |
| Domain commands/validation | `src/services/motionDesign/**` |
| Property descriptors | `src/services/properties/motion*.ts` |
| Timeline mutations | `src/stores/timeline/motionClipSlice.ts`, keyframe/parenting slices |
| UI | `src/components/panels/properties/**`, `src/components/timeline/**`, `src/components/preview/**` |
| GPU renderer | `src/engine/motion/**` |
| Layer/evaluation path | `src/services/layerBuilder/**`, composition render services |
| Export | `src/engine/export/**` |
| AI definitions | `src/services/aiTools/definitions/motionDesign.ts` |
| AI handlers | `src/services/aiTools/handlers/motionDesign.ts` |
| AI policy/dispatch | `src/services/aiTools/policy/**`, handler/definition registries |
| Prompt/playbooks | `src/services/flashboard/FlashBoardChatPrompt.ts`, `FlashBoardChatPlaybooks.ts`, tool selection |
| Tests | `tests/unit/motionDesign*.test.ts`, AI tool, UI, project, render, and bridge suites |

Before implementation changes cross active architecture boundaries, update the relevant architecture ownership/gate registries instead of bypassing them.

## Dependency Order

```text
MD0 existing MVP + AI
 ├─> MD1 shapes/appearances ─> MD3 replicator core ─> MD4 modifiers/falloffs
 │                         └─────────────────────────> MD5 media motion
 └─> MD2 authoring/animation ─> MD6 nulls/groups

MD7 adjustment/render graph can proceed after its compositor contract is ready.

MD1–MD7 stable schemas ─> MD8 presets/templates/expressions ─> MD9 release
```

MD0 is mandatory before expanding scope. It proves the vertical-slice rule and gives the AI access to the already working implementation.

## First Implementation Packet

The first packet should be deliberately narrow:

1. Add shared capability and validation contracts for the existing rectangle/ellipse MVP.
2. Add `getMotionCapabilities` and `getMotionDesign`.
3. Add `createMotionShapeClip`.
4. Add registry-validated `updateMotionProperties`.
5. Add current fill/stroke and Grid Replicator structured mutations.
6. Add policy, dispatcher, batch, mutation-envelope, and registry parity coverage.
7. Update the FlashBoard tool selection and prompt.
8. Add one bridge-driven lower-third fixture with save/reload and preview/export evidence.

Do not start polygon/star, gradients, or a larger Replicator rewrite until gate `MD0_EXISTING_MVP_COMPLETE` is green.

## Completion Checklist

- [ ] `MD0_EXISTING_MVP_COMPLETE`
- [ ] `MD1_SHAPES_AND_APPEARANCES_COMPLETE`
- [ ] `MD2_AUTHORING_AND_ANIMATION_COMPLETE`
- [ ] `MD3_REPLICATOR_CORE_COMPLETE`
- [ ] `MD4_MODIFIERS_AND_FALLOFFS_COMPLETE`
- [ ] `MD5_MEDIA_MOTION_COMPLETE`
- [ ] `MD6_STRUCTURE_COMPLETE`
- [ ] `MD7_ADJUSTMENT_LAYERS_COMPLETE`
- [ ] `MD8_REUSABLE_AI_CONTENT_COMPLETE`
- [ ] `MD9_MOTION_DESIGN_1_0_RELEASE`
