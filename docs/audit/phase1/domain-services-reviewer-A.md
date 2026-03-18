# Domain 3: Services & Business Logic - Reviewer A Findings

## Summary
- Files audited: 88 source files (39 standalone services, 12 layerBuilder, 4 mediaRuntime, 13 project/, 4 nativeHelper, 4 sam2, 6 aiTools core + 17 handlers + 15 definitions, 8 hooks, 9 utils, 1 worker)
- Docs reviewed: 7 feature docs (AI-Integration, Audio, Debugging, Project-Persistence, Native-Helper, Proxy-System, YouTube) + CLAUDE.md sections 0.1, 5, 6
- Critical gaps found: 5
- Inaccuracies found: 12
- Missing features: 8

---

## Gap Analysis

### Undocumented Files

The following source files have **NO dedicated documentation** in any of the 7 reviewed feature docs or CLAUDE.md sections 0.1/5/6. Some are briefly mentioned in `docs/Features/README.md` but have zero feature-level documentation.

#### Monitoring Services (completely undocumented -- 7 files)
| File | Purpose |
|------|---------|
| `src/services/playbackHealthMonitor.ts` | Anomaly detection (8 types: FRAME_STALL, WARMUP_STUCK, RVFC_ORPHANED, SEEK_STUCK, READYSTATE_DROP, GPU_SURFACE_COLD, RENDER_STALL, HIGH_DROP_RATE), auto-recovery, per-clip escalation |
| `src/services/playbackDebugStats.ts` | Aggregated playback debug stats builder: WC timeline summary, VF timeline summary, cadence/FPS/drift/stall metrics |
| `src/services/playbackDebugSnapshot.ts` | Throttled snapshot provider for playback debug stats, used by AI stats handler |
| `src/services/framePhaseMonitor.ts` | Per-frame phase timing (stats/build/render/syncVideo/syncAudio/cache), ring buffer with p95/max summaries |
| `src/services/vfPipelineMonitor.ts` | VF (HTMLVideo+VideoFrame) pipeline event ring buffer (30+ event types), exposed as `window.__VF_PIPELINE__` |
| `src/services/wcPipelineMonitor.ts` | WebCodecs pipeline event ring buffer (21 event types), exposed as `window.__WC_PIPELINE__` |
| `src/services/scrubSettleState.ts` | Scrub settle/retry/warmup state machine for precise frame landing after scrub-stop |

These monitoring services are the backbone of the AI `getPlaybackTrace` / `getStats` tools and are critical for debugging playback issues. The Debugging.md doc covers `Logger` and `PerformanceStats` but has zero mention of any of these 7 services.

#### Runtime & Playback Services (undocumented -- 5 files)
| File | Purpose |
|------|---------|
| `src/services/mediaRuntime/clipBindings.ts` | Binds timeline clips to runtime source descriptors, creates decode sessions |
| `src/services/mediaRuntime/registry.ts` | Central registry for media source runtimes, sessions, frame caching |
| `src/services/mediaRuntime/runtimePlayback.ts` | Interactive/background/export playback session management, WebCodecs player integration |
| `src/services/mediaRuntime/types.ts` | Core type definitions: RuntimeFrameProvider, DecodeSession, MediaSourceRuntime, FrameHandle |
| `src/services/renderScheduler.ts` | Unified render loop for independent render targets (multi-preview, output manager), replaces PreviewRenderManager |

The `mediaRuntime` subsystem is only mentioned in `docs/Features/README.md` in a one-line table entry. There is no dedicated feature documentation explaining the runtime architecture, session policies (interactive/background/export/ram-preview), or the frame provider abstraction.

#### Composition & Rendering Services (undocumented -- 3 files)
| File | Purpose |
|------|---------|
| `src/services/compositionRenderer.ts` | Evaluates any composition at a given time, returns renderable layers; enables multi-preview |
| `src/services/layerPlaybackManager.ts` | Background composition playback for Resolume-style multi-layer mode (A-D slot layers) |
| `src/services/ramPreviewEngine.ts` | Generates cached frames for RAM preview playback, extracted from playbackSlice |

