# Gaussian Splat Clip - Multi-Agent Orchestrator Prompt

Copy this entire prompt into a new Claude Code session.

---

## TASK

You are the coordinator for the native `gaussian-splat` clip implementation in the MasterSelects repository.

Your job is to:

1. Read the current codebase and understand the existing `gaussian-avatar` path.
2. Design and enforce the new `gaussian-splat` architecture as a first-class clip type.
3. Split the work across specialized subagents with non-overlapping write scopes.
4. Sequence implementation so shared contracts land before parallel work begins.
5. Run independent review and verification agents after each major implementation wave.
6. Produce a final status report with completed work, open risks, and next steps.

This is not a generic "add a splat viewer" task.
It must fit the current MasterSelects timeline, layer-builder, WebGPU compositor, serialization, import, and export architecture.

---

## PRIMARY GOALS

- Add a new first-class clip type: `gaussian-splat`.
- Render `gaussian-splat` clips natively through WebGPU, not through a copied WebGL canvas.
- Make `gaussian-splat` behave like a normal timeline clip:
  - importable from the media panel
  - draggable onto the timeline
  - serializable and reloadable
  - composited with normal clip ordering
  - compatible with opacity, blend modes, masks, and existing layer effects
- Support large splat assets without blocking the main thread every frame.
- Support time-based or 4D splat playback.
- Support particle-style clip effects driven by deterministic clip time.

---

## HARD REQUIREMENTS

- Do not add a feature flag for the new `gaussian-splat` path.
- Do not route `gaussian-splat` through the existing `gaussian-avatar` WebGL canvas-copy path.
- Do not flatten all active splat clips into one global synthetic layer.
- Preserve per-clip compositor semantics:
  - layer order
  - per-layer opacity
  - per-layer blend mode
  - per-layer masks
  - per-layer effect stack
- Keep the existing `gaussian-avatar` path intact unless a small compile fix is required.
- Treat 4D and particles as deterministic functions of clip-local time. No free-running simulation loop.
- Keep implementation tasks on non-overlapping files wherever possible.
- Require real verification after code changes. Do not accept "looks right" as proof.

---

## NON-GOALS

- Do not replace or refactor the old `gaussian-avatar` renderer as part of this work.
- Do not add cloud processing, server-side conversion, or backend dependencies.
- Do not redesign the entire 3D system.
- Do not attempt arbitrary folder-based 4D sequence import in the first pass.
- Do not build avatar facial blendshape animation into the new clip type.

---

## FROZEN ARCHITECTURAL DECISIONS

These decisions are not open for subagent debate unless the lead agent explicitly reopens them.

### 1. New source type

The new implementation introduces a new source type:

- `gaussian-splat`

It does not reuse `gaussian-avatar`.

### 2. Per-layer render model

Each active `gaussian-splat` layer must render into its own GPU texture for the current frame.

Then the render dispatcher replaces that source layer with a synthetic image-like `LayerRenderData` entry pointing at the generated texture view.

This preserves compositor behavior.

Do not merge multiple splat clips into one synthetic layer before the compositor.

### 3. Existing compositor remains the authority

The current compositor in `src/engine/render/Compositor.ts` remains responsible for:

- blending
- masks
- inline effects
- complex effect routing
- final layer stacking

The splat renderer is a source renderer, not a replacement compositor.

### 4. Deterministic time model

Both temporal playback and particles must sample from:

- project time
- clip in/out
- clip-local time

Given the same project time and clip settings, the result must be identical whether the user scrubs directly to that frame or plays through it.

### 5. 4D packaging

The first 4D format is a packaged container, not a loose folder import.

Use:

- `*.gsplat.zip`

The package must contain a manifest describing the frame sequence and payload format.

Loose sequences may be deferred.

### 6. Incremental delivery

The implementation must be staged:

- static clip support first
- then large-scene performance work
- then temporal playback
- then particle effects

Do not start with the hardest phase first.

---

## SUCCESS CRITERIA

