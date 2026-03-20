# Slot Grid Live VJ Multi-Agent Plan

**Created:** 2026-03-17  
**Mode:** Lead-orchestrated execution plan for up to 20 agents  
**Scope:** Turn the existing Slot Grid into a low-latency live playback surface that feels closer to Resolume than to "open comp in editor and then play".

---

## Purpose

This document is not just a feature plan.

It is an execution harness for a lead agent that may delegate work to many smaller, diligent, lower-context agents without losing safety, coherence, or technical quality.

Use this plan when:

- one lead agent owns the outcome
- multiple agents may work in parallel
- some agents are strong at execution but weak at architecture
- the project must stay stable while major playback behavior changes

This plan assumes:

- the lead agent is the only merge authority
- delegated agents get bounded work packets
- risky behavior changes require independent review before merge

Companion document:

- [Slot Grid Live VJ Agent Prompts](./slot-grid-live-vj-agent-prompts.md)
- [Slot Grid Live VJ Phase 0 Contracts](./slot-grid-live-vj-phase-0-contracts.md)
- [Slot Grid Live VJ Phase 2 Warm Slot Contract](./slot-grid-live-vj-phase-2-warm-slot-contract.md)

---

## Desired Product Outcome

Make Slot Grid launching feel immediate and dependable enough for live visual performance.

Target behavior:

- single click launches a slot without reloading the editor
- assigned slots can stay warm and show a valid first frame immediately
- hot slots can launch within one frame or close to it on warmed media
- cue and program become separate concepts
- live layers can be triggered, faded, retriggered, and mapped to MIDI controls

---

## Current Constraints In Code

### 1. Slot click is still editor-first

`src/components/timeline/SlotGrid.tsx`

- slot click calls `openCompositionTab(..., { playFromStart: true })`
- only after that does it activate the layer

This makes live launch depend on editor timeline switching.

### 2. Composition switching reloads timeline state

`src/stores/mediaStore/slices/compositionSlice.ts`

- `finishCompositionSwitch()` calls `timelineStore.loadState(...)`
- playback starts only after timeline restore finishes

That is acceptable for editing, but not ideal for performance triggering.

### 3. Playback still has readiness waits on HTML video

`src/stores/timeline/playbackSlice.ts`

- `play()` waits for active videos to reach usable readiness
- this adds startup delay when sources are cold

### 4. Background layers load media at activation time

`src/services/layerPlaybackManager.ts`

- `activateLayer()` hydrates clips and creates media elements on demand
- `loadVideoForClip()` starts from a cold `HTMLVideoElement`

That is too late for a live trigger path.

### 5. Full low-latency decode path is not the default

`src/engine/featureFlags.ts`

- `useDecoderPool: false`
- `useFullWebCodecsPlayback: false`

So the current path still leans on HTML media behavior.

---

## Multi-Agent Operating Model

The lead agent must treat this work as a DAG of bounded leaf tasks, not as one giant conversation.

Core rules:

- the lead agent owns architecture, task graph, merge order, and final quality bar
- every delegated agent gets exactly one bounded work packet
- each work packet has explicit inputs, outputs, write scope, and forbidden changes
- no agent may expand scope on its own
- no agent may own overlapping writes with another implementer in the same wave
- agents do not depend on another agent's prose; they depend on artifacts, file paths, interface contracts, tests, or diffs
- the lead agent merges by evidence, not by confidence

The lead agent should prefer:

- contract-first execution
- disjoint write scopes
- shallow parallelism with strong verification

The lead agent should avoid:

- spawning many agents before contracts are stable
- overlapping edits to shared playback files
- letting implementers define their own acceptance criteria

---

## Role Catalog And Trust Boundaries

| Role | Purpose | Can Edit Production Code | Can Edit Tests | Trust Level |
|------|---------|--------------------------|----------------|-------------|
| `lead-orchestrator` | Owns plan, task graph, merges, final decisions | Yes | Yes | Highest |
| `planner` | Produces or compares interface/contract proposals | No by default | No | Advisory only |
| `implementer` | Makes bounded production code changes | Yes, only in assigned scope | Yes if assigned | Medium |
| `reviewer-correctness` | Looks for bugs, regressions, broken assumptions | No | No | High |
| `reviewer-performance` | Looks for latency, lifecycle, cache, memory, timing issues | No | No | High |
| `risk-auditor` | Adversarial review, tries to break the design | No | No | High |
| `tester` | Adds or runs tests, writes smoke harnesses, validates scenarios | No by default | Yes | High |
| `integration-arbiter` | Reconciles cross-agent outputs against contracts | No by default | No | High |