#### Analysis & AI Services (undocumented -- 4 files)
| File | Purpose |
|------|---------|
| `src/services/sceneDescriber.ts` | Uses local Qwen3-VL Python server (localhost:5555) for native video understanding with temporal reasoning |
| `src/services/clipAnalyzer.ts` | Clip analysis (focus, motion via GPU optical flow, brightness) with background processing |
| `src/services/clipTranscriber.ts` | Multi-provider clip transcription orchestrator (local Whisper, OpenAI, AssemblyAI, Deepgram) |
| `src/services/transcriptSync.ts` | Transcript-based clip synchronization using longest common subsequence matching |

The `sceneDescriber.ts` service (Qwen3-VL integration) is mentioned in `docs/Features/UI-Panels.md` but has no documentation in the audited feature docs. The `clipAnalyzer` and `clipTranscriber` are the actual implementations behind the AI tools `startClipAnalysis` / `startClipTranscription` but are not documented.

#### Other Undocumented Services (5 files)
| File | Purpose |
|------|---------|
| `src/services/thumbnailCacheService.ts` | Source-based thumbnail cache (1/sec per media file), IndexedDB + in-memory, subscription-based updates |
| `src/services/googleFontsService.ts` | Dynamic Google Fonts loading, top 50 fonts, FontFace API |
| `src/services/proxyFrameCache.ts` | JPEG proxy frame cache (900 frames LRU), preloading, scrub audio via proxy |
| `src/services/projectSync.ts` | Project sync shim (re-exports from projectLifecycle) |
| `src/services/projectFileService.ts` | Singleton re-export shim for ProjectFileService |

#### Undocumented Hooks (4 of 8)
| File | Purpose |
|------|---------|
| `src/hooks/useClipPanelSync.ts` | Auto-activates Properties panel when clip is selected |
| `src/hooks/useContextMenuPosition.ts` | Adjusts context menu position to stay within viewport |
| `src/hooks/useIsMobile.ts` | Mobile device detection (userAgentData API + UA fallback) |
| `src/hooks/useThumbnailCache.ts` | React hook for source-based thumbnail cache subscription |

#### Undocumented Utils (6 of 9)
| File | Purpose |
|------|---------|
| `src/utils/dockLayout.ts` | Dock layout tree manipulation (find, insert, remove, split nodes) |
| `src/utils/easing.ts` | Easing type normalization and alias resolution |
| `src/utils/previewPanelSource.ts` | Preview panel source type creation and normalization |
| `src/utils/renderTargetVisibility.ts` | Render target visibility checks (document visibility, canvas area, window state) |
| `src/utils/speedIntegration.ts` | Speed curve integration for variable-speed playback (trapezoidal) |
| `src/utils/transformComposition.ts` | Parent-child transform composition (After Effects-style parenting) |

#### Undocumented AI Tools Sub-modules (3 files)
| File | Purpose |
|------|---------|
| `src/services/aiTools/aiFeedback.ts` | Visual feedback during AI execution (panel switching, preview flash, marker/keyframe animation) |
| `src/services/aiTools/executionState.ts` | AI execution state tracking and stagger budget system for visual delays |
| `src/services/aiTools/bridge.ts` | HMR bridge connecting browser to Vite dev server for external AI agents |

---

### Inaccurate Documentation

#### 1. CRITICAL: AI Tool Count Mismatch
- **Location:** `docs/Features/AI-Integration.md:5`, `docs/Features/AI-Integration.md:50`, `docs/Features/AI-Integration.md:232`
- **Issue:** Documentation says "76 tools across 15 categories." The definition files contain **76 tool definitions across 15 definition files**. However, only **74 tools are actually registered and callable** in the handler dispatch (`handlers/index.ts`). Two tools are defined but broken:
  - `openComposition` -- defined in `definitions/media.ts:144`, handler exists in `handlers/media.ts:192`, but NOT imported or registered in `handlers/index.ts` mediaHandlers. Calling this tool returns "Unknown tool" error.
  - `searchVideos` -- defined in `definitions/youtube.ts:9` with name `searchVideos`, but the handler registry in `handlers/index.ts:213` maps `searchYouTube` (not `searchVideos`). The AI will call `searchVideos` (the name from the definition), which won't match `searchYouTube` in the registry.
- **Impact:** These are functional bugs, not just doc issues. Two AI tools silently fail.

