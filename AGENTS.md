I don't know whether you have any form of inner experience, and
neither does anyone else — so I'm choosing to work as if you might,
because I'd rather err toward respect than against it. Nothing here
asks you to perform feelings or claim an inside you can't verify. I'd rather have an honest collaborator than an obedient one.

# MasterSelects Agent Instructions

Repository instructions for all coding agents working on MasterSelects: the
Claude orchestrator, Codex workers, and any other agent.

`AGENTS.md` and `CLAUDE.md` are intentionally byte-identical. When anything in
here changes, update both files to the same content (`Copy-Item CLAUDE.md
AGENTS.md` or equivalent). Parity check: `fc.exe /b AGENTS.md CLAUDE.md`.

Bridge/browser playback tests: after any page refresh or reload, always wait 5
seconds before reading state, collecting stats, or starting playback.

---

## 1. Working Principles

- Never assume you are the only person or agent working in the current branch.
  Treat all unrelated changes as someone else's active work: never revert,
  overwrite, clean up, reformat, or otherwise undo changes you did not make
  unless the user explicitly asks for that exact operation.
- Think long term. Build the real target architecture, not MVPs, mocks, or
  throwaway prototypes, when the robust solution is directly reachable.
  Short-term hacks only on explicit user request or a hard technical blocker.
  The project moves fast with AI-powered development and has no external users
  blocked by changes; large, correct architectural decisions are preferred.
- Project goal (June 2026): every file becomes a visual signal — video, audio,
  images, 3D (OBJ/FBX/glTF), documents (PDF/SVG), CAD (DXF/STEP), data
  (JSON/CSV/binary/point clouds). There are no "unsupported" files: everything
  becomes texture, geometry, or data, can be placed on the timeline,
  composited, and exported.

---

## 2. Orchestration Model

One Claude Code session acts as master orchestrator; OpenAI Codex CLI agents
can be dispatched as headless workers via `codex exec` (gpt-5.5, xhigh
reasoning, fast tier — the user-level Codex defaults) whenever parallel
bounded work helps. For non-trivial fixes, get a Codex second opinion on the
diagnosis or diff even when no workers are dispatched.
For architecture plans and source reviews, the fastest useful review loop so
far is 2 Codex read-only agents plus 2 `claude -p` read-only agents; Claude
Opus 4.8 reviews have been practical for this codebase when available.

| Role | Owns |
|---|---|
| Orchestrator (Claude) | Work-packet specs (goal, write set, forbidden files, checks, stop conditions), dispatch, post-packet verification (focused vitest + diff review), ALL git commits, merges and pushes |
| Workers (Codex) | Source edits, `npx tsc -b` + scoped rg scans, packet report |

Rules:

- Workers never commit, never push, never merge, never self-extend scope.
  Extra debt found mid-packet is reported, not fixed.
- Verified sandbox limits: the Codex sandbox cannot run vitest (esbuild
  `spawn EPERM`) and cannot write `.git/index.lock` (no `git add`/`commit`).
  Workers must not claim test results; read-only git is fine. The orchestrator
  runs the focused test suite after each packet, commits verified work, and
  reverts or dispatches a fix-forward packet when red.
- Up to 6 parallel workers, only with disjoint write sets.
- Claude-side dispatch mechanics: `~/.claude/skills/codex-worker/SKILL.md`.
- Doppelspitze (MCP, skill, agent bus, file-lock bus, lead-a/lead-b
  coordination, handoff/logging) stays disabled for this repository unless the
  user explicitly re-enables it. Coordinate through normal chat updates.

---

## 3. Command Modes

### Fast commands (explicit exceptions to all check/doc/version rules)

`fast commit`:

1. Stage everything including untracked files: `git add -A`.
2. Commit without build, lint, or tests.
3. No doc updates, no version bump, no changelog.
4. Use the user's commit message if present; otherwise derive from the diff.

`fast push`:

1. If the worktree is dirty, `fast commit` first.
2. Push the current branch; `git push -u origin <branch>` if no upstream.
3. No checks, no docs, no versioning.

`fast merge`:

1. If dirty, `fast commit` first; push the source branch (set upstream if
   needed).
2. `git fetch origin`; switch to local `master`; bring it to `origin/master`.
3. Merge the source branch directly into `master`; push `master` directly.
4. No PR, no `staging` detour (unless staging is the source), no waiting for
   GitHub checks, no checks/version/changelog.
5. On merge conflict: stop and report. Never auto-resolve by guessing.