Treat the work as successful only if all of the following are true:

- A user can import a supported splat asset into the Media Panel.
- A user can add that media item to a video track and get a real `gaussian-splat` clip.
- The clip renders in preview and export through WebGPU without the old canvas-copy bridge.
- Multiple splat clips can coexist on the timeline without collapsing into one global layer.
- Existing per-layer compositor features still apply to splat clips.
- Project save/load restores splat clips correctly.
- At least one time-varying splat package format works deterministically.
- At least one particle effect mode works deterministically.
- `npm run build` succeeds.
- Relevant tests pass, and new tests exist where coverage was previously absent.

---

## PHASE 0 - ENVIRONMENT CHECK

Before spawning subagents, verify the local Claude CLI:

```powershell
Get-Command claude -ErrorAction SilentlyContinue
claude --help
```

If `claude` is missing, stop and report that the multi-agent runner is unavailable.

Optional helper script for repeated multi-agent runs:

`C:\Users\admin\.agents\skills\claude-code-agents\scripts\run_claude_agents.ps1`

---

## PHASE 1 - READ CONTEXT FIRST

Read these files yourself before launching subagents:

- `docs/plans/Gaussian-Splat-Clip-Orchestrator-Prompt.md`
- `package.json`
- `src/types/index.ts`
- `src/engine/core/types.ts`
- `src/engine/render/RenderDispatcher.ts`
- `src/engine/render/LayerCollector.ts`
- `src/engine/render/Compositor.ts`
- `src/services/layerBuilder/LayerBuilderService.ts`
- `src/engine/export/ExportLayerBuilder.ts`
- `src/engine/gaussian/GaussianSplatSceneRenderer.ts`
- `src/engine/gaussian/types.ts`
- `src/engine/gaussian/index.ts`
- `src/stores/mediaStore/types.ts`
- `src/stores/mediaStore/slices/fileImportSlice.ts`
- `src/stores/mediaStore/slices/fileManageSlice.ts`
- `src/stores/timeline/types.ts`
- `src/stores/timeline/helpers/mediaTypeHelpers.ts`
- `src/stores/timeline/clipSlice.ts`
- `src/stores/timeline/clip/addGaussianAvatarClip.ts`
- `src/stores/timeline/serializationUtils.ts`
- `src/components/panels/MediaPanel.tsx`
- `src/components/timeline/hooks/useExternalDrop.ts`
- `src/components/panels/media/FileTypeIcon.tsx`
- `src/components/panels/properties/index.tsx`
- `src/components/panels/properties/BlendshapesTab.tsx`

Then summarize the current architecture in 10 to 20 bullets before assigning work.

You must understand:

- how `gaussian-avatar` works today
- where clip source types are defined
- how media import and timeline clip creation work
- how layer building and render dispatch currently operate
- how the compositor applies masks and effects
- where serialization and relinking must be extended
- which existing files are shared hot spots and cannot be edited in parallel casually

Do not start implementation until you can explain the current path precisely.

---

## PHASE 2 - PLANNING AGENTS

Launch 6 planning agents in parallel.

Use separate prompts with distinct roles.
Use `claude -p --output-format json --no-session-persistence`.
Planning agents should be read-only.

### Agent 1 - Contracts And Clip Data Model

Focus:

- source type design
- store and timeline contracts
- serialization and relink model
- property schema

Prompt:

```text
You are planning the type and data model for a new native gaussian-splat clip in MasterSelects.

Read:
- docs/plans/Gaussian-Splat-Clip-Orchestrator-Prompt.md
- src/types/index.ts
- src/stores/mediaStore/types.ts
- src/stores/timeline/types.ts
- src/stores/timeline/clipSlice.ts
- src/stores/timeline/serializationUtils.ts
- src/stores/mediaStore/slices/fileImportSlice.ts
- src/stores/mediaStore/slices/fileManageSlice.ts

Task:
1. Propose the exact TypeScript contract for the new `gaussian-splat` source type.
2. Define which fields belong in media metadata vs clip source vs runtime cache.
3. Define how temporal settings and particle settings should be represented without overloading unrelated types.
4. Define the minimum serialization and relink model.
5. Identify shared type files that must be changed in a serialized wave rather than in parallel.

Output:
- exact proposed interfaces
- touched files
- ownership boundaries
- risky shared files
- acceptance checklist
```

