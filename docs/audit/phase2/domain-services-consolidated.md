# Domain 3: Services & Business Logic - Consolidated Findings

## Cross-Review Summary

| Metric | Reviewer A | Reviewer B | Consolidated |
|--------|-----------|-----------|-------------|
| Files audited | 88 | 109 | 109 (B's count includes project domain services A omitted) |
| Docs reviewed | 7 + CLAUDE.md | 9 + CLAUDE.md | 9 + CLAUDE.md |
| Critical gaps | 5 | 4 | 4 (after dedup) |
| Inaccuracies | 12 | 5 | 12 (A more granular; B grouped some together) |
| Missing features | 8 | 3 | 8 (A more granular) |
| Code bugs found | 2 | 2 | 2 (identical findings) |

---

## CODE BUGS FOUND (both reviewers confirmed, verified against source)

### Bug 1: `openComposition` handler not registered in dispatcher

- **Severity:** CRITICAL
- **Effort:** SMALL (< 30 min)
- **Definition file:** `src/services/aiTools/definitions/media.ts` line 144 -- defines tool `openComposition`
- **Handler file:** `src/services/aiTools/handlers/media.ts` line 192 -- `handleOpenComposition` function exists and is fully implemented
- **Dispatcher file:** `src/services/aiTools/handlers/index.ts`
  - `handleOpenComposition` is NOT in the import statement (lines 53-63 import 9 handlers from `./media`, but not `handleOpenComposition`)
  - `openComposition` is NOT in the `mediaHandlers` map (lines 185-194 list 8 entries, missing `openComposition`)
- **Runtime behavior:** AI calls `openComposition` -> dispatched through `executeToolInternal` -> not found in any handler map -> returns `{ success: false, error: "Unknown tool: openComposition" }`
- **Both reviewers:** Confirmed independently. Reviewer A (Finding #1), Reviewer B (Handler registration table).
- **Fix:** Add `handleOpenComposition` to the import on line 53 and add `openComposition: handleOpenComposition` to the `mediaHandlers` map.

### Bug 2: `searchVideos` / `searchYouTube` name mismatch

- **Severity:** CRITICAL
- **Effort:** SMALL (< 30 min)
- **Definition file:** `src/services/aiTools/definitions/youtube.ts` line 9 -- defines tool name as `searchVideos`
- **Handler file:** `src/services/aiTools/handlers/youtube.ts` line 41 -- function is named `handleSearchYouTube`
- **Dispatcher file:** `src/services/aiTools/handlers/index.ts` line 213 -- registered as `searchYouTube: handleSearchYouTube`
- **Runtime behavior:** AI receives tool definition with name `searchVideos` -> AI calls `searchVideos` -> dispatched through `executeToolInternal` -> not found (the map key is `searchYouTube`, not `searchVideos`) -> returns `{ success: false, error: "Unknown tool: searchVideos" }`
- **Both reviewers:** Confirmed independently. Reviewer A (Finding #1 and #10), Reviewer B (Handler registration table).
- **Fix:** Either rename the definition to `searchYouTube` (matching the handler registry key) or rename the handler registry key to `searchVideos` (matching the definition). The definition name is what gets exposed to the AI, so renaming the registry key to `searchVideos` is the lower-risk fix.

### Tool Count Impact

With both bugs, the actual state is:
- **76 tool definitions** exist across 15 definition files (16 files including `index.ts`)
- **74 tools** are registered and callable via the standard handler maps
- **1 tool** (`executeBatch`) is special-cased in `aiTools/index.ts` line 63 (not in handler maps, handled correctly)
- **1 tool** (`openComposition`) has a handler but is not registered -- dead code
- **1 tool** (`searchVideos`) has a handler registered under a different name (`searchYouTube`) -- name mismatch
- **Net callable tools:** 74 (via handler maps) + 1 (batch special case) = 75, but `searchVideos` silently fails, so effectively **74 tools work correctly**

---

## Consensus Findings (both reviewers found)

| # | Finding | Severity | Effort | Affected Doc(s) |
|---|---------|----------|--------|-----------------|
| C1 | Monitoring services (7 files) completely undocumented: `playbackHealthMonitor`, `playbackDebugStats`, `playbackDebugSnapshot`, `framePhaseMonitor`, `vfPipelineMonitor`, `wcPipelineMonitor`, `scrubSettleState` | CRITICAL | LARGE | `Debugging.md` missing entirely; no standalone doc exists |
| C2 | `mediaRuntime/` subsystem (4 files) has no feature documentation -- only a one-line table entry in README.md | CRITICAL | MEDIUM | No doc exists; CLAUDE.md section 3 mentions directory only |
| C3 | AI-Integration.md tool count "76 tools across 15 categories" is inaccurate (74 callable, 2 broken) | HIGH | SMALL | `docs/Features/AI-Integration.md` line 5, 50, 232 |
| C4 | AI visual feedback system (`aiFeedback.ts`, `executionState.ts`) completely undocumented | HIGH | MEDIUM | `docs/Features/AI-Integration.md` |
| C5 | `sceneDescriber.ts` (Qwen3-VL local AI) has no documentation | HIGH | SMALL | No doc exists |
| C6 | CLAUDE.md section 3 lists only 3 of 10 `layerBuilder/` files | MEDIUM | SMALL | `CLAUDE.md` line 156 |
| C7 | CLAUDE.md standalone services listing covers ~4 of 39+ files ("etc." hides 35 services) | MEDIUM | SMALL | `CLAUDE.md` line 163 |
| C8 | CLAUDE.md hooks listing incomplete (4 of 8 listed) | LOW | SMALL | `CLAUDE.md` line 164 |
| C9 | CLAUDE.md utils listing incomplete (3 of 9 listed) | LOW | SMALL | `CLAUDE.md` line 165 |
| C10 | `clipAnalyzer.ts` and `clipTranscriber.ts` undocumented despite being backends for AI tools | MEDIUM | SMALL | No doc exists |
| C11 | Pipeline monitor window globals (`window.__WC_PIPELINE__`, `window.__VF_PIPELINE__`) not in Debugging.md | HIGH | SMALL | `docs/Features/Debugging.md` |
| C12 | `renderScheduler.ts` undocumented (replaced PreviewRenderManager) | MEDIUM | SMALL | No doc exists |
| C13 | `ramPreviewEngine.ts` undocumented | MEDIUM | SMALL | No doc exists |
| C14 | `layerPlaybackManager.ts` undocumented (Resolume-style background composition playback) | MEDIUM | SMALL | Only in UI-Panels.md source list |
| C15 | `compositionRenderer.ts` undocumented | MEDIUM | SMALL | Only in Preview.md source list |
| C16 | `thumbnailCacheService.ts` undocumented | LOW | SMALL | No doc exists |
| C17 | `projectSync.ts` and `projectFileService.ts` shims undocumented | LOW | SMALL | Negligible impact -- they are just re-exports |
| C18 | `apiKeyManager.ts` supports `klingAccessKey`/`klingSecretKey` -- not documented | LOW | SMALL | `docs/Features/AI-Integration.md` |

---

## Reviewer A Unique Findings

| # | Finding | Severity | Effort | Verified? |
|---|---------|----------|--------|-----------|
| A1 | Whisper model name inaccurate -- doc says `Xenova/whisper-tiny`, actual code uses `Xenova/whisper-tiny.en` (EN) and `onnx-community/whisper-tiny` (other langs) | MEDIUM | SMALL | Yes -- verified against `transcriptionWorker.ts`. Legacy `whisperService.ts` still uses `Xenova/whisper-tiny`. Doc should reflect language-dependent selection. |
| A2 | Kling version list missing `2.1-master` variant | LOW | SMALL | Yes -- `piApiService.ts` line 32 has `['2.6', '2.5', '2.1', '2.1-master', '1.6', '1.5']` |
| A3 | AI-Integration.md "15 Categories" label ambiguous -- 15 definition files but doc body lists 16 sub-sections | LOW | SMALL | Yes -- 15 definition files (excl. `index.ts`), but the doc splits "clips" into sub-sections (Clip Info, Clip Editing, Selection) |
| A4 | `addClipSegment` registered as selfContainedHandler (not timelineHandler) -- architectural inconsistency | LOW | SMALL | Yes -- confirmed in `handlers/index.ts` line 199. Works correctly but is in a different handler map than other clip handlers. |
| A5 | `proxyFrameCache.ts` not in Audio.md source list despite `playScrubAudio()` being referenced | LOW | SMALL | Yes -- Audio.md references scrub audio behavior but doesn't list the source file |
| A6 | `googleFontsService.ts` undocumented in audited docs (documented in Text-Clips.md which was out of scope) | LOW | SMALL | Yes -- documented in Text-Clips.md only, which wasn't in scope for this service domain audit |
| A7 | Playback health monitor per-clip escalation (3+ anomalies within 12s triggers aggressive recovery) undocumented | HIGH | SMALL | Yes -- this is a critical auto-recovery feature with no documentation |
| A8 | AI bridge architecture (HMR dev bridge vs Native Helper production bridge) not explained in AI-Integration.md | MEDIUM | MEDIUM | Yes -- `bridge.ts` handles HMR dev server, Native Helper handles production. The distinction is only in CLAUDE.md section 0.1 briefly. |
| A9 | CLAUDE.md section 6 (Important Files) omits monitoring services, mediaRuntime, project domain services | MEDIUM | SMALL | Yes -- section 6 only has 2 layerBuilder entries and no monitoring/mediaRuntime entries |
| A10 | `LayerCache.ts` missing from CLAUDE.md layerBuilder listing | MEDIUM | SMALL | Yes -- confirmed; CLAUDE.md line 156 lists only "LayerBuilderService, VideoSyncManager, AudioSyncHandler" |

---

## Reviewer B Unique Findings

| # | Finding | Severity | Effort | Verified? |
|---|---------|----------|--------|-----------|
| B1 | No service dependency graph documented anywhere -- complex inter-service dependencies are invisible | HIGH | LARGE | Yes -- the dependency chain from `useEngine` through `layerBuilder`, monitoring services, `mediaRuntime`, etc. is nowhere documented. Reviewer B provided a useful draft dependency tree. |
| B2 | Project domain services (5 files: `AnalysisService`, `CacheService`, `ProxyStorageService`, `RawMediaService`, `TranscriptService`) have no API documentation despite being listed in Project-Persistence.md architecture tree | MEDIUM | MEDIUM | Yes -- these files exist in `src/services/project/domains/` and are referenced in the architecture tree but have zero API docs. |
| B3 | CLAUDE.md section 6 lists `ProjectCoreService.ts` as "Project Storage" but omits parallel `NativeProjectCoreService.ts` (Firefox/Native backend) | MEDIUM | SMALL | Yes -- both FSA and Native backends exist but only FSA is listed |
| B4 | `piApiService.ts` line 2 comment lists "Veo, Sora2" which are NOT in `DEFAULT_VIDEO_PROVIDERS` -- stale/aspirational comment | LOW | SMALL | Not independently verified in this review, but plausible given the nature of provider lists |
| B5 | AI-Integration.md lists AI model names (e.g., `claude-sonnet-4-20250514`) that may be stale | LOW | SMALL | Out of scope for service domain audit; noted for completeness |
| B6 | `thumbnailRenderer.ts` (WebGPU-rendered thumbnails for nested compositions) undocumented | LOW | SMALL | Yes -- confirmed file exists in services directory |
| B7 | `projectDB.ts` (IndexedDB persistence with 6 stores) and `fileSystemService.ts` only briefly mentioned in Project-Persistence.md | LOW | SMALL | Yes -- they exist but have no API documentation |
| B8 | Recent git commits (post-2026-03-08) introduced undocumented features: playback debug stats system, stagger budget enhancements, scrubbing stability + telemetry, source-based thumbnail cache | MEDIUM | MEDIUM | Yes -- Reviewer B identified specific commit hashes for traceability |

---

## Conflicts Resolved

### Conflict 1: layerBuilder file count in CLAUDE.md

- **Reviewer A** stated CLAUDE.md lists "LayerBuilderService, VideoSyncManager, AudioSyncHandler, AudioTrackSyncManager, FrameContext, TransformCache, PlayheadState" and said only `LayerCache.ts` is missing.
- **Reviewer B** stated CLAUDE.md lists only 3 files and the actual directory has 10.
- **Resolution:** Reviewer B is correct. CLAUDE.md line 156 reads: `layerBuilder/    # LayerBuilderService, VideoSyncManager, AudioSyncHandler`. Only 3 files are listed. The directory contains 10 files (including `index.ts` and `types.ts`). Reviewer A incorrectly included files that are NOT in CLAUDE.md. **7 files are missing from the listing, not 1.**

### Conflict 2: Definition file count (15 vs 16)

- **Reviewer A** said "76 tool definitions across 15 definition files"
- **Reviewer B** said "16 definition files (including batch.ts and stats.ts)" but then clarified "15 exported arrays"
- **Resolution:** The `definitions/` directory contains 16 `.ts` files, but one is `index.ts` (the barrel export). There are **15 definition files** that each export a tool definition array. Both reviewers agree on 15 functional definition files; B's initial "16" counted `index.ts`. The doc's claim of "15 categories" is approximately correct if counting by definition file, though the doc body sub-sections don't map 1:1 to files.

### Conflict 3: Total callable tool count

- **Reviewer A** said "74 tools are actually registered and callable"
- **Reviewer B** said "74 in handler index + 1 batch (separate) = 75 active handlers out of 76 definitions"
- **Resolution:** Both are correct from different perspectives. There are 74 entries across the 4 handler maps in `handlers/index.ts`. The `executeBatch` tool is handled via special-case in `aiTools/index.ts` line 63, making 75 tools that can be successfully invoked. The `openComposition` handler exists but is not registered (dead), and `searchVideos` maps to `searchYouTube` (name mismatch, fails). So: **75 tools have working handler code, but only 74 work correctly** (since `searchVideos` hits the wrong key).

### Conflict 4: Severity assessment approach

- **Reviewer A** assigned severity implicitly through "Priority 1-5" ordering
- **Reviewer B** used "Critical / High / Medium / Low" labels explicitly
- **Resolution:** Consolidated using explicit severity labels applied consistently.

---

## Prioritized Action Items

### P0: Fix Code Bugs (CRITICAL, SMALL effort each)

| # | Action | File(s) | Effort |
|---|--------|---------|--------|
| 1 | Register `openComposition` handler: add import of `handleOpenComposition` and add `openComposition: handleOpenComposition` to `mediaHandlers` map | `src/services/aiTools/handlers/index.ts` | SMALL |
| 2 | Fix `searchVideos`/`searchYouTube` name mismatch: rename handler map key from `searchYouTube` to `searchVideos` (or rename the definition) | `src/services/aiTools/handlers/index.ts` (or `definitions/youtube.ts`) | SMALL |
| 3 | Update AI-Integration.md tool count after fixes: should become "76 tools across 15 categories" (all callable) | `docs/Features/AI-Integration.md` | SMALL |

### P1: Critical Documentation Gaps (HIGH-CRITICAL, MEDIUM-LARGE effort)

| # | Action | Effort |
|---|--------|--------|
| 4 | Create `docs/Features/Playback-Monitoring.md` or extend `Debugging.md` to cover all 7 monitoring services, 8 anomaly types, auto-recovery, per-clip escalation, pipeline monitors, window globals | LARGE |
| 5 | Document `mediaRuntime/` subsystem: source resolution, session policies (interactive/background/export/ram-preview), frame provider abstraction, clip bindings, registry | MEDIUM |
| 6 | Add service dependency graph to architecture documentation (useEngine -> layerBuilder -> mediaRuntime -> monitoring chain) | MEDIUM |

### P2: High Priority Documentation Updates (HIGH, SMALL-MEDIUM effort)

| # | Action | Effort |
|---|--------|--------|
| 7 | Update CLAUDE.md section 3: expand `layerBuilder/` listing to include all 10 files; expand standalone services list to include monitoring, rendering, and analysis services | SMALL |
| 8 | Update CLAUDE.md section 6 (Important Files): add monitoring services, mediaRuntime, NativeProjectCoreService | SMALL |
| 9 | Update `Debugging.md`: add section on pipeline monitor window globals (`__WC_PIPELINE__`, `__VF_PIPELINE__`) | SMALL |
| 10 | Document AI visual feedback system (`aiFeedback.ts`, `executionState.ts`, stagger budget) in AI-Integration.md | MEDIUM |
| 11 | Document AI bridge architecture (HMR dev bridge vs Native Helper production bridge) in AI-Integration.md | SMALL |

### P3: Medium Priority Documentation (MEDIUM, SMALL-MEDIUM effort)

| # | Action | Effort |
|---|--------|--------|
| 12 | Document `sceneDescriber.ts` (Qwen3-VL local AI integration) in AI-Integration.md or standalone doc | SMALL |
| 13 | Document `clipAnalyzer.ts` and `clipTranscriber.ts` (backends for AI analysis tools) | SMALL |
| 14 | Document `renderScheduler.ts`, `ramPreviewEngine.ts`, `layerPlaybackManager.ts`, `compositionRenderer.ts` | MEDIUM |
| 15 | Add API documentation for project domain services (AnalysisService, CacheService, ProxyStorageService, RawMediaService, TranscriptService) | MEDIUM |
| 16 | Update CLAUDE.md hooks listing (add 4 missing hooks) and utils listing (add 6 missing utils) | SMALL |
| 17 | Add `NativeProjectCoreService.ts` to CLAUDE.md section 6 alongside `ProjectCoreService.ts` | SMALL |

### P4: Low Priority Fixes (LOW, SMALL effort)

| # | Action | Effort |
|---|--------|--------|
| 18 | Fix Whisper model name in AI-Integration.md (language-dependent: `whisper-tiny.en` for EN, `onnx-community/whisper-tiny` for others) | SMALL |
| 19 | Add Kling `v2.1-master` to version list in AI-Integration.md | SMALL |
| 20 | Document `klingAccessKey`/`klingSecretKey` in API keys configuration section | SMALL |
| 21 | Add `proxyFrameCache.ts` to Audio.md source list (for scrub audio) | SMALL |
| 22 | Clean up stale `Veo, Sora2` comment in `piApiService.ts` line 2 | SMALL |
| 23 | Document `thumbnailCacheService.ts`, `thumbnailRenderer.ts`, `googleFontsService.ts` (low-impact services) | SMALL |

---

## Statistics

- **Total findings:** 39 (2 code bugs + 18 consensus + 10 Reviewer A unique + 8 Reviewer B unique + 1 conflict-resolved discrepancy)
- **CRITICAL:** 4 (2 code bugs + monitoring subsystem gap + mediaRuntime gap)
- **HIGH:** 7 (tool count accuracy, visual feedback docs, dependency graph, pipeline globals, escalation behavior, bridge architecture)
- **MEDIUM:** 14 (various undocumented services, CLAUDE.md gaps, project domain APIs)
- **LOW:** 14 (minor doc inaccuracies, low-impact undocumented files, stale references)
- **Estimated total effort:** ~15-20 hours (2 LARGE + 4 MEDIUM + rest SMALL)