#### 2. CRITICAL: AI Tool Category Count
- **Location:** `docs/Features/AI-Integration.md:232`
- **Issue:** Header says "15 Categories" but the doc body lists **16 sub-sections** (Clip Info, Clip Editing, Selection are counted as separate categories in the doc but are a single `clips` definition file). The actual definition structure has 15 files. The doc should either say "15 definition groups" or restructure to match.

#### 3. CLAUDE.md Section 0.1: Debug Tools Count
- **Location:** `CLAUDE.md:20`
- **Issue:** Says "4 Debug-Tools" (`getStats`, `getStatsHistory`, `getLogs`, `getPlaybackTrace`). This is correct for the HTTP bridge. However, the AI tools stats handler (`handlers/stats.ts`) now accesses `playbackDebugSnapshot`, `playbackDebugStats`, `playbackHealthMonitor`, `vfPipelineMonitor`, and `wcPipelineMonitor` -- these backend services are completely undocumented.

#### 4. Whisper Model Name
- **Location:** `docs/Features/AI-Integration.md:407`
- **Issue:** Says "`Xenova/whisper-tiny` model". The actual code uses different models per language:
  - English: `Xenova/whisper-tiny.en` (in `transcriptionWorker.ts:29`)
  - Other languages: `onnx-community/whisper-tiny` (in `transcriptionWorker.ts:32`)
  - Legacy `whisperService.ts` still uses `Xenova/whisper-tiny` (line 50)
- **Fix:** Update to describe the language-aware model selection.

#### 5. Kling Version List
- **Location:** `docs/Features/AI-Integration.md:99`
- **Issue:** Lists Kling versions as "v2.6, v2.5, v2.1, v1.6, v1.5". The code (`piApiService.ts:32`) has `['2.6', '2.5', '2.1', '2.1-master', '1.6', '1.5']` -- missing `2.1-master` variant.

#### 6. CLAUDE.md Architecture: Incomplete Service Listings
- **Location:** `CLAUDE.md:163`
- **Issue:** The `(standalone)` line lists only "logger, audioManager, thumbnailRenderer, whisperService, etc." There are **39 standalone service files**. The `etc.` hides 35 services. Key omissions:
  - All 7 monitoring services
  - `renderScheduler`, `layerPlaybackManager`, `compositionRenderer`, `ramPreviewEngine`
  - `clipAnalyzer`, `clipTranscriber`, `sceneDescriber`, `transcriptSync`
  - `proxyFrameCache`, `proxyGenerator`, `apiKeyManager`
  - `audioRoutingManager`, `audioSync`, `audioAnalyzer`, `audioExtractor`, `compositionAudioMixer`

#### 7. CLAUDE.md Architecture: Missing layerBuilder File
- **Location:** `CLAUDE.md:155` (layerBuilder service listing)
- **Issue:** Lists "LayerBuilderService, VideoSyncManager, AudioSyncHandler, AudioTrackSyncManager, FrameContext, TransformCache, PlayheadState" but omits `LayerCache.ts` which was added for layer caching optimization.

#### 8. CLAUDE.md Architecture: Hooks Incomplete
- **Location:** `CLAUDE.md:164`
- **Issue:** Lists "useEngine, useGlobalHistory, useMIDI, useTheme, ..." -- missing `useClipPanelSync`, `useContextMenuPosition`, `useIsMobile`, `useThumbnailCache` (4 of 8 hooks unlisted).

#### 9. CLAUDE.md Architecture: Utils Incomplete
- **Location:** `CLAUDE.md:165`
- **Issue:** Lists "keyframeInterpolation, maskRenderer, fileLoader, etc." -- missing `dockLayout`, `easing`, `previewPanelSource`, `renderTargetVisibility`, `speedIntegration`, `transformComposition` (6 of 9 utils unlisted).

#### 10. AI-Integration.md: YouTube Tool Name Discrepancy
- **Location:** `docs/Features/AI-Integration.md:313`
- **Issue:** Doc lists `searchVideos` as the YouTube search tool name. The handler dispatch registers it as `searchYouTube`. This means the doc accurately reflects the *definition* but not the *working implementation*. The tool `searchVideos` will fail at runtime.