Trust boundary rules:

- only the lead agent may merge production work from multiple agents
- reviewers and risk auditors are read-only
- testers should edit tests only unless explicitly assigned otherwise
- if an agent violates scope, the lead rejects the result instead of trying to salvage it casually

---

## Agent Budget

Do not use the full 20-agent ceiling by default.

Use a bounded pool:

| Pool | Count | Notes |
|------|-------|-------|
| `lead-orchestrator` | 1 | Always singular |
| `planner` | 0-2 | Only for contract-first phases or disagreement |
| `implementer` | 1-6 | Only on disjoint write scopes |
| `reviewer` | 1-6 | Correctness and performance lanes |
| `tester` | 1-4 | Unit, integration, smoke, perf |
| `risk-auditor` | 0-2 | For high-risk behavior changes |
| `integration-arbiter` | 0-1 | Needed when outputs converge poorly |

Practical maximum layout:

- 1 lead
- 2 planners
- 6 implementers
- 4 reviewers
- 3 testers
- 2 risk auditors
- 1 integration arbiter
- 19 total

Do not spawn toward this ceiling unless the task graph is already stable.

---

## Risk Tiers And Spawn Rules

### Tier 0: Trivial

Examples:

- wording-only docs
- comment cleanup
- purely local rename

Execution:

- lead does it locally
- no spawn needed

### Tier 1: Local Implementation

Examples:

- one file or one tightly-scoped pair of files
- no behavior change to launch timing, cache ownership, or state model

Execution:

- 1 implementer
- optional 1 reviewer if tests are thin

### Tier 2: Moderate Behavior Change

Examples:

- slot interaction changes
- UI/store wiring changes
- new live actions with unchanged runtime model

Execution:

- 1 implementer
- 1 reviewer-correctness
- 1 tester

### Tier 3: High-Risk Runtime Or State Change

Examples:

- launch timing
- playback startup
- cache warmup
- decoder selection
- state ownership across `SlotGrid`, `compositionSlice`, `playbackSlice`, `layerPlaybackManager`

Execution:

- 2 independent solution opinions before code lands
- 1 implementer after contract selection
- 1 reviewer-correctness
- 1 reviewer-performance
- 1 tester
- 1 risk-auditor

This is the default tier for Phases 1, 2, and 6.

### Tier 4: Cross-Cutting Multi-Subsystem Change

Examples:

- new deck lifecycle model
- cue/program routing plus render target changes
- MIDI plus live launch plus routing integration

Execution:

- 2 planners or 2 independent design opinions
- 2-4 implementers on disjoint scopes
- 2 reviewers with different lenses
- 1 tester for unit coverage
- 1 tester for integration/perf coverage
- 1 risk-auditor
- 1 integration-arbiter if reviews disagree

---

## Two-To-Three Opinion Rule

For any change that alters:

- launch behavior
- playback startup
- decoder/runtime ownership
- warmup or caching policy
- layer activation semantics
- cue/program routing

the lead agent must not accept a single opinion.

Required pattern:

1. two independent solution opinions
2. one reviewer that did not author either solution
3. one adversarial read if the change is Tier 3 or Tier 4

If the two solution opinions converge:

- the lead may choose the shared contract and continue

If they diverge:

- do not average them
- tighten the spec
- or escalate to a third opinion or integration arbiter

If reviewer and adversarial audit both flag unresolved blockers:

- the packet does not merge

---

## Work Packet Template

Every delegated task must use a strict packet.

```md
Task ID:
Phase:
Role:
Goal:
Why this task exists:

Inputs:
- relevant files
- accepted contract or interface
- known constraints

Write scope:
- exact files allowed to change

Read scope:
- exact files or folders to inspect

Forbidden changes:
- files not to edit
- behaviors not to alter
- no scope expansion

Deliverable:
- code, tests, docs, or review memo

Evidence required:
- file references
- tests run
- risks found
- assumptions made

Done when:
- acceptance criteria for this packet only
```

