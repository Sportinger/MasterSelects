# Security Hardening - Multi-Agent Orchestrator Prompt

Copy this entire prompt into a new Claude Code session.

---

## TASK

You are the coordinator for the security hardening project in the MasterSelects repository.

Your job is to:

1. Read the existing security plan and current implementation.
2. Split the work across specialized subagents.
3. Synthesize their findings into a concrete execution plan.
4. If implementation is approved, assign non-overlapping implementation tasks.
5. After code changes, launch independent review agents.
6. Produce a final report with completed work, open risks, and next steps.

This is not a generic "improve security" task. Use the repo-specific plan already documented in:

- `docs/plans/Security-Hardening-Plan.md`

## PRIMARY GOALS

- Harden the browser dev bridge and native-helper bridge.
- Introduce explicit AI tool policy and approval boundaries.
- Restrict local file access to explicit roots.
- Reduce secret leakage through logs, prompts, and debug tooling.
- Add automated security checks in CI.

## HARD REQUIREMENTS

- Do not weaken editing workflows unnecessarily.
- Do not silently expand local file privileges.
- Do not allow external bridge paths to bypass approval or policy checks.
- Keep implementation tasks on non-overlapping files.
- Treat security claims as incomplete unless backed by tests.

---

## PHASE 0 - ENVIRONMENT CHECK

Before spawning subagents, verify the local Claude CLI:

```powershell
Get-Command claude -ErrorAction SilentlyContinue
claude --help
```

If `claude` is missing, stop and report that the CLI is unavailable.

Optional helper script for parallel runs:

`C:\Users\admin\.agents\skills\claude-code-agents\scripts\run_claude_agents.ps1`

---

## PHASE 1 - READ CONTEXT FIRST

Read these files yourself before launching subagents:

- `docs/plans/Security-Hardening-Plan.md`
- `vite.config.ts`
- `src/main.tsx`
- `src/services/aiTools/bridge.ts`
- `src/services/aiTools/index.ts`
- `src/services/aiTools/types.ts`
- `src/services/aiTools/handlers/index.ts`
- `src/services/aiTools/handlers/media.ts`
- `src/services/aiTools/handlers/stats.ts`
- `src/components/panels/AIChatPanel.tsx`
- `src/services/logger.ts`
- `src/services/apiKeyManager.ts`
- `src/services/nativeHelper/NativeHelperClient.ts`
- `tools/native-helper/src/main.rs`
- `tools/native-helper/src/server.rs`
- `tools/native-helper/src/session.rs`
- `tools/native-helper/src/utils.rs`
- `docs/Features/AI-Integration.md`
- `tools/native-helper/README.md`

Then summarize the current trust boundaries in 8 to 15 bullets before assigning work.

You must understand:

- which routes can trigger AI tool execution
- which routes can read or write local files
- where secrets can leak into logs or prompts
- whether helper auth is actually enforced
- which tools are sensitive and why

Do not start implementation before you can explain the current security model precisely.

---

## PHASE 2 - PLANNING AGENTS

Launch 4 planning agents in parallel.

Use separate prompts with distinct roles.
Use `claude -p --output-format json --no-session-persistence`.
Planning agents should be read-only.

### Agent 1 - Browser Bridge And AI Tool Policy

Focus:

- Vite dev bridge
- browser tool exposure
- AI tool policy layer
- approval model

Prompt:

```text
You are planning the browser-side security hardening for MasterSelects.

Read:
- docs/plans/Security-Hardening-Plan.md
- vite.config.ts
- src/main.tsx
- src/services/aiTools/bridge.ts
- src/services/aiTools/index.ts
- src/services/aiTools/types.ts
- src/services/aiTools/handlers/index.ts
- src/components/panels/AIChatPanel.tsx

Task:
1. Map the browser-side AI execution and bridge flow in detail.
2. Identify the smallest safe implementation seam for a central tool policy layer.
3. Propose the exact file-level plan for token-gating and origin-checking the dev bridge.
4. Define which tools should be read-only, sensitive, or confirmation-required.
5. Recommend the approval UX and bridge behavior for mutating tools.

Output:
- attack surface summary
- concrete implementation steps
- exact touched files
- risks
- test plan
```

### Agent 2 - Native Helper Auth And File Boundaries

Focus:

- helper auth
- helper AI bridge
- HTTP/WS protection
- file allowlists

Prompt:

```text
You are planning the native-helper security hardening for MasterSelects.

Read:
- docs/plans/Security-Hardening-Plan.md
- src/services/nativeHelper/NativeHelperClient.ts
- tools/native-helper/src/main.rs
- tools/native-helper/src/server.rs
- tools/native-helper/src/session.rs
- tools/native-helper/src/utils.rs
- tools/native-helper/README.md

Task:
1. Explain the current helper auth and bridging model.
2. Identify where auth exists conceptually but is not actually enforced.
3. Propose the exact implementation plan for mandatory helper auth on WebSocket and HTTP routes.
4. Recommend a narrower file allowlist strategy than the current prefix model.
5. Define the tests needed to prove helper AI and file routes fail closed.

Output:
- current auth model
- concrete implementation steps
- exact touched files
- risks
- Rust and frontend test plan
```

### Agent 3 - Secrets, Logs, And Data Exfiltration

Focus:

- API key handling
- log exposure
- prompt/log redaction
- AI-visible debug tools

Prompt:

```text
You are planning secret-handling and data-exfiltration hardening for MasterSelects.

Read:
- docs/plans/Security-Hardening-Plan.md
- src/services/apiKeyManager.ts
- src/services/logger.ts
- src/services/aiTools/handlers/stats.ts
- src/services/claudeService.ts
- src/components/panels/AIChatPanel.tsx
- docs/Features/AI-Integration.md

Task:
1. Identify how API keys are stored, exported, and exposed to runtime code.
2. Identify how secrets or sensitive context could leak into logs, tool results, or prompts.
3. Propose a concrete redaction strategy and file-level implementation plan.
4. Recommend what to do with `.keys.enc` export.
5. Define tests and documentation changes required.

Output:
- leak surface inventory
- concrete implementation steps
- exact touched files
- risks
- test and docs plan
```

### Agent 4 - CI, Rollout, And Review Strategy

Focus:

- PR sequencing
- verification
- CI checks
- review workflow

Prompt:

```text
You are planning rollout and verification for the MasterSelects security hardening project.

Read:
- docs/plans/Security-Hardening-Plan.md
- package.json
- .github/workflows
- docs/plans/MediaBunny-Migration-Orchestrator-Prompt.md

Task:
1. Break the security work into the smallest safe PRs.
2. Propose which tasks can run in parallel without file conflicts.
3. Define the minimum CI security workflow for this repo.
4. Define the review-agent workflow after implementation.
5. Call out the highest-risk merge-order mistakes.

Output:
- PR sequence
- parallelization map
- file ownership map
- CI plan
- review workflow
```

---

## PHASE 3 - SYNTHESIZE PLANNING OUTPUTS

After all planning agents finish:

1. Merge their findings into one execution plan.
2. Resolve contradictions explicitly.
3. Separate:
   - immediate blockers
   - approved for implementation
   - deferred
   - blocked
4. Produce a file ownership map so implementation agents do not edit the same files in parallel.

Your synthesis must include:

- exact workstreams
- exact files per workstream
- tests required per workstream
- security invariants that must hold after each PR
- review checkpoints

If two planning agents disagree, state the disagreement and make a decision.

---

## PHASE 4 - IMPLEMENTATION AGENTS

When implementation is approved, launch 3 implementation agents.

Use dedicated worktrees if available so they can edit independently.

Suggested worktree names:

- `security-browser`
- `security-helper`
- `security-docs-ci`

Do not assign overlapping files to multiple implementation agents at the same time.

### Implementation Agent A - Browser Bridges, Tool Policy, Approval

Owns:

- `vite.config.ts`
- `src/main.tsx`
- `src/services/aiTools/bridge.ts`
- `src/services/aiTools/index.ts`
- `src/services/aiTools/types.ts`
- `src/services/aiTools/definitions/*.ts`
- `src/services/aiTools/handlers/index.ts`
- `src/components/panels/AIChatPanel.tsx`
- browser-side tests under `tests/security/` and `tests/unit/`

Prompt:

```text
Implement the browser-side security hardening for MasterSelects.

Scope:
- Add a central AI tool policy layer.
- Harden the Vite dev bridge with strict origin checks and per-session auth.
- Add approval gating for risky AI tool actions.
- Ensure external bridge calls cannot bypass tool policy.

Read first:
- docs/plans/Security-Hardening-Plan.md
- vite.config.ts
- src/main.tsx
- src/services/aiTools/bridge.ts
- src/services/aiTools/index.ts
- src/services/aiTools/types.ts
- src/services/aiTools/handlers/index.ts
- src/components/panels/AIChatPanel.tsx

Deliver:
1. Code changes.
2. Tests added or updated.
3. Short summary of what changed.
4. Verification commands run.
5. Open issues or limitations.

Do not edit native-helper files.
```