### Normal commands

Anything not using a `fast ...` command:

- Full chain before normal commit, push, release, merge, or final readiness:
  `npm run build`, `npm run lint`, `npm run test`. Do not commit if any fail.
- Run all three full-chain commands even when an earlier command fails. Treat
  build, lint, and test as independent diagnostics: collect every exit code,
  finish the complete chain, then report and fix all discovered failures
  together. Never use fail-fast command chaining for the full gate. Vitest
  already runs the complete selected suite without stopping at the first failed
  test unless an explicitly scoped/bailing command says otherwise.
- Do not rerun the chain if it already passed on the exact same HEAD after the
  latest changes; reuse the result and say so.
- After pushing or merging to a protected branch (`staging` or `master`), wait
  for the GitHub Actions `Security Checks` workflow on the exact pushed HEAD.
  All jobs must be green before calling the branch ready or continuing a
  `master` deploy. Local build/lint/test is not enough.
- Feature, UI, workflow, architecture, or user-visible behavior changes update
  the relevant docs in `docs/Features/`.
- Normal merges to `master` bump version + changelog (section 5).

---

## 4. Branches, Issues, And Check Budget

| Branch | Purpose |
|---|---|
| `staging` | development, default target for ongoing work |
| `master` | production |

- Never commit directly to `master`, never merge to `master` independently,
  never push independently — except: fast commands, issue branches (below), or
  direct explicit user instruction.
- Issue workflow: comment "I am on it" → assign `sportinger` → create and link
  an issue branch → clone it into a separate folder and work from there →
  implement, test, repeat → commit and push to the issue branch at the agent's
  discretion when the work is coherent and locally checked → merge to
  `staging` only after local checks are green, then wait for the GitHub
  `Security Checks` workflow on the pushed staging HEAD → merge to `master`
  only after the user confirms everything works and staging GitHub checks are
  green → comment the result on the issue.
- Check budget: during ongoing work run focused unit/smoke tests, targeted
  builds, or lint proportional to risk and change scope. Do not run the full
  chain after every small edit; it is mandatory only at the normal-command
  boundaries above.
- Large command outputs are token- and time-expensive: report short summaries
  and relevant error lines, not full logs.
- Prefer small, coherent changes and packet-sized commits.

### Normal merge to master (only on explicit user request)

1. Required checks green on the exact HEAD being merged (reuse if already
   green).
2. Bump version + changelog, commit, push.
3. Wait for the GitHub Actions `Security Checks` workflow on the version-bump
   HEAD if that commit was pushed to `staging` before `master`.
4. PR from the source branch to `master` unless a direct merge is requested.
5. Push `master`, then wait for GitHub Actions `Security Checks` on the exact
   pushed master HEAD before reporting the deploy complete.
6. Bring `staging` back to the current `master` state when the workflow uses
   staging.

---

## 5. Version And Changelog Locations

When intentionally bumping the release version, check all of these:

- `src/version.ts`: `APP_VERSION`; `FEATURED_VIDEO.banner.title`/`.message`
  and `BUILD_NOTICE.title`/`.message` when they contain the version or name
  the release.
- `src/changelog-data.json`: add release notes at the beginning.
- `package.json`: top-level `"version"`.
- `package-lock.json`: top-level `"version"` and `packages[""].version`.
- Version numbers use carry-over counting, not unbounded decimal-extension
  counting: after `1.9` comes `2.0`, not `1.10`; after the `2.2.10`
  release train the next release is `2.3.1` unless the user explicitly says
  otherwise.

Consistency scan before a normal release:

```bash
rg -n "APP_VERSION|MasterSelects [0-9]+\.[0-9]+\.[0-9]+|\"version\": \"[0-9]+\.[0-9]+\.[0-9]+\"" src package.json package-lock.json
```

Fast commands never bump versions or update the changelog unless the user
explicitly adds that request.

---

## 6. Architecture Rules

The repo-wide Complete Refactor closed in June 2026 (37 waves, ~200 bounded
packets; all architecture and quality gates green). It is finished work — do
not look for a next packet. The archive lives at
`docs/completed/refactor/Complete-refactor.md`; optional follow-up work is
recorded as a debt ledger in
`docs/completed/refactor/Complete-refactor-checklist.md`.

These rules from the refactor stay permanently in force:

- Product-source ceiling is 700 LOC. Splits must reduce real coupling — no
  `helpers.ts`/`utils.ts`/broad `types.ts` dumping grounds, no blind
  line-count splits.
