# MasterSelects Agent Instructions

Instructions for every coding agent working on MasterSelects — Claude Code,
Codex workers, and anyone else. `CLAUDE.md` imports this file: edit here, and
never let the two diverge in substance.

**What this is:** MasterSelects is a professional video editor running
entirely in the browser — multitrack timeline, WebGPU compositing and
effects, keyframes/masks, audio workstation, 3D and Gaussian splats,
WebCodecs export — plus an in-app AI agent (FlashBoard chat) that edits the
timeline through deterministic tools. Stack: React + TypeScript + Zustand +
WebGPU; Cloudflare Pages/D1 backend; private AI kernel in the sibling repo
`../masterselects-kernel`. The editor is licensed under AGPL-3.0-only; see
`LICENSING.md` for scope and component exceptions. Development happens directly
in the public repository `Sportinger/MasterSelects`; the former
`Sportinger/MasterSelects-Private` repository is retired (decision 2026-10-03, user)
and is never a commit or push target. Kernel-internal code and secrets must stay
out of this editor repository (see section 7).

Feature docs: one page per feature under `docs/Features/`, index at
[`docs/Features/README.md`](docs/Features/README.md). Product overview:
[`README.md`](README.md). Maintainer plans in `docs/ongoing/` stay private.

---

## 1. Shared-workspace ground rules

Several agents (typically 3) plus the user work in this repository at the same
time. The main folder (`C:\Users\admin\Documents\MasterSelects-Public`) is
shared; every agent task gets its own branch and worktree (branch model below).

### Branch model (decision 2026-10-04, user)

| Branch | Where | Purpose |
|---|---|---|
| `master` | GitHub | Integration and release branch. Production is uploaded manually from it; the Fassandra auto-repair loop pushes its tested fixes to it as fast-forward commits. |
| `local` | main folder only, never pushed | The owner's working branch, checked out in the main folder. |
| `task/<short-name>` | own worktree | One branch per agent task (Claude Code, Codex workers, any other agent). |

- **Start every task** on a new `task/<short-name>` branch from the current
  `local`, in its own worktree next to the main folder:
  `git worktree add -b task/<short-name> ../MasterSelects-tasks/<short-name> local`.
  Install dependencies there with a real `npm ci`; never link or junction
  `node_modules` from the main folder (a forced worktree removal once deleted
  the real packages through such a link).
- **Work and commit only in your worktree.** In the main folder never switch,
  create, rename, rebase, reset, or delete branches, and never commit there
  unless the owner explicitly asks for a change directly on `local`.
- **Live checks from a task worktree:** run only Vite there on a free port
  (`npx vite --port 5174 --strictPort`). It proxies to the shared kernel and
  local API of the main folder's `dev:full` (8787/8788); never start a second
  `dev:full`. The new origin needs its own login and test project, and the
  optional bridge MCP tools target the main folder's editor, so test the task
  worktree in the browser.
- **Finish** with all commits on your task branch and report the branch name.
  The owner merges task branches into `local` and `local` into `master`;
  agents merge, push, or delete branches only on explicit request. Remove a
  worktree only after the owner confirms its branch is merged, with a plain
  `git worktree remove <path>` (never `--force` without inspecting it first).
- **Fixes from Fassandra arrive on `master`.** Keep `local` current by merging
  `origin/master` into it (owner, or an agent on request) and start new task
  branches from the updated `local`.
- **The Fassandra auto-repair agent** (Codex on Fassandra) never sees `local`
  or task branches: it works in a fresh remote checkout of `origin/master` on
  the AWS test hosts, does not commit itself, and its controller pushes only
  reviewed and tested fast-forward commits to `master`. For it, the rest of
  this section describes how the owner's side works; its own limits are in the
  Fassandra repair prompt and `aws-test-maintenance` skill.

### Working rules

- Treat every change you did not make as someone else's active work. Never
  revert, overwrite, clean up, or reformat it.
- The user routes tasks between agents; there is no agent-to-agent claim or
  coordination protocol — just never touch work that isn't yours.
