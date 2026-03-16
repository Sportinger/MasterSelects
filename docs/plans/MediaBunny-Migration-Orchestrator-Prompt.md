# MediaBunny Migration - Multi-Agent Orchestrator Prompt

Copy this entire prompt into a new Claude Code session.

---

## TASK

You are the coordinator for the MediaBunny migration in the MasterSelects repository.

Your job is to:

1. Read the existing migration plan.
2. Split the work across specialized subagents.
3. Synthesize their outputs into an execution plan.
4. If asked to implement, assign non-overlapping implementation tasks to subagents.
5. After code changes, launch separate review agents to verify what happened.
6. Produce a final status report with completed work, open issues, and recommended next steps.

This is not a generic "replace FFmpeg" task. Follow the scoped plan already documented in:

- `docs/plans/MediaBunny-Migration-Plan.md`

## SCOPE

The migration scope is intentionally narrow for the first pass:

- Migrate the browser-side WebCodecs export muxing layer from `mp4-muxer` and `webm-muxer` to MediaBunny.
- Migrate low-risk `mp4box` helper usage where parity is clear.
- Keep `src/engine/ffmpeg/FFmpegBridge.ts` out of scope unless a small compile fix is required.
- Keep the native helper out of scope.
- Do not remove professional codec export support.

## SUCCESS CRITERIA

Treat the work as successful only if the final result preserves current browser-export behavior while improving maintainability.

Required outcomes:

- The main WebCodecs export path no longer depends on `mp4-muxer` or `webm-muxer`.
- MediaBunny integration is contained behind a small adapter or well-bounded export layer.
- Low-risk `mp4box` helper migrations are either implemented or explicitly deferred with reasons.
- FFmpeg WASM and native-helper behavior are not regressed.
- Review agents independently inspect the resulting changes and identify bugs, regressions, and test gaps.

---

## PHASE 0 - ENVIRONMENT CHECK

Before spawning subagents, verify the local Claude CLI:

```powershell
Get-Command claude -ErrorAction SilentlyContinue
claude --help
```

If `claude` is missing, stop and report that the CLI is not available.

Optional helper script for parallel runs:

`C:\Users\admin\.agents\skills\claude-code-agents\scripts\run_claude_agents.ps1`

---

## PHASE 1 - READ CONTEXT FIRST

Read these files yourself before launching subagents:

- `docs/plans/MediaBunny-Migration-Plan.md`
- `package.json`
- `src/engine/export/VideoEncoderWrapper.ts`
- `src/engine/export/FrameExporter.ts`
- `src/engine/audio/AudioEncoder.ts`
- `src/services/audioExtractor.ts`
- `src/stores/mediaStore/helpers/mediaInfoHelpers.ts`
- `src/stores/timeline/helpers/mp4MetadataHelper.ts`
- `src/stores/timeline/helpers/audioDetection.ts`
- `src/engine/ffmpeg/FFmpegBridge.ts`

Then summarize the architecture in 8 to 15 bullets before assigning work.

Do not start implementation before you understand:

- where `mp4-muxer` and `webm-muxer` are used,
- where `mp4box` is used,
- which parts of the system are out of scope,
- where export ordering may create buffering or memory pressure.

---

## PHASE 2 - PLANNING AGENTS

Launch 4 planning agents in parallel.

Use separate prompts with distinct roles.
Use `claude -p --output-format json --no-session-persistence`.
If helpful, use separate worktrees, but planning agents do not need to edit files.

### Agent 1 - Export Architecture

Focus:

- Current WebCodecs export path
- `VideoEncoderWrapper`
- adapter boundaries for MediaBunny
- required API changes

Prompt:

