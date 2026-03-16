# Domain 3: Services & Business Logic - Reviewer B Findings

## Summary
- Files audited: 109 (services: 87, hooks: 8, utils: 9, workers: 1)
- Docs reviewed: 9 (AI-Integration.md, Audio.md, Debugging.md, Project-Persistence.md, Native-Helper.md, Proxy-System.md, YouTube.md, CLAUDE.md sections 0.1/5/6, README.md)
- Critical gaps found: 4
- Inaccuracies found: 5
- Missing features: 3

---

## Gap Analysis

### 1. AI Tools Deep-Dive

**Doc claim:** 76 tools across 15 categories (AI-Integration.md)

**Source reality:** 76 tool definitions exist in `src/services/aiTools/definitions/` spread across 16 definition files (including `batch.ts` and `stats.ts`). The doc says 15 categories but the code has 16 definition groups (timeline, clips, tracks, preview, analysis, media, batch, youtube, transform, effects, keyframes, playback, transitions, masks, stats -- 15 exported arrays as listed, but the definition index imports from 15 separate files plus batch = 16 files total). The 15-category count in the doc is consistent if you count by the doc's table groupings.

**Handler registration issues (CRITICAL):**

| Issue | Detail |
|-------|--------|
| `openComposition` | Defined in `definitions/media.ts`, handler exists in `handlers/media.ts` (`handleOpenComposition`), but is NOT registered in `handlers/index.ts` dispatcher. AI calls to `openComposition` will return "Unknown tool" error. |
| `searchVideos` vs `searchYouTube` | Definition file `definitions/youtube.ts` defines tool name as `searchVideos`, but handler registry in `handlers/index.ts` registers it as `searchYouTube`. Name mismatch means AI calls `searchVideos` -> "Unknown tool" failure. |
| `executeBatch` | Has a definition but no handler in `handlers/index.ts`. This is intentional -- it is special-cased in `aiTools/index.ts` line 63. Correctly handled. |

**Handler categories in source (13 handler files):**
1. `handlers/timeline.ts` -- 3 handlers
2. `handlers/clips.ts` -- 14 handlers (includes `handleAddClipSegment` which is self-contained)
3. `handlers/tracks.ts` -- 4 handlers
4. `handlers/analysis.ts` -- 6 handlers
5. `handlers/preview.ts` -- 3 handlers
6. `handlers/media.ts` -- 9 handlers + 1 unregistered (`handleOpenComposition`)
7. `handlers/youtube.ts` -- 4 handlers
8. `handlers/transform.ts` -- 1 handler
9. `handlers/effects.ts` -- 4 handlers
10. `handlers/keyframes.ts` -- 3 handlers
11. `handlers/playback.ts` -- 8 handlers
12. `handlers/transitions.ts` -- 2 handlers
13. `handlers/masks.ts` -- 9 handlers
14. `handlers/batch.ts` -- 1 handler (imported separately)
15. `handlers/stats.ts` -- 4 handlers

Total registered: 74 in handler index + 1 batch (separate) = 75 active handlers out of 76 definitions (`openComposition` is dead).

**Undocumented AI tools infrastructure files:**
- `src/services/aiTools/executionState.ts` -- stagger budget system for visual animations (not in any doc)
- `src/services/aiTools/aiFeedback.ts` -- visual feedback (panel switching, canvas flash, marker animations) during AI execution (not in any doc)
- `src/services/aiTools/bridge.ts` -- HMR bridge for dev server, documented only in CLAUDE.md section 0.1

### 2. Monitoring Services Gap (CRITICAL -- Entirely Undocumented Subsystem)

The following monitoring services exist in `src/services/` but have zero dedicated documentation. The Debugging.md doc covers only `logger.ts` and `performanceMonitor.ts`. The rest form a comprehensive playback debugging pipeline that is completely undocumented:

| Service | File | Purpose |
|---------|------|---------|
| `playbackHealthMonitor` | `src/services/playbackHealthMonitor.ts` | Detects 8 anomaly types (FRAME_STALL, WARMUP_STUCK, RVFC_ORPHANED, SEEK_STUCK, READYSTATE_DROP, GPU_SURFACE_COLD, RENDER_STALL, HIGH_DROP_RATE) with auto-recovery |
| `playbackDebugStats` | `src/services/playbackDebugStats.ts` | Assembles aggregate playback stats from WC/VF monitors and health monitor |
| `playbackDebugSnapshot` | `src/services/playbackDebugSnapshot.ts` | Throttled snapshot wrapper (500ms) for playback debug stats |
| `framePhaseMonitor` | `src/services/framePhaseMonitor.ts` | Per-frame timing breakdown: stats/build/render/syncVideo/syncAudio/cache phases with p95/max stats |
| `vfPipelineMonitor` | `src/services/vfPipelineMonitor.ts` | Ring buffer for HTMLVideo+VideoFrame pipeline events (capture, read, drop, seek, drift, audio) - exposed as `window.__VF_PIPELINE__` |
| `wcPipelineMonitor` | `src/services/wcPipelineMonitor.ts` | Ring buffer for WebCodecs pipeline events (decode, seek, stall, queue pressure) - exposed as `window.__WC_PIPELINE__` |
| `scrubSettleState` | `src/services/scrubSettleState.ts` | State machine for scrub settle behavior (settle/retry/warmup stages with deadlines) |
| `renderScheduler` | `src/services/renderScheduler.ts` | Unified render loop for independent render targets (replaces PreviewRenderManager) |

These are production-critical services used by `useEngine.ts` and the layer builder. The FEATURES README mentions `framePhaseMonitor`, `playbackDebugStats`, `playbackHealthMonitor`, and `mediaRuntime` as "Engine internals" in a brief table row but provides no actual documentation of their APIs or behavior.

### 3. Service Dependency Graph (Not Documented)

No documentation exists for inter-service dependencies. Key dependency chains observed:

```
useEngine.ts
  -> layerBuilder (LayerBuilderService)
     -> VideoSyncManager -> mediaRuntime/runtimePlayback, proxyFrameCache
     -> AudioTrackSyncManager -> AudioSyncHandler -> audioRoutingManager
     -> FrameContext -> mediaStore, timelineStore
     -> PlayheadState -> vfPipelineMonitor
     -> LayerCache
  -> layerPlaybackManager -> compositionRenderer -> mediaRuntime
  -> renderScheduler -> compositionRenderer
  -> playbackDebugSnapshot -> playbackDebugStats -> wcPipelineMonitor, vfPipelineMonitor, playbackHealthMonitor
  -> framePhaseMonitor
  -> playbackHealthMonitor -> layerBuilder, engine

aiTools/index.ts -> handlers/index.ts -> handlers/* -> stores (timeline, media)
                 -> handlers/batch.ts -> executeToolInternal (recursive)
                 -> executionState.ts

projectSync.ts (barrel) -> project/projectSave.ts, projectLoad.ts, projectLifecycle.ts
projectFileService.ts (shim) -> project/index.ts -> ProjectFileService.ts
  -> core/ProjectCoreService (FSA) | core/NativeProjectCoreService (Native)
  -> core/FileStorageService | core/NativeFileStorageService
  -> domains/AnalysisService, CacheService, ProxyStorageService, RawMediaService, TranscriptService
```

### 4. Undocumented Files

#### Completely Undocumented Services (no dedicated docs or significant mentions)

