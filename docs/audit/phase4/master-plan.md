# Documentation Audit - Master Execution Plan

**Created:** 2026-03-16
**Inputs:** 6 Phase 2 consolidated findings + 2 Phase 3 structural reviews
**Scope:** Core docs only (docs/Features/, README.md, CLAUDE.md). Skip docs/plans/ and docs/refactor/.

---

## Verified Metrics (use these numbers everywhere)

| Metric | Verified Value | Source |
|--------|---------------|--------|
| APP_VERSION | `1.3.5` | `src/version.ts` line 4 |
| TypeScript files | 486 | Phase 2 infrastructure consensus |
| Total LOC (TS/TSX) | ~124,000 | Phase 2 infrastructure (123,616 actual) |
| WGSL core shaders (src/shaders/) | 1,303 lines | Phase 2 infrastructure consensus |
| WGSL effect shaders (src/effects/**/*.wgsl) | 1,108 lines (30 files) | Phase 2 infrastructure consensus |
| WGSL shared utility (common.wgsl) | 154 lines | Phase 2 engine A15, located at `src/effects/_shared/common.wgsl` |
| WGSL total (.wgsl files) | 2,565 lines | 1,303 + 1,108 + 154 |
| WGSL inline (CompositorPipeline.ts) | ~435 lines | Phase 2 engine A5 |
| WGSL grand total (all WGSL) | ~3,000 lines | 2,565 + 435 |
| Production dependencies | 13 | Phase 2 infrastructure consensus |
| Dev dependencies | 19 | Phase 2 infrastructure consensus |
| npm scripts | 11 | Phase 2 infrastructure consensus |
| GPU effects | 30 | Phase 2 effects consensus |
| AI tool definitions | 76 | Phase 2 infrastructure (B correct, A overcounted) |
| AI tools actually callable | 74 (2 broken) | Phase 2 services consolidated |
| Google Fonts (POPULAR_FONTS) | 50 | Phase 2 infrastructure (B correct, code comment says "Top 50") |
| Panel types (PanelType union) | 17 | Phase 2 infrastructure consensus |
| Timeline store slices | 17 | Phase 2 infrastructure consensus |
| MediaStore slices | 9 | Phase 2 infrastructure consensus |
| Standalone stores | 9 | Phase 2 stores C1 (history, engine, settings, dock, slice, renderTarget, sam2, multicam, youtube) |
| Test files | 44 | Phase 2 infrastructure consensus |
| Test count | 1,717 | Phase 2 infrastructure consensus |
| Render targets (textures) | 7 | Phase 2 engine C5 (not 8) |
| OutputPipeline uniform buffers | 3 | Phase 2 engine A7 (gridOn, gridOff, stackedAlpha) |
| Blend modes | 37 | Consensus across all docs |
| Keyboard shortcuts | 89 | Phase 2 components (Keyboard-Shortcuts.md) |
| output.wgsl lines | 83 | Phase 2 engine C3 (not 71) |
| Tutorial campaigns | 14 | Phase 2 components C2 (not 2 parts) |
| Timeline selectors (selectors.ts) | 50 | Phase 2 stores conflict #4 |
| package.json version | `1.0.0` | Phase 2 infrastructure B1 (stale, does not match version.ts) |
| useFullWebCodecsPlayback flag | `false` | Phase 2 engine C1 (not `true`) |
| Codec support (export) | 4 (H.264, H.265, VP9, AV1) | Phase 2 engine C7 (not 2) |
| H.264 codec string | `avc1.4d0028` | Phase 2 engine C6 (Main Profile, not High) |

---

## Structural Changes Summary

### Files to DELETE
| File | Reason |
|------|--------|
| `docs/Features/FEATURES.md` | 95% redundant with docs/Features/README.md; German duplicate with no unique content (Phase 3A) |

### Files to MERGE (then delete source)
| Target | Source to absorb | Rationale |
|--------|-----------------|-----------|
| `docs/Features/Effects.md` | `docs/Features/effects-system.md` (add as "Developer Internals" section at bottom) | Eliminate two overlapping docs; keep one canonical effects reference (Phase 3A) |
| `docs/Features/Export.md` | `docs/Features/SharedDecoderArchitecture.md` (add as "Future: V2 Architecture" appendix, keep NOT IMPLEMENTED banner) | SharedDecoder is a design appendix, not a standalone feature (Phase 3A) |

### Files to RENAME
| Current | New Name | Reason |
|---------|----------|--------|
| `docs/Features/YouTube.md` | `docs/Features/Download-Panel.md` | File's own title says "Download Panel (formerly YouTube Panel)" (Phase 3A) |

### Files to MOVE
| File | From | To | Reason |
|------|------|----|--------|
| `docs/Features/FFMPEG_WASM_BUILD_PLAN.md` | `docs/Features/` | `docs/plans/` | Planning doc, not feature reference (Phase 3A) |

### Files to SLIM DOWN
| File | Action |
|------|--------|
| `docs/Features/README.md` | Remove feature catalog tables (lines 98-378, redundant with individual feature docs), remove version history section (lines 620-650, stale duplicate of src/version.ts), remove Quick Start guide (lines 469-512), remove browser requirements (lines 448-465), remove keyboard reference (lines 515-537). Keep as pure documentation index ~100-120 lines. |

### Existing Files to UPDATE (heavy changes)
| File | Summary of changes |
|------|-------------------|
| `CLAUDE.md` | Section 3 architecture tree overhaul, Section 9 removal, new patterns from Section 9, metric corrections, slice listings |
| `README.md` | Version badge, LOC count, WGSL count, Google Fonts count |
| `docs/Features/README.md` | Version, metrics, slim to pure index, fix all stale numbers |
| `docs/Features/GPU-Engine.md` | 27 action items from Phase 2 engine domain |
| `docs/Features/Export.md` | Codec table, V2 section, pipeline description, merge SharedDecoder |
| `docs/Features/Effects.md` | File path fix, merge effects-system.md, add defaults, transitions |
| `docs/Features/Timeline.md` | Test counts, missing actions, state shape, session ID, AI overlays |
| `docs/Features/Masks.md` | Missing fields, missing actions |
| `docs/Features/Keyframes.md` | Test counts, bezier easing fix, speed integration |
| `docs/Features/Media-Panel.md` | Test count, missing fields, text defaults clarification |
| `docs/Features/AI-Integration.md` | Tool count, visual feedback, bridge architecture, scene describer |
| `docs/Features/UI-Panels.md` | Tool count, mobile section, tutorial rewrite, stacked alpha, WhatsNew, NativeHelper dialog |
| `docs/Features/Preview.md` | Loop shortcut fix, per-layer preview sources, output manager components |
| `docs/Features/Debugging.md` | Pipeline monitor globals, playback monitoring services |

