# MASterSelects Refactoring Plan

## Overview

This document tracks the refactoring of large "god object" files in the codebase. The goal is to improve maintainability, testability, and developer experience by breaking down monolithic files into focused, single-responsibility modules.

---

## God Object Inventory

| File | Lines | Priority | Status |
|------|-------|----------|--------|
| `src/services/aiTools.ts` | 1902 | Medium | Planned |
| `src/services/layerBuilder.ts` | 1505 | High | **Planned** |
| `src/components/export/ExportPanel.tsx` | 1503 | Medium | Planned |
| `src/engine/WebCodecsPlayer.ts` | 1422 | Low | Planned |
| `src/components/panels/PropertiesPanel.tsx` | 1329 | Low | Stable |
| `src/components/timeline/Timeline.tsx` | 1327 | - | **Done** (was 2109) |
| `src/components/panels/MediaPanel.tsx` | 1164 | Low | Stable |
| `src/stores/timeline/index.ts` | 1107 | Medium | Planned |
| `src/engine/WebGPUEngine.ts` | 1010 | - | **Done** (was ~2200) |
| `src/services/proxyGenerator.ts` | 1010 | Low | Stable |

---

## Completed Refactors

### Timeline.tsx (2109 → 1327 lines)

**Extracted:**
- `src/components/timeline/hooks/useTimelineKeyboard.ts`
- `src/components/timeline/hooks/useTimelineZoom.ts`
- `src/components/timeline/hooks/usePlayheadDrag.ts`
- `src/components/timeline/hooks/useMarqueeSelection.ts`
- `src/components/timeline/hooks/useClipTrim.ts`
- `src/components/timeline/hooks/useClipDrag.ts`
- `src/components/timeline/hooks/useLayerSync.ts`

### WebGPUEngine.ts (~2200 → 1010 lines)

**Extracted to `src/engine/`:**
- `core/WebGPUContext.ts`
- `core/RenderTargetManager.ts`
- `render/RenderLoop.ts`
- `render/Compositor.ts`
- `render/LayerCollector.ts`
- `render/NestedCompRenderer.ts`
- `pipeline/CompositorPipeline.ts`
- `pipeline/EffectsPipeline.ts`
- `pipeline/OutputPipeline.ts`
- `texture/TextureManager.ts`
- `texture/MaskTextureManager.ts`
- `texture/ScrubbingCache.ts`
- `stats/PerformanceStats.ts`
- `managers/OutputWindowManager.ts`

### FrameExporter.ts (1510 → ~300 lines)

**Extracted to `src/engine/export/`:**
- `ClipPreparation.ts`
- `ExportLayerBuilder.ts`
- `VideoEncoderWrapper.ts`
- `VideoSeeker.ts`
- `codecHelpers.ts`
- `types.ts`

---

## Active Refactors

### 1. LayerBuilder (Priority: High)

**File:** `src/services/layerBuilder.ts` (1505 lines)

**Problem:** Single class handling 7+ responsibilities:
- Playhead state management
- Layer caching
- Layer building from store
- Video element synchronization
- Audio element synchronization (450 lines!)
- Nested composition handling
- Proxy frame handling

**Target Structure:**
```
src/services/layerBuilder/
├── index.ts                 # Re-exports, singleton
├── PlayheadState.ts         # ~50 lines
├── LayerCache.ts            # ~100 lines
├── VideoSyncService.ts      # ~150 lines
├── AudioSyncService.ts      # ~300 lines
├── NestedCompService.ts     # ~250 lines
├── ProxyLayerBuilder.ts     # ~150 lines
├── LayerBuilderService.ts   # ~200 lines
└── types.ts                 # ~50 lines
```

**Detailed Plan:** [LayerBuilder-Refactor-Plan.md](./LayerBuilder-Refactor-Plan.md)

---

## Planned Refactors

### 2. aiTools.ts (Priority: Medium)

**File:** `src/services/aiTools.ts` (1902 lines)

**Problem:** 50+ AI tool definitions in single file, hard to navigate

**Target Structure:**
```
src/services/aiTools/
├── index.ts                 # Main exports, tool registry
├── types.ts                 # Tool interfaces
├── clipTools.ts             # Clip operations (~15 tools)
├── trackTools.ts            # Track operations (~8 tools)
├── keyframeTools.ts         # Keyframe operations (~10 tools)
├── effectTools.ts           # Effect operations (~8 tools)
├── mediaTools.ts            # Media/import operations (~5 tools)
├── playbackTools.ts         # Playback control (~4 tools)
└── queryTools.ts            # Information queries (~10 tools)
```

