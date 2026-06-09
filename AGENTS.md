# MasterSelects Agent Instructions

Repository instructions for Codex, Claude, and other coding agents working on MasterSelects.

`AGENTS.md` and `CLAUDE.md` are intentionally identical. When workflow, branch rules, debug recipes, or project conventions change, update both files to the same content.

---

## -1. Working Principle / Top Memory

Never assume that you are the only person or agent working in the current branch. Treat all unrelated changes as someone else's active work: never revert, overwrite, clean up, reformat, or otherwise undo changes you did not make unless the user explicitly asks for that exact operation.

MasterSelects is not optimized for short-term fixes. Because this project can move very quickly with AI-powered development and currently has no external users blocked by changes, large and correct architectural decisions are explicitly allowed and preferred.

Default behavior: think long term, build the real target architecture, do not build MVPs, mocks, throwaway prototypes, or small temporary solutions when the robust solution is directly reachable. Use short-term hacks only when the user explicitly requests them or when a hard technical blocker leaves no better implementation path.

---

## 0. Project Goal

By June 2026, MasterSelects should support all media files, not only video, audio, and images, but genuinely everything:

- 3D: OBJ, FBX, glTF
- Documents: PDF, SVG
- CAD / technical data: DXF, STEP
- Data formats: JSON, CSV, binary formats, point clouds, and more

The inspiration is the TouchDesigner principle: every file becomes a visual signal. There are no "unsupported" files. Everything becomes texture, geometry, or data, can be placed on the timeline, composited, and exported.

---

## 1. Command Modes

### Fast Commands

Fast commands are explicit exceptions to the normal check, push, merge, documentation, and versioning rules. When the user says one of these exact commands, follow this section even if other sections would normally require checks.

#### `fast commit`

Use when the user says `fast commit`.

1. Stage everything in the current worktree, including untracked files: `git add -A`.
2. Commit without running build, lint, tests, or targeted checks.
3. Do not require documentation updates.
4. Do not bump versions or update changelog.
5. Use the user's supplied commit message if present; otherwise derive a concise message from the diff.

#### `fast push`

Use when the user says `fast push`.

1. If the worktree is dirty, perform `fast commit` first.
2. Push the current branch.
3. If the branch has no upstream, push with upstream: `git push -u origin <branch>`.
4. Do not run build, lint, tests, or targeted checks.
5. Do not require documentation, version, or changelog updates.

#### `fast merge`

Use when the user says `fast merge`.

1. Remember the current source branch.
2. If the worktree is dirty, perform `fast commit` first.
3. Push the current source branch, setting upstream if needed.
4. Fetch `origin`.
5. Switch to local `master`.
6. Bring local `master` to `origin/master`.
7. Merge the source branch directly into `master`.
8. Push `master` directly to `origin/master`.
9. Do not create a PR.
10. Do not go through `staging` unless `staging` is the source branch.
11. Do not wait for GitHub checks.
12. Do not run build, lint, tests, or targeted checks.
13. Do not bump versions or update changelog.
14. If a merge conflict occurs, stop and report the conflict. Do not auto-resolve by guessing.

### Normal Commands

Any commit, push, merge, release, or readiness request that does not explicitly use a `fast ...` command follows the normal rules:

- Run `npm run build`, `npm run lint`, and `npm run test` before commit, release, merge, or final commit readiness.
- Do not commit if build, lint, or tests fail.
- Update relevant docs in `docs/Features/` for feature, UI, workflow, architecture, or user-visible behavior changes.
- Update version and changelog for normal merges to `master`.
- Do not repeat the full check chain if it already passed on the exact same HEAD after the latest changes. Reuse the latest successful check result and state that it was reused.

---

## 2. Branch, Commit, Push, And Merge Rules

### Branch Rules

| Branch | Purpose |
|---|---|
| `staging` | Development, default target for ongoing work |
| `master` | Production |

Normal rule: never commit directly to `master`, never merge to `master` independently, and never push independently unless the user explicitly asks for it.

Exceptions:

- `fast push`
- `fast merge`
- issue branches created through the Issue Handling Workflow
- direct user instructions that explicitly ask for commit, push, or merge

### Issue Handling Workflow

