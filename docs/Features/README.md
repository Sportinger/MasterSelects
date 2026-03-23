[← Back to Project](../../README.md)

# MASterSelects Documentation

**Professional WebGPU Video Compositor & Timeline Editor**

Version 1.4.2 | March 2026

---

## Overview

MASterSelects is a browser-based professional video editing application built on cutting-edge WebGPU technology. It delivers After Effects-style compositing, multi-track timeline editing, AI-powered workflows, and real-time GPU rendering—all running entirely in the browser with no plugins or installations required.

### Key Highlights

| Capability | Description |
|------------|-------------|
| **WebGPU Rendering** | Hardware-accelerated compositing with zero-copy video textures at 60fps |
| **Multi-track Timeline** | Professional NLE with video/audio tracks, nested compositions, and multicam |
| **Keyframe Animation** | Full property animation with bezier curve editor and 5 easing modes |
| **AI Integration** | 76 intelligent editing tools via OpenAI function calling (GPT-4/GPT-5) |
| **AI Video Generation** | PiAPI integration for AI-powered video creation |
| **SAM2 Segmentation** | Click-to-segment object tracking with WebGPU ONNX inference |
| **Download Panel** | Download videos from YouTube, TikTok, Instagram, Twitter/X and more |
| **3D Layer System** | Three.js integration: per-layer 3D toggle, OBJ/glTF/GLB model import, primitive mesh creation (Cube/Sphere/Plane/Cylinder/Torus/Cone), perspective camera |
| **30 GPU Effects** | Modular color, blur, distort, stylize, keying effects with quality controls |
| **37 Blend Modes** | After Effects-style blend modes including stencil and silhouette |
| **Video Scopes** | GPU-accelerated Histogram, Vectorscope, Waveform monitor (DaVinci-style) |
| **Text Clips** | Typography with 50 Google Fonts, stroke, shadow effects |
| **Solid Color Clips** | Solid color layers with color picker and comp dimensions |
| **Professional Audio** | 10-band parametric EQ with live Web Audio, audio master clock, varispeed |
| **Multicam Support** | Audio-based cross-correlation synchronization |
| **Transitions** | Crossfade transitions with GPU-accelerated rendering |
| **4 Export Modes** | WebCodecs Fast, HTMLVideo Precise, FFmpeg WASM, FCP XML interchange |
| **Parallel Decoding** | Multi-clip parallel decode for faster exports |
| **Output Manager** | Source routing, slice management, corner pin warping, multi-window control |
| **Slot Grid** | Resolume-style 4x12 grid with multi-layer playback and column activation |
| **Native Helper** | Project storage for Firefox, yt-dlp downloads, AI bridge |
| **Local Storage** | Project folder with Raw media, autosave, backups, smart relinking |
| **Mobile Support** | Responsive UI with touch gestures |

---

## Technology Stack

```
Frontend          React 19 + TypeScript + Vite 7.2
State Management  Zustand with modular slice architecture
GPU Rendering     WebGPU + WGSL shaders (2,500+ lines)
3D Engine         Three.js (lazy-loaded, isolated scene renderer)
GPU Effects       30 modular effects with individual WGSL shaders
Video Decoding    WebCodecs API with hardware acceleration + parallel decode
Video Encoding    WebCodecs (Fast/Precise) + FFmpeg WASM (ProRes, DNxHR, HAP)
Audio Processing  Web Audio API, audio master clock, varispeed scrubbing
AI Services       OpenAI GPT-4/GPT-5 function calling, PiAPI video generation
Persistence       File System Access API + local project folders with Raw media
Native Helper     Rust + FFmpeg + yt-dlp (unified cross-platform)
UI Framework      Custom dockable panel system with mobile support
```

---

## Documentation Index

### Feature Documentation