| File | Purpose | Notes |
|------|---------|-------|
| `src/services/scrubSettleState.ts` | Scrub settle state machine | No docs |
| `src/services/renderScheduler.ts` | Unified render target scheduling | No docs |
| `src/services/ramPreviewEngine.ts` | RAM preview frame generation | No docs |
| `src/services/compositionRenderer.ts` | Composition evaluation for multi-preview | Mentioned briefly in Preview.md source list |
| `src/services/layerPlaybackManager.ts` | Background composition playback (Resolume-style) | Mentioned in UI-Panels.md source list only |
| `src/services/sceneDescriber.ts` | Qwen3-VL scene description via local Python server | No docs at all |
| `src/services/thumbnailCacheService.ts` | Source-based thumbnail cache (IndexedDB + memory) | No docs |
| `src/services/thumbnailRenderer.ts` | WebGPU-rendered thumbnails for nested compositions | No docs |
| `src/services/proxyFrameCache.ts` | Proxy frame loading, caching, LRU eviction, scrub audio | Mentioned only indirectly in Audio.md |
| `src/services/transcriptSync.ts` | Text-based transcript synchronization | No docs |
| `src/services/clipTranscriber.ts` | Per-clip transcription orchestration | No docs |
| `src/services/clipAnalyzer.ts` | Clip analysis (focus, motion, face detection via GPU optical flow) | No docs |
| `src/services/projectDB.ts` | IndexedDB persistence (6 stores) | Mentioned in Project-Persistence.md as related service |
| `src/services/fileSystemService.ts` | File picker, handle cache, permissions | Mentioned in Project-Persistence.md |
| `src/services/projectSync.ts` | Barrel re-export for project lifecycle | No docs |
| `src/services/projectFileService.ts` | Backward-compatibility shim | No docs |
| `src/services/googleFontsService.ts` | Google Fonts dynamic loading | Documented in Text-Clips.md only |
| `src/services/textRenderer.ts` | Canvas2D text rendering for GPU texture | Documented in Text-Clips.md only |
| `src/services/aiTools/executionState.ts` | AI execution state + stagger budget | No docs |
| `src/services/aiTools/aiFeedback.ts` | AI visual feedback (panel switching, canvas flash) | No docs |

#### Undocumented layerBuilder files

CLAUDE.md lists 3 files; the actual directory has 10:

| File | In CLAUDE.md? | In any doc? |
|------|---------------|-------------|
| `LayerBuilderService.ts` | Yes | Yes |
| `VideoSyncManager.ts` | Yes | Yes |
| `AudioSyncHandler.ts` | Yes | Audio.md |
| `AudioTrackSyncManager.ts` | No | Audio.md |
| `FrameContext.ts` | No | No |
| `LayerCache.ts` | No | No |
| `PlayheadState.ts` | No | No |
| `TransformCache.ts` | No | No |
| `types.ts` | No | No |
| `index.ts` | No | No |

#### Undocumented mediaRuntime files

CLAUDE.md mentions the directory; no file has dedicated documentation:

| File | Purpose |
|------|---------|
| `clipBindings.ts` | Binds clips to media source runtimes |
| `registry.ts` | Central registry of media source runtimes |
| `runtimePlayback.ts` | Interactive playback session management |
| `types.ts` | Type definitions for the runtime system |

#### Undocumented hooks

| Hook | In CLAUDE.md? | In any doc? |
|------|---------------|-------------|
| `useEngine.ts` | Yes | Yes (render pipeline section) |
| `useGlobalHistory.ts` | Mentioned in architecture | Debugging.md module table |
| `useMIDI.ts` | Mentioned in architecture | No dedicated docs |
| `useTheme.ts` | Mentioned in architecture | No dedicated docs |
| `useClipPanelSync.ts` | No | No |
| `useContextMenuPosition.ts` | No | No |
| `useThumbnailCache.ts` | No | No |
| `useIsMobile.ts` | No | No |

#### Undocumented utils

| Util | In any doc? |
|------|-------------|
| `dockLayout.ts` | No |
| `fileLoader.ts` | No |
| `maskRenderer.ts` | CLAUDE.md mentions it in architecture |
| `speedIntegration.ts` | Audio.md references speed integration concept |
| `transformComposition.ts` | No |
| `easing.ts` | No |
| `keyframeInterpolation.ts` | CLAUDE.md mentions it in architecture |
| `renderTargetVisibility.ts` | No |
| `previewPanelSource.ts` | No |

#### Worker

| File | Documented? |
|------|-------------|
| `transcriptionWorker.ts` | Mentioned in AI-Integration.md (Web Worker Support) but no detailed docs |

### 5. Inaccurate Documentation