Packet rules:

- one packet, one owner
- one implementer cannot own two unresolved write scopes at once
- downstream packets may start only when upstream contracts are stable

---

## Merge Harness

The lead agent merges by contract and evidence.

Accept a packet only if:

- it stayed inside write scope
- it matches the accepted contract
- claimed behavior is supported by tests or direct code evidence
- no reviewer has an unresolved blocker
- no risk auditor found an uncontained failure mode

Reject or rework a packet if:

- it changes extra files without permission
- it silently redefines the interface contract
- it duplicates another agent's concern without new evidence
- it uses vague language like "should be fine" without proof

The lead agent should perform a reconciliation pass after each wave:

1. compare each packet output against contract
2. compare all touched files for drift or overlap
3. rerun targeted tests
4. decide whether the next wave can unlock

---

## Safety Rails

### 1. Contract-First For Risky Phases

Before any high-risk code changes, define or select:

- public action names
- state shape
- deck lifecycle states
- hot/warm/cold definitions
- routing ownership

Small agents should implement contracts, not invent them.

### 2. Revert-Ready Checkpoints

Each phase must be mergeable and revertable as one unit.

Required:

- feature-flag or behavior gate where practical
- tests added or updated in the same phase
- no half-migrated ownership model merged without containment

### 3. Disjoint Writes

Parallel implementers must not share write scope.

Good split:

- one implementer owns `SlotGrid` UI behavior
- one implementer owns media store actions/types
- one implementer owns runtime/deck manager
- one implementer owns tests only

Bad split:

- two implementers both editing `layerPlaybackManager.ts`
- two implementers both redefining live launch state

### 4. Read-Only Adversarial Checks

At least one agent in risky phases should try to disprove the design.

Prompt that agent to find:

- race conditions
- stale state ownership
- decoder warmup lies
- hidden editor/live coupling
- memory or cleanup leaks

### 5. Human-Perceived Latency Gate

A green test suite is not enough for live playback work.

Every relevant phase must include a manual or observable check for:

- cold launch
- warm launch
- rapid retrigger
- repeated switching on same layer

---

## Verification Layers

Use all four layers.

### Layer A: Packet-Level Tests

- unit tests for touched store/service logic
- state transition tests
- no-regression tests for existing editor paths

### Layer B: Phase Smoke Tests

- slot launch path
- layer activation/deactivation
- editor remains unchanged while live launch occurs
- cue/program routing if phase includes it

### Layer C: Performance Checks

- first-frame latency
- warm retrigger latency
- memory growth after repeated launches
- cleanup after deactivation

### Layer D: Human-Visible Acceptance

- the launch should feel immediate on hot slots
- rapid switching should not visibly stall
- live output should not disturb cue/editor unexpectedly

---

## Escalation Rules

Escalate to stronger review when any of the following happen:

- a change touches `SlotGrid.tsx`, `compositionSlice.ts`, `playbackSlice.ts`, and `layerPlaybackManager.ts` in one pass
- reviewers disagree on state ownership or operation ordering
- a proposed fix introduces a new runtime or cache session model
- launch timing changes are claimed without measurement
- tests pass but latency feels worse
- memory usage or decoder cleanup is uncertain

Escalation options:

- add a third opinion
- add a second reviewer with a different lens
- add a risk-auditor
- split the contract into a smaller checkpoint

---

## Phase Graph

Do not start with blind parallel implementation.

Use this dependency order:

1. Phase 0: contracts and metrics
2. Phase 1: decouple live trigger from editor
3. Phase 2: warm slot decks
4. Phase 6: telemetry and runtime visibility
5. Phase 3: cue/program separation
6. Phase 4: live playback semantics
7. Phase 5: MIDI mappings

Reason:

- smaller agents need stable contracts before they can safely execute
- warm deck work is the core latency win
- telemetry should exist before larger live behavior tuning

---

## Phase 0: Contracts And Metrics

### Goal

Define contracts so implementation agents do not invent architecture ad hoc.

### Deliverables