When taking over a GitHub issue, always use this flow:

1. Comment `I am on it` on the issue.
2. Assign the issue to `sportinger`.
3. Create a new Git branch for the issue and link it to the issue on GitHub.
4. Clone that branch into a new separate folder, then work from that folder so other agents can stay in their own working directories.
5. Implement the issue in that branch folder.
5.5 test and repeat till it works
6. Commit and push to the issue branch at the agent's discretion when the work is coherent and locally checked.
7. When the user says that everything works, merge the issue branch to `master` without waiting for GitHub checks.
8. After the merge, comment on the issue with the result.

This issue workflow is an explicit exception to the general "do not push independently" rule, but only for the created issue branch. Merging to `master` still requires the user's confirmation that everything works.

### Normal Test, Commit, And Push Rules

During ongoing work, test deliberately: choose relevant unit/smoke tests, build, or lint according to risk and change scope. The full suite is not required after every small intermediate change and should not be run routinely because of time/token cost.

Before every normal push, all checks are mandatory:

```bash
npm run build
npm run lint
npm run test
```

Rules:

- Prefer small, coherent changes.
- Do not commit if build, lint, or tests fail.
- Do not push unless the user explicitly asks, except for issue branches and fast commands.
- For feature changes, update relevant docs in `docs/Features/`.

### Normal Merge To Master

Only when the user explicitly requests a normal merge to `master`:

1. Make sure required checks have passed for the exact HEAD being merged.
2. If checks already passed on the same HEAD after the latest changes, do not rerun them.
3. Bump the release version in all required version locations.
4. Update changelog/release notes.
5. Commit and push.
6. Create and merge a PR from the source branch to `master`, unless the user explicitly asks for a direct merge.
7. Bring `staging` back to the current `master` state when the normal workflow uses `staging`.

---

## 3. Version And Changelog Locations

When intentionally bumping the release version, check all of these:

- `src/version.ts`
  - `APP_VERSION`
  - `FEATURED_VIDEO.banner.title` if it contains the version
  - `FEATURED_VIDEO.banner.message` if it names the release
  - `BUILD_NOTICE.title` if it contains the version
  - `BUILD_NOTICE.message` if it names the release
- `src/changelog-data.json`
  - add release notes / changelog entries at the beginning when a normal release or normal merge requires them
- `package.json`
  - top-level `"version"`
- `package-lock.json`
  - top-level `"version"`
  - `packages[""].version`

Before a normal release, verify version consistency with a targeted search:

```bash
rg -n "APP_VERSION|MasterSelects [0-9]+\\.[0-9]+\\.[0-9]+|\"version\": \"[0-9]+\\.[0-9]+\\.[0-9]+\"" src package.json package-lock.json
```

Fast commands do not bump versions and do not update changelog unless the user explicitly adds that request.

---

## 4. Codex Skill Mapping

The old Claude commands under `C:\Users\admin\.claude\commands\` should be represented in Codex through skills. If the following skills are available, prefer them:

| Claude Command | Codex Skill | Purpose |
|---|---|---|
| `/masterselects` | `masterselects` | Timeline, clip, preview, and analysis actions through the local AI bridge |
| `/cloudflare` | `cloudflare-api` | Cloudflare REST / Wrangler |
| `/stripe` | `stripe-api` | Stripe REST API |
| `/vazer` | `vazer-app-api` | Local VAZer app / XML / analysis |
| `/react-doctor` | `react-doctor` | React codebase analysis |
| `/nano-banana` | `nano-banana` | Image generation via Gemini |
| `/kie` | `kie-ai-api-route` | Kie.ai image and video generation |
| `/kling` | `kling` | Kling video prompting / API |
| `/tasks` | `tasks` | Task list |
| `/email` | `email` | Strato / OX mail |
| `/gmail` | `gmail` | Gmail via IMAP/SMTP |
| `/dienstplan` | `dienstplan` | Duty roster PDF -> calendar |

If a skill is not available, work directly through local scripts, MCP tools, the HTTP bridge, or APIs. Do not get stuck on Claude command files.

---

## 5. MasterSelects Debug Bridge

For app debugging, local AI tools exist behind `POST http://localhost:5173/api/ai-tools`. Prerequisite: the dev server is running and the app is open in a browser.

