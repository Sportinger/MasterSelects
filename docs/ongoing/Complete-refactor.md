# Complete Refactor Execution Plan

Status: execution plan
Created: 2026-06-09
Updated: 2026-06-09

## Objective

Guide the full-codebase refactor execution for MasterSelects.

The target is the long-term architecture, not a cleanup MVP. The timeline
refactor is the method template: lanes, ownership, gates, ledgers, focused
checks, retired-path classification, and execution reporting. The whole-codebase
plan must reuse that discipline without copying timeline-specific code.

Agents working on the Complete Refactor should use this document as the active
execution plan. Do not restart meta-planning by default. Work in bounded
packets with a lane, write set, forbidden files, expected gates/checks, and a
short report.

If a required contract, gate, or write set is missing, add the smallest needed
preflight entry here and in the checklist, then continue with the bounded
packet when the risk is controlled.

## Success Definition

The final architecture should be easy to change, easy to reason about, and fast
in the places where performance matters.

Success means:

- no source god objects remain as normal architecture
- no product source file should exceed 700 LOC without an explicit temporary
  gate exception
- files are grouped by responsibility, dependency direction, and lifecycle
  owner, not split blindly by line count
- duplicate logic is consolidated behind stable contracts instead of copied
  into smaller files
- runtime ownership is explicit and durable state stays serializable
- hot paths have performance baselines and guardrails before and after changes
- legacy paths are deleted, ignored, or isolated behind explicit current-behavior
  import boundaries
- tests protect user-visible behavior and architecture boundaries, not obsolete
  implementation details

The 700 LOC limit is a guardrail, not the definition of success. A 300 LOC file
can still be bad architecture if it is a prop funnel, dependency dump,
retired compatibility wrapper, or hidden runtime owner.

## 700 LOC And Cohesion Rule

Target state: no normal product source file over 700 LOC.

700 LOC is the ceiling, not the target. Most files should be much smaller,
depending on their role.

Suggested target budgets:

| File role | Target |
|---|---:|
| Composition root / complex shell | <= 700 LOC |
| React host component | <= 400 LOC |
| Focused React view component | <= 250 LOC |
| Leaf UI component | <= 150 LOC |
| Store root / public store facade | <= 400 LOC |
| Store slice | <= 300 LOC |
| Store selector / action planner | <= 250 LOC |
| Pure planner / builder / selector | <= 250 LOC |
| Runtime service facade | <= 700 LOC |
| Runtime lifecycle owner | <= 400 LOC |
| IO adapter | <= 300 LOC |
| Registry / contributor module | <= 300 LOC |
| Renderer / painter facet | <= 200 LOC |
| Bridge route / dev-tool handler | <= 250 LOC |
| Architecture gate / coherence test | <= 250 LOC |
| Coherence envelope / orchestration function | <= 80 LOC |
| Component CSS module/file | <= 250 LOC |
| Domain CSS file | <= 700 LOC |

Allowed exceptions:

- generated files
- vendored code
- test fixtures where splitting would hide intent
- temporary gate exceptions with owner, reason, replacement plan, and delete or
  split gate

A split is valid only when it improves at least one real architectural property:

- narrows a public contract
- removes a cross-domain import
- separates durable state from runtime allocation
- isolates IO from planning or pure selection
- isolates dev-only diagnostics from product behavior
- deletes legacy compatibility or isolates active import adapters behind a
  domain boundary
- removes duplicated logic by creating a single domain owner
- separates high-frequency rendering from low-frequency React UI
- gives tests a smaller and more meaningful behavior surface

Invalid splits:

- moving random functions into `helpers.ts` or `utils.ts`
- creating wrapper modules that only rename old logic
- creating a broad `types.ts` dump beside the old god object
- splitting by visual position in the file instead of responsibility
- passing the same broad prop/store bag through more layers
- keeping old fallback branches after the new contract owns the behavior

Preferred module shapes:

- public contract / types
- pure selectors or planners
- runtime owner / lease manager
- IO adapter
- React shell
- focused view components
- renderer or painter facet
- test and smoke gate

## Dead Code And Retired Path Deletion

Dead code deletion is part of the Complete Refactor, but it must be deliberate.
Agents should not delete unused-looking code as drive-by cleanup while working
on another packet.

Every deletion candidate must be classified in the retired-path ledger as one
of:

- delete now
- delete at gate
- keep

Deletion requires:

- owner lane
- replacement gate or keep/migration reason
- usage scan or import scan
- related test migration classification
- focused check showing the active behavior is still covered