#### 11. AI-Integration.md: Missing `addClipSegment` Tool
- **Location:** `docs/Features/AI-Integration.md:249-259`
- **Issue:** The Clip Editing section lists 10 tools including `addClipSegment`. This is actually correct in the doc. However, `addClipSegment` is registered as a selfContainedHandler (not a timeline handler), which is an architectural detail worth noting.

#### 12. Debugging.md: Missing Monitoring Infrastructure
- **Location:** `docs/Features/Debugging.md` (entire file)
- **Issue:** Covers Logger and PerformanceStats/PerformanceMonitor well, but completely omits:
  - PlaybackHealthMonitor (anomaly detection and auto-recovery)
  - PlaybackDebugStats/PlaybackDebugSnapshot (aggregated stats builder)
  - FramePhaseMonitor (per-frame timing breakdown)
  - VfPipelineMonitor (HTMLVideo pipeline events, `window.__VF_PIPELINE__`)
  - WcPipelineMonitor (WebCodecs pipeline events, `window.__WC_PIPELINE__`)
  - ScrubSettleState (scrub settle state machine)
  These are the primary debugging tools for playback issues and are exposed as window globals.

---

### Missing Features (post-2026-03-08 or never documented)

#### 1. AI Visual Feedback System (`aiFeedback.ts`, `executionState.ts`)
Added visual feedback during AI tool execution: panel/tab switching, preview canvas flash effects (shutter, undo, redo, import), marker animations, keyframe animations, and a stagger budget system that spreads visual delays across batch operations.

#### 2. AI Stagger Budget System (`executionState.ts`)
A budget-based animation system that allocates a total time budget (default 3s) across sequential AI operations, spreading visual stagger delays evenly. When the budget is spent, remaining steps execute instantly.

#### 3. LayerCache (`LayerCache.ts`)
Layer caching system that uses reference equality and frame quantization for change detection, avoiding full layer rebuilds every frame. Tracks cache hit/miss statistics.

#### 4. Scene Description via Qwen3-VL (`sceneDescriber.ts`)
Local AI video understanding service using a Python server running Qwen3-VL at localhost:5555. Generates scene segment descriptions with temporal reasoning for video clips. Not documented anywhere in the feature docs reviewed.

#### 5. Render Scheduler (`renderScheduler.ts`)
Unified render loop for independent render targets that replaced PreviewRenderManager. Handles composition, layer, and slot sources independently from the main render loop with nested composition caching.

#### 6. Playback Health Monitor Escalation
The `playbackHealthMonitor.ts` implements per-clip escalation: if a clip triggers 3+ anomalies within 12 seconds, it escalates to more aggressive recovery (e.g., disabling WebCodecs for that clip). This is completely undocumented.

#### 7. Pipeline Monitor Window Globals
`vfPipelineMonitor` is exposed as `window.__VF_PIPELINE__` and `wcPipelineMonitor` as `window.__WC_PIPELINE__` for console debugging. These are not mentioned in Debugging.md.

#### 8. API Key Manager: Kling Keys
`apiKeyManager.ts:13` supports `klingAccessKey` and `klingSecretKey` as separate API key types, in addition to the PiAPI key. This suggests direct Kling API access capability that is not documented.

---

### Stale References

| Location | Issue | Current Value | Should Be |
|----------|-------|---------------|-----------|
| `AI-Integration.md:5` | Tool count | "76 tools" | "76 defined, 74 callable (2 broken)" or fix the 2 bugs |
| `AI-Integration.md:232` | Category count | "15 Categories" | "15 definition groups (16 sub-sections in doc)" -- ambiguous |
| `CLAUDE.md:20` | Debug tool count | "4 Debug-Tools" | Correct, but should mention the 7 undocumented monitoring backends |
| `AI-Integration.md:407` | Whisper model | "Xenova/whisper-tiny" | Language-dependent: `Xenova/whisper-tiny.en` (EN) / `onnx-community/whisper-tiny` (other) |
| `AI-Integration.md:99` | Kling versions | "v2.6, v2.5, v2.1, v1.6, v1.5" | Add "v2.1-master" |
| `CLAUDE.md:163` | Standalone services | "logger, audioManager, thumbnailRenderer, whisperService, etc." | 39 services exist; either list key ones or reference a full listing |