- Stage only the files you yourself changed: `git add <explicit paths>`.
  Never `git add -A`, `git add .`, or `git commit -a`.
- The target repository is always the public `Sportinger/MasterSelects`. The
  private repository is retired: never commit to, push to, or restore a
  `MasterSelects-Private` remote. Before every commit verify that `origin`
  resolves to `Sportinger/MasterSelects` for fetch and push; if it does not,
  stop and report the mismatch instead of changing remotes.
- Never push, merge, or switch branches manually without an explicit user
  request (task branches in your own worktree are the exception, see above).
  Because every pushed commit is public, never commit credentials, secrets,
  `.dev.vars` values, or kernel implementation.
- Agents may start or restart the shared dev environment (`npm run dev:full`)
  when the task requires it. Resolve the exact MasterSelects process tree and
  never stop unrelated Node processes; after every restart, wait for all four
  services; if using the optional bridge, re-read its rotated token.
- Never close a browser window or tab yourself, including windows or tabs the
  agent opened for setup, authentication, verification, or testing. Leave them
  open for the user unless the user explicitly asks you to close the specific
  window or tab.
- Never run the full vitest suite (`npm run test`): it rotates
  `.ai-bridge-token` and cuts every other agent off the bridge mid-run.
  Targeted vitest runs with explicitly named relevant files are fine.
- Large command outputs are expensive: report short summaries and the
  relevant error lines, not full logs.

## 2. Task workflow

Default to autonomous completion. A request to implement or fix something
also authorizes the necessary local investigation, edits, verification, docs,
and local commit under section 1. Do not stop for a plan approval, routine
implementation choices, or mandatory user testing.

1. **Inspect and implement.** Read the relevant code and preserve others' work.
   Choose a reasonable implementation and continue. Ask only when missing
   information materially changes the result and cannot be established from
   the workspace, or an action exceeds the user's authorization.
2. **Verify it yourself, after implementation is complete.** Finish the agreed
   implementation first, then run the relevant tests and live checks together
   in a final verification phase. Do not interrupt each implementation step
   with tests, browser checks, type checks, or builds. Reading code and inspecting
   diffs during implementation is fine. After fixing a final-check failure,
   repeat only the checks affected by that fix.
   Run the cheapest checks that actually cover the
   change. For behavior changes, use targeted tests and the running editor
   where useful. Use normal browser automation and the visible editor UI by
   default; the AI bridge is optional, not a prerequisite for testing. Reuse
   one existing test tab and run scenarios sequentially;
   open another only when isolation is technically necessary, explaining why
   before opening it. The running local editor at `https://localhost:5173/editor`
   (main folder) and the editor a task worktree serves on its own Vite port
   (section 1) are explicitly authorized by the user as test projects. Test
   product behavior directly there: agents may create, modify, and remove test clips, effects,
   graphs, keyframes, and other project data as needed, without asking again.
   Prefer this editor for live interaction checks; isolated probes may supplement
   it for exact GPU/pixel measurements. This authorization applies to the local
   test project, not other projects, original media files, or production data.
   Inspect results and fix failures without handing routine QA back to the user.
3. **Match verification to risk.**
   - Documentation/instruction-only edits: inspect the diff and links; no
     TypeScript check, browser session, or full build unless relevant.
   - Small visual/copy changes: inspect the affected UI when feasible; do not
     invent implementation-mirroring tests.
   - Runtime, data, or behavioral changes: targeted regression tests and relevant
     live checks. Run `npm run build` once on the final code before committing.
     A previous passing build still counts if no build-relevant files changed.
   - Do not repeat passing checks unless later edits or new evidence invalidate
     them. No full vitest suite; a small explicitly named set of relevant files
     is allowed. Avoid full builds during intermediate edits.
4. **Kernel- or chat-affecting changes** additionally require the agent's own
   live end-to-end chat run and audit review (section 5). The user does not need
   to watch or approve the test run.
