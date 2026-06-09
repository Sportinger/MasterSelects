# Complete Refactor - P0 Baseline And Guard Rails

Source: split from `docs/ongoing/Complete-refactor.md` on 2026-06-09.

Back to index: [Complete-refactor.md](../Complete-refactor.md).

### Phase 0 - Baseline And Guard Rails

Goal: make the current architecture measurable before source movement starts.

Current codebase signals, refreshed from the current worktree on 2026-06-09
by `P0-BASELINE-REFRESH-001`:

- domain LOC:
  - `src/components`: 145,804 LOC
  - `src/services`: 118,630 LOC
  - `tests`: 105,981 LOC
  - `src/engine`: 45,480 LOC
  - `src/stores`: 44,175 LOC
  - `src/types`: 3,971 LOC by PowerShell line count; raw newline-counted
    totals may differ where files contain wrapped physical lines.
  - `src/importers`: 733 LOC
  - `src/signals`: 568 LOC
- largest domains inside those:
  - `src/components/panels`: 52,674 LOC
  - `src/components/timeline`: 49,146 LOC
  - `src/stores/timeline`: 28,789 LOC
  - `src/services/audio`: 21,244 LOC
  - `src/components/common`: 17,512 LOC
  - `src/services/aiTools`: 16,523 LOC
  - `src/components/preview`: 12,872 LOC
  - `src/engine/audio`: 9,900 LOC
  - `src/services/layerBuilder`: 9,442 LOC
  - `src/services/project`: 8,654 LOC
  - `src/stores/mediaStore`: 7,328 LOC
  - `src/components/export`: 5,960 LOC
  - `src/engine/render`: 5,600 LOC
- file budget pressure:
  - `>= 700 LOC`: 146 files
  - `>= 1,000 LOC`: 71 files
  - `>= 1,500 LOC`: 36 files
  - `>= 2,000 LOC`: 14 files
  - `>= 3,000 LOC`: 5 files
- top product files over 2,000 LOC:
  - `src/components/panels/MediaPanel.tsx`: 5,544
  - `src/components/panels/flashboard/FlashBoardComposer.tsx`: 3,565
  - `src/components/export/ExportPanel.tsx`: 3,108
  - `src/components/panels/flashboard/FlashBoard.css`: 3,054
  - `src/services/proxyFrameCache.ts`: 2,909
  - `src/services/aiTools/handlers/timelineCanvasSmoke.ts`: 2,907
  - `src/services/aiTools/bridge.ts`: 2,779
  - `src/components/preview/Preview.tsx`: 2,561
  - `src/engine/render/RenderDispatcher.ts`: 2,331
  - `src/engine/WebCodecsPlayer.ts`: 2,224
- largest tests over 2,000 LOC:
  - `tests/unit/projectMediaPersistence.test.ts`: 3,465
  - `tests/unit/timelineArchitectureRegistry.test.ts`: 2,914
  - `tests/unit/timelineEditOperations.test.ts`: 2,131
  - `tests/stores/timeline/clipSlice.test.ts`: 2,117
- fan-in and barrel signals:
  - Vite currently aliases `module` only; `@/...` fan-in scans return zero and
    are not useful for this worktree.
  - relative import fan-in by hub: `src/types` 776 files,
    `src/stores/timeline` 368 files, `src/stores/mediaStore` 220 files,
    `src/services/project/types` 5 files, `src/signals` 36 files,
    `src/importers` 4 files.
  - broad barrel exports remain in `src/types/index.ts`,
    `src/stores/timeline/index.ts`, `src/importers/index.ts`,
    `src/signals/index.ts`, `src/engine/index.ts`, and related subdomain
    barrels.
- `getState()` usage:
  - total hits: 1,243
  - top files: `timelineCanvasSmoke.ts` 56, `MatAnyoneService.ts` 48,
    `torture.ts` 46, `aiTools/bridge.ts` 33, `SAM2Panel.tsx` 32,
    `AudioMixerPanel.tsx` 30, `surfaceInteractionDriver.ts` 29,
    `aiTools/handlers/playback.ts` 29, `SAM2Service.ts` 29,
    `Preview.tsx` 28.
- runtime-handle boundary scan:
  - total hits in `src/types`, `src/services/project/types`, `src/signals`,
    and `src/stores`: 306
  - top files: `webCodecsHelpers.ts` 29, `fileManageSlice.ts` 25,
    `src/types/index.ts` 18, `thumbnailHelpers.ts` 16,
    `fileImportSlice.ts` 15, `addVideoClip.ts` 13,
    `mediaTypeHelpers.ts` 10, `upgradeToNativeDecoder.ts` 10.
- CSS/global selector scan:
  - total hits: 565
  - top files: `MediaPanel.css` 52, `FlashBoard.css` 50,
    `TimelineInteractions.css` 36, `GuidedActionOverlay.css` 25,
    `PreviewEditMode.css` 22, `dock.css` 22.