- live trigger contract
- slot deck lifecycle contract
- hot/warm/cold definitions
- latency measurement plan

### Spawn pattern

- 2 planners produce independent contract proposals
- 1 reviewer compares both
- lead selects final contract
- 1 tester or metrics agent defines how latency will be observed

### Suggested packets

`P0-A` live trigger API contract

- likely files: docs only, plus notes tied to `SlotGrid.tsx`, `multiLayerSlice.ts`, `compositionSlice.ts`
- output: exact action names and interaction semantics

`P0-B` slot deck lifecycle contract

- likely files: docs only, plus notes tied to `layerPlaybackManager.ts`, `mediaRuntime/registry.ts`
- output: state machine for `cold`, `warming`, `warm`, `hot`, `failed`, `disposed`

`P0-C` telemetry contract

- likely files: docs only, plus notes tied to `playbackHealthMonitor.ts`, `aiTools/handlers/stats.ts`
- output: metrics and thresholds

### Gate

No implementation starts until the lead freezes these contracts.

---

## Phase 1: Decouple Live Trigger From Editor

### Goal

A slot trigger must not require an editor composition switch.

### Product change

Single click becomes a live action. Editor opening becomes an explicit secondary action.

### Likely files

- `src/components/timeline/SlotGrid.tsx`
- `src/stores/mediaStore/slices/multiLayerSlice.ts`
- `src/stores/mediaStore/slices/compositionSlice.ts`
- `src/stores/mediaStore/types.ts`

### Risk tier

Tier 3

### Spawn pattern

- 2 solution opinions on interaction and store contract
- 1 implementer for `SlotGrid.tsx`
- 1 implementer for store actions/types
- 1 reviewer-correctness
- 1 tester
- 1 risk-auditor

### Disjoint write split

Packet `P1-UI`

- owns `SlotGrid.tsx`
- changes click, double click, context affordances

Packet `P1-Store`

- owns media store types/actions
- adds explicit live trigger semantics

Packet `P1-Test`

- owns tests only
- verifies slot click no longer routes through editor switch path

### Acceptance criteria

- clicking a slot does not call the composition switch path
- active editor composition can remain unchanged while a different slot launches
- existing composition tab workflow still works explicitly

---

## Phase 2: Introduce Warm Slot Decks

### Goal

Slots should be armed before the user presses them.

### Product change

A slot owns a reusable warm playback runtime instead of being activated from cold media.

### Likely files

- `src/services/layerPlaybackManager.ts`
- `src/services/mediaRuntime/registry.ts`
- `src/services/mediaRuntime/runtimePlayback.ts`
- `src/stores/mediaStore/slices/slotSlice.ts`
- `src/components/timeline/SlotGrid.tsx`

### Risk tier

Tier 4

### Spawn pattern

- 2 planners or solution opinions on deck lifecycle
- 1 integration-arbiter if the contract is ambiguous
- 1 implementer for deck manager state and lifecycle
- 1 implementer for runtime session integration
- 1 implementer for slot/store wiring
- 1 implementer for deck indicators or UI surfacing if needed
- 1 reviewer-correctness
- 1 reviewer-performance
- 1 tester for unit and state tests
- 1 tester for latency/perf smoke
- 1 risk-auditor

### Required contracts before coding

- how a slot becomes warm
- what keeps it hot
- when it is disposed
- memory budget and eviction rules
- whether activation is a pointer swap, session handoff, or both

### Acceptance criteria

- already assigned slots can stay warm in memory
- repeated retrigger of the same slot does not recreate media elements each time
- switching between two warmed slots on the same layer feels immediate
- deck disposal is explicit and testable

---

## Phase 6: Decoder And Cache Telemetry

### Goal

The system must report whether a slot is actually ready for live use.

### Likely files

- `src/engine/featureFlags.ts`
- `src/services/proxyFrameCache.ts`
- `src/services/playbackHealthMonitor.ts`
- `src/services/aiTools/handlers/stats.ts`
- `src/services/nativeHelper/NativeDecoder.ts`

### Risk tier

Tier 3

### Spawn pattern

- 1 implementer for metrics/state
- 1 implementer for debug exposure or stats UI path
- 1 reviewer-performance
- 1 tester for repeated launch and memory growth
- 1 risk-auditor