5. **Finish without another approval round.** Update the matching feature docs
   and `README.md` when product behavior changes. Once the relevant checks pass,
   commit on your task branch using an English, one-line conventional message
   and explicit file paths. User confirmation is not a prerequisite. Report the
   branch, what changed, the verification result, and any material limitation
   briefly.

If a required check is blocked, continue independent work first, then report
the exact blocker and the smallest user action needed. Do not claim untested
behavior works or commit a known broken intermediate state. If the build fails
only in another agent's files, fix a trivial missing import or typo and report
it; otherwise hold the affected commit and report the foreign failure.

Production deployment, releases, version bumps, changelog entries, and external
messages still require an explicit request. The repository guards in section 1
remain in effect (public `Sportinger/MasterSelects` only). If the user reports a
regression, fix forward and verify it yourself.

---

## 3. Dev environment

`npm run dev:full` (login/credits only work in this mode, not plain `dev`):

| Process | Where |
|---|---|
| Vite dev server + AI bridge | `http://localhost:5173` |
| Dev kernel (private sibling repo) | `http://127.0.0.1:8787` |
| Local API (wrangler pages dev + local D1) | `http://127.0.0.1:8788` |
| Logic Codex app-server | `ws://127.0.0.1:4500` |

- Starting dev:full **rotates `.ai-bridge-token`** — when using the optional
  bridge, read the token fresh from the file.
- `npm run dev:lan` serves the same stack over HTTPS on the LAN so a real
  iPad/phone can be tested and driven through the bridge. Requires a TLS pair
  in `.certs/` with **≤398 days** validity (Apple rejects longer ones with a
  fatal TLS error). Full setup: `docs/Features/LAN-Device-Testing.md`.
- Vite, kernel, and wrangler logs are interleaved in the dev:full console.

## 4. Browser testing and optional AI bridge

Use the normal browser to operate and verify the running editor. Prefer its
visible controls for timeline editing, effects, playback/seek, camera navigation,
reload, and export. Browser automation is explicitly supported; a bridge
connection or bridge-specific skill is not required. Reuse the existing test
tab and inspect the rendered result. If the user requests browser-only testing,
do not use the bridge for that task.

The AI bridge below is an optional diagnostic/automation transport when useful
and consistent with the user's instructions. Its absence is not a blocker when
the same check can be completed in the browser.

The dev server exposes the live editor to agents. Two transports, same
Bearer token from `.ai-bridge-token` in the repo root:

- **MCP (Claude Code):** the `mcp__masterselects__bridge_*` tools —
  `bridge_list_tools` / `bridge_get_tool_schema` / `bridge_call_tool` for
  editor tools, `bridge_list_sessions` / `bridge_select_session` for tab
  targeting, `bridge_send_chat_message` / `bridge_new_chat` /
  `bridge_set_chat_model_class` for the in-app chat,
  `bridge_get_history` / `bridge_get_tool_result` / `bridge_replay_tool_call`
  for auditing.
- **HTTP (any agent):** `POST http://localhost:5173/api/ai-tools` with
  `{ "tool": "...", "args": { ... } }` for single editor tool calls, and
  `http://localhost:5173/api/agent-control/*` (`sessions`, `tools`, `call`,
  `chat`, `chat/new`, `chat/model-class`, `history`, `calls/<id>`, `replay`)
  — the same surface the MCP tools wrap.

Gotchas (learned the hard way):

- Responses are shaped `{ success, data }` — do not read `result`.
- The dev server records its origin in `.ai-bridge-url`; the MCP client reads
  it per request, so http/https follows the mode automatically. Hand-written
  HTTP calls must match it — in LAN mode that means `https://localhost:5173`
  plus `--cacert .certs/rootCA.pem`.
- After any page reload, wait 5 seconds before reading bridge state.
- More than one browser tab may be connected: identify the intended tab
  (`getTimelineState` / `getStats`) and pass an explicit session/tab target
  on every call. Never let a multi-tab test pick a tab implicitly.