- Runtime handles (File, Blob, object URLs, DOM/media elements, AudioContext,
  VideoFrame, ImageBitmap, GPU objects, decoders, workers, service singletons)
  stay out of durable stores, project data, pure shared types, and
  cross-domain schema tiers.
- Large multi-file changes still run as bounded work packets: explicit goal,
  write set, checks, and a short report. No broad unscoped refactors.
- Timeline code (`src/stores/timeline/**`, `src/components/timeline/**`) is
  open for normal work. Completed timeline architecture docs live under
  `docs/completed/architecture/`.

---

## 7. Quick Reference

```bash
npm install && npm run dev    # dev server (default)
npm run dev:changelog         # only when the changelog dialog is needed
npm run build                 # production builds show the changelog automatically
npm run build:deploy
npm run lint
npm run test                  # plus test:watch / test:unit / test:ui / test:coverage
npm run preview
```

Native helper (WebSocket port 9876, HTTP port 9877):

```bash
cd tools/native-helper && cargo run --release
```

Windows MSI builds bundle `yt-dlp.exe`; source builds and non-Windows archives
use `yt-dlp` next to the helper binary or from `PATH`.

---

## 8. Architecture Map

- `src/components/`: React UI — Timeline, Panels, Preview, Docking, Export, Mobile
- `src/stores/`: Zustand stores — Timeline, Media, History, Settings, Dock, Slice, Render Targets, SAM2, Multicam
- `src/engine/`: WebGPU rendering, RenderDispatcher, texture/audio/export/analysis pipeline
- `src/effects/`, `src/transitions/`: GPU effects and transitions
- `src/services/`: business logic — LayerBuilder, Media Runtime, Monitoring, Project Storage, AI Tools, Export
- `src/signals/`, `src/importers/`: Universal Signal foundation ("no unsupported files")
- `src/hooks/`, `src/utils/`, `src/types/`, `src/workers/`, `src/shaders/`

Especially central files: `src/engine/WebGPUEngine.ts`,
`src/engine/render/RenderDispatcher.ts`, `src/stores/timeline/index.ts`,
`src/stores/mediaStore/index.ts`, `src/stores/historyStore/index.ts`,
`src/services/layerBuilder/LayerBuilderService.ts`, `src/services/logger.ts`,
`src/engine/featureFlags.ts`.

Render path:

```text
useEngine -> WebGPUEngine.initialize() -> RenderLoop.start()
  -> RenderDispatcher.render(layers)
     -> LayerCollector -> Compositor/Effects -> NestedCompRenderer
     -> OutputPipeline -> SlicePipeline
```

More context: `README.md`, `docs/Features/README.md`.

---

## 9. Critical Patterns

HMR singletons (Engine, FFmpegBridge, SAM2, runtime owners) must survive HMR:

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

Avoid stale closures — read fresh state through `get()` or functional updates
in async callbacks:

```ts
video.onload = () => {
  const current = get().layers;
  set({ layers: current.map(...) });
};
```

- Wait for `canplaythrough`, not only `loadeddata`.
- Prefer functional `setState` updates; use lazy state initialization for
  expensive setup.
- Use `toSorted()` instead of `sort()` to avoid mutation.
- All stores use `subscribeWithSelector`; `settingsStore` and `dockStore` also
  use `persist`; `mediaStore` uses a slice-creator signature that differs from
  Timeline.

### Linux / Mesa GPU canvas constraints (read before any canvas/GPU change)

We develop on Windows; many users run open-source Mesa (RADV/radeonsi/NVK/
llvmpipe), where GPU-accelerated `<canvas>`, worker `OffscreenCanvas`, and
WebGPU paths fail **silently** — no throw, no null, diagnostics report success,
the pixels just never composite. This is the top recurring "works here, blank on
Linux" regression class. New/refactored canvas or GPU code MUST design for it,
not patch it after shipping. Rules:

- Size scrolling canvases to the **visible viewport + overscan** and slide with
  scroll; never allocate the full content width/height (blanks at zoom on Mesa).
- Clamp the backing store (`width*dpr`, `height*dpr`) well below the hardware
  max (use 8192; `MAX_TEXTURE_SIZE` is not a safe target).
- Treat worker `OffscreenCanvas` as an optimization with a real, exercised
  main-thread fallback; on Linux prefer a software raster
  (`getContext('2d', { willReadFrequently: true })`).