### NOT creating (out of scope for this pass)
- `docs/ARCHITECTURE.md` (Phase 3 recommended, but requires new content creation beyond doc updates)
- `docs/Getting-Started.md` (Phase 3 recommended, deferred)
- `CONTRIBUTING.md` (Phase 3 recommended, deferred)
- `docs/HOW-TO/` directory (Phase 3 recommended, deferred)
- New standalone store docs (Phase 2 stores LOW priority #25)

---

## Code Bugs to Track (NOT fixed in this documentation pass)

### Bug 1: `openComposition` handler not registered in dispatcher
- **Severity:** CRITICAL
- **Location:** `src/services/aiTools/handlers/index.ts`
- **Problem:** `handleOpenComposition` is implemented in `handlers/media.ts` line 192 but is neither imported nor registered in the `mediaHandlers` map in `handlers/index.ts`
- **Runtime effect:** AI calls `openComposition` -> "Unknown tool: openComposition"
- **Fix:** Add import of `handleOpenComposition` and add `openComposition: handleOpenComposition` to the `mediaHandlers` map

### Bug 2: `searchVideos` / `searchYouTube` name mismatch
- **Severity:** CRITICAL
- **Location:** Definition: `definitions/youtube.ts` line 9 defines tool name as `searchVideos`. Handler: `handlers/index.ts` line 213 registers as `searchYouTube: handleSearchYouTube`
- **Runtime effect:** AI receives tool name `searchVideos`, calls it, dispatcher looks for `searchVideos` but map key is `searchYouTube` -> "Unknown tool: searchVideos"
- **Fix:** Rename handler map key from `searchYouTube` to `searchVideos` (lower-risk, preserves the API-facing name)

---

## Work Units

### Work Unit 1: Root Documents (CLAUDE.md + README.md)

**Agent scope:** 2 files
**Dependencies:** None (must execute first -- other agents reference these)

#### File: `CLAUDE.md`

**Section 0 (Vision):** No changes needed.

**Section 0.1 (AI Debug Tools):** No changes needed.

**Section 1 (Workflow):** No changes needed.

**Section 2 (Quick Reference):** Add 2 missing npm scripts after the existing list:
- Add `npm run test:ui` with description `# Vitest mit Browser-UI`
- Add `npm run test:coverage` with description `# Vitest mit Coverage-Report`

**Section 3 (Architecture tree, lines ~117-169):** Major overhaul required.

Changes to `stores/` subtree -- replace current listing:
```
├── stores/              # Zustand State
│   ├── timeline/        # Slices: track, clip, keyframe, mask, playback, selection, transition, ...
│   ├── mediaStore/      # Slices: fileImport, fileManage, folder, proxy, composition, slot, ...
```
with expanded version listing all 17 timeline slices and all 9 mediaStore slices:
```
├── stores/              # Zustand State
│   ├── timeline/        # 17 Slices: track, clip, keyframe, mask, playback, selection, transition,
│   │   │                #   ramPreview, proxyCache, clipEffect, linkedGroup, downloadClip,
│   │   │                #   solidClip, textClip, clipboard, aiActionFeedback, marker
│   │   ├── clip/        # Clip sub-modules (addVideoClip, addAudioClip, addImageClip, etc.)
│   │   ├── helpers/     # clipStateHelpers, idGenerator, blobUrlManager, audioDetection, etc.
│   │   └── selectors.ts # 50 optimized selectors (individual, grouped, derived, stable action)
│   ├── mediaStore/      # 9 Slices: fileImport, fileManage, folder, proxy, composition,
│   │   │                #   slot, multiLayer, project, selection
│   │   └── init.ts      # IndexedDB init, auto-save, beforeunload, audio cleanup
```

Changes to `engine/` subtree -- add missing root-level files:
```
├── engine/              # WebGPU Rendering
│   ├── core/            # WebGPUContext, RenderTargetManager
│   ├── render/          # RenderLoop, RenderDispatcher, LayerCollector, Compositor, NestedCompRenderer, layerEffectStack
│   ├── pipeline/        # CompositorPipeline, EffectsPipeline, OutputPipeline, SlicePipeline
│   ├── texture/         # TextureManager, MaskTextureManager, ScrubbingCache
│   ├── managers/        # CacheManager, ExportCanvasManager, OutputWindowManager, outputWindowPlacement
│   ├── export/          # FrameExporter, VideoEncoderWrapper, AudioEncoder, types
│   ├── audio/           # AudioMixer, TimeStretchProcessor, AudioExportPipeline
│   ├── video/           # VideoFrameManager
│   ├── ffmpeg/          # FFmpegBridge
│   ├── analysis/        # Scopes (Histogram, Waveform, Vectorscope, OpticalFlow)
│   ├── stats/           # PerformanceStats
│   ├── structuralSharing/ # SnapshotManager for render optimization
│   ├── ParallelDecodeManager.ts  # Multi-clip parallel decode
│   ├── WebCodecsPlayer.ts        # WebCodecs playback engine
│   ├── WebCodecsExportMode.ts    # Export-specific WebCodecs path
│   └── featureFlags.ts           # Runtime feature toggles
```

Changes to `effects/` subtree -- add missing categories:
```
├── effects/             # 30 GPU Effects (color/, blur/, distort/, stylize/, keying/, generate/, time/, transition/)
│   ├── _shared/         # common.wgsl (154 lines shared utility)
│   └── EffectsPipeline.ts # Effect orchestration
```

Changes to `services/` subtree -- expand listings:
```
├── services/            # Business logic
│   ├── layerBuilder/    # LayerBuilderService, VideoSyncManager, AudioSyncHandler,
│   │                    #   AudioTrackSyncManager, LayerCache, FrameContext, TransformCache, types, index
│   ├── mediaRuntime/    # Clip bindings, runtime playback registry, session policies
│   ├── monitoring/      # playbackHealthMonitor, playbackDebugStats, framePhaseMonitor,
│   │                    #   vfPipelineMonitor, wcPipelineMonitor, scrubSettleState
│   ├── project/         # ProjectCoreService, NativeProjectCoreService, save/load, file service
│   │   └── domains/     # AnalysisService, CacheService, ProxyStorageService, RawMediaService, TranscriptService
│   ├── nativeHelper/    # Native FFmpeg decoder client
│   ├── sam2/            # SAM2 segmentation service
│   ├── aiTools/         # AI tool bridge (76 tools across 15 definition files)
│   │   ├── definitions/ # 15 tool definition files
│   │   └── handlers/    # Tool handler dispatch + visual feedback
│   ├── export/          # FCPXML export
│   └── (standalone)     # logger, audioManager, thumbnailRenderer, whisperService,
│                        #   renderScheduler, ramPreviewEngine, compositionRenderer,
│                        #   clipAnalyzer, clipTranscriber, sceneDescriber, apiKeyManager, etc.
```

Changes to `hooks/` -- add missing hooks:
```
├── hooks/               # React hooks: useEngine, useGlobalHistory, useMIDI, useTheme,
│                        #   useClipPanelSync, useContextMenuPosition, useThumbnailCache, ...
```

Changes to `utils/` -- add missing utils:
```
├── utils/               # Helpers: keyframeInterpolation, maskRenderer, fileLoader,
│                        #   speedIntegration, externalDragPlacement, externalDragSession, ...
```

Add two missing top-level entries:
```
├── assets/              # Static assets
├── test/                # In-browser test components
└── changelog-data.json  # 5,000+ line changelog data (imported by version.ts)
```

**Section 4 (Critical Patterns):** Add 3 universal patterns salvaged from Section 9:

After the existing "Zustand Slice Pattern" block, add:

```markdown
### Functional setState (prevents stale closures)
\`\`\`typescript
// WRONG: needs items as dependency, recreated on every change
const addItems = useCallback((newItems) => {
  setItems([...items, ...newItems])
}, [items])

// RIGHT: stable callback, no stale closure
const addItems = useCallback((newItems) => {
  setItems(curr => [...curr, ...newItems])
}, [])
\`\`\`

### Lazy State Initialization
\`\`\`typescript
// WRONG: runs on EVERY render
const [index, setIndex] = useState(buildSearchIndex(items))

// RIGHT: runs only once
const [index, setIndex] = useState(() => buildSearchIndex(items))
\`\`\`

### toSorted() instead of sort() (prevents state mutation)
\`\`\`typescript
// WRONG: mutates original array
const sorted = users.sort((a, b) => a.name.localeCompare(b.name))

// RIGHT: creates new array
const sorted = users.toSorted((a, b) => a.name.localeCompare(b.name))
\`\`\`

### Zustand Middleware
All stores use `subscribeWithSelector` middleware. `settingsStore` and `dockStore` also use `persist` middleware.
MediaStore uses `MediaSliceCreator` variant (slightly different signature than timeline's `SliceCreator`).
```

**Section 5 (Debugging):** No changes needed.

**Section 6 (Important Files / Wichtige Dateien):** Update the table:
- Add row: `Monitoring Services | src/services/monitoring/playbackHealthMonitor.ts`
- Add row: `Media Runtime | src/services/mediaRuntime/index.ts`
- Add row: `Native Project Storage | src/services/project/core/NativeProjectCoreService.ts`
- Add row: `Feature Flags | src/engine/featureFlags.ts`
- Change "Neuen Effect hinzufuegen" instructions to: `Detailed guide: docs/Features/Effects.md (Developer Internals section)`

**Section 7 (Texture Types):** Add Firefox exception row:
After the `Video (HTMLVideoElement)` row, add a note:
```
| Video (HTMLVideoElement, Firefox) | `texture_2d<f32>` via `htmlVideoPreviewFallback.ts` (copies to persistent texture to avoid black frames) |
```

**Section 8 (Render Pipeline):** No changes needed.

**Section 9 (React/Next.js Best Practices):** DELETE ENTIRELY (all ~174 lines, from "## 9. React/Next.js Best Practices" through end of that section). The 3 universal patterns (functional setState, lazy init, toSorted) are being moved to Section 4. The Next.js-specific patterns (React.cache, RSC, next/dynamic, next.config.js, Suspense for streaming) are inapplicable to this Vite SPA. Also remove the "Projekt-spezifische Ergaenzungen" subsection at the bottom of Section 9.

The final line of CLAUDE.md should remain: `*Ausfuehrliche Dokumentation: docs/Features/README.md*`

#### File: `README.md`

**Line 7 (version badge):** Change `1.3.4` to `1.3.5`:
```
[![Version](https://img.shields.io/badge/version-1.3.5-blue.svg)]
```

**Line 23 (WGSL count in stat table):** Change `2,200+` to `2,500+`:
```
<td align="center"><b>2,500+</b><br><sub>Lines WGSL</sub></td>
```

**Line 58 ("~60k lines of TypeScript"):** Change to `~120k lines of TypeScript`:
```
Built with Claude as my pair-programmer. Every feature gets debugged, refactored, and beaten into shape until it does what I need. ~120k lines of TypeScript, ~2,500 lines of WGSL, and a Rust native helper for the stuff browsers still can't do cleanly.
```

**Line 99 (Google Fonts count):** Change `57 Google Fonts` to `50 Google Fonts`:
```
| [**Text & Solids**](docs/Features/Text-Clips.md) | 50 Google Fonts, stroke, shadow, solid color clips |
```

**Line 170 (Tech Stack WGSL):** Change `2,200 lines of WGSL shaders` to `2,500+ lines of WGSL shaders`:
```
- **Rendering:** WebGPU + 2,500+ lines of WGSL shaders
```

---

### Work Unit 2: Doc Index + Structural Cleanup

**Agent scope:** 3 files (docs/Features/README.md rewrite, FEATURES.md deletion, YouTube.md rename)
**Dependencies:** Depends on Work Unit 1 for correct metric values.

#### File: `docs/Features/FEATURES.md` -- DELETE

Delete this file entirely. It is 95% redundant with docs/Features/README.md (Phase 3A confirmed). All content is a German translation of the English README.md feature tables with no unique information.

#### File: `docs/Features/YouTube.md` -- RENAME to `docs/Features/Download-Panel.md`

Rename the file. The file's own title already says "Download Panel (formerly YouTube Panel)".

After renaming, update all references to YouTube.md across the codebase docs:
- `docs/Features/README.md`: Change `./YouTube.md` to `./Download-Panel.md` (in Documentation Index table)
- `README.md` line 98: Change `docs/Features/YouTube.md` to `docs/Features/Download-Panel.md`

#### File: `docs/Features/README.md` -- MAJOR REWRITE (slim to pure index)

**Line 5 (version header):** Change `Version 1.2.11 | March 2026` to `Version 1.3.5 | March 2026`

**Lines 20-21 (Key Highlights table, AI Integration row):** Change `33 intelligent editing tools` to `76 intelligent editing tools`

**Lines 27 (Key Highlights table, Text Clips row):** Verify says `50 Google Fonts` -- it does, no change needed.

**Lines 44-56 (Technology Stack):** Update:
- Line 47: Change `WGSL shaders (2,400+ lines)` to `WGSL shaders (2,500+ lines)`
- Line 48: Change `30+ modular effects` to `30 modular effects`

**Lines 62-94 (Documentation Index):**
- Line 72: Change `33 AI tools` to `76 AI tools`
- Line 81: Change link text `Download Panel` to keep, but change `./YouTube.md` to `./Download-Panel.md`
- Line 92: Change `Shared Decoder Architecture` row -- add note "(NOT IMPLEMENTED -- design proposal)"
- Line 93: Move `FFMPEG_WASM_BUILD_PLAN.md` row to a separate "Planning Documents" section or add note "(see docs/plans/)"
- Line 94: Remove `Feature Handbook (DE)` row entirely (file being deleted)

**Lines 98-378 (Feature Catalog tables):** DELETE ALL feature catalog tables. These duplicate the individual feature docs and are a maintenance burden. Replace with a single line:
```
> Feature details are documented in the individual feature docs linked in the Documentation Index above.
```

**Lines 380-417 (Architecture diagram):** KEEP the box diagram but update:
- Line 396: Change `(7 slices)` to `(17 slices)` in the Timeline Store box

**Lines 420-431 (WGSL Shader Breakdown table):** Update all values:
- `output.wgsl`: Change `71` to `83`
- `30 effect shaders`: Change `~954` to `1,108`
- `common.wgsl`: Change `154` to `154` (already correct, but verify location note says `src/effects/_shared/common.wgsl`)
- **Total**: Change `~2,400` to `~2,565` and add note: "(plus ~435 lines inline WGSL in CompositorPipeline.ts)"

**Lines 433-444 (Zustand Store Architecture):** Update to list all 17 slices instead of just 7:
```
timelineStore/
  trackSlice.ts          # Track CRUD operations
  clipSlice.ts           # Clip operations, transforms
  playbackSlice.ts       # Play/pause, seeking, time
  keyframeSlice.ts       # Keyframe CRUD, interpolation
  selectionSlice.ts      # Clip/keyframe selection
  maskSlice.ts           # Mask shapes and vertices
  compositionSlice.ts    # Composition management
  transitionSlice.ts     # Crossfade transitions
  ramPreviewSlice.ts     # RAM Preview cache control
  proxyCacheSlice.ts     # Proxy cache invalidation
  clipEffectSlice.ts     # Effect instances on clips
  linkedGroupSlice.ts    # Video-audio linked groups
  downloadClipSlice.ts   # Download clip management
  solidClipSlice.ts      # Solid color clip creation
  textClipSlice.ts       # Text clip creation
  clipboardSlice.ts      # Cut/copy/paste with media reload
  aiActionFeedbackSlice.ts # AI visual feedback overlays
  markerSlice.ts         # Timeline markers
```

**Lines 448-465 (Browser Requirements):** DELETE section (move concern to root README.md which already has this in the Quick Start area).

**Lines 469-512 (Quick Start Guide):** DELETE section (root README.md already has Quick Start).

**Lines 515-537 (Keyboard Reference):** DELETE section (Keyboard-Shortcuts.md is the canonical reference).

**Lines 542-559 (Performance Optimization + Troubleshooting):** DELETE section (GPU-Engine.md and Debugging.md cover this).

**Lines 562-603 (Source Code Reference + Test Coverage):** Update Test Coverage section:
- Line 604: Change `~1,659 tests across 35 test files` to `~1,717 tests across 44 test files`
- Keep the test coverage table as a useful cross-reference. Update individual test file counts where incorrect (see Work Units 3-5 for specific counts).

**Lines 608-616 (Not Yet Implemented):** KEEP as-is.

**Lines 620-650 (Version History):** DELETE entire section. Replace with single line:
```
## Version History

See `src/version.ts` and `src/changelog-data.json` for the authoritative changelog.
Current version: 1.3.5.
```

**Lines 360 (Panel type count):** Change `16 Panel Types` to `17 Panel Types` in the UI feature catalog. (If feature catalog is deleted per above, this is moot.)

**Add navigation consistency:** Add `[<- Back to Project](../../README.md)` at the top of the file.

#### File: `docs/Features/FFMPEG_WASM_BUILD_PLAN.md` -- MOVE

Move this file from `docs/Features/` to `docs/plans/`. This is a planning document, not a feature reference.

---

### Work Unit 3: Engine, Export & Effects Docs

**Agent scope:** 3 files (GPU-Engine.md, Export.md, Effects.md)
**Dependencies:** Depends on Work Unit 1 for CLAUDE.md architecture tree being correct.

#### File: `docs/Features/GPU-Engine.md`

**CRITICAL fixes:**

1. **Lines 362 and 585 (useFullWebCodecsPlayback):** Change `useFullWebCodecsPlayback: true` to `useFullWebCodecsPlayback: false` in BOTH locations. Update any surrounding comment to: "Preview uses HTML video by default; WebCodecs is used for export and full-mode playback only."

2. **Line 139 (WebGPUContext limits):** Change "default limits (no custom maxTextureDimension2D)" to "`requiredLimits: { maxTextureDimension2D: 4096 }`"

3. **Line 143 (Vulkan delays):** Remove the claim "Vulkan delay: 50ms after device creation, 100ms after pipelines, 50ms before textures". Replace with: "Device loss recovery: 100ms delay before re-initialization (only setTimeout in WebGPUContext)."

**HIGH fixes:**

4. **OutputPipeline section:** Change "Dual uniform buffers (grid-on / grid-off)" to "Three uniform buffers: `uniformBufferGridOn` (mode 0), `uniformBufferGridOff` (mode 1), `uniformBufferStackedAlpha` (mode 2, for transparent video export)."

5. **Add new subsection "Stacked Alpha Export"** in the OutputPipeline area:
   - `ExportSettings.stackedAlpha` option enables transparent video export
   - OutputPipeline mode 2 renders RGB on top half, alpha grayscale on bottom half (double-height canvas)
   - `ExportCanvasManager` creates double-height OffscreenCanvas
   - `output.wgsl` stacked alpha logic (lines added in commits 8326ad14, f2a84a50)

6. **Add new subsection "Firefox HTML Video Preview Fallback"** in the Video Decoding or Texture Import section:
   - `htmlVideoPreviewFallback.ts` implements a Firefox-specific workaround
   - Copies video frames to persistent `texture_2d<f32>` textures
   - Avoids intermittent black frames from `importExternalTexture` on Firefox
   - Means Firefox does NOT use zero-copy external textures for HTMLVideoElement

7. **Lines 307-312 and line 353 (LayerCollector priority order):** Update priority order to reflect actual behavior when `useFullWebCodecsPlayback` is `false`:
   1. NativeHelper decoded frames
   2. Direct VideoFrame (from parallel decode)
   3. HTML Video (when `allowHtmlVideoPreview` is true -- which it is when not in full WC mode, during scrub/pause)
   4. WebCodecs (full mode only, or export)
   5. Cache fallbacks (scrubbing cache, stall hold frame)

8. **EngineStats section (lines 611-634):** Add missing fields:
   - `gpuMemory: number`
   - `isIdle: boolean`
   - `playback?: { ... }` (30+ field diagnostic object for pipeline debugging)
   - Fix `audio: AudioStatus` to inline type: `audio: { playing: number; drift: number; status: 'sync' | 'drift' | 'silent' | 'error' }`

**MEDIUM fixes:**

9. **Line 265 (render target count):** Change "8 textures total" to "7 textures total" (Ping, Pong, IndependentPing, IndependentPong, EffectTemp1, EffectTemp2, Black).

10. **Add `layerEffectStack.ts` to render/ directory listing:** "splits effects into inline vs. complex categories via `splitLayerEffects()`"

11. **Add documentation for `RenderDispatcher.renderToPreviewCanvas()` and `renderCachedFrame()`** in the Render Loop / RenderDispatcher section. Note `renderToPreviewCanvas()` performs independent ping-pong compositing for multi-composition preview.

12. **Document black frame flash prevention:** Add to RenderDispatcher or Troubleshooting section: "`lastRenderHadContent` flag holds last rendered frame during transient playback stalls instead of flashing black (Windows/Linux fix, commit ee7e2329)."

13. **Document VRAM leak fix pattern:** Add to RenderTargetManager section: "`createPingPongTextures()` nulls references for GC instead of calling `.destroy()` to avoid 'Destroyed texture used in a submit' warnings (commit 0242668d)."

14. **Document playback stall hold frame:** Add to LayerCollector section: "`getPlaybackStallHoldFrame()` provides last-resort cached frames during decoder stalls."

15. **Document scrub grace period:** Add to LayerCollector section: "`scrubGraceUntil` (~150ms) keeps HTML preview path active after scrub stops for settle-seek completion."

16. **Shader Capabilities section -- inline WGSL:** Add note: "~435 lines of WGSL are inlined in `CompositorPipeline.ts` (copyShader ~30 lines, externalCopyShader ~30 lines, externalCompositeShader ~375 lines with all 37 blend modes). These are NOT in separate .wgsl files."

17. **Line 372 (shader line counts):** Update:
    - `output.wgsl`: `71` -> `83`
    - Effect shaders: `~954` -> `1,108` (30 shaders)
    - Total WGSL: `~2,400` -> `~2,565` (files only) or `~3,000` (including inline)

18. **Line 380 (common.wgsl location):** Change implied `src/shaders/` location to actual `src/effects/_shared/common.wgsl`.

19. **Add `outputWindowPlacement.ts` to OutputWindowManager section:** Randomized popup placement with center-exclusion zone logic.

20. **Add telemetry subsection:** Document `vfPipelineMonitor`, `wcPipelineMonitor`, `performanceMonitor` (reportRenderTime). Note these are used in LayerCollector and RenderDispatcher.

21. **Document `webCodecsTypes.ts` and `VideoFrameManager.ts`** in directory listing / respective sections with brief descriptions.

#### File: `docs/Features/Export.md`

**CRITICAL fixes:**

1. **Lines 385-419 (Export V2 section):** Add prominent banner at the top of this section:
   ```
   > **NOT IMPLEMENTED** -- The V2 export system described below is a design proposal. The source files listed do not exist. See SharedDecoderArchitecture.md for the full design document.
   ```

2. **Lines 108-111 (codec table):** Fix H.264 codec string from `avc1.640028` to `avc1.4d0028` (Main Profile, Level 4.0). Add two new rows:
   - `H.265 | MP4 | hvc1.1.6.L93.B0`
   - `AV1 | MP4/WebM | av01.0.04M.08`

**HIGH fixes:**

3. **Add Stacked Alpha Export section:** Document the `ExportSettings.stackedAlpha` option, double-height canvas, RGB top / alpha bottom. Cross-reference GPU-Engine.md OutputPipeline section.

4. **Line 169 (pipeline step 5):** Change "Read pixels (staging buffer)" to: "Create VideoFrame from GPU canvas (zero-copy via `ExportCanvasManager.createVideoFrameFromExport` using OffscreenCanvas). Staging buffer is fallback only."

5. **Line 217 (keyframe interval):** Change "Every 30 frames (configurable)" to: "1 keyframe per second, fps-dependent: `Math.round(fps)` (24 for 24fps, 30 for 30fps, 60 for 60fps). Defined in `export/types.ts` via `getKeyframeInterval(fps)`."

**MEDIUM fixes:**

6. **Document export types:** Add documentation for `FrameContext`, `LayerTransformData`, `BaseLayerProps`, `getFrameTolerance()`, `getKeyframeInterval()` from `src/engine/export/types.ts`.

**MERGE: Absorb SharedDecoderArchitecture.md as appendix:**

7. At the end of Export.md, add a new section:
   ```
   ## Appendix: V2 Shared Decoder Architecture (NOT IMPLEMENTED)

   > This is a design proposal for a future export system. It is NOT currently implemented.

   (Copy the essential content from SharedDecoderArchitecture.md here, preserving the NOT IMPLEMENTED banner)
   ```
   Then delete `docs/Features/SharedDecoderArchitecture.md`.

#### File: `docs/Features/Effects.md`

**CRITICAL fixes:**

1. **Line 332 (source attribution):** Change `src/components/panels/EffectsPanel.tsx` to `src/components/panels/properties/EffectsTab.tsx`. The referenced file does not exist at all.

**HIGH fixes:**

2. **Add default values column to parameter tables:** For all 30 effects, add a "Default" column. The complete list of defaults is documented in Phase 2 effects A2. Key examples:
   - brightness: 0, contrast: 0, saturation: 0, hue-shift: 0
   - box-blur: 0.02, gaussian-blur: 0.02, motion-blur: 0.02
   - rgb-split: 0.01, pixelate: 0.05, grain: 0.15
   - vignette: 0.3, glow: 0.3, posterize: 8

**MEDIUM fixes:**

3. **Document audio effect filtering:** In the pipeline section, add: "`EffectsPipeline.applyEffects()` silently filters out effects with type prefix `audio-` (line 178). Audio effects are processed by the Web Audio API, not the GPU pipeline."

4. **Document `ClipTransition` interface in transitions section:** `{ id, type, duration, linkedClipId }` defined in `src/transitions/types.ts` lines 37-46.

5. **Add `slide` and `zoom` transition categories:** Note that `TransitionCategory` type includes `'slide' | 'zoom'` but these are currently empty (no transition implementations use them yet).

6. **Fix uniform size description:** Change "16-32 bytes" to "0, 16, or 32 bytes" (Invert uses 0, most use 16, levels/glow/chroma-key use 32).

7. **Add transition min/max duration:** In the crossfade table, add min (0.1s) and max (5.0s) bounds alongside the default (0.5s).

**MERGE: Absorb effects-system.md content:**

8. Add a new section at the bottom of Effects.md titled "## Developer Internals: Effect Plugin System". Move the following content from effects-system.md:
   - Auto-registration pattern (how effects are discovered)
   - Plugin architecture (file structure convention)
   - The complete "How to Add a New Effect" guide (the gold-standard worked example)
   - `EffectInstance` interface: `{ id, type, name, enabled, params }` (runtime representation on clips)
   - `INLINE_EFFECT_IDS` optimization explanation
   - Note about `point` and `color` parameter types being defined but unused
   - Note about non-animatable parameters: quality params and `speed` (grain, scanlines) have `animatable: false`
   - Clarify that `EffectsTab.tsx` is the production UI (primary), while `EffectControls.tsx` is a simplified/generic fallback

   After merging, delete `docs/Features/effects-system.md`.

---

### Work Unit 4: Timeline, Keyframes, Masks & Media Docs

**Agent scope:** 4 files (Timeline.md, Keyframes.md, Masks.md, Media-Panel.md)
**Dependencies:** None (can run in parallel with Work Unit 3)

#### File: `docs/Features/Timeline.md`

**CRITICAL fixes:**

1. **Line 661 (keyframeSlice.test.ts count):** Change `94` to `96`.

**HIGH fixes:**

2. **Add `timelineSessionId` documentation:** In the State Shape or Async Safety section, add: "`timelineSessionId: string` -- Incremented UUID that guards async callbacks during composition switches. All async operations (video loading, WebCodecs init) compare their captured session ID against the current one to prevent stale updates."

3. **Add `addAIOverlaysBatch` action and new overlay types:** In the AI Action Feedback section (lines 516-526), add:
   - `addAIOverlaysBatch(overlays)` action for bulk overlay creation
   - New overlay types: `'silent-zone'` and `'low-quality-zone'` (in addition to existing `'split-glow'`, `'delete-ghost'`, `'trim-highlight'`)
   - Correct total overlay types from 4 to 5

4. **Document `ExportActions`** in the store architecture table:
   - `setExportProgress(progress)` -- update export progress bar
   - `startExport()` / `endExport()` -- export lifecycle management

5. **Document `LayerActions`** in the store architecture table:
   - `setLayers(layers)` / `updateLayer(id, updates)` / `selectLayer(id)` -- layer management actions

6. **Document `invalidateCache` action:** Add to the ProxyCache section: "`invalidateCache()` is the most frequently called side-effect action in the codebase. Called from nearly every mutation to signal that cached proxy frames may be stale."

7. **Add selectors.ts documentation:** Add a new section "Timeline Selectors" documenting:
   - 50 exported selectors in `src/stores/timeline/selectors.ts` (251 lines)
   - 5 categories: individual field selectors, grouped selectors (for useShallow), derived selectors, stable action selectors, preview/export selectors
   - Performance pattern: use individual selectors to avoid unnecessary re-renders

**MEDIUM fixes:**

8. **Line 144 (speed range):** Change "-400% to 400%" to: "No enforced code limits (keyframeSlice passes speed values through without clamping). The range is a UI guideline only."

9. **Line 565 (clip/ directory listing):** Add `clip/index.ts` -- re-exports addVideoClip, addAudioClip, addImageClip, addCompClip, completeDownload. Note that `upgradeToNativeDecoder.ts` exists in the directory but is NOT exported from `clip/index.ts`.

10. **Line 36 (default audio track name):** Add note: "Default audio track name is `'Audio'` (not `'Audio 1'` as some docs imply). Defined in `constants.ts` DEFAULT_TRACKS."

11. **Document timeline helper files:** Add brief listings for `constants.ts`, `utils.ts`, `helpers/clipStateHelpers.ts`, `helpers/idGenerator.ts`, `helpers/blobUrlManager.ts`, `helpers/audioDetection.ts`, `helpers/mp4MetadataHelper.ts`, `helpers/webCodecsHelpers.ts`.

#### File: `docs/Features/Keyframes.md`

**CRITICAL fixes:**

1. **Line 264 (keyframeSlice.test.ts count):** Change `14` to `96`.

2. **Line 265 (keyframeInterpolation.test.ts count):** Change `120` to `112`.

**MEDIUM fixes:**

3. **Line 59 area (EasingType interface):** Add `'bezier'` to the EasingType listing to fix the internal inconsistency with the Easing Modes table at line 124.

4. **Add speed integration section:** Document speed as an animatable property. Reference `speedIntegration.ts` utilities: `calculateSourceTime()`, `getSpeedAtTime()`, `calculateTimelineDuration()`. These handle the complex mapping between timeline time and source time when clip speed is keyframed.

#### File: `docs/Features/Masks.md`

**CRITICAL fixes:**

1. **Lines 138-148 (ClipMask interface):** Add 3 missing fields:
   - `name: string` -- display name of the mask
   - `expanded: boolean` -- whether mask is expanded in UI
   - `visible: boolean` -- whether mask is visible/applied

2. **Add 9 missing mask actions** to the action inventory:
   - `setMaskEditMode(mode)` -- switch between select/draw modes
   - `setMaskDragging(isDragging)` -- drag state for UI feedback
   - `setMaskDrawStart(point | null)` -- starting point for new mask draw
   - `setActiveMask(clipId, maskIndex | null)` -- set which mask is being edited
   - `selectVertex(clipId, maskIndex, vertexIndex)` -- select individual vertex
   - `deselectAllVertices()` -- clear vertex selection
   - `getClipMasks(clipId): ClipMask[]` -- getter for a clip's masks
   - `addRectangleMask(clipId)` -- create rectangle mask preset
   - `addEllipseMask(clipId)` -- create ellipse mask preset

   Total mask actions should be 17 (8 existing + 9 new).

#### File: `docs/Features/Media-Panel.md`

**HIGH fixes:**

1. **Test count for compositionSlice.test.ts:** Change `99` to `101`.

2. **Clarify text defaults:** In the text item creation section (around line 93), add clarifying note: "These are defaults for Media Panel text items (Arial, 48px). Timeline text clips use different defaults: Roboto, 72px (from `DEFAULT_TEXT_PROPERTIES` in `stores/timeline/constants.ts`)."

**MEDIUM fixes:**

3. **Add missing `MediaFile` fields** to the interface documentation:
   - `proxyVideoUrl?: string` -- URL to proxy video
   - `transcribedRanges?: [number, number][]` -- time ranges that have been transcribed

4. **Document mediaStore init.ts:** Add brief section: "Boot Sequence: `init.ts` (288 lines) handles IndexedDB initialization, timeline restore from saved state, status synchronization, auto-save interval setup, beforeunload handler, and audio cleanup via `disposeAllAudio()`."

5. **Document helper modules:** Brief mentions of `importPipeline.ts`, `mediaInfoHelpers.ts`, `thumbnailHelpers.ts`, `fileHashHelpers.ts`.

---

### Work Unit 5: AI, UI Panels, Preview & Debugging Docs

**Agent scope:** 4 files (AI-Integration.md, UI-Panels.md, Preview.md, Debugging.md)
**Dependencies:** None (can run in parallel with Work Units 3 and 4)

#### File: `docs/Features/AI-Integration.md`

**HIGH fixes:**

1. **Lines 5, 50, 232 (tool count):** Change all instances of the tool count to `76 tools across 15 categories`. Add note: "Of 76 defined tools, 74 are fully functional. 2 tools have registration bugs (openComposition: unregistered handler; searchVideos: name mismatch with searchYouTube). See Code Bugs section."

2. **Document AI visual feedback system:** Add new section covering:
   - `aiFeedback.ts` -- visual feedback coordination
   - `executionState.ts` -- execution state tracking
   - Stagger budget system for smooth animations
   - Connection to `aiActionFeedbackSlice.ts` in timeline store

3. **Document AI bridge architecture:** Add section explaining the two bridge modes:
   - **Development (HMR bridge):** Vite dev server proxies `POST /api/ai-tools` to the running app via WebSocket
   - **Production (Native Helper bridge):** Rust native helper proxies HTTP `POST http://127.0.0.1:9877/api/ai-tools` to the app via WebSocket on port 9876
   - Both converge at `aiTools/index.ts` `executeToolInternal()`

4. **Document `sceneDescriber.ts`:** Add section: "Scene Description: `sceneDescriber.ts` integrates with Qwen3-VL (local AI model) for automated scene analysis. Runs via the `qwen3vl-server` tool in `tools/qwen3vl-server/`."

**MEDIUM fixes:**

5. **Fix Whisper model name:** Change `Xenova/whisper-tiny` to note language-dependent selection:
   - English: `Xenova/whisper-tiny.en`
   - Other languages: `onnx-community/whisper-tiny`
   - Legacy `whisperService.ts` still uses `Xenova/whisper-tiny`

6. **Add Kling `v2.1-master` to version list:** In the PiAPI / AI Video section, update the Kling version list to include `2.1-master`.

7. **Document `klingAccessKey`/`klingSecretKey`:** In the API keys configuration section, add these two keys alongside the existing API key docs.

8. **Document `clipAnalyzer.ts` and `clipTranscriber.ts`:** Brief mentions as backends for AI analysis tools.

#### File: `docs/Features/UI-Panels.md`

**CRITICAL fixes:**

1. **Lines 410-494 (Tutorial System section):** REWRITE. Replace the 2-part tutorial description with the 14-campaign system:
   - `TutorialCampaignDialog.tsx` -- campaign selection UI with category grouping
   - 4 categories: Basics (3 campaigns), Editing (4 campaigns), Creative (4 campaigns), Output (3 campaigns)
   - Completion tracking via `completedTutorials` in settingsStore
   - Per-campaign progress (partial completion supported)
   - Original Part 1/2 still exist as `interface-overview` and `timeline-controls` campaigns within the Basics category

**HIGH fixes:**

2. **Line 192 (AI Chat Panel tool count):** Change `33 available tools` to `76 available tools`.

3. **Lines 169-181 (Export Panel section):** Add Stacked Alpha export checkbox: "Stacked Alpha (transparent video) -- when enabled, doubles output height with RGB on top and alpha grayscale on bottom. Useful for compositing in external tools like TouchDesigner."

4. **Add Mobile UI section:** Create new section documenting:
   - `MobileApp.tsx` root component
   - 7 sub-components: `MobileTimeline`, `MobilePreview`, `MobileToolbar`, `MobilePropertiesPanel`, `MobileMediaPanel`, `MobileOptionsMenu`
   - Touch gestures: edge swipes, two-finger undo/redo
   - Precision mode for fine adjustments
   - Feature limitations vs desktop

**MEDIUM fixes:**

5. **Lines 55-59 (Info menu table):** Add `Changelog on Startup` toggle between "Timeline Tour" and "About".

6. **Add WhatsNewDialog section:** Document:
   - Filter tabs: All, New, Fixes, Improved, Refactor
   - Release calendar heatmap (from `src/version.ts` calendar functions)
   - YouTube video embed
   - Build/WIP notice cards
   - "Don't show on startup" checkbox (connected to `showChangelogOnStartup` setting)
   - Commit links

7. **Add NativeHelperDialog documentation:** Toolbar button + full status dialog:
   - Enable/disable toggle
   - Install guide per platform
   - Capability pills (decode, encode, download, storage, AI bridge)
   - GitHub release checking

8. **Document Media Panel breadcrumb navigation:** Expand the existing "List view and Grid view toggle" mention: thumbnail grid view, folder breadcrumb navigation, single toggle button with icon swap.

9. **Document RelinkDialog:** Auto-scan, recursive folder scanning, multi-file picker, status tracking per file.

#### File: `docs/Features/Preview.md`

**MEDIUM fixes:**

1. **Line 104 (loop shortcut):** Change `L` / "Toggle loop mode" to `Shift + L` / "Toggle loop playback". `L` alone is forward playback (JKL shuttle).

2. **Document per-layer preview sources:** Add to the composition selector / multi-preview docs: "`layer-index` source type allows isolating individual video tracks from a composition in any preview tab. Added via `addPreviewPanel` and `updatePanelData` in dockStore."

3. **Expand Output Manager component docs:** Add descriptions for:
   - `OutputManagerBoot.ts` -- popup window management, reconnection logic
   - `SliceInputOverlay` / `SliceOutputOverlay` -- slice visualization
   - `SliceList` -- slice management UI
   - `SourceSelector` -- render target source routing
   - `TabBar` -- output window tab navigation
   - `TargetList` / `TargetPreview` -- render target management

#### File: `docs/Features/Debugging.md`

**HIGH fixes:**

1. **Add pipeline monitor globals section:** Document:
   - `window.__WC_PIPELINE__` -- WebCodecs pipeline state inspection
   - `window.__VF_PIPELINE__` -- VideoFrame pipeline state inspection
   - Both are set by the monitoring services and readable from browser console

2. **Add playback monitoring overview:** Brief documentation of the 7 monitoring services:
   - `playbackHealthMonitor` -- detects 8 anomaly types, per-clip escalation (3+ anomalies within 12s triggers aggressive recovery)
   - `playbackDebugStats` -- real-time stats for the `playback` field in EngineStats
   - `playbackDebugSnapshot` -- point-in-time snapshots for debugging
   - `framePhaseMonitor` -- frame lifecycle tracking
   - `vfPipelineMonitor` -- VideoFrame pipeline events
   - `wcPipelineMonitor` -- WebCodecs pipeline events
   - `scrubSettleState` -- scrub-to-play transition state

---

### Work Unit 6: Cleanup & Cross-Reference Pass

**Agent scope:** All modified files (verification pass)
**Dependencies:** ALL previous work units must be complete.

This is a verification and cross-reference pass, not a content creation pass. The agent should:

1. **Verify all "Back to Index" links** work correctly (especially after renames/deletions).

2. **Verify docs/Features/README.md index** links:
   - `./YouTube.md` must be changed to `./Download-Panel.md`
   - `./effects-system.md` link must be removed (merged into Effects.md)
   - `./SharedDecoderArchitecture.md` link must be removed (merged into Export.md)
   - `./FEATURES.md` link must be removed (deleted)
   - `./FFMPEG_WASM_BUILD_PLAN.md` link must be updated to `../plans/FFMPEG_WASM_BUILD_PLAN.md` or removed

3. **Verify cross-document links** in modified files (e.g., Export.md linking to GPU-Engine.md, Effects.md internal sections, etc.)

4. **Standardize "Back to Index" link format** to `[<- Back to Index](./README.md)` across all remaining feature docs.

5. **Add "Related Documents" section** to feature docs that lack them:
   - `Debugging.md`: Related: GPU-Engine.md (troubleshooting), AI-Integration.md (AI debug tools)
   - `Multicam-AI.md`: Related: AI-Integration.md, Audio.md
   - `Native-Helper.md`: Related: Download-Panel.md, Project-Persistence.md
   - `Text-Clips.md`: Related: Timeline.md, Keyframes.md

6. **Verify no references remain** to deleted files (FEATURES.md, effects-system.md, SharedDecoderArchitecture.md).

7. **Add navigation links between related docs:**
   - `Export.md` should link to `GPU-Engine.md` (render pipeline used in export)
   - `Native-Helper.md` should link to `Download-Panel.md` and `Project-Persistence.md`
   - `Multicam-AI.md` should link to `AI-Integration.md` and `Audio.md`

---

## Execution Order

| Batch | Work Units | Can run in parallel? | Notes |
|-------|-----------|---------------------|-------|
| 1 | WU1 (Root Documents) | Solo | Must complete first -- establishes correct metrics and architecture tree |
| 2 | WU2 (Doc Index + Structure), WU3 (Engine/Export/Effects), WU4 (Timeline/Keyframes/Masks/Media), WU5 (AI/UI/Preview/Debug) | Yes, all 4 in parallel | WU2 depends on WU1 metrics. WU3-5 are independent of each other. |
| 3 | WU6 (Cleanup & Cross-References) | Solo | Must run last -- verifies all links and references after all changes |

**Total files touched:** 16 (2 root docs + 14 feature docs)
**Total files deleted:** 3 (FEATURES.md, effects-system.md, SharedDecoderArchitecture.md)
**Total files renamed:** 1 (YouTube.md -> Download-Panel.md)
**Total files moved:** 1 (FFMPEG_WASM_BUILD_PLAN.md -> docs/plans/)

---

## Acceptance Criteria

When all work units are complete, the following must be true:

### Metric accuracy
- [ ] Version `1.3.5` appears in: README.md badge, docs/Features/README.md header
- [ ] No reference to version `1.2.11` or `1.3.4` remains in any core doc
- [ ] LOC stated as `~120k` or `~124k` (not `~60k`) in README.md
- [ ] WGSL count stated as `2,500+` in README.md, `~2,565` (files) or `~3,000` (total) in technical docs
- [ ] AI tool count is `76` everywhere (not `33` or `80`)
- [ ] Google Fonts count is `50` everywhere (not `57`)
- [ ] Panel types count is `17` everywhere (not `16`)
- [ ] Timeline store slices count is `17` everywhere (not `7`)
- [ ] Test count is `~1,717` / `44 files` everywhere (not `~1,659` / `35`)
- [ ] `keyframeSlice.test.ts` count is `96` (not `14` or `94`)
- [ ] `keyframeInterpolation.test.ts` count is `112` (not `120`)
- [ ] `compositionSlice.test.ts` count is `101` (not `99`)
- [ ] Render target count is `7` (not `8`)
- [ ] OutputPipeline uniform buffers count is `3` (not `2`)
- [ ] Export codecs are `4` (H.264, H.265, VP9, AV1) with correct codec strings
- [ ] `useFullWebCodecsPlayback` documented as `false` (not `true`)
- [ ] `output.wgsl` line count is `83` (not `71`)
- [ ] Effect shader line count is `1,108` (not `~954`)
- [ ] `common.wgsl` documented at `src/effects/_shared/common.wgsl` (not `src/shaders/`)

### Structural integrity
- [ ] `docs/Features/FEATURES.md` does not exist
- [ ] `docs/Features/effects-system.md` does not exist (content merged into Effects.md)
- [ ] `docs/Features/SharedDecoderArchitecture.md` does not exist (content merged into Export.md)
- [ ] `docs/Features/YouTube.md` does not exist (renamed to Download-Panel.md)
- [ ] `docs/Features/Download-Panel.md` exists
- [ ] `docs/plans/FFMPEG_WASM_BUILD_PLAN.md` exists (moved from Features/)
- [ ] `docs/Features/FFMPEG_WASM_BUILD_PLAN.md` does not exist
- [ ] No doc references deleted/renamed files by their old names
- [ ] All feature docs in docs/Features/ have a "Back to Index" link

### Content completeness
- [ ] CLAUDE.md Section 9 (Next.js patterns) is removed
- [ ] CLAUDE.md Section 4 contains the 3 universal patterns (functional setState, lazy init, toSorted)
- [ ] CLAUDE.md Section 3 architecture tree lists all 17 timeline slices, all 9 mediaStore slices, expanded engine/services/hooks/utils directories
- [ ] CLAUDE.md Section 7 has Firefox texture exception
- [ ] GPU-Engine.md documents stacked alpha export, Firefox fallback, correct LayerCollector priority, correct EngineStats fields
- [ ] Export.md has correct codec table (4 codecs), NOT IMPLEMENTED banner on V2, SharedDecoder appendix
- [ ] Effects.md has developer internals section (merged from effects-system.md), correct file path, default values
- [ ] Timeline.md has all missing actions, state shape docs, selectors.ts docs
- [ ] Masks.md has all 17 actions and all ClipMask fields
- [ ] AI-Integration.md has correct tool count, visual feedback system, bridge architecture
- [ ] UI-Panels.md has 14-campaign tutorial system, mobile UI section, stacked alpha
- [ ] Debugging.md has pipeline monitor globals and monitoring services overview

### Code bugs documented (NOT fixed)
- [ ] `openComposition` handler bug is noted in AI-Integration.md or master plan
- [ ] `searchVideos`/`searchYouTube` name mismatch is noted in AI-Integration.md or master plan