- Treat that explicit `sessionId` as a logical tab pin: background/hidden tabs
  remain valid targets, but re-list and re-pin sessions after every reload or
  `dev:full` restart before continuing.
- Long playback/export probes: pass a generous `timeoutMs` instead of
  relying on the default.
- HTTP 401 "Invalid bridge token" = the token rotated (dev:full restart,
  a second Vite instance, or a vitest run). Re-read `.ai-bridge-token`.
- PowerShell helpers: never name a parameter `$args` (automatic variable —
  silently drops tool arguments) and avoid alias-colliding names like `R`.

Useful editor tools: `getStats` / `getStatsHistory`, `getLogs`,
`getPlaybackTrace`, `getTimelineState`, `getClipDetails`, `simulateScrub` /
`simulatePlayback` / `simulatePlaybackPath`, `reloadApp`, `debugExport`
(always pass `maxRuntimeMs`; a returned blob with `size > 0` proves the
browser export path; `WebGPU device lost` afterwards means stale device
state — `reloadApp`, then retest).
Full-app debugging: with an explicit `sessionId` and `confirm: true`, use `captureAppScreenshot` for viewport/full-page PNGs, `clickAppControl` for visible controls, and `probeSameOriginRequest` for redacted same-origin API status/error bodies.

## 5. Testing chat and kernel end-to-end

Calling an editor tool directly proves only that tool. For any change to
prompts, playbooks, tool schemas, chat history handling, kernel routing, or
the provider loop, run the complete in-app agent in the browser:

1. Select the intended browser tab and verify its project/timeline.
2. Send the message through the in-app chat UI (select the model class there
   when it matters) and inspect the finished run yourself; this is the
   pre-commit verification for kernel-affecting work.
3. Review the finished chat and the corresponding audit evidence (section 6):
   resolved prompt, ordered tool calls, arguments, results, status, timing.
   The optional bridge history/audit endpoints may supplement this review
   unless the user requested browser-only testing.
4. Classify a failure before editing code: prompt/playbook, history/
   continuity, tool schema/result size, policy/approval, or provider-loop
   orchestration. Never patch the system prompt to mask a non-prompt defect.

Cost note: provider calls hit real APIs. Kernel-handled turns answer with
the fixed `Kernel-verifiziert (<hash>)` format and consume no provider
credits; prose answers mean the community-provider path ran.

## 6. Kernel debugging — what happened inside?

The kernel is a separate private project; this repo contains only the client
boundary (`src/services/kernelClient/`). Fast inspection paths, editor side
first:

- **Browser console:** `Logger.enable('KernelGateway')` — every handled
  turn, fallback reason, and rollback cause is logged with a reason string.
- **Dev config:** localStorage keys `ms.kernel.url` / `ms.kernel.token` /
  `ms.kernel.enabled` (`false` kills kernel routing everywhere). Production
  uses the same-origin `/api/kernel/*` proxy.
- **Direct run overwatch (dev kernel, read-only HTTP):** authenticate with
  `Authorization: Bearer <KERNEL_AUTH_TOKEN>` (value from `.dev.vars`; never
  print or commit it), then against `http://127.0.0.1:8787`:
  - `GET /kernel/runs` — list runs; `GET /kernel/runs/<runId>` — full audit
    record of one run; `GET /kernel/runs/<runId>/trace` — step-by-step trace
    (the way to observe what a job did);
  - `GET /kernel/activity` — recent events; `GET /kernel/metrics`;
    `GET /kernel/health`.
- **Audit files on disk:** `../masterselects-kernel/.dev-data/audits/` —
  `fast-v2-audits/` (one JSON per run), `fast-v2-journal/`,
  `source-bundles/`; durable even after the visible chat is cleared.
- **Kernel console output:** interleaved in the user's dev:full terminal.

Full client contract and troubleshooting: `docs/Features/Kernel-Client.md`.

## 7. Kernel boundary (architecture rule)

Before changing AI-agent capabilities, read
[Normal Path ownership ADR](docs/architecture/ADR-001-Fast-V2-Kernel-Owned-Orchestration.md).