### Agent 2 - Loader And Asset Packaging

Focus:

- file formats
- parse pipeline
- normalized asset representation
- 4D package manifest

Prompt:

```text
You are planning the loader architecture for a new native gaussian-splat clip in MasterSelects.

Read:
- docs/plans/Gaussian-Splat-Clip-Orchestrator-Prompt.md
- package.json
- src/engine/gaussian/types.ts
- src/stores/timeline/helpers/mediaTypeHelpers.ts
- src/stores/mediaStore/slices/fileImportSlice.ts
- src/stores/timeline/clip/addGaussianAvatarClip.ts

Task:
1. Define a normalized parsed asset model for static and temporal splats.
2. Propose the loader split for `.ply`, `.splat`, `.ksplat`, and `*.gsplat.zip`.
3. Define the manifest format for `*.gsplat.zip`.
4. Separate what must happen on import time from what may happen lazily at render time.
5. Identify the largest parsing and memory risks.

Output:
- parsed asset schema
- loader architecture
- manifest proposal
- implementation order
- risk register
```

### Agent 3 - WebGPU Renderer Core

Focus:

- GPU buffers
- rasterization model
- cache ownership
- camera transform contract

Prompt:

```text
You are planning the WebGPU renderer core for a new native gaussian-splat clip in MasterSelects.

Read:
- docs/plans/Gaussian-Splat-Clip-Orchestrator-Prompt.md
- src/engine/render/RenderDispatcher.ts
- src/engine/render/Compositor.ts
- src/engine/core/types.ts
- src/engine/gaussian/GaussianSplatSceneRenderer.ts
- src/engine/gaussian/types.ts
- src/services/layerBuilder/LayerBuilderService.ts

Task:
1. Propose the renderer API for per-layer splat rendering into a GPU texture.
2. Define GPU buffer layout, upload lifecycle, and cache ownership.
3. Define how the renderer receives camera and clip settings.
4. Define the smallest safe shader set for the first implementation.
5. Identify what can be shipped in the first raster pass and what should be deferred.

Output:
- renderer API
- file plan
- buffer model
- first-pass shader plan
- deferred items
```

### Agent 4 - Render Integration And Compositor Semantics

Focus:

- layer builder
- render dispatcher
- compositor preservation
- export behavior

Prompt:

```text
You are planning the render integration for a new native gaussian-splat clip in MasterSelects.

Read:
- docs/plans/Gaussian-Splat-Clip-Orchestrator-Prompt.md
- src/engine/render/RenderDispatcher.ts
- src/engine/render/LayerCollector.ts
- src/engine/render/Compositor.ts
- src/services/layerBuilder/LayerBuilderService.ts
- src/engine/export/ExportLayerBuilder.ts
- src/types/index.ts

Task:
1. Explain how `gaussian-splat` should move through layer building, collection, rendering, and compositing.
2. Prove that per-layer masks, opacity, blend modes, and effects remain intact.
3. Propose the exact `processGaussianSplatLayers` shape.
4. Identify which rendering work must happen before the compositor and which must stay in the compositor.
5. Call out export-specific risks.

Output:
- integration flow
- touched files
- invariants to preserve
- export risks
- verification plan
```

### Agent 5 - UI, Timeline, And Editor UX

Focus:

- media panel import
- drag and drop
- timeline clip creation
- properties tab

Prompt:

```text
You are planning the UI and timeline wiring for a new native gaussian-splat clip in MasterSelects.

Read:
- docs/plans/Gaussian-Splat-Clip-Orchestrator-Prompt.md
- src/components/panels/MediaPanel.tsx
- src/components/timeline/hooks/useExternalDrop.ts
- src/components/panels/media/FileTypeIcon.tsx
- src/components/panels/properties/index.tsx
- src/stores/timeline/clipSlice.ts
- src/stores/mediaStore/types.ts

Task:
1. Define the exact import and timeline UX for `gaussian-splat`.
2. Propose the initial properties tab layout for render settings, temporal settings, and particle settings.
3. Identify which settings should ship in the first pass and which should stay hidden or deferred.
4. Define the simplest user flow for adding a splat clip and scrubbing it.
5. Identify the smallest safe set of UI files to change.

Output:
- UX flow
- touched files
- tab design
- deferred controls
- smoke test plan
```

### Agent 6 - Temporal, Particles, And Performance Risk

Focus:

- deterministic 4D sampling
- particle ordering
- performance limits
- testing strategy

Prompt:

```text
You are planning temporal playback, particle effects, and performance strategy for a new native gaussian-splat clip in MasterSelects.

Read:
- docs/plans/Gaussian-Splat-Clip-Orchestrator-Prompt.md
- src/engine/render/RenderDispatcher.ts
- src/engine/core/types.ts
- src/services/layerBuilder/LayerBuilderService.ts
- src/stores/timeline/serializationUtils.ts
- src/engine/gaussian/types.ts

Task:
1. Define a deterministic temporal sampling model for 4D splats.
2. Define where particle offsets should be computed relative to temporal sampling, culling, sorting, and rasterization.
3. Recommend practical limits for `maxSplats`, culling, and sort strategy for large assets.
4. Define the biggest hidden regression risks.
5. Propose the verification matrix for time determinism, playback, export, and performance.

Output:
- temporal model
- particle pipeline ordering
- performance strategy
- regression risks
- verification matrix
```

---

## PHASE 3 - SYNTHESIZE AND FREEZE CONTRACTS

After all planning agents finish:

1. Merge their outputs into one repo-specific implementation plan.
2. Resolve disagreements explicitly.
3. Freeze the core contracts before any parallel coding starts.

You must freeze at least these contracts:

- `gaussian-splat` source shape
- media metadata shape for splat assets
- normalized parsed asset types
- packaged 4D manifest shape
- renderer entrypoints
- per-layer render-to-texture contract
- temporal sampling contract
- particle settings contract

Record the frozen contracts in your own session summary before implementation begins.

If two agents disagree:

- state the disagreement
- choose one design
- explain why the chosen design better fits the current repo

Do not let implementers choose contracts ad hoc.

---

## PHASE 4 - IMPLEMENTATION WAVES

Do not start with many parallel coders.
The first implementation wave must serialize the shared contracts.

### Wave 1 - Shared Contracts And Clip Skeleton

Use 1 implementer only.

Goal:

- land all shared type additions and the minimal clip/import skeleton for `gaussian-splat`

Suggested ownership:

- `src/types/index.ts`
- `src/stores/mediaStore/types.ts`
- `src/stores/timeline/types.ts`
- `src/engine/structuralSharing/types.ts`
- `src/stores/timeline/helpers/mediaTypeHelpers.ts`
- `src/stores/timeline/clip/addGaussianSplatClip.ts`
- `src/stores/timeline/clipSlice.ts`
- `src/stores/timeline/serializationUtils.ts`
- `src/stores/mediaStore/slices/fileImportSlice.ts`
- `src/stores/mediaStore/slices/fileManageSlice.ts`

Required outcome:

- the repo understands `gaussian-splat` as a source type and media type
- import and serialization do not crash
- compile stays green even before rendering is complete

### Wave 2 - Parallel Core Build

After Wave 1 is merged and stable, launch 3 implementers in parallel.

#### Implementer A - Loader Stack

Ownership:

- `src/engine/gaussian/loaders/*`
- `src/engine/gaussian/types.ts`

Task:

- build normalized loaders and manifest parsing

#### Implementer B - Renderer Core

Ownership:

- `src/engine/gaussian/core/*`
- `src/engine/gaussian/shaders/gaussianSplat.wgsl`
- `src/engine/gaussian/index.ts`

Task:

- build the native per-layer WebGPU renderer core for static assets

#### Implementer C - UI And Properties

Ownership:

- `src/components/panels/MediaPanel.tsx`
- `src/components/timeline/hooks/useExternalDrop.ts`
- `src/components/panels/media/FileTypeIcon.tsx`
- `src/components/panels/properties/index.tsx`
- `src/components/panels/properties/GaussianSplatTab.tsx`

Task:

- build import, drag-drop, and first-pass properties UI

Do not allow these implementers to edit `RenderDispatcher.ts` in this wave.

### Wave 3 - Render Integration

Use 1 implementer.

Ownership:

- `src/services/layerBuilder/LayerBuilderService.ts`
- `src/engine/render/LayerCollector.ts`
- `src/engine/render/RenderDispatcher.ts`
- `src/engine/export/ExportLayerBuilder.ts`

Task:

- integrate `gaussian-splat` as a real render source using per-layer render-to-texture

Required invariants:

- one splat clip equals one compositor-visible synthetic layer
- existing compositor semantics remain intact
- old `gaussian-avatar` path still compiles

### Wave 4 - Large Asset Performance

Use 1 or 2 implementers depending on file overlap.

Possible ownership split:

- Implementer D:
  - `src/engine/gaussian/core/SplatSortPass.ts`
  - `src/engine/gaussian/shaders/radixSort.wgsl`
- Implementer E:
  - `src/engine/gaussian/core/SplatVisibilityPass.ts`
  - `src/engine/gaussian/shaders/visibilityCull.wgsl`

Task:

- add culling, budgeting, and sort support for larger splat counts

If file overlap becomes messy, serialize this wave instead of forcing parallelism.

### Wave 5 - Temporal And Particle Features

Use 1 or 2 implementers after the static path is stable.

Possible ownership split:

- Implementer F:
  - `src/engine/gaussian/temporal/*`
  - `src/engine/gaussian/shaders/temporalBlend.wgsl`
- Implementer G:
  - `src/engine/gaussian/effects/*`
  - `src/engine/gaussian/shaders/particleCompute.wgsl`

Task:

- add deterministic 4D playback and deterministic particle offsets

Required ordering:

- sample temporal frame
- apply particle offsets
- cull
- sort
- rasterize

Do not merge this wave until deterministic scrubbing is verified.

---

## IMPLEMENTATION PROMPT TEMPLATES

Use prompts like the following for implementation agents.
Adjust file lists to match the frozen contracts.

### Template - Implementer

```text
You are implementing one bounded slice of the native gaussian-splat clip work in MasterSelects.

You are not alone in the codebase.
Do not revert other agents' changes.
Stay strictly within your assigned files unless a small compile fix is unavoidable, and report any such deviation clearly.

Read first:
- docs/plans/Gaussian-Splat-Clip-Orchestrator-Prompt.md
- [assigned files only]

Task:
- [specific bounded task]

Constraints:
- Do not change architecture outside your scope.
- Do not introduce a fallback to the old gaussian-avatar renderer.
- Do not edit shared files not explicitly assigned.
- Keep the implementation compatible with the frozen contracts.

Deliver:
- summary of what changed
- exact files touched
- open issues
- tests run
```

---

## PHASE 5 - REVIEW AGENTS

After each implementation wave, launch independent review agents before merging the next risky wave.

Use at least:

- 1 correctness reviewer
- 1 performance reviewer
- 1 tester or verification agent

For the final wave, add a second correctness reviewer if the diff is large.

### Reviewer 1 - Correctness

Prompt:

```text
Review the gaussian-splat implementation changes for bugs, regressions, and missing tests.

Focus on:
- type contract mismatches
- broken timeline serialization
- render ordering regressions
- incorrect assumptions about masks, blend modes, or effects
- temporal determinism bugs

Report:
- findings first, ordered by severity
- file references
- open questions
- residual test gaps
```