| # | Location | Issue |
|---|----------|-------|
| 1 | AI-Integration.md "76 Tools across 15 Categories" | Doc lists `searchVideos` under YouTube tools, but the handler is registered as `searchYouTube`. The definition file uses `searchVideos`. This is a **code bug** (handler name mismatch), not just a doc issue. Tool calls to `searchVideos` will fail at runtime. |
| 2 | AI-Integration.md Media Panel section | Lists `openComposition` as a tool (10 tools total for Media Panel). The definition exists but the handler is **not registered** in the dispatcher. This tool is dead/broken. The actual working count for Media Panel is 9. |
| 3 | CLAUDE.md section 3 (Architecture) | Lists `layerBuilder/` as containing "LayerBuilderService, VideoSyncManager, AudioSyncHandler". The actual directory has 10 files including LayerCache, PlayheadState, FrameContext, TransformCache, AudioTrackSyncManager. |
| 4 | CLAUDE.md section 6 (Important Files) | Does not list any monitoring services, mediaRuntime, or project domain services. Only `src/services/layerBuilder/LayerBuilderService.ts` and `src/services/layerBuilder/VideoSyncManager.ts` are listed. |
| 5 | AI-Integration.md "Available Models" | Lists `GPT-5.2`, `GPT-5.2 Pro`, `GPT-5.1 Codex`, `GPT-5.1 Codex Mini`, etc. These model names should be verified against the actual AIChatPanel component (not in scope of this service audit, but the docs claim is load-bearing). |

### 6. Missing Features (post-2026-03-08)

Based on `git log --oneline --since="2026-03-08" -- src/services/`:

| Commit | Feature | Documentation Status |
|--------|---------|---------------------|
| `95304a59` (Add playback debug stats, enhanced video sync, AI tools improvements) | New playback debug stats system, enhanced monitoring | Not documented in any feature doc |
| `d02cce9c` + `7d7dadb7` + `2938c091` + `45921604` (stagger budget system) | Global stagger budget for AI visual delays -- `executionState.ts` updated with `setStaggerBudget`/`consumeStaggerDelay` | Not documented |
| `6c203dd9` (native helper AI bridge) | AI bridge endpoint via Native Helper (`POST /api/ai-tools`) | Documented in Native-Helper.md (confirmed present) |
| `4222d746` (Unify clip warmup and playback stop) | Refactored warmup/playback stop handling | Not documented |
| `535786fc` + `a472c428` (scrubbing stability + telemetry) | scrubSettleState improvements, vfPipelineMonitor telemetry | Not documented |
| `696b4f20` (source-based thumbnail cache) | `thumbnailCacheService.ts`, `useThumbnailCache` hook | Not documented |
| `4abf7603` (Firefox project persistence) | `NativeProjectCoreService.ts`, `NativeFileStorageService.ts` | Documented in Project-Persistence.md (confirmed present) |

### 7. Stale References

| Location | Reference | Issue |
|----------|-----------|-------|
| `piApiService.ts` line 2 comment | "Supports: Kling, Luma, Veo, Sora2, Wanx, Hailuo, SkyReels, Hunyuan, etc." | Veo and Sora2 are NOT in `DEFAULT_VIDEO_PROVIDERS`. Comment is aspirational/stale. |
| CLAUDE.md section 6 | `src/services/project/core/ProjectCoreService.ts` listed as "Project Storage" | This is only the FSA backend. The parallel Native backend (`NativeProjectCoreService.ts`) is not listed. |
| Audio.md source list | `src/services/layerBuilder/AudioSyncHandler.ts` | Correct, but `AudioTrackSyncManager.ts` is also referenced in the doc body but uses the class name `AudioTrackSyncManager`, which matches the file. OK. |
| API-Integration.md "Multicam EDL" | Model listed as `claude-sonnet-4-20250514` | This model string should be verified against `claudeService.ts` -- cannot confirm without reading full file, but date format suggests it may be stale if newer model versions exist. |

### 8. Project Domain Services Documentation

The following domain services exist in `src/services/project/domains/` and are listed in the Project-Persistence.md architecture tree but have no API documentation:

| Service | Purpose | Documented? |
|---------|---------|-------------|
| `AnalysisService.ts` | Range-based analysis caching to `Analysis/{mediaId}.json` | Listed in architecture tree only |
| `CacheService.ts` | Thumbnail + waveform caching to `Cache/thumbnails/` and `Cache/waveforms/` | Listed in architecture tree only |
| `ProxyStorageService.ts` | Proxy frame and audio file storage | Listed in architecture tree only |
| `RawMediaService.ts` | Raw folder copy, deduplication, relink | Listed in architecture tree only |
| `TranscriptService.ts` | Transcript persistence with range tracking | Listed in architecture tree only |

Project-Persistence.md has an excellent architecture section listing these files, but none have their API methods or data formats documented.

### 9. Documentation Quality Issues

| Issue | Detail |
|-------|--------|
| No service dependency diagram | The dependency relationships between layerBuilder, mediaRuntime, monitoring services, and the engine are complex but nowhere visualized |
| Monitoring subsystem invisible | 8 monitoring services form a cohesive debugging pipeline; Debugging.md covers only logger and performanceMonitor |
| mediaRuntime undocumented | This is a core playback abstraction (registry, sessions, frame providers) with zero documentation |
| Hook documentation scattered | Hooks are mentioned in CLAUDE.md architecture tree but 5 of 8 have no documentation anywhere |
| `apiKeyManager.ts` supports `klingAccessKey`/`klingSecretKey` | Not documented in AI-Integration.md configuration section |

---

## Recommended Changes

### Critical (Fix Immediately)

1. **Fix `searchVideos` handler name mismatch**: Either rename the definition to `searchYouTube` or rename the handler registration to `searchVideos`. This is a runtime bug where AI tool calls to `searchVideos` will fail silently.

2. **Register `openComposition` handler**: Add `openComposition: handleOpenComposition` to the `mediaHandlers` map in `handlers/index.ts` and import it. Alternatively, if intentionally disabled, remove it from definitions and update the doc (Media Panel tool count from 10 to 9).

3. **Update AI-Integration.md tool count**: If `openComposition` remains broken, update Media Panel tools from 10 to 9.

### High Priority (Doc Gaps)

4. **Create Monitoring & Debugging Pipeline doc** or extend Debugging.md to cover: `playbackHealthMonitor` (8 anomaly types, auto-recovery), `framePhaseMonitor` (per-frame phase timing), `wcPipelineMonitor` and `vfPipelineMonitor` (ring buffers, `window.__WC_PIPELINE__` / `window.__VF_PIPELINE__`), `playbackDebugStats` + `playbackDebugSnapshot`, `scrubSettleState`.

5. **Document mediaRuntime subsystem**: This is the core media source abstraction (registry, decode sessions, frame providers, clip bindings). It deserves at least a section in GPU-Engine.md or a standalone doc.

6. **Document layerBuilder fully**: The directory has 10 files but only 3 are listed in CLAUDE.md. At minimum, update CLAUDE.md section 3 and section 6.

### Medium Priority

7. **Add API documentation for project domain services**: AnalysisService, CacheService, ProxyStorageService, RawMediaService, TranscriptService have no API docs despite being listed in the architecture tree.

8. **Document the stagger budget system**: `executionState.ts` manages visual animation budgets across AI tool operations. This should be documented in AI-Integration.md.

9. **Update CLAUDE.md section 6** to include critical services: monitoring services, mediaRuntime, project domain services, at minimum.

10. **Document remaining hooks**: `useClipPanelSync`, `useContextMenuPosition`, `useThumbnailCache`, `useIsMobile` are completely undocumented.

### Low Priority

11. **Remove stale Veo/Sora2 comment** from `piApiService.ts` line 2, or add those providers.

12. **Document `sceneDescriber.ts`**: Uses local Qwen3-VL Python server (port 5555) for scene description. This is a completely undocumented feature.

13. **Document `apiKeyManager.ts` Kling key support** in AI-Integration.md configuration section.