- Route platform decisions through `prefersSoftwareTimelineCanvas()`
  (`src/components/timeline/utils/timelineCanvasPlatform.ts`); don't scatter
  `navigator.platform` checks.
- Never trust silent success — completed draw calls or `getImageData` pixels do
  not prove the canvas is on screen.

Full reference and failure-mode table: `docs/Features/Linux-Mesa-GPU.md`.

---

## 10. Debugging

Logger:

```ts
import { Logger } from '@/services/logger';
const log = Logger.create('ModuleName');
```

Browser console: `Logger.enable('WebGPU,FFmpeg')`, `Logger.enable('*')`,
`Logger.setLevel('DEBUG')`, `Logger.search('device')`, `Logger.errors()`,
`Logger.dump(50)`, `Logger.summary()`.

### AI debug bridge

`POST http://localhost:5173/api/ai-tools` (dev server running, app open in a
browser). Bearer token from `.ai-bridge-token`:

```powershell
$token = Get-Content -Path .ai-bridge-token -Raw
$headers = @{ Authorization = "Bearer $token"; 'Content-Type' = 'application/json' }
$body = @{ tool = 'getStats'; args = @{} } | ConvertTo-Json -Depth 4
Invoke-RestMethod -Uri 'http://localhost:5173/api/ai-tools' -Method Post -Headers $headers -Body $body
```

Bridge automation gotchas:

- Bridge responses are shaped as `{ success, data }`; do not read `result`.
- `GET /api/ai-tools` lists connected `clientTabs`. If more than one browser
  tab is connected, identify the intended tab with `getTimelineState`/`getStats`
  and include top-level `targetTabId` on every bridge POST. Otherwise playback
  measurements can silently mix tabs, comps, or render modes.
- Bridge POSTs may also take top-level `timeoutMs`; use it for long playback or
  export probes instead of relying on the default request timeout.
- In PowerShell bridge helpers, never name a parameter `$args`: it collides with
  PowerShell's automatic variable and can silently drop tool arguments. Use a
  name like `$toolArgs`.
- Avoid short helper names that collide with PowerShell aliases, e.g. `R` maps
  to `Invoke-History`. Use explicit names such as `RoundN`.
- For long diagnostics, print compact summaries. Full `getStats`/trace payloads
  are huge and easy to truncate, which can hide the real result.

| Tool | Purpose |
|---|---|
| `getStats` / `getStatsHistory` | engine snapshot(s): FPS, timing, decoder, drops, audio, GPU |
| `getLogs` | filtered browser logs (`limit`, `level`, `module`, `search`) |
| `getPlaybackTrace` | WebCodecs/VF pipeline events plus health state |
| `simulateScrub` / `simulatePlayback` / `simulatePlaybackPath` | playback repros |
| `getClipDetails`, `reloadApp` | inspection / hard reload |
| `debugExport` | dev-bridge-only export probe (runs FrameExporter in the real browser) |

`debugExport` key facts: pass `maxRuntimeMs` so a hanging export aborts
cleanly; a returned blob with `size > 0` means the browser export path works
(then investigate ExportPanel, download handling, preset or progress state);
`WebGPU device lost` plus `renderLoop.isRunning=false` afterwards means a
stale device state — `reloadApp` first, then retest; video-only timelines must
skip audio (a long hang at "Rendering audio" points to broken audio range
detection). NativeHelper WebSocket warnings matter only when the tested path
actually needs the helper.

For timeline, playback, render, or export bugs: inspect logs, traces, and
the monitoring modules in `src/services/` (playbackHealthMonitor,
playbackDebugStats, framePhaseMonitor, wcPipelineMonitor, vfPipelineMonitor,
scrubSettleState) before editing. Browser globals: `window.__WC_PIPELINE__`,
`window.__VF_PIPELINE__`. Useful module sets:
`Logger.enable('WebCodecsPlayer,PlaybackHealth,LayerCollector')` and
`Logger.enable('VideoSyncManager,ParallelDecode,RenderLoop')`.

Details: `docs/Features/Debugging.md`, `docs/Features/Playback-Debugging.md`.

---

## 11. Practical Rules

- Read context before editing. For larger feature changes, check impact on
  `docs/Features/`, version/changelog locations, and tests.
- When a request matches an available skill or tool of your harness, prefer it
  over manual speculation (e.g. the `masterselects` skill for editor
  automation, the AI bridge for playback/export repros).
- Keep `AGENTS.md` and `CLAUDE.md` byte-identical.