| Document | Description |
|----------|-------------|
| [Timeline](./Timeline.md) | Multi-track editing, clips, snapping, compositions, multicam |
| [Keyframes](./Keyframes.md) | Animation system, curve editor, bezier interpolation |
| [Preview & Playback](./Preview.md) | RAM Preview, scrubbing, multiple outputs, edit mode |
| [Output Manager](./Preview.md#output-manager) | Source routing, slices, corner pin warping, mask layers |
| [3D Layers](./3D-Layers.md) | Three.js 3D layers, OBJ/glTF model import, perspective camera |
| [Effects](./Effects.md) | 30 modular GPU effects, 37 blend modes, transforms |
| [Masks](./Masks.md) | Shape masks, pen tool, GPU feathering |
| [AI Integration](./AI-Integration.md) | 76 AI tools, transcription, AI video generation |
| [Media Panel](./Media-Panel.md) | Import, folder organization, columns, compositions |
| [Audio](./Audio.md) | 10-band EQ, audio master clock, varispeed scrubbing |
| [Text Clips](./Text-Clips.md) | Typography, 50 Google Fonts, stroke, shadow |
| [Export](./Export.md) | WebCodecs Fast/Precise, FFmpeg, parallel decoding |
| [UI & Panels](./UI-Panels.md) | Dockable panels, layouts, menus, mobile support |
| [GPU Engine](./GPU-Engine.md) | WebGPU architecture, modular render pipeline |
| [Project Persistence](./Project-Persistence.md) | Local folders, Raw media, autosave, backups |
| [Proxy System](./Proxy-System.md) | GPU-accelerated proxy generation |
| [Download Panel](./Download-Panel.md) | YouTube, TikTok, Instagram, Twitter/X downloads |
| [Native Helper](./Native-Helper.md) | Project storage (Firefox), yt-dlp downloads, AI bridge |
| [Multicam AI](./Multicam-AI.md) | Audio-based sync, cross-correlation |
| [Keyboard Shortcuts](./Keyboard-Shortcuts.md) | Complete shortcut reference |
| [Debugging](./Debugging.md) | Logger service, module filtering, AI-agent inspection |

### Planning Documents

| Document | Description |
|----------|-------------|
| [FFmpeg WASM Build Plan](../plans/FFMPEG_WASM_BUILD_PLAN.md) | Custom FFmpeg WASM build with professional codecs |

> Feature details are documented in the individual feature docs linked in the Documentation Index above.

---

## Architecture

```
+-------------------------------------------------------------------------+
|                              UI Layer                                    |
|  +--------------+ +--------------+ +--------------+ +------------------+ |
|  |  Timeline    | |   Preview    | |   Media      | |  Effects/Props   | |
|  |   (React)    | |  (Canvas)    | |   Panel      | |  AI Chat Panel   | |
|  +--------------+ +--------------+ +--------------+ +------------------+ |
|-------------------------------------------------------------------------|
|                         State Layer (Zustand)                            |
|  +--------------+ +--------------+ +--------------+ +------------------+ |
|  |  Timeline    | |   Dock       | |   Media      | |    Multicam      | |
|  |   Store      | |   Store      | |   Store      | |     Store        | |
|  | (17 slices)  | |              | |              | |                  | |
|  +--------------+ +--------------+ +--------------+ +------------------+ |
|-------------------------------------------------------------------------|
|                        Engine Layer (WebGPU)                             |
|  +--------------+ +--------------+ +--------------+ +------------------+ |
|  | Compositor   | |  Effects     | |  Texture     | |     Frame        | |
|  |  Pipeline    | |  Pipeline    | |  Manager     | |    Exporter      | |
|  +--------------+ +--------------+ +--------------+ +------------------+ |
|  +--------------+ +--------------+ +--------------+                      |
|  |   Mask       | |  Scrubbing   | |  Optical     |                      |
|  |  Manager     | |   Cache      | |    Flow      |                      |
|  +--------------+ +--------------+ +--------------+                      |
|-------------------------------------------------------------------------|
|                          Services Layer                                  |
|  +--------------+ +--------------+ +--------------+ +------------------+ |
|  |   Audio      | |  Whisper     | |  Project     | |    AI Tools      | |
|  |  Manager     | |  Service     | |     DB       | |   (OpenAI)       | |
|  +--------------+ +--------------+ +--------------+ +------------------+ |
|  +--------------+ +--------------+ +--------------+                      |
|  |   Proxy      | | FileSystem   | |   Audio      |                      |
|  | Generator    | |  Service     | |    Sync      |                      |
|  +--------------+ +--------------+ +--------------+                      |
+-------------------------------------------------------------------------+
```

### WGSL Shader Breakdown

| File | Lines | Purpose |
|------|-------|---------|
| `composite.wgsl` | 618 | Layer compositing, 37 blend modes |
| `opticalflow.wgsl` | 326 | Motion analysis, scene detection |
| `effects.wgsl` | 243 | GPU effect implementations |
| `output.wgsl` | 83 | Final output passthrough |
| `slice.wgsl` | 33 | Output slice rendering |
| `common.wgsl` (`src/effects/_shared/common.wgsl`) | 154 | Shared effect utilities |
| 30 effect shaders | ~1,108 | Individual GPU effect shaders |
| **Total** | **~2,565** | *Plus ~435 lines inline WGSL in CompositorPipeline.ts* |

### Zustand Store Architecture

```
timelineStore/
  trackSlice.ts            # Track CRUD operations
  clipSlice.ts             # Clip operations, transforms
  playbackSlice.ts         # Play/pause, seeking, time
  keyframeSlice.ts         # Keyframe CRUD, interpolation
  selectionSlice.ts        # Clip/keyframe selection
  maskSlice.ts             # Mask shapes and vertices
  transitionSlice.ts       # Crossfade transitions
  ramPreviewSlice.ts       # RAM Preview cache control
  proxyCacheSlice.ts       # Proxy cache invalidation
  clipEffectSlice.ts       # Effect instances on clips
  linkedGroupSlice.ts      # Video-audio linked groups
  downloadClipSlice.ts     # Download clip management
  solidClipSlice.ts        # Solid color clip creation
  textClipSlice.ts         # Text clip creation
  clipboardSlice.ts        # Cut/copy/paste with media reload
  aiActionFeedbackSlice.ts # AI visual feedback overlays
  markerSlice.ts           # Timeline markers
```

---

## Source Code Reference

| Area | Location |
|------|----------|
| Timeline Components | `src/components/timeline/` |
| Panel Components | `src/components/panels/` |
| Preview System | `src/components/preview/` |
| GPU Engine | `src/engine/` |
| WGSL Shaders | `src/shaders/` |
| State Management | `src/stores/` |
| Services | `src/services/` |
| React Hooks | `src/hooks/` |

---

## Test Coverage

Overview of unit test coverage across feature areas. Run all tests with `npx vitest run`.

| Feature Area | Test Files | Notes |
|-------------|-----------|-------|
| [Timeline](./Timeline.md) | clipSlice, trackSlice, selectionSlice, playbackSlice, markerSlice | Clips, tracks, selection, playback, markers |
| [Keyframes](./Keyframes.md) | keyframeSlice, keyframeInterpolation | Keyframe CRUD, easing, bezier interpolation |
| [Preview](./Preview.md) | layerCollector, layerBuilderService, webCodecsPlayer, videoSyncManager, videoSyncManagerSyncGate | Layer collection, media runtime, WebCodecs playback |
| [Export](./Export.md) | exportUtils, webCodecsHelpers | FCP XML, time calculations, codecs, presets |
| [Audio](./Audio.md) | audioUtils, crossCorrelation, speedIntegration | AudioUtils, cross-correlation, playback speed |
| [Effects](./Effects.md) | effectsRegistry, typeHelpers | Registry, type helpers |
| [GPU Engine](./GPU-Engine.md) | transformComposition, compositor | Transform composition, cycle detection |
| [Masks](./Masks.md) | maskSlice | Mask CRUD, modes, vertices, workflows |
| [AI Integration](./AI-Integration.md) | aiToolDefinitions | Tool definitions, schemas, MODIFYING_TOOLS |
| [Text Clips](./Text-Clips.md) | clipSlice | Covered by clipSlice tests |
| [Media Panel](./Media-Panel.md) | fileManageSlice, compositionSlice | Files, compositions |
| [Proxy System](./Proxy-System.md) | -- | Hardware-dependent |
| [Download Panel](./Download-Panel.md) | -- | Requires network/native helper |
| [Project Persistence](./Project-Persistence.md) | serialization, historyStore | Serialization, undo/redo |
| [Native Helper](./Native-Helper.md) | -- | Rust binary, tested separately |
| [Keyboard Shortcuts](./Keyboard-Shortcuts.md) | playbackSlice, speedIntegration | Playback, speed integration |
| [UI Panels](./UI-Panels.md) | -- | React component-level UI |
| [Multicam AI](./Multicam-AI.md) | crossCorrelation | Audio sync cross-correlation |
| Engine internals | mediaRuntime, framePhaseMonitor, playbackDebugStats, playbackHealthMonitor, playbackSliceGate, externalDragPlacement, externalDragSession, logger | Playback pipeline, drag-drop, logging |

**Total: ~1,717 tests across 44 test files**

---

## Not Yet Implemented

The following features are planned but not currently available:

- Cloud storage integration
- Asset library across projects
- Batch import settings
- Multi-pass encoding
- Background export queue

---

## Version History

See `src/version.ts` and `src/changelog-data.json` for the authoritative changelog.
Current version: 1.4.2.

---

## License

MIT - see [LICENSE](../../LICENSE)

---

*Documentation updated March 2026*