- retired/deprecated payload signals:
  - total hits for `youtube`, `download`, `ai-video`, and retired FlashBoard
    board/canvas/node terms: 544
  - top files: `youtubeDownloader.ts` 33, `MediaAIGenerativeTray.css` 30,
    `mediaDownloadStore.ts` 28, `MediaDownloadComposer.tsx` 28,
    `aiTools/handlers/youtube.ts` 18, `nodeSlice.ts` 13.
- project persistence touch points:
  - total hits for project load/save/autosave/localStorage and deprecated
    payload terms in project/stores/components: 278
  - top files: `MediaDownloadComposer.tsx` 26, `projectLoad.ts` 15,
    `ProjectFileService.ts` 12, `MediaPanel.tsx` 12,
    `NativeProjectCoreService.ts` 11, `media/board/storage.ts` 10.
- smoke inventory:
  - total hits: 124
  - existing package scripts include `timeline:canvas:verify` and
    `torture:bridge-fast`.
  - top smoke surfaces: `scripts/run-timeline-canvas-verification.mjs` 54,
    `src/services/aiTools/handlers/index.ts` 8,
    `scripts/run-torture-bridge-fast.mjs` 7,
    `src/services/aiTools/policy/registry.ts` 7.

Guard rails to create before implementation:

- LOC budget gate for product source, with role-specific budgets from this doc.
- Import/fan-in report gate for shared hubs.
- Runtime-handle leak scan for durable/project/shared-type boundaries.
- `getState()` usage report outside stores.
- CSS size and legacy-class report.
- Smoke inventory for render, playback, export, preview, Media Panel,
  FlashBoard generation, project load/save, and AI bridge.

Gate:

- `P0_BASELINE_CAPTURED`: baseline files exist and contain reproducible command
  summaries for LOC, fan-in/out, barrels, `getState()`, runtime handles, CSS,
  legacy panels, project persistence, and existing smokes.
- `P0_BASELINE_REFRESHED`: all counts used by gates are refreshed from the
  current working tree, not copied from older planning scans.
- `P0_RENDER_PLAYBACK_BASELINE`: playback and scrub at 1, 4, and 16 visible
  clips; record FPS, max frame delta, render timing, and cache evictions.
- `P0_EXPORT_BASELINE`: `debugExport` fast and precise, 640x360 and 1080p,
  audio on/off; assert blob size, monotonic progress, no device loss, and
  stable engine state before/after.
- `P0_PROXY_CACHE_PRESSURE`: scrub proxy video under cache pressure; assert
  bounded `VideoFrame` count, decoder count, object URL revokes, and runtime
  releases.
- `P0_AUDIO_CONTEXT_BASELINE`: play, scrub, record, and export; assert only
  approved live `AudioContext` owners remain.
- `P0_PREVIEW_TARGET_LIFECYCLE`: mount/unmount Preview, source monitor, and
  output targets; assert no stale target canvases or render contexts.
- `P0_CSS_GLOBAL_SELECTOR_GATE`: report large CSS, global selectors, z-index
  tiers, fixed overlays, pointer-event traps, and retired class usage.
- `P0_COMPLETE_ARCHITECTURE_REGISTRY`: define a whole-codebase architecture
  registry plan based on the timeline registry method. Subchecks must cover
  lane ids, gate ids, write sets, forbidden sets, exit criteria, retired-path
  classification, test migration classification, and the command that will
  make the registry executable when implementation starts.

Parallel worker packets:

- Worker 1: LOC/domain/file-size baseline.
- Worker 2: import fan-in/fan-out and barrel baseline.
- Worker 3: store `getState()` and runtime-handle baseline.
- Worker 4: CSS/legacy/deprecated panel baseline.
- Worker 5: project persistence and retired payload baseline.
- Worker 6: render/audio/export/preview/AI-bridge smoke baseline.

Do not:

- Do not start source implementation before the relevant phase gate has
  subchecks, allowed write set, forbidden files, and exit criteria.
- Do not enforce stale LOC numbers as gates without `P0_BASELINE_REFRESHED`.
- Do not edit timeline architecture registry files while defining the
  whole-codebase registry pattern.

P0 executable scan catalog:

Run these commands from the repository root. Record summarized output in this
plan/checklist. Do not commit generated scan output unless the summary becomes
too large for the ongoing docs.

- `P0S_DOMAIN_LOC`

```powershell
$roots = @('src/components','src/services','src/engine','src/stores','src/types','src/signals','src/importers','tests')
$roots | ForEach-Object {
  $root = $_
  $sum = (rg --files $root --glob '*.ts' --glob '*.tsx' --glob '*.css' |
    ForEach-Object { (Get-Content -LiteralPath $_ | Measure-Object -Line).Lines } |
    Measure-Object -Sum).Sum
  [pscustomobject]@{ Root = $root; Lines = [int]$sum }
} | Sort-Object Lines -Descending
```

- `P0S_LARGE_FILES`