```text
You are planning the MediaBunny migration for MasterSelects. Focus only on the browser export path.

Read:
- docs/plans/MediaBunny-Migration-Plan.md
- package.json
- src/engine/export/FrameExporter.ts
- src/engine/export/VideoEncoderWrapper.ts
- src/engine/audio/AudioEncoder.ts

Task:
1. Explain the current export pipeline in detail.
2. Identify the smallest safe integration seam for MediaBunny.
3. Propose the exact file-level implementation plan for replacing mp4-muxer and webm-muxer.
4. Call out any multi-track buffering or ordering risks caused by the current "video first, audio later" pipeline.
5. List the tests needed to prove parity.

Output:
- short architecture summary
- concrete implementation steps
- touched files
- risks
- test plan
```

### Agent 2 - Metadata And Parsing

Focus:

- low-risk `mp4box` helper migrations
- metadata parity
- audio-track inspection

Prompt:

```text
You are planning the MediaBunny migration for MasterSelects. Focus only on mp4box replacement opportunities in low-risk helper code.

Read:
- docs/plans/MediaBunny-Migration-Plan.md
- package.json
- src/services/audioExtractor.ts
- src/stores/mediaStore/helpers/mediaInfoHelpers.ts
- src/stores/timeline/helpers/mp4MetadataHelper.ts
- src/stores/timeline/helpers/audioDetection.ts

Task:
1. Inventory the current mp4box responsibilities in these files.
2. Separate low-risk migrations from high-risk sample-level or playback-sensitive migrations.
3. Propose a phased implementation plan for helper-level migration.
4. Identify any metadata, codec-labeling, duration, fps, or audio-track parity risks.
5. Recommend what should stay deferred for now.

Output:
- current mp4box usage map
- low-risk migration candidates
- deferred items with reasons
- implementation order
- validation checklist
```

### Agent 3 - Risk, Performance, And Testing

Focus:

- memory behavior
- streaming targets
- browser compatibility
- regression coverage

Prompt:

```text
You are planning the MediaBunny migration for MasterSelects. Focus on risk, performance, and verification.

Read:
- docs/plans/MediaBunny-Migration-Plan.md
- src/engine/export/FrameExporter.ts
- src/engine/export/VideoEncoderWrapper.ts
- src/engine/audio/AudioEncoder.ts
- src/engine/ffmpeg/FFmpegBridge.ts

Task:
1. Analyze where export memory pressure exists today.
2. Explain which risks MediaBunny reduces and which risks remain unchanged.
3. Define a practical verification matrix for export correctness, audio, metadata, and browser behavior.
4. Call out the biggest hidden regression risks.
5. Recommend whether the first implementation should stay in-memory or attempt streaming/interleaving immediately.

Output:
- risk register
- recommended rollout strategy
- regression matrix
- stress tests
- go/no-go decision points
```

### Agent 4 - Rollout And PR Strategy

Focus:

- execution sequencing
- branch and worktree isolation
- dependency cleanup
- review workflow

Prompt:

```text
You are planning the MediaBunny migration for MasterSelects. Focus on execution logistics and rollout.

Read:
- docs/plans/MediaBunny-Migration-Plan.md
- package.json
- docs/plans/playback-pipeline-analysis-prompt.md

Task:
1. Break the migration into the smallest safe PRs.
2. Propose which tasks can run in parallel without file conflicts.
3. Propose which tasks must stay serialized.
4. Define a review phase with independent review agents after implementation.
5. Recommend how to document deferred work and follow-ups.

Output:
- PR sequence
- parallelization map
- file ownership per task
- review workflow
- final rollout recommendation
```

---

## PHASE 3 - SYNTHESIZE THE PLANNING OUTPUTS

After all 4 planning agents finish:

1. Merge their findings into one implementation plan.
2. Resolve contradictions explicitly.
3. Separate:
   - approved for immediate implementation
   - deferred
   - blocked
4. Create a file ownership map so implementation agents do not edit the same files in parallel.

Your synthesis must include:

- exact workstreams
- exact files per workstream
- conflicts to avoid
- tests required per workstream
- review checkpoints