**Benefits:**
- Find tools by category
- Add new tools without scrolling 2000 lines
- Test tool categories independently

---

### 3. ExportPanel.tsx (Priority: Medium)

**File:** `src/components/export/ExportPanel.tsx` (1503 lines)

**Problem:** UI and export logic mixed, multiple export modes interleaved

**Target Structure:**
```
src/components/export/
├── ExportPanel.tsx          # Main panel (~200 lines)
├── ExportSettings.tsx       # Settings form (~150 lines)
├── ExportProgress.tsx       # Progress overlay (~100 lines)
├── hooks/
│   ├── useExportState.ts    # Export state management (~150 lines)
│   ├── useWebCodecsExport.ts # Fast mode logic (~200 lines)
│   ├── useHTMLVideoExport.ts # Precise mode logic (~150 lines)
│   └── useFFmpegExport.ts   # FFmpeg mode logic (~200 lines)
└── utils/
    ├── codecDetection.ts    # Codec support detection
    └── exportHelpers.ts     # Shared utilities
```

**Benefits:**
- Each export mode isolated
- UI separate from logic
- Easier to add new export modes

---

### 4. timeline/index.ts (Priority: Medium)

**File:** `src/stores/timeline/index.ts` (1107 lines)

**Problem:** Store barrel file contains too much logic

**Target Structure:**
```
src/stores/timeline/
├── index.ts                 # Clean barrel export (~50 lines)
├── createStore.ts           # Store creation (~100 lines)
├── selectors.ts             # Derived selectors (~150 lines)
├── compositionSlice.ts      # Composition management (new)
└── ... (existing slices)
```

---

### 5. WebCodecsPlayer.ts (Priority: Low)

**File:** `src/engine/WebCodecsPlayer.ts` (1422 lines)

**Problem:** Complex state machine with multiple responsibilities

**Target Structure:**
```
src/engine/video/
├── WebCodecsPlayer.ts       # Main player (~400 lines)
├── DecoderStateMachine.ts   # State management (~300 lines)
├── FrameBuffer.ts           # Frame buffering (~200 lines)
├── MP4Demuxer.ts            # MP4 parsing (~300 lines)
└── SeekController.ts        # Seek logic (~200 lines)
```

---

## Refactoring Guidelines

### When to Refactor

1. **File > 1000 lines** - Consider splitting
2. **File > 500 lines with multiple concerns** - Definitely split
3. **Before adding major features** - Clean up first
4. **When bugs are hard to trace** - Complexity hiding bugs

### When NOT to Refactor

1. **Stable code that works** - Don't fix what isn't broken
2. **Before a deadline** - Risk of regression
3. **Without tests** - Add tests first if possible
4. **Single responsibility already** - Large is OK if focused

### Refactoring Process

1. **Document current structure** - Understand before changing
2. **Identify boundaries** - Where do responsibilities split?
3. **Create new files** - Don't delete old code yet
4. **Move code piece by piece** - Small, testable changes
5. **Update imports** - Fix all references
6. **Test thoroughly** - Especially edge cases
7. **Delete old code** - Only after everything works
8. **Update documentation** - CLAUDE.md, README, etc.

### Code Quality Targets

| Metric | Target | Current Avg |
|--------|--------|-------------|
| Max file lines | 500 | ~400 |
| Max function lines | 50 | ~30 |
| Cyclomatic complexity | <10 | ~8 |
| Dependencies per file | <10 | ~7 |

---

## Progress Tracking

### Q1 2026 Goals

- [x] Timeline.tsx refactor
- [x] WebGPUEngine refactor
- [x] FrameExporter refactor
- [ ] LayerBuilder refactor
- [ ] aiTools refactor

### Metrics

| Date | Total LOC | Largest File | Avg File Size |
|------|-----------|--------------|---------------|
| Dec 2025 | ~70,000 | 2,109 (Timeline) | ~450 |
| Jan 2026 | ~76,000 | 1,902 (aiTools) | ~400 |

---

## Related Documents

- [LayerBuilder-Refactor-Plan.md](./LayerBuilder-Refactor-Plan.md) - Detailed plan
- [../Features/README.md](../Features/README.md) - Feature documentation
- [../../CLAUDE.md](../../CLAUDE.md) - Project structure reference

---

*Last updated: January 2026*