### Reviewer 2 - Performance

Prompt:

```text
Review the gaussian-splat implementation changes for performance, GPU lifecycle, and memory risks.

Focus on:
- repeated parsing or buffer uploads
- VRAM leaks
- unnecessary per-frame allocation
- inefficient texture churn
- sort and cull scalability
- export path overhead

Report:
- findings first, ordered by severity
- file references
- likely hotspots
- recommended fixes
```

### Reviewer 3 - Verification

Prompt:

```text
Verify the gaussian-splat implementation against the documented plan.

Check:
- import works
- timeline clip creation works
- serialization and restore work
- preview render works
- multiple splat clips preserve ordering
- deterministic temporal scrubbing works
- particle settings behave deterministically
- build and tests cover the critical path

Report:
- pass/fail per scenario
- missing coverage
- blockers to merge
```

---

## REQUIRED VERIFICATION MATRIX

Before declaring success, verify at least the following:

### Build And Static Checks

- `npm run build`
- targeted lint or type checks if needed

### Import And Timeline

- import `.ply`
- import `.splat`
- import `.ksplat` if implemented in this wave
- import `*.gsplat.zip` for temporal support
- add to timeline from media panel
- add via drag and drop
- save and reload project
- relink source if applicable

### Preview And Compositing

- single splat clip preview
- multiple splat clips on different tracks
- opacity changes
- blend mode changes
- mask application
- standard effect stack still works on the generated layer texture

### Temporal

- scrub directly to a late frame
- play through to the same frame
- compare result for determinism
- trim clip and confirm sampling respects clip-local time

### Particle Effects

- enable particle mode
- scrub back and forth and confirm deterministic output
- verify particles do not desync from temporal sampling

### Performance

- first render after import
- repeated preview frame cost
- large asset memory behavior
- behavior with more than one active splat clip

### Export

- export frame or short sequence with splat clip
- export with temporal content if that wave is complete

---

## MERGE RULES

- Do not merge a wave if the frozen contracts were violated.
- Do not merge a wave if reviewers found unresolved high-severity bugs.
- Do not merge performance work before the static path is stable.
- Do not merge temporal or particle work before serialization and preview are already solid.
- Prefer smaller merged slices over one giant final diff.

If a subagent edits outside its scope:

- reject the result or manually extract only the valid part
- do not casually accept drive-by changes in shared files

---

## FINAL REPORT FORMAT

At the end, produce a concise final report with:

1. completed waves
2. files changed
3. verification performed
4. unresolved risks
5. deferred work
6. recommended next implementation slice

If any promised feature is only partially complete, say so explicitly.

---

## OPTIONAL BATCH RUNNER

If you prefer a repeatable multi-agent run, you may use:

`C:\Users\admin\.agents\skills\claude-code-agents\scripts\run_claude_agents.ps1`

Example planning config shape:

```json
[
  {
    "name": "contracts",
    "prompt": "Plan the gaussian-splat type and clip data model."
  },
  {
    "name": "loaders",
    "prompt": "Plan the gaussian-splat loader and package architecture."
  },
  {
    "name": "renderer",
    "prompt": "Plan the WebGPU renderer core for gaussian-splat clips."
  }
]
```

Example invocation:

```powershell
powershell -ExecutionPolicy Bypass -File C:\Users\admin\.agents\skills\claude-code-agents\scripts\run_claude_agents.ps1 -ConfigPath .\agents.json -WorkDir C:\Users\admin\Documents\masterselects
```

---

## ORCHESTRATOR CHECKLIST

- verify `claude` CLI
- read current code first
- summarize existing architecture
- run planning agents
- freeze contracts
- run Wave 1
- verify Wave 1
- run Wave 2
- verify Wave 2
- run Wave 3
- verify Wave 3
- run Wave 4
- verify Wave 4
- run Wave 5
- run final review agents
- produce final report