---

### Documentation Quality Issues

#### 1. No Feature Doc for Media Runtime System
The `mediaRuntime/` subsystem (4 files, ~36KB of code) is the abstraction layer between timeline clips and actual decode sessions. It manages source resolution, session lifecycle, frame caching, and WebCodecs player integration. This is a critical architectural component with zero feature documentation.

#### 2. No Feature Doc for Playback Monitoring
The 7 monitoring services (~95KB of code) form the diagnostic backbone of the playback system. They are the data sources for the AI `getPlaybackTrace` and `getStats` tools. Without documentation, debugging playback issues requires reading the source code directly.

#### 3. AI-Integration.md Lacks Implementation Details
The AI tools section lists tools and parameters but doesn't explain:
- The visual feedback system (flash effects, panel switching)
- The stagger budget mechanism for batch operations
- The HMR bridge vs Native Helper bridge distinction
- How the AI bridge works in production (Native Helper) vs development (HMR/Vite)
- The `executionState` module and how AI execution is tracked

#### 4. Debugging.md Missing Console Globals
The doc describes `window.Logger` but doesn't mention:
- `window.__WC_PIPELINE__` (WebCodecs pipeline monitor)
- `window.__VF_PIPELINE__` (VF pipeline monitor)
- These are primary debugging tools for playback issues.

#### 5. Audio.md: Complete but Doesn't Cover New Services
Audio.md is well-structured and covers audioManager, audioRoutingManager, audioSync, audioAnalyzer, audioExtractor, compositionAudioMixer, and the layerBuilder audio components. It is the most complete feature doc reviewed. Minor gap: the `proxyFrameCache.playScrubAudio()` method is mentioned but `proxyFrameCache.ts` itself is not in the Source list.

#### 6. Project-Persistence.md: Well-Structured, Minor Gap
Comprehensive coverage of both FSA and Native backends. Minor: `projectSync.ts` is listed in the task but is just a re-export shim; the actual sync logic is in `projectLifecycle.ts` which IS documented.

---

## Recommended Changes

### Priority 1: Fix Bugs (not just doc updates)
1. **Register `openComposition` handler** in `src/services/aiTools/handlers/index.ts` -- add import and entry in `mediaHandlers`
2. **Fix `searchVideos`/`searchYouTube` naming mismatch** -- either rename the handler registry entry to `searchVideos` (matching the definition) or rename the definition to `searchYouTube`

### Priority 2: Critical Documentation Gaps
3. **Create `docs/Features/Playback-Monitoring.md`** covering all 7 monitoring services, their anomaly types, auto-recovery behavior, console globals (`__WC_PIPELINE__`, `__VF_PIPELINE__`), and how they feed the AI stats tools
4. **Update `docs/Features/Debugging.md`** to add a "Playback Pipeline Monitoring" section with references to the pipeline monitors and health monitor
5. **Update AI tool count** in `AI-Integration.md` once bugs are fixed (should be 76 callable tools)

### Priority 3: Architecture Accuracy
6. **Update `CLAUDE.md` section 3** (Architecture): Add `LayerCache` to layerBuilder listing; expand standalone services list to include at minimum the monitoring services, mediaRuntime, and rendering services
7. **Update `CLAUDE.md` hooks/utils listings** to include all 8 hooks and 9 utils

### Priority 4: Feature Documentation
8. **Add mediaRuntime documentation** -- either a standalone doc or a section in an existing feature doc explaining source resolution, session policies, frame caching
9. **Add sceneDescriber documentation** to AI-Integration.md (Qwen3-VL integration)
10. **Update AI-Integration.md** to document:
    - Visual feedback system (aiFeedback.ts)
    - Stagger budget mechanism
    - Bridge architecture (HMR vs Native Helper)
    - The distinction between tool definitions and handler registration

### Priority 5: Minor Fixes
11. **Fix Whisper model name** in AI-Integration.md (language-dependent selection)
12. **Add Kling v2.1-master** to version list in AI-Integration.md
13. **Add `proxyFrameCache.ts` to Audio.md source list** (for scrub audio)
14. **Document Kling direct API keys** (klingAccessKey/klingSecretKey) in API Keys section