CSS class deletion also needs a class-usage scan and retired-class entry.
Tests that assert obsolete internals should be ported, replaced, split, kept,
or deleted through the test-migration ledger after replacement coverage exists.

## Project Compatibility Policy

MasterSelects currently has no external users whose saved projects must remain
loadable. The Complete Refactor may intentionally break old project files when
that produces the cleaner long-term architecture.

Project persistence work should target the current schema only:

- do not build a versioned migration registry only to preserve obsolete saved
  project payloads
- delete or ignore deprecated project fields after active behavior has current
  coverage
- keep fixtures for current save/load, autosave, nested restore, active
  FlashBoard generation metadata, active Media Panel data, and signal state
- do not let old `youtube`, `download`, `ai-video`, or retired FlashBoard
  board/canvas payloads shape current architecture

If a later release needs compatibility for a specific internal project fixture,
that must be added as an explicit product decision, not assumed by default.

## Master Orchestrator Execution Model

The eventual refactor should be executed by one master orchestrator agent.

The master orchestrator owns:

- canonical plan and lane ordering
- contract freeze decisions
- dependency map and shared hub ownership
- write-set assignment and forbidden-file enforcement
- worker-agent prompts
- gate closure decisions
- diff review and integration order
- execution report updates
- skeptical review incorporation

The master orchestrator should not let worker agents invent the target
architecture independently. Workers implement or verify bounded packets from
the accepted plan.

The orchestrator may use up to 6 parallel worker agents when the work is truly
independent. Parallelism is allowed for read-only discovery, baseline scans,
test classification, legacy classification, and implementation packets with
disjoint write sets. If two packets touch the same shared hub, project schema,
store boundary, renderer, bridge, or source file, they must be sequenced.

The orchestrator should prefer waves:

1. Baseline/discovery wave: read-only agents collect metrics and risks.
2. Contract wave: foundation agents define target contracts and gates.
3. Skeptical review wave: reviewers attack the plan before implementation.
4. Implementation wave: up to 6 disjoint worker packets.
5. Verification wave: independent verifier agents run gates and inspect diffs.
6. Synthesis wave: orchestrator updates ledgers, checklist, and next packet
   list.

## Worker Agent Packet Format

Every worker-agent task should be issued as a packet with this shape:

```text
Lane:
Packet:
Mode: read-only | implementation | verification
Goal:
Read first:
Allowed write set:
Forbidden files:
Current contract:
Target contract:
Retired paths in scope:
Runtime invariants:
Expected gates:
Expected checks:
Expected report:
Stop conditions:
```

Worker agents must report:

- files read
- files changed, if any
- coupling actually reduced
- gates passed, failed, or still active
- checks run and result
- checks skipped and why
- retired paths classified or deleted
- tests ported, replaced, split, kept, or deleted
- remaining risks and next packet recommendation

For implementation packets, the worker should not broaden scope when it finds
extra debt. It should report the debt and let the orchestrator assign the next
packet.

## Progress, Commit, And Check Cadence

The refactor should preserve progress frequently, but checks must stay scoped
to the risk of the packet.

During normal implementation:

- keep changes in small, coherent packets
- update this plan/checklist whenever requirements, gates, write sets,
  blockers, or decisions change
- keep `docs/ongoing/Complete-refactor-checklist.md` as the only
  user-visible status source
- update phase files, queue files, or handoff files only when packet scope,
  contract, gate, write set, blocker, next eligible packet, or verification
  result changes
- keep `docs/ongoing/complete-refactor/execution-queue-and-lanes.md` as an
  active execution queue, not a packet-history archive: it should contain the
  active packet, the next few queued packets, high-conflict ownership, reusable
  check profiles, and the immediate next step
- when a packet completes, collapse it to one or two checklist lines and remove
  or summarize the long packet spec unless the spec is still needed as a
  reusable template for the next packet wave
- run focused gates, targeted unit tests, static scans, or smokes that match
  the packet risk
- avoid redundant check loops: rerun whole-codebase architecture registry tests
  only when architecture manifests, gates, ledgers, or write sets change; rerun
  broad smoke/test bundles at coherent packet boundaries instead of after every
  tiny extraction; scope `rg` scans to affected paths whenever possible
- do not run full `npm run build`, `npm run lint`, and `npm run test` after
  every small edit
- run the full chain only when AGENTS.md requires it: normal commit, push,
  release, merge, or explicit final readiness
- if the user explicitly requests a `fast commit`/`fast push` workflow, follow
  the fast-command rules in AGENTS.md instead of running checks

Commit cadence:

- commit after coherent, reviewable packets rather than after every file edit
- do not commit unresolved broad churn that lacks an accepted gate/write set
- do not push unless the active branch/workflow and user instruction allow it
- for long multi-agent execution, prefer frequent checkpoint commits only when
  the command mode permits them and the diff is understandable

## Gate And Checklist Contract

The checklist is not only a task list. It is the user-visible contract for what
is allowed, forbidden, blocked, and finished.

Every phase and every implementation packet must expose:

- goal
- allowed write set
- forbidden files or directories
- high-conflict hubs
- do-not rules
- gate ids
- gate subchecks
- focused checks or smoke commands
- exit criteria

Gate ids are not complete until their subchecks say what proves them. A gate
that only names a desired state is still a planning item, not an executable
guard.

Each gate should have this shape:

```text
Gate:
Subchecks:
- static or runtime condition
- fixture/smoke condition
- import/LOC/runtime-boundary condition
Checks:
- exact test, script, bridge command, or scan command when known
Do not:
- files, domains, or shortcuts that must not be touched to close this gate
Exit:
- observable state that lets the orchestrator mark the gate closed
```

When a worker discovers that a gate lacks subchecks, the worker must stop
source edits for that packet and report the smallest missing preflight entry.

## Source Of Truth

Use the current code tree as the primary source of truth.

Current feature docs in `docs/Features/**` are useful context. Historical docs
under `docs/completed/**` are reference material only; they may describe old
plans or surfaces that no longer exist.

Keep the refactor execution artifacts small.

Required during execution:

- `docs/ongoing/Complete-refactor.md`: actual refactor plan
- `docs/ongoing/Complete-refactor-checklist.md`: user-visible progress
- `docs/ongoing/complete-refactor/*.md`: phase details, active packet queue,
  reusable check profiles, and lane records referenced by this index

Optional when the plan becomes canonical:

- `docs/refactor/whole-codebase/Whole-Codebase-Refactor-Plan.md`
- `docs/refactor/whole-codebase/Whole-Codebase-Refactor-Baseline.md`

Do not create separate manifest/ledger files up front unless a gate needs to be
executable. Keep lane ownership, contract freeze notes, adapter debt, retired
paths, test migration, and dependency maps as sections inside the plan until
they become too large or the implementation phase needs separate files.

The completed timeline refactor already has an executable architecture-registry
pattern under `src/timeline/architecture/**` and
`tests/unit/timelineArchitectureRegistry.test.ts`. The whole-codebase refactor
should generalize that discipline only when the Phase 0 architecture-registry
gate is accepted, so this plan does not drift into a second unverified source
of truth.

While the refactor runs from `docs/ongoing/`, use this file as the actual plan
and `docs/ongoing/Complete-refactor-checklist.md` as the user-visible progress
checklist.

Handoff files are execution templates, not running logs. Use them when a master
orchestrator or worker-agent run starts and needs resume state. Keep handoff
updates to current state, next packet, blockers, and last meaningful checks; do
not duplicate the full packet history already recorded by the checklist and
queue.

Checklist rule: whenever a new requirement, lane, gate, baseline item, or
blocker is discovered, update `Complete-refactor-checklist.md` in the same
session so the user can quickly see what is done and what remains.

## Timeline Reuse Position

The timeline refactor is not work to restart.

Reuse from `src/timeline/architecture/**`:

- gate registry shape
- lane write manifest shape
- high-conflict ownership tracking
- retired-path ledger shape
- adapter-debt ledger shape
- test-migration ledger shape
- exit-criteria coverage shape
- architecture-registry test style from
  `tests/unit/timelineArchitectureRegistry.test.ts`

Do not copy timeline-specific gate ids or implementation details into the
whole-codebase plan. Generalize the method and keep the timeline as a protected
lane that other phases integrate with through contracts.

Timeline source edits are allowed only for explicit integration packets, such
as project hydration adapters, runtime lease migration, signal materialization,
or render/export snapshot integration. A worker must not reopen broad timeline
architecture work just because a whole-codebase gate mentions the timeline.

## Foundation-First Order

The plan should not start with Media Panel, FlashBoard, Preview, or render code
movement. Those lanes depend on shared foundations.

Required order:

1. Type tier, broad barrels, and dependency map.
2. Durable state versus runtime lease boundaries.
3. Universal Signal and import route foundation for "no unsupported files".
4. Project load/save, importers, history, autosave, and artifact schema.
5. Dev bridge and smoke verifier quarantine.
6. Domain lanes: Media Panel, FlashBoard, Preview, Export, Audio, Render,
   Proxy/Cache/Runtime, Common UI, Dock, CSS, tools, and tests.