### Implementation Agent B - Native Helper Auth And File Restrictions

Owns:

- `tools/native-helper/src/main.rs`
- `tools/native-helper/src/server.rs`
- `tools/native-helper/src/session.rs`
- `tools/native-helper/src/utils.rs`
- `src/services/nativeHelper/NativeHelperClient.ts`
- helper tests

Prompt:

```text
Implement the native-helper security hardening for MasterSelects.

Scope:
- Make helper auth real and mandatory by default.
- Protect HTTP and WebSocket surfaces with auth.
- Tighten file access boundaries to explicit roots.
- Preserve supported project and download workflows.

Read first:
- docs/plans/Security-Hardening-Plan.md
- src/services/nativeHelper/NativeHelperClient.ts
- tools/native-helper/src/main.rs
- tools/native-helper/src/server.rs
- tools/native-helper/src/session.rs
- tools/native-helper/src/utils.rs

Deliver:
1. Code changes.
2. Rust and frontend tests.
3. Short summary of what changed.
4. Verification commands run.
5. Open issues or limitations.

Do not edit browser AI-chat UI files.
```

### Implementation Agent C - Secrets, Logs, Docs, And CI

Owns:

- `src/services/logger.ts`
- `src/services/apiKeyManager.ts`
- `src/services/aiTools/handlers/stats.ts`
- `.github/workflows/*`
- `docs/Features/AI-Integration.md`
- `tools/native-helper/README.md`
- related tests

Prompt:

```text
Implement the secret-handling, logging, documentation, and CI parts of the security hardening plan for MasterSelects.

Scope:
- Redact secrets from logs and AI-visible debug outputs.
- Improve or disable insecure key export behavior.
- Add CI security checks.
- Update docs to describe the real trust model and new safeguards.

Read first:
- docs/plans/Security-Hardening-Plan.md
- src/services/logger.ts
- src/services/apiKeyManager.ts
- src/services/aiTools/handlers/stats.ts
- docs/Features/AI-Integration.md
- tools/native-helper/README.md
- package.json
- .github/workflows

Deliver:
1. Code and docs changes.
2. Tests added or updated.
3. CI workflow changes.
4. Verification commands run.
5. Open issues or limitations.

Do not edit native-helper core server logic unless needed for compile compatibility.
```

---

## PHASE 5 - MERGE AND VERIFY

After implementation agents finish:

1. Review each agent's changed files and summaries.
2. Merge or reapply non-conflicting work carefully.
3. Run verification commands yourself.
4. Document what actually changed.

Minimum verification:

```powershell
npm run test
npm run build
```

If helper files changed, also run the relevant Rust verification commands.

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

### Review Agent 1 - Strict Security Review

Prompt:

```text
Review the completed security hardening changes in MasterSelects.

Focus on:
- security regressions
- missing auth checks
- unsafe defaults
- policy bypasses
- missing tests

Read:
- docs/plans/Security-Hardening-Plan.md
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
Review the completed security hardening changes in MasterSelects from an architecture and scope perspective.

Focus on:
- whether the implementation matches the documented plan
- whether bridges now fail closed
- whether local file boundaries are actually narrower
- whether helper auth is truly enforced end-to-end
- whether the approval model is coherent

Read:
- docs/plans/Security-Hardening-Plan.md
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

- what was actually implemented
- which files changed
- which checks were added

### 2. Review Findings

- findings from Review Agent 1
- findings from Review Agent 2
- which findings were fixed immediately
- which findings remain open

### 3. Verification

- commands run
- pass/fail status
- manual checks still required

### 4. Deferred Work

- any hardening intentionally postponed
- any browser-side secret-storage limitations still present
- any user-experience tradeoffs still open

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
- Never let a review agent silently modify code.
- Prefer 4 planning agents, 3 implementation agents, and 2 review agents.

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
    "name": "browser-policy",
    "prompt": "PLAN_PROMPT_FOR_AGENT_1"
  },
  {
    "name": "helper-auth",
    "prompt": "PLAN_PROMPT_FOR_AGENT_2"
  },
  {
    "name": "secrets-redaction",
    "prompt": "PLAN_PROMPT_FOR_AGENT_3"
  },
  {
    "name": "rollout-ci",
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
4. Synthesize the plan
5. Launch implementation agents if approved
6. Merge and verify
7. Launch review agents
8. Produce the final report

Do not skip the review phase.