Provider prompts, categories, fast paths, orchestration, sequencing, retries,
and intent-to-operation compilers belong in the private sibling repository
`masterselects-kernel`. This browser editor may add atomic tools and must
retain their schemas, policy, authorization, confirmation, undo/transaction
handling, and deterministic execution. Do not add a provider-facing
client-side fast path when existing atomic tools can be composed privately in
the kernel. Externally reachable Cloudflare/D1 routes may validate and relay
the pinned operation boundary, but must not contain model orchestration or
fast-path logic. `tests/unit/kernelClientIsolation.test.ts` enforces the
boundary. Internal plans and audits may be tracked under `docs/private/` in
this private repository.

## 8. Architecture map

- `src/components/` — React UI: Timeline, Panels, Preview, Docking, Export, Mobile
- `src/stores/` — Zustand: Timeline, Media, History, Settings, Dock, Slice, Render Targets, SAM2, Multicam
- `src/engine/` — WebGPU rendering, RenderDispatcher, texture/audio/export/analysis pipeline
- `src/effects/`, `src/transitions/` — GPU effects and transitions
- `src/services/` — LayerBuilder, Media Runtime, Monitoring, Project Storage, AI Tools, Export, kernelClient
- `src/signals/`, `src/importers/` — Universal Signal foundation ("no unsupported files")
- `src/hooks/`, `src/utils/`, `src/types/`, `src/workers/`, `src/shaders/`

Central files: `src/engine/WebGPUEngine.ts`,
`src/engine/render/RenderDispatcher.ts`, `src/stores/timeline/index.ts`,
`src/stores/mediaStore/index.ts`, `src/stores/historyStore/index.ts`,
`src/services/layerBuilder/LayerBuilderService.ts`, `src/services/logger.ts`.

Render path: `useEngine` → `WebGPUEngine.initialize()` → `RenderLoop.start()`
→ `RenderDispatcher.render(layers)` → LayerCollector → Compositor/Effects →
NestedCompRenderer → OutputPipeline → SlicePipeline.

Permanent architecture rules:

- Before adding multi-time video sampling or an auxiliary video texture, read
  [Temporal frame access](docs/architecture/Temporal-Frame-Access.md). Reuse
  `SourceFrameService` and the GPU upload path for source-frame consumers; do not
  add a decoder per requested frame. Source history and previous-output feedback
  are different contracts. The current Slit Scan integration is effect-specific:
  adding `image.sample-history` to another effect does not opt it into this path.
- Product-source ceiling is 700 LOC per file. Splits must reduce real
  coupling — no `helpers.ts`/`utils.ts` dumping grounds, no blind splits.
- Runtime handles (File, Blob, object URLs, DOM/media elements,
  AudioContext, VideoFrame, ImageBitmap, GPU objects, decoders, workers,
  service singletons) stay out of durable stores, project data, and pure
  shared types.

## 9. Critical patterns

- HMR singletons (Engine, FFmpegBridge, SAM2, runtime owners) must survive
  HMR: park the instance in `import.meta.hot.data` on dispose and restore it
  on accept.
- Avoid stale closures in async callbacks — read fresh state via `get()` or
  functional `setState` updates.
- Wait for `canplaythrough`, not only `loadeddata`.
- Use `toSorted()` instead of `sort()` to avoid mutation.
- **Unified property / effect inspector design:** New or revised effect controls
  must reuse the compact Transform inspector design: collapsible sections,
  aligned labels, thin sliders, bordered numeric fields, and reset actions.
  Reuse `ResolveInspectorSection`, `ResolveInspectorRow`, and
  `ResolveInspectorIconButton` from
  `src/components/panels/properties/resolveInspector/ResolveInspectorPrimitives.tsx`,
  `ResolveInspectorNumberRow` for slider + number + reset rows, and
  `src/components/inspector/InspectorSelect.tsx` for dropdowns.
  Numeric interaction comes from `LabeledValue` / `EditableDraggableNumber`;
  sliders use `HandleOnlyRange`. Use existing inspector CSS and theme tokens.
  See `FaceCableControls.tsx` as an effect reference and
  `transformTab/ResolveTransformSection.tsx` as the visual reference.
  Do not create another bespoke form style or substitute a bare number field
  for the complete inspector row. Add shared primitives when something is
  missing; migrate other effects incrementally when touching their UI.
  Only show enable/keyframe actions when they have real supported behavior.
  Verify visual alignment and pointer/touch versus keyboard focus behavior.