Shared hubs need explicit ownership before implementation:

- `src/types/index.ts`
- `src/stores/timeline/index.ts`
- `src/stores/mediaStore/index.ts`
- history, dock, settings, and render-target stores
- project load/save and importers
- `RenderDispatcher`
- `WebGPUEngine`
- `Preview`
- `MediaPanel`
- `aiTools/bridge`
- dev smoke/stress test handlers such as `timelineCanvasSmoke`

## Runtime Invariants

Runtime handles must not leak into durable state, project files, pure shared
types, or cross-domain schema tiers.

Explicitly exclude these from durable/project state:

- `File`
- `Blob`
- object URLs
- DOM elements
- `HTMLMediaElement`
- `AudioContext`
- `VideoFrame`
- `ImageBitmap`
- `GPU*` objects
- decoder/player instances
- workers
- service singletons

The plan must separate durable state, selectors, commands, IO, runtime leases,
and active importer behavior.

## Baseline Checklist

Before finalizing this plan, capture a reproducible baseline with command
outputs summarized in this plan unless the data becomes too large.

Minimum baseline:

- domain LOC totals
- files over 700, 1000, 1500, 2000, and 3000 LOC
- fan-in/fan-out hubs
- broad `index.ts` barrels and global type dumps
- cross-domain imports that violate intended ownership
- `getState()` usage outside stores, counted by file
- runtime-handle usage in durable state or pure contracts
- React components with mixed update cadence or excessive hooks
- services that mix planning, allocation, IO, diagnostics, and UI policy
- CSS files over 700, 1000, and 2000 LOC
- unused or legacy CSS class candidates
- deprecated panels and retired UI paths
- project save/load and importer touch points
- AI bridge and dev-smoke handlers that currently act as verifier surfaces
- render, playback, audio, export, preview, and Media Panel performance smokes
- tests coupled to legacy internals instead of user-visible behavior

Known baseline signals from the first scan:

- `src/components` is the largest area at roughly 162k LOC.
- `src/services` is roughly 134k LOC and must be split by lifecycle owner, not
  treated as one lane.
- `src/engine` is roughly 52k LOC.
- `src/stores` is roughly 50k LOC.
- `src/types/index.ts` has 755 direct relative import hits across `src` and
  `tests`; 776 files import somewhere under `src/types`, so it remains the
  first foundation lane.
- Large god objects include `MediaPanel.tsx`, `FlashBoardComposer.tsx`,
  `ExportPanel.tsx`, `proxyFrameCache.ts`, `timelineCanvasSmoke.ts`,
  `aiTools/bridge.ts`, `Preview.tsx`, `RenderDispatcher.ts`, and
  `WebCodecsPlayer.ts`.

## Actual Codebase Refactor Plan

This is the codebase-specific refactor plan. It is not only a plan for how to
plan.

The work should be executed in phases because several large files are symptoms
of shared foundation problems. Media Panel, FlashBoard, Preview, Export, Render,
Audio, Project, and AI tools all touch shared types, stores, project hydration,
runtime handles, and dev smokes. Starting with a single UI god object would
only move the coupling.

## Review Corrections From Codebase Agents

Four read-only review agents compared this plan against the codebase. The plan
should incorporate these corrections before implementation starts:

- Baseline numbers in this document are planning signals only. Before gates or
  budgets are enforced, refresh LOC, fan-in/fan-out, `getState()`, runtime
  handles, CSS, and smoke baselines with reproducible commands.
- Add a required `Phase 1A` for clip/media-source data versus runtime split.
  Runtime handles already live in shared foundation models such as
  `src/types/index.ts` and media store types; treating this only as a later
  store/runtime cleanup would leave the root defect in place.
- Treat Phase 2 and Phase 3 contract design as one freeze wave. Stores,
  project load/save, project schema, history, FlashBoard persistence, media
  runtime, and importers currently form a cycle.
- Use `services/mediaRuntime` as the canonical runtime lease domain instead of
  inventing a second lease manager. Existing sources such as
  `blobUrlManager`, `sourceRuntimeSanitizer`, `webCodecsHelpers`, proxy/cache,
  and project hydration should migrate into or behind that owner.
- Project schema must be plain persisted DTOs with no imports from stores,
  engine, components, or live runtime services. Store/domain code may map to
  schema DTOs; schema must not depend on store internals.
- Superseded on 2026-06-09 by the project compatibility policy: do not build a
  versioned project migration registry only for obsolete saved projects. The
  current schema boundary still needs to be built cleanly.