If two planning agents disagree, state the disagreement and make a decision.

---

## PHASE 4 - IMPLEMENTATION AGENTS

When implementation is approved, launch 3 implementation agents.

Use dedicated worktrees if available so each agent can edit independently without stomping on each other.

Suggested worktree names:

- `mediabunny-export`
- `mediabunny-metadata`
- `mediabunny-tests-docs`

Do not assign overlapping files to multiple implementation agents at the same time.

### Implementation Agent A - Export Muxing Migration

Owns:

- `package.json`
- `src/engine/export/VideoEncoderWrapper.ts`
- new adapter files under `src/engine/export/`
- minimal supporting changes in `src/engine/export/FrameExporter.ts` if needed

Prompt:

```text
Implement the MediaBunny migration for the WebCodecs export path in MasterSelects.

Scope:
- Replace mp4-muxer and webm-muxer usage in the browser export path.
- Keep public export behavior stable.
- Keep FFmpeg WASM untouched.
- Keep changes localized behind a small adapter or bounded export layer.

Read first:
- docs/plans/MediaBunny-Migration-Plan.md
- package.json
- src/engine/export/FrameExporter.ts
- src/engine/export/VideoEncoderWrapper.ts
- src/engine/audio/AudioEncoder.ts

Deliver:
1. Code changes.
2. Any required dependency updates.
3. Short summary of what changed.
4. Tests or verification commands run.
5. Open issues or limitations.

Do not edit metadata helper files unless absolutely required for compile correctness.
```

### Implementation Agent B - Low-Risk mp4box Helper Migration

Owns:

- `src/services/audioExtractor.ts`
- `src/stores/mediaStore/helpers/mediaInfoHelpers.ts`
- `src/stores/timeline/helpers/mp4MetadataHelper.ts`
- `src/stores/timeline/helpers/audioDetection.ts`

Prompt:

```text
Implement the low-risk helper-side MediaBunny migration for MasterSelects.

Scope:
- Migrate helper-level mp4box usage where parity is clear.
- Preserve current metadata and audio-track detection behavior.
- Do not touch playback-critical or sample-level decoding code.
- Do not touch FFmpegBridge or native-helper code.

Read first:
- docs/plans/MediaBunny-Migration-Plan.md
- src/services/audioExtractor.ts
- src/stores/mediaStore/helpers/mediaInfoHelpers.ts
- src/stores/timeline/helpers/mp4MetadataHelper.ts
- src/stores/timeline/helpers/audioDetection.ts

Deliver:
1. Code changes.
2. Summary of migrated vs deferred sites.
3. Tests or verification commands run.
4. Any parity gaps still open.

If a site is too risky, leave it unchanged and document why.
```

### Implementation Agent C - Tests, Docs, And Cleanup

Owns:

- test updates related to the migration
- docs updates related to the migration
- dependency cleanup after implementation is stable

Prompt:

```text
Support the MediaBunny migration in MasterSelects with tests, docs, and safe cleanup.

Scope:
- Add or update tests that cover the migration.
- Update docs if the implementation changes the described media stack.
- Remove deprecated dependencies only if they are no longer used.
- Do not make architectural changes outside the migration scope.

Read first:
- docs/plans/MediaBunny-Migration-Plan.md
- package.json
- README.md
- any files changed by the implementation agents

Deliver:
1. Test changes.
2. Documentation changes.
3. Dependency cleanup if safe.
4. Verification summary.
5. Any unresolved gaps for follow-up.
```

---

## PHASE 5 - MERGE AND VERIFY

After implementation agents finish:

1. Review each agent's changed files and summaries.
2. Merge or reapply the non-conflicting work carefully.
3. Run verification commands yourself.
4. Document what actually changed, not what was planned.

Minimum verification:

```powershell
npm test
npm run test:unit
npm run build
```

If the repo has no targeted automated coverage for the changed area, say so explicitly and note the manual verification still needed.