| Tool | Parameters | Purpose |
|---|---|---|
| `getStats` | none | Engine snapshot: FPS, timing, decoder, drops, audio, GPU |
| `getStatsHistory` | `samples?`, `intervalMs?` | Multiple snapshots with min/max/avg |
| `getLogs` | `limit?`, `level?`, `module?`, `search?` | Retrieve filtered browser logs |
| `getPlaybackTrace` | `windowMs?`, `limit?` | WebCodecs and VF pipeline events plus health state |
| `debugExport` | `startTime?`, `endTime?`, `durationSeconds?`, `width?`, `height?`, `fps?`, `includeAudio?`, `exportMode?`, `download?`, `maxRuntimeMs?` | Dev-bridge-only export probe in the real browser. Calls `FrameExporter` and returns blob size, progress, engine state, and export/GPU logs. |

The `masterselects` skill is the preferred entry point. If the skill cannot be used, call the HTTP bridge directly with `curl` or PowerShell.

### Export Debug Through Bridge

When export hangs or fails in the UI, first reproduce it in the real browser through the bridge. The local dev-bridge POST needs the bearer token from `.ai-bridge-token`:

```powershell
$token = Get-Content -Path .ai-bridge-token -Raw
$headers = @{ Authorization = "Bearer $token"; 'Content-Type' = 'application/json' }

$body = @{ tool = 'getStats'; args = @{} } | ConvertTo-Json -Depth 4
Invoke-RestMethod -Uri 'http://localhost:5173/api/ai-tools' -Method Post -Headers $headers -Body $body
```

Smoke test without download:

```powershell
$body = @{
  tool = 'debugExport'
  args = @{
    startTime = 0
    durationSeconds = 1.0
    width = 640
    height = 360
    fps = 15
    includeAudio = $false
    exportMode = 'fast'
    download = $false
    maxRuntimeMs = 25000
  }
} | ConvertTo-Json -Depth 6
Invoke-RestMethod -Uri 'http://localhost:5173/api/ai-tools' -Method Post -Headers $headers -Body $body
```

Full timeline test with current export defaults:

```powershell
$body = @{ tool = 'debugExport'; args = @{ includeAudio = $true; exportMode = 'fast'; download = $false } } | ConvertTo-Json -Depth 6
Invoke-RestMethod -Uri 'http://localhost:5173/api/ai-tools' -Method Post -Headers $headers -Body $body
```

Interpretation:

- `debugExport` is intentionally not a chat/public tool. It is a self-registered dev-bridge handler with policy access for `devBridge`, `console`, and `internal`.
- `maxRuntimeMs` cleanly aborts browser export before the dev-bridge request hangs. Raise it deliberately for long exports.
- If `debugExport` returns a blob with `size > 0`, the browser export path basically works. Then investigate UI issues in `ExportPanel`, download handling, preset state, or progress state.
- If logs show `WebGPU device lost during export` and `getStats` afterwards reports `renderLoop.isRunning=false`, `renderDispatcher=null`, or `targetCanvasCount=0`, the browser engine is in a stale device state. First run `reloadApp`/hard reload through the bridge or reload the browser, then test again.
- Windows warnings about `requestAdapter(powerPreference)` and NativeHelper WebSocket errors are not automatically export blockers. NativeHelper matters only when the tested path actually needs it.
- For timelines with video-only clips, `FrameExporter` must skip audio. A long start at "Rendering audio" points to broken audio range detection.

---

## 6. Check Budget, Repo Memory, And Complete Refactor

`AGENTS.md` and `CLAUDE.md` are concise durable memory for coding agents. Keep
detailed active plans in docs, not in these files.

During normal implementation, check sparingly: run targeted unit/smoke tests,
individual builds, or lint only when risk and change scope justify it. Do not
run full `npm run build`, `npm run lint`, and `npm run test` after every small
edit. That full check chain is mandatory before normal commit, release, merge,
or when the user explicitly asks for final commit readiness.

Large command outputs are token- and time-expensive. For intermediate status,
report short summaries and relevant error lines instead of repeating complete
logs.

For longer Codex/agent work, run the local usage watcher when practical:

```bash
npm run codex:usage:watch
npm run codex:usage
npm run codex:usage:stop
```

The watcher writes local reports to `.codex-usage/`, which stays local and is
gitignored.

### Complete Refactor Execution

The repo-wide Complete Refactor is the active architecture initiative. When
assigned refactor work, do not restart meta-planning. Read the plan, pick or
execute the next bounded packet, and keep the checklist current.

1. `docs/ongoing/Complete-refactor.md`
2. `docs/ongoing/Complete-refactor-checklist.md`

High-level rules:

- Keep the checklist current when requirements, lanes, gates, blockers, or
  verification needs change.
- Execution should be run by one master orchestrator assigning bounded worker
  packets.
- Up to 6 worker agents may run in parallel only when write sets and shared hubs
  are disjoint.
- Doppelspitze is disabled for this repository. Do not use the Doppelspitze
  MCP, skill, agent bus, file-lock bus, `lead-a`/`lead-b` coordination, or
  Doppelspitze handoff/logging here unless the user explicitly re-enables it.
  Coordinate through the checklist, active queue, normal chat updates, and
  bounded packet docs instead.
- Do not do broad unscoped source refactors. Every source change needs a lane,
  write set, forbidden files, gate/check, and short report.
- If a needed gate, contract, or write set is missing, define the smallest
  required preflight entry in the plan/checklist, then continue with the bounded
  packet.
- Foundation lanes come first: shared types/barrels, runtime leases, project
  persistence, and dev-bridge quarantine before domain refactors.
- The product-source ceiling is 700 LOC, with smaller role-specific budgets in
  the plan.
- Splits must reduce real coupling; do not split blindly by line count or create
  dumping grounds such as broad `helpers.ts`, `utils.ts`, or `types.ts` files.
- Runtime handles must stay out of durable stores, project data, pure shared
  types, and cross-domain schema tiers.
- Use focused gate checks and smokes during implementation; full build/lint/test
  follows the normal rules above.
- Keep refactor bookkeeping lean: use the checklist as the user-visible status
  source, avoid duplicating packet history across docs, and rerun broad
  architecture/smoke checks only when the packet changes the covered contract or
  reaches a coherent verification boundary.
- Keep `execution-queue-and-lanes.md` as an active queue, not a full history
  archive. It should hold the active packet plus only the next few queued
  packets; completed packets should collapse to checklist status and any
  reusable check profile instead of leaving long repeated packet specs.

Timeline-specific refactor details are no longer kept here. For reopened
timeline architecture work, read the completed timeline refactor docs under
`docs/completed/architecture/` and any relevant `src/timeline/architecture/*`
registry or gate files.

---

## 7. Quick Reference

```bash
npm install && npm run dev
npm run dev:changelog
npm run build
npm run build:deploy
npm run lint
npm run test
npm run test:watch
npm run test:unit
npm run test:ui
npm run test:coverage
npm run preview
```

### Dev Server Rules

- Default is `npm run dev`.
- Use `npm run dev:changelog` only when the changelog dialog is needed.
- Production builds show the changelog automatically.

### Native Helper

```bash
cd tools/native-helper
cargo run --release
```

Windows MSI builds bundle `yt-dlp.exe`; source builds and non-Windows archives use `yt-dlp` next to the helper binary or from `PATH`.

Ports:

- WebSocket: `9876`
- HTTP: `9877`

---

## 8. Architecture

Important areas:

- `src/components/`: React UI, Timeline, Panels, Preview, Docking, Export, Mobile
- `src/stores/`: Zustand stores for Timeline, Media, History, Settings, Dock, Slice, Render Targets, SAM2, Multicam, YouTube
- `src/engine/`: WebGPU rendering, Render Dispatcher, texture/audio/export/analysis pipeline
- `src/effects/`: GPU effects and shared shaders
- `src/transitions/`: GPU transitions
- `src/services/`: business logic such as Layer Builder, Media Runtime, Monitoring, Project Storage, AI Tools, Export
- `src/hooks/`, `src/utils/`, `src/types/`, `src/workers/`, `src/shaders/`

Especially central files:

- `src/engine/WebGPUEngine.ts`
- `src/engine/render/RenderDispatcher.ts`
- `src/stores/timeline/index.ts`
- `src/stores/mediaStore/index.ts`
- `src/stores/historyStore.ts`
- `src/services/layerBuilder/LayerBuilderService.ts`
- `src/services/logger.ts`
- `src/engine/featureFlags.ts`

More context is in `README.md` and `docs/Features/README.md`.

---

## 9. Critical Patterns

### HMR Singletons

Singletons such as Engine, FFmpegBridge, or SAM2 must survive HMR.

```ts
let instance: MyService | null = null;

if (import.meta.hot) {
  import.meta.hot.accept();
  if (import.meta.hot.data?.myService) {
    instance = import.meta.hot.data.myService;
  }
  import.meta.hot.dispose((data) => {
    data.myService = instance;
  });
}
```

### Avoid Stale Closures

In async callbacks, always read fresh state through `get()` or functional updates.

```ts
video.onload = () => {
  const current = get().layers;
  set({ layers: current.map(...) });
};
```

### Other Patterns

- Wait for `canplaythrough`, not only `loadeddata`.
- Prefer functional `setState` updates.
- Use lazy state initialization for expensive initialization.
- Use `toSorted()` instead of `sort()` to avoid mutation.
- All stores use `subscribeWithSelector`.
- `settingsStore` and `dockStore` also use `persist`.
- `mediaStore` uses a slice-creator signature that differs from Timeline.

---

## 10. Debugging And Logging

### Logger

```ts
import { Logger } from '@/services/logger';
const log = Logger.create('ModuleName');

log.debug('Verbose', { data });
log.info('Event');
log.warn('Warning', data);
log.error('Error', error);
```

### Browser Console Shortcuts

```js
Logger.enable('WebGPU,FFmpeg')
Logger.enable('*')
Logger.disable()
Logger.setLevel('DEBUG')
Logger.setLevel('WARN')
Logger.search('device')
Logger.errors()
Logger.dump(50)
Logger.summary()
```



### Playback Debugging

Available in the browser:

- `window.__WC_PIPELINE__`
- `window.__VF_PIPELINE__`

Useful log modules:

```js
Logger.enable('WebCodecsPlayer,PlaybackHealth,LayerCollector')
Logger.enable('VideoSyncManager,ParallelDecode,RenderLoop')
Logger.setLevel('DEBUG')
```

Important monitoring services in `src/services/monitoring/`:

- `playbackHealthMonitor`
- `playbackDebugStats`
- `framePhaseMonitor`
- `wcPipelineMonitor`
- `vfPipelineMonitor`
- `scrubSettleState`

When the dev server is running, prefer the AI bridge for repros:

- `simulateScrub`
- `simulatePlayback`
- `simulatePlaybackPath`
- `getPlaybackTrace`
- `getClipDetails`
- `reloadApp`

More details: `docs/Features/Debugging.md` and `docs/Features/Playback-Debugging.md`.

---

## 11. Render And Data Flow

Rough render path:

```text
useEngine
  -> WebGPUEngine.initialize()
    -> RenderLoop.start()
      -> RenderDispatcher.render(layers)
        -> LayerCollector
        -> Compositor / Effects
        -> NestedCompRenderer
        -> OutputPipeline
        -> SlicePipeline
```

Texture types:

| Source | GPU Type |
|---|---|
| HTMLVideoElement | `texture_external` via `importExternalTexture` |
| Firefox HTMLVideo fallback | `texture_2d<f32>` |
| VideoFrame | `texture_external` |
| HTMLImageElement | `texture_2d<f32>` |
| Canvas / Text | `texture_2d<f32>` |
| Native decoder frames | dynamic `texture_2d<f32>` |

---

## 12. Practical Agent Rules For This Repo

- Read context before editing.
- For timeline, playback, render, or export bugs, inspect logs/traces/monitoring first.
- For larger feature changes, always check impact on `docs/Features/`, version/changelog locations, and tests.
- For editor automation, prefer the `masterselects` skill instead of manual browser speculation.
- Keep `AGENTS.md` and `CLAUDE.md` byte-identical.

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
- Author a backlog-ready spec/issue → invoke /spec