```powershell
rg --files src tests --glob '*.ts' --glob '*.tsx' --glob '*.css' |
  ForEach-Object {
    [pscustomobject]@{
      Path = $_
      Lines = (Get-Content -LiteralPath $_ | Measure-Object -Line).Lines
    }
  } |
  Where-Object { $_.Lines -ge 700 } |
  Sort-Object Lines -Descending |
  Select-Object -First 120
```

- `P0S_BROAD_BARRELS_AND_FANIN`

```powershell
rg -n '^export\s+\*|^export\s+type\s+\{.*\}\s+from' src --glob 'index.ts'
$directTypeBarrel = rg -n 'from [''"]((\.\./)+src/types|(\.\./)+types)[''"]' src tests --glob '*.ts' --glob '*.tsx'
[pscustomobject]@{ Hub = 'src/types direct barrel'; Hits = ($directTypeBarrel | Measure-Object).Count }

$groups = @(
  @{ Name = 'src/types all relative'; Patterns = @('../types', '../../src/types', '../../../src/types', '../../types', '../src/types') },
  @{ Name = 'stores/timeline'; Patterns = @('/stores/timeline', '../stores/timeline', '../../src/stores/timeline', '../../../src/stores/timeline') },
  @{ Name = 'stores/mediaStore'; Patterns = @('/stores/mediaStore', '../stores/mediaStore', '../../src/stores/mediaStore', '../../../src/stores/mediaStore') },
  @{ Name = 'services/project/types'; Patterns = @('/services/project/types', '../services/project/types', '../../src/services/project/types', '../../../src/services/project/types') },
  @{ Name = 'signals'; Patterns = @('/signals', '../signals', '../../src/signals', '../../../src/signals') },
  @{ Name = 'importers'; Patterns = @('/importers', '../importers', '../../src/importers', '../../../src/importers') }
)
$groups | ForEach-Object {
  $set = [System.Collections.Generic.HashSet[string]]::new()
  foreach ($pattern in $_.Patterns) {
    rg -l --fixed-strings $pattern src tests --glob '*.ts' --glob '*.tsx' 2>$null |
      ForEach-Object { [void]$set.Add($_) }
  }
  [pscustomobject]@{ Hub = $_.Name; Files = $set.Count }
}
```

- `P0S_GETSTATE_USAGE`

```powershell
rg -n 'getState\(' src --glob '*.ts' --glob '*.tsx'
```

- `P0S_RUNTIME_HANDLE_BOUNDARY`

```powershell
rg -n '\b(File|Blob|FileSystemFileHandle|HTMLMediaElement|HTMLVideoElement|HTMLAudioElement|HTMLCanvasElement|AudioContext|VideoFrame|ImageBitmap|GPU[A-Za-z]+|Worker|WebCodecsPlayer|NativeDecoder)\b|createObjectURL|revokeObjectURL' src/types src/services/project/types src/signals src/stores --glob '*.ts' --glob '*.tsx'
```

- `P0S_CSS_GLOBAL_SELECTOR`

```powershell
rg -n 'position:\s*fixed|z-index\s*:|pointer-events\s*:\s*none|:global|(^|[,{]\s*)(html|body|#root|\*|button|input|select|textarea)\b' src --glob '*.css'
```

- `P0S_SMOKE_INVENTORY`

```powershell
rg -n 'debugExport|getStats|getPlaybackTrace|simulatePlayback|simulateScrub|timelineCanvasSmoke|timeline:canvas:verify|torture:bridge-fast' src scripts tests package.json
```

- `P0S_TIMELINE_REGISTRY_TEMPLATE`

```powershell
npm run test -- tests/unit/timelineArchitectureRegistry.test.ts
```

P0 smoke thresholds:

- Render/playback baseline: scenarios must cover 1, 4, and 16 visible clips.
  For each scenario, record average FPS, p95 frame delta, p95 render timing,
  cache evictions, dropped frame count, and browser errors. The readiness floor
  is no fatal browser error, no WebGPU device loss, render loop still running
  after the smoke, and no p95 frame delta above 250 ms in the steady-state
  sample. Numeric performance budgets become regression gates only after this
  baseline is refreshed on current HEAD.
- Export baseline: `debugExport` must cover fast and precise modes, 640x360
  and 1080p, audio on and audio off. Each run must return a non-empty blob or a
  clean timeout before `maxRuntimeMs`, monotonic progress, no device loss, and
  stable engine/render-target state before and after the run.
- Proxy/cache pressure: scrub at least three passes through the same proxy
  range. `VideoFrame`, decoder, object URL, and runtime-release counters must
  be recorded. If counters are missing, the gate remains open and the next
  packet is instrumentation-only.
- Audio context baseline: list live playback, scrub, recording, export, and
  diagnostic owners. Scrub/export contexts must be disposed after the action,
  and any retained context needs an owner and release condition.
- Preview target lifecycle: mount/unmount Preview, source monitor, and output
  targets three times. Target canvas count and render context count must return
  to the starting value after each cycle.
- CSS global selector gate: run `P0S_CSS_GLOBAL_SELECTOR`, classify each hit as
  allowed token/reset, component-owned overlay, active compatibility debt, or
  retired.