- Static runtime-handle scans are not enough. `P1A-RUNTIME-LEASE-001` added
  `src/services/mediaRuntime/persistedStateGuard.ts` and
  `tests/unit/persistedStateRuntimeHandles.test.ts` so `structuredClone`, JSON
  roundtrip, object URL, runtime-field, and runtime-object leaks are checked.
- Split `getState()` findings by usage class:
  - sanctioned fresh reads in async callbacks
  - adapter/bridge reads
  - module-scope/render-path reads
  Only the last category is a hard reduction target.
- Phase 5 and Phase 6 are coupled. Preview and Export mutate render targets,
  engine export mode, resolution, readback paths, and render-time overrides.
  They must wait for render lifecycle contracts such as `RenderFrameSnapshot`,
  `RenderTargetSnapshot`, `RenderOutputRouter`, and `ExportRenderSession`.
- Proxy/cache needs its own explicit lifecycle work: VideoFrame close/borrow
  contracts, object URL revoke accounting, decoder coalescing, bounded cache
  pressure, and scrub `AudioContext` disposal.
- Audio needs an ownership map before refactor: live playback routing, scrub
  audition, recording/worklet, export/offline rendering, diagnostics, and
  compatibility.
- Existing AI bridge smokes are valuable and should become Phase 0 gates with
  thresholds, not remain Phase 7 cleanup.
- CSS risk is broader than LOC. Add gates for global selectors, z-index tiers,
  fixed overlays, pointer-event traps, and retired class usage.
- New runtime owners must be HMR-safe according to the repo singleton pattern.
- The whole-codebase gates should reuse the timeline architecture-registry
  method instead of remaining Markdown-only. Add a Phase 0 preflight gate for a
  codebase-wide registry plan before source implementation begins.
- Add a Universal Signal lane. `src/signals/**`,
  `src/importers/UniversalImportOrchestrator.ts`, CSV import, binary fallback,
  WASM/worker runtime, and renderer adapters are already part of the "no
  unsupported files" target and must not be treated as incidental project
  persistence details.

## Detailed Phase Files

The codebase-specific phase details are split into bounded files so the active orchestrator index stays readable. These files remain part of the same Complete Refactor plan; do not treat them as separate initiatives.

- [P0 Baseline And Guard Rails](complete-refactor/p0-baseline-and-guard-rails.md)
- [P1 Foundation Contracts](complete-refactor/p1-foundation-contracts.md)
- [P2-P3 State And Project Persistence](complete-refactor/p2-p3-state-and-project-persistence.md)
- [P4 Media Panel And FlashBoard](complete-refactor/p4-media-panel-and-flashboard.md)
- [P5 Preview, Export, And Common UI](complete-refactor/p5-preview-export-common-ui.md)
- [P6 Render, Audio, Codecs, Proxy, And Cache](complete-refactor/p6-render-audio-codecs-proxy-cache.md)
- [P7 AI Tools, Dev Bridge, And Smokes](complete-refactor/p7-ai-tools-dev-bridge-smokes.md)
- [P8 Tests And Architecture Gates](complete-refactor/p8-tests-and-architecture-gates.md)
- [Execution Queue And Lanes](complete-refactor/execution-queue-and-lanes.md)
- [Execution History 2026-06-09](complete-refactor/execution-history-2026-06-09.md)

## Status Source

Use `docs/ongoing/Complete-refactor-checklist.md` as the running user-visible
status source. Do not duplicate packet history in this index. Active and next
packet definitions live in [Execution Queue And Lanes](complete-refactor/execution-queue-and-lanes.md);
phase contracts live in the phase files above. Historical completed packet specs
live in [Execution History 2026-06-09](complete-refactor/execution-history-2026-06-09.md) and should be read only when compact status is not enough.

## Read Order For Agents

1. Read this index and `docs/ongoing/Complete-refactor-checklist.md`.
2. Read [Execution Queue And Lanes](complete-refactor/execution-queue-and-lanes.md) for the active packet, dependency order, high-conflict ownership, and stop conditions.
3. Read only the phase file for the lane being assigned.
4. Read [Execution History 2026-06-09](complete-refactor/execution-history-2026-06-09.md) only when a completed packet's full historical write set, report, or check detail is needed.
5. For Timeline integration, use completed Timeline architecture docs and `src/timeline/architecture/**` as references only unless the packet explicitly allows Timeline edits.

## Immediate Next Step

Use `docs/ongoing/Complete-refactor-checklist.md` for the current status and
`docs/ongoing/complete-refactor/execution-queue-and-lanes.md` for the active or
next bounded packet definition.