- **Pointer-focus hygiene:** product UI controls must not retain native browser
  focus rings, tap highlights, or stuck `:focus` / `:focus-within` styling
  after mouse, pen, or touch activation. Clear transient pointer focus where
  needed, but always preserve an intentional, product-styled `:focus-visible`
  state for keyboard navigation. Verify both pointer/touch and keyboard input
  when adding or changing interactive controls.
- When working in a UI surface, treat the same pointer-focus defect on nearby
  existing controls as part of the task and fix it immediately when the scope
  is obvious, the change is safe and small, and it does not overwrite another
  agent's in-progress work. Otherwise report the adjacent defect explicitly.
- All stores use `subscribeWithSelector`; `settingsStore` and `dockStore`
  also use `persist`; `mediaStore` uses a different slice-creator signature
  than Timeline.
- **Linux/Mesa GPU canvas:** on Mesa (RADV/llvmpipe etc.) GPU `<canvas>`,
  worker `OffscreenCanvas`, and WebGPU fail **silently** — diagnostics report
  success, pixels never composite. Size scrolling canvases to viewport +
  overscan (never full content size), clamp backing stores well below 8192,
  keep a real main-thread software fallback, route platform decisions
  through `prefersSoftwareTimelineCanvas()`
  (`src/components/timeline/utils/timelineCanvasPlatform.ts`), and never
  trust silent success. Full table: `docs/Features/Linux-Mesa-GPU.md`.

## 10. Debugging the editor & release locations

Logger: `Logger.create('ModuleName')`; browser console:
`Logger.enable('WebGPU,FFmpeg')` / `Logger.enable('*')`,
`Logger.setLevel('DEBUG')`, `Logger.search(...)`, `Logger.errors()`,
`Logger.dump(50)`. Monitoring modules in `src/services/`:
playbackHealthMonitor, playbackDebugStats, framePhaseMonitor,
wcPipelineMonitor, vfPipelineMonitor, scrubSettleState. Browser globals:
`window.__WC_PIPELINE__`, `window.__VF_PIPELINE__`. Details:
`docs/Features/Debugging.md`, `docs/Features/Playback-Debugging.md`.

Version bump + changelog (ONLY on explicit release request): `src/version.ts`
(`APP_VERSION` and version-naming banner/notice strings),
`src/changelog-data.json` (prepend), `package.json` and `package-lock.json`
(top-level `version` and `packages[""].version`). Carry-over counting: after
`1.9` comes `2.0`; after `2.0.9` comes `2.1.0`.

Build warnings about mp4box, chunk sizes, and dynamic imports are
pre-existing — not errors.

## 11. Production errors and developer messages

Production error groups and auto-repair jobs share one status on the
operations host (error groups: `open`, `investigating`, `fixed` with a commit,
`ignored`; jobs: `resolved`, `dismissed`). Set it yourself with the operations
status CLI (`status-cli.mjs`, documented in the operations repository's
`docs/AUTO-REPAIR.md`):

- Mark an error group `investigating` before you start on it, so the
  auto-repair loop does not take it at the same time.
- After fixing a production error or finishing an auto-repair job locally,
  set it `fixed` / `resolved` with the commit and a short note.
- Mark groups that do not come from MasterSelects code `ignored`.

For an important question or a problem only the developer can solve,
`notify-cli.mjs` sends a one-way Telegram message. Production builds report
their source commit with every diagnostic (`sourceRevision`, and `releaseId` for
builds without local changes); diagnostics keep page paths only, never query
strings.
