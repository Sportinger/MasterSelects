# AGENTS.md

Repository instructions for Codex and other coding agents working on MasterSelects.

This file is the Codex counterpart to `CLAUDE.md`. When workflow, branch rules, debug recipes, or project conventions change, keep `AGENTS.md` and `CLAUDE.md` in sync.

---

## -1. Working Principle / Top Memory

MasterSelects is not optimized for short-term fixes. Because this project can move very quickly with AI-powered development and currently has no external users blocked by changes, large and correct architectural decisions are explicitly allowed and preferred.

Default behavior: think long term, build the real target architecture, do not build MVPs, mocks, throwaway prototypes, or small temporary solutions when the robust solution is directly reachable. Use short-term hacks only when the user explicitly requests them or when a hard technical blocker leaves no better implementation path.

---

## 0. Project Goal

By June 2026, MasterSelects should support ALL media files, not only video, audio, and images, but genuinely everything:

- 3D: OBJ, FBX, glTF
- Documents: PDF, SVG
- CAD / technical data: DXF, STEP
- Data formats: JSON, CSV, binary formats, point clouds, and more

The inspiration is the TouchDesigner principle: every file becomes a visual signal. There are no "unsupported" files. Everything becomes texture, geometry, or data, can be placed on the timeline, composited, and exported.

## 0.1 Codex Skill Mapping

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

## 0.2 MasterSelects Debug Bridge

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

## 0.3 Codex Session Usage Monitoring

For longer Codex/agent work, run the local usage watcher when practical:

```bash
npm run codex:usage:watch
```

One-time evaluation:

```bash
npm run codex:usage
```

Stop hidden watcher:

```bash
npm run codex:usage:stop
```

The watcher reads `~/.codex/sessions`, filters to this repo, groups `token_count` events per user turn, and writes local reports to `.codex-usage/`:

- `turns.jsonl`: machine-readable turn costs, questions, status, tool usage, and git snapshots
- `sessions.json`: session summary
- `report.md`: readable cost/strategy report
- `state.json`: watcher state for commit attribution

`.codex-usage/` stays local and is gitignored. Exact commit attribution only works for turns observed while `codex:usage:watch` was running; historical sessions only get the git state observed when the report was generated.

## 0.4 Agent Check Budget / Repo Memory

`AGENTS.md` and `CLAUDE.md` are the durable project memory for coding agents. Do not assume an agent has hidden persistent memory for this repo; important workflow rules belong here.

During normal implementation, check sparingly: run targeted unit/smoke tests, individual builds, or lint only when risk and change scope justify it. Do not run full `npm run build`, `npm run lint`, and `npm run test` after every small edit. That full check chain is mandatory before commit, release, merge, or when the user explicitly asks for final commit readiness.

Large command outputs are token- and time-expensive. For intermediate status, report short summaries and relevant error lines instead of repeating complete logs.

---

## 1. Workflow

### Branch Rules

| Branch | Purpose |
|---|---|
| `staging` | Development, default target for ongoing work |
| `master` | Production, only through PR |

### Test, Commit, and Push Rules

During ongoing work, test deliberately: choose relevant unit/smoke tests, build, or lint according to risk and change scope. The full suite is not required after every small intermediate change and should not be run routinely because of time/token cost.

Before every commit, all checks remain mandatory:

```bash
npm run build
npm run lint
npm run test
```

Rules:

- Never commit directly to `master`.
- Never merge to `master` independently.
- Never push independently unless the user explicitly asks for it.
- Prefer small, coherent changes.
- Do not commit if build, lint, or tests fail.

### Merge To Master

Only when the user explicitly requests it:

1. Bump version in `src/version.ts`.
2. Update CHANGELOG in `src/version.ts`.
3. Commit and push.
4. Create and merge PR from `staging` to `master`.
5. Bring `staging` back to the current `master` state.

### Version / Changelog

- File: `src/version.ts`
- Bump version only when merging to `master`
- Always add CHANGELOG entries at the beginning
- Keep `KNOWN_ISSUES` current

### Documentation

For feature changes, update relevant docs in `docs/Features/`.

---

## 2. Quick Reference

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

- Default is `npm run dev`
- Use `npm run dev:changelog` only when the changelog dialog is needed
- Production builds show the changelog automatically

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

## 3. Architecture

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

## 4. Critical Patterns

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

### Video Ready State

Wait for `canplaythrough`, not only `loadeddata`.

### Zustand Slice Pattern

```ts
export const createSlice: SliceCreator<Actions> = (set, get) => ({
  actionName: (params) => {
    const state = get();
    set({ /* updates */ });
  },
});
```

### React State Updates

- Prefer functional `setState` updates
- Use lazy state initialization for expensive initialization
- Use `toSorted()` instead of `sort()` to avoid mutation

### Zustand Middleware

- All stores use `subscribeWithSelector`
- `settingsStore` and `dockStore` also use `persist`
- `mediaStore` uses a slice-creator signature that differs from Timeline

---

## 5. Debugging And Logging

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

### Common Problems

| Problem | Check |
|---|---|
| Black canvas | Check `readyState >= 2` |
| Device mismatch | HMR broken, reload page |
| Linux at 15fps | Check Vulkan flag |
| WebCodecs error | Expect fallback to HTMLVideoElement |
| Black after refresh | Cold-start / restore path, hard reload if needed |

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

### Scripted Playback Tests

When the dev server is running, prefer the AI bridge for repros:

- `simulateScrub`
- `simulatePlayback`
- `simulatePlaybackPath`
- `getPlaybackTrace`
- `getClipDetails`
- `reloadApp`

What to watch for in traces:

- `stalePreviewWhileTargetMoved`
- `decoderResets`
- `previewFreezeEvents`
- `previewPathCounts.empty`
- `driftSeconds`
- Health anomalies such as `FRAME_STALL`, `SEEK_STUCK`, `HIGH_DROP_RATE`, `GPU_SURFACE_COLD`
- `firstPreviewUpdateMs`

More details: `docs/Features/Debugging.md` and `docs/Features/Playback-Debugging.md`

---

## 6. Render And Data Flow

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

## 7. Practical Agent Rules For This Repo

- Read context before editing.
- For timeline, playback, render, or export bugs, inspect logs/traces/monitoring first.
- For larger feature changes, always check impact on `docs/Features/`, `src/version.ts`, and tests.
- For editor automation, prefer the `masterselects` skill instead of manual browser speculation.
- If a workflow diverges between `CLAUDE.md` and `AGENTS.md`, synchronize both files again.