### Acceptance criteria

- stats distinguish cold, warm, and hot launches
- decoder source per slot is visible
- heavy media sets fail gracefully instead of unpredictably stalling

---

## Phase 3: Cue / Program Separation

### Goal

Prepare the next clip without disturbing what is live.

### Likely files

- `src/stores/renderTargetStore.ts`
- `src/components/preview/Preview.tsx`
- `src/components/outputManager/SourceSelector.tsx`
- `src/engine/WebGPUEngine.ts`
- `src/stores/mediaStore/types.ts`

### Risk tier

Tier 4

### Spawn pattern

- 2 solution opinions on routing model
- 1 implementer for render target state
- 1 implementer for preview/output UI routing
- 1 implementer for engine routing hooks
- 1 reviewer-correctness
- 1 reviewer-performance
- 1 tester
- 1 risk-auditor

### Acceptance criteria

- cue preview can differ from the currently live slot
- triggering program does not overwrite cue state
- output routing stays stable across popup/output windows

---

## Phase 4: Add Live Playback Semantics

### Goal

Launching needs live-oriented behavior, not just "play from zero".

### Features in scope

- launch modes
- per-slot cue point
- follow actions
- fades
- optional quantized launch

### Likely files

- `src/stores/mediaStore/types.ts`
- `src/stores/mediaStore/slices/multiLayerSlice.ts`
- `src/components/timeline/SlotGrid.tsx`
- `src/services/layerPlaybackManager.ts`
- `src/services/audioRoutingManager.ts`

### Risk tier

Tier 3 or Tier 4 depending on quantization depth

### Spawn pattern

- 2 solution opinions if quantized launch touches timing model
- 1 implementer for state/actions
- 1 implementer for layer runtime behavior
- 1 reviewer-correctness
- 1 reviewer-performance
- 1 tester
- optional 1 risk-auditor

### Acceptance criteria

- slots can retrigger or resume according to mode
- layer fades happen without editor interaction
- launch timing can be immediate or quantized if included

---

## Phase 5: MIDI Mapping For Live Control

### Goal

Hardware control becomes a first-class live path.

### Current situation

`src/hooks/useMIDI.ts` detects devices and reports CC messages, but does not implement live mappings.

### Likely files

- `src/hooks/useMIDI.ts`
- `src/stores/settingsStore.ts`
- `src/components/common/settings/PerformanceSettings.tsx`
- new MIDI mapping UI files under `src/components`

### Risk tier

Tier 2 or Tier 3 depending on routing depth

### Spawn pattern

- 1 implementer for MIDI input and mapping model
- 1 implementer for mapping UI
- 1 reviewer-correctness
- 1 tester

### Acceptance criteria

- note and CC messages can trigger slots reliably
- mappings survive reload
- duplicate mappings are prevented or clearly shown

---

## Per-Phase Verification Checklist

Every phase should end with these checks:

1. packet-level tests pass
2. phase smoke scenarios pass
3. no reviewer blocker remains
4. risk-auditor findings are resolved or explicitly waived by the lead
5. latency did not regress for hot-slot use cases
6. checkpoint is revert-ready

---

## Validation Matrix

The full effort is not done until these scenarios pass:

- trigger an already warmed slot and see first frame immediately
- retrigger the same slot multiple times without increasing delay
- switch between two slots on the same layer rapidly
- launch four layers at once from a column trigger
- keep editor focused on one composition while performing another
- send program to output window while cue stays local
- survive long playback without drift or runaway memory
- survive mixed codecs and missing proxies with graceful fallback

---

## Recommended First Milestone

Start with:

### Hot Trigger MVP

Includes:

- Phase 0 contracts and metrics
- Phase 1 editor/live trigger separation
- Phase 2 warm slot runtime for assigned slots
- minimal telemetry from Phase 6

Excludes:

- full cue/program split
- quantized launch
- MIDI learn UI
- advanced deck semantics

This is the smallest slice that materially changes how the Slot Grid feels in practice while still fitting a safe multi-agent execution model.

---

## Final Rule For The Lead Agent

If a lower-context agent could misunderstand a task, the task is not ready to delegate.

Clarify first.
Split second.
Spawn third.
Merge last.