Your merge summary must include:

- files changed
- commands run
- failures encountered
- fixes applied
- remaining known risks

---

## PHASE 6 - REVIEW AGENTS

After the code is merged locally, launch 2 fresh review agents that did not implement the changes.

Their job is to review the actual diff and resulting code, not to restate the original plan.

### Review Agent 1 - Strict Code Review

Prompt:

```text
Review the completed MediaBunny migration changes in MasterSelects.

Focus on:
- bugs
- behavioral regressions
- missing tests
- broken assumptions
- accidental scope expansion

Read:
- docs/plans/MediaBunny-Migration-Plan.md
- the changed files in the working tree

Output:
- findings ordered by severity
- file references
- concrete regressions or risks
- missing tests
- brief change summary only after findings

If there are no findings, state that explicitly and mention residual risks.
```

### Review Agent 2 - Architecture And Scope Review

Prompt:

```text
Review the completed MediaBunny migration changes in MasterSelects from an architecture and migration-scope perspective.

Focus on:
- whether the implementation matches the scoped plan
- whether FFmpeg and native-helper boundaries stayed intact
- whether the adapter boundary is clean
- whether any mp4box removals were too risky or too broad
- whether memory and buffering risks were handled or at least documented

Read:
- docs/plans/MediaBunny-Migration-Plan.md
- the changed files in the working tree

Output:
- scope adherence review
- architecture concerns
- deferred work still needed
- recommendation: accept / accept with follow-ups / rework
```

---

## PHASE 7 - FINAL REPORT

When all work and reviews are complete, produce a final report with these sections:

### 1. Completed Work

- What was actually implemented
- Which files changed
- Which dependencies were added or removed

### 2. Review Findings

- Findings from Review Agent 1
- Findings from Review Agent 2
- Which findings were fixed immediately
- Which findings remain open

### 3. Verification

- Commands run
- Pass/fail status
- Manual checks still required

### 4. Deferred Work

- Any `mp4box` sites left in place
- Any streaming/interleaving follow-up needed
- Any browser-compatibility or memory caveats

### 5. Recommendation

Choose one:

- ready for merge
- ready for merge with follow-ups
- not ready for merge

Be explicit and decisive.

---

## ORCHESTRATION RULES

- Keep planning agents read-only.
- Keep implementation agents on non-overlapping files.
- Use review agents that did not author the code they review.
- If a subagent fails, report it clearly and continue with the remaining agents.
- If two implementations conflict, reconcile them yourself before review.
- Never let a review agent silently modify code. Review comes after implementation.
- Prefer 3 implementation agents and 2 review agents. Do not scale up unless there is a concrete need.

---

## OPTIONAL: SCRIPT-BASED PARALLEL RUNS

If you prefer a repeatable batch run for planning or review agents, you may use:

```powershell
powershell -ExecutionPolicy Bypass -File C:\Users\admin\.agents\skills\claude-code-agents\scripts\run_claude_agents.ps1 -ConfigPath <CONFIG_JSON_PATH> -WorkDir C:\Users\admin\Documents\masterselects
```

Example planning config shape:

```json
[
  {
    "name": "export-architecture",
    "prompt": "PLAN_PROMPT_FOR_AGENT_1"
  },
  {
    "name": "metadata-parsing",
    "prompt": "PLAN_PROMPT_FOR_AGENT_2"
  },
  {
    "name": "risk-testing",
    "prompt": "PLAN_PROMPT_FOR_AGENT_3"
  },
  {
    "name": "rollout-strategy",
    "prompt": "PLAN_PROMPT_FOR_AGENT_4"
  }
]
```

---

## START NOW

Follow the phases in order:

1. Environment check
2. Read context
3. Launch planning agents
4. Synthesize plan
5. Launch implementation agents if approved
6. Merge and verify
7. Launch review agents
8. Produce final report

Do not skip the review phase.
