# GPU Engine

[← Back to Index](./README.md)

WebGPU-powered rendering with zero-copy textures, multi-target output, and GPU-accelerated scopes.

---

## Table of Contents

- [Architecture](#architecture)
- [Texture Management](#texture-management)
- [Compositing Pipeline](#compositing-pipeline)
- [Render Loop](#render-loop)
- [Video Decoding](#video-decoding)
- [Shader Capabilities](#shader-capabilities)
- [Optical Flow](#optical-flow)
- [Scopes & Analysis](#scopes--analysis)
- [Caching](#caching)
- [Output Targets](#output-targets)
- [Export Pipeline](#export-pipeline)
- [Structural Sharing](#structural-sharing)
- [Feature Flags](#feature-flags)
- [Performance](#performance)
- [Troubleshooting](#troubleshooting)

---

## Architecture

### Engine Directory Structure
```
src/engine/
  WebGPUEngine.ts           # Thin facade orchestrating all subsystems
  WebCodecsPlayer.ts        # Full WebCodecs decoding (MP4Box demux + VideoDecoder)
  WebCodecsExportMode.ts    # Sequential export frame decoding
  ParallelDecodeManager.ts  # Parallel multi-clip decoding for export
  featureFlags.ts           # Runtime feature toggles
  webCodecsTypes.ts         # Shared MP4Box/sample types
  index.ts                  # Public exports
  core/
    WebGPUContext.ts         # GPU adapter/device/canvas management + device loss recovery
    RenderTargetManager.ts   # Ping-pong buffers, independent preview buffers, effect temp textures
    types.ts                 # Layer, BlendMode, EngineStats, LayerRenderData, blend mode map
  render/
    RenderLoop.ts            # RAF loop with idle detection, frame rate limiting, watchdog
    RenderDispatcher.ts      # Orchestrates per-frame render: collect -> composite -> output
    Compositor.ts            # Ping-pong compositing with inline + complex effects
    LayerCollector.ts        # Imports textures from video/image/text/nested sources
    NestedCompRenderer.ts    # Pre-renders nested compositions to offscreen textures
    layerEffectStack.ts      # Splits effects into inline vs. complex categories via splitLayerEffects()
  pipeline/
    CompositorPipeline.ts    # GPU pipelines for standard + external composite + copy shaders
    EffectsPipeline.ts       # (in src/effects/) Modular per-effect GPU pipelines
    OutputPipeline.ts        # Final output to canvas with optional transparency grid
    SlicePipeline.ts         # Corner-pin warped slices with 16x16 subdivision
  texture/
    TextureManager.ts        # Image/canvas/video/ImageBitmap texture creation and caching
    MaskTextureManager.ts    # Per-layer mask textures with white fallback
    ScrubbingCache.ts        # LRU frame cache for scrubbing, last-frame cache, RAM preview
  managers/
    CacheManager.ts          # Owns ScrubbingCache lifecycle + video time tracking
    ExportCanvasManager.ts   # OffscreenCanvas for zero-copy VideoFrame export
    OutputWindowManager.ts   # External popup windows for multi-display output
  video/
    VideoFrameManager.ts     # requestVideoFrameCallback tracking for frame readiness
  stats/
    PerformanceStats.ts      # FPS, timing, frame drop tracking with ring buffer
  analysis/
    OpticalFlowAnalyzer.ts   # GPU Lucas-Kanade optical flow (compute shaders)
    ScopeRenderer.ts         # Delegates to waveform/histogram/vectorscope
    ScopeAnalyzer.ts         # CPU histogram computation (pure functions)
    HistogramScope.ts        # GPU-accelerated histogram (compute + render)
    WaveformScope.ts         # GPU-accelerated waveform with phosphor glow
    VectorscopeScope.ts      # GPU-accelerated vectorscope (BT.709 CbCr)
  audio/
    AudioExtractor.ts        # Decode audio from media files
    AudioEncoder.ts          # WebCodecs AAC/Opus encoding
    AudioMixer.ts            # Multi-track mixing with mute/solo
    TimeStretchProcessor.ts  # Speed/pitch manipulation (SoundTouchJS)
    AudioEffectRenderer.ts   # EQ/volume with keyframe automation
    AudioExportPipeline.ts   # Orchestrates complete audio export
  export/
    FrameExporter.ts         # Frame-by-frame export orchestrator
    VideoEncoderWrapper.ts   # WebCodecs VideoEncoder + mp4/webm muxers
    ClipPreparation.ts       # Prepare clips for export mode
    ExportLayerBuilder.ts    # Build layers at arbitrary time for export
    VideoSeeker.ts           # Seek all clips to export time
    codecHelpers.ts          # Codec strings, presets, support checks
    types.ts                 # ExportSettings, VideoCodec, ContainerFormat
  ffmpeg/
    FFmpegBridge.ts          # FFmpeg WASM bridge for advanced encoding
    codecs.ts                # FFmpeg codec definitions
    types.ts                 # FFmpeg types
  structuralSharing/
    SnapshotManager.ts       # Undo/redo snapshots with structural sharing
    types.ts                 # SerializedClipState, HistorySnapshotV2, DomRefRegistry
```

### Engine Facade (WebGPUEngine.ts)

The `WebGPUEngine` class is a thin facade that orchestrates all subsystems:

```
WebGPUEngine (Facade)
  Core:
  ├── WebGPUContext             # GPU adapter, device, canvas configuration
  ├── RenderTargetManager       # Ping-pong + independent + effect temp textures
  ├── PerformanceStats          # FPS, timing, drops

  Render:
  ├── RenderLoop                # RAF with idle detection + watchdog
  ├── RenderDispatcher          # Orchestrates per-frame render
  ├── LayerCollector            # Texture import from all source types
  ├── Compositor                # Ping-pong compositing + effects
  └── NestedCompRenderer        # Offscreen nested composition rendering

  Pipelines:
  ├── CompositorPipeline        # Standard + external composite GPU pipelines
  ├── EffectsPipeline           # Per-effect GPU pipelines (30+ effects)
  ├── OutputPipeline            # Final output with transparency grid
  └── SlicePipeline             # Corner-pin warped slice output

  Textures:
  ├── TextureManager            # Image/canvas/video/bitmap textures
  ├── MaskTextureManager        # Per-layer mask textures
  └── VideoFrameManager         # RVFC frame readiness tracking

  Managers:
  ├── CacheManager              # ScrubbingCache + video time tracking
  ├── ExportCanvasManager       # Zero-copy export via OffscreenCanvas
  └── OutputWindowManager       # External popup windows
```

### Initialization

```typescript
// WebGPUContext.ts
- GPU adapter: powerPreference configurable ('high-performance' | 'low-power')
- Device: `requiredLimits: { maxTextureDimension2D: 4096 }`
- Canvas: preferred format via navigator.gpu.getPreferredCanvasFormat()
- Alpha mode: 'opaque' for preview canvases, 'premultiplied' for export
- Sampler: linear filtering, clamp-to-edge
- Device loss recovery: 100ms delay before re-initialization (only setTimeout in WebGPUContext)
```

### Device Loss Recovery

```
Device Lost → notify callbacks → clean GPU resources → wait 100ms →
  → re-initialize (up to 3 attempts) → recreate all resources →
  → reconfigure canvases → restart render loop → notify restored
```

### HMR Singleton

```typescript
// Survives hot module reload
if (hot?.data?.engine) {
  engineInstance = hot.data.engine;
  existing.clearVideoCache();
} else {
  engineInstance = new WebGPUEngine();
  hot.data.engine = engineInstance;
}
```

---

## Texture Management

### Texture Types
| Source | GPU Type | Copy | Caching |
|--------|----------|------|---------|
| HTMLVideoElement | `GPUExternalTexture` | Zero-copy | Per-video last-frame + scrubbing cache |
| VideoFrame (WebCodecs) | `GPUExternalTexture` | Zero-copy | None (frame buffer managed by decoder) |
| HTMLImageElement | `texture_2d<f32>` (rgba8unorm) | Copy once | By HTMLImageElement reference |
| HTMLCanvasElement (text) | `texture_2d<f32>` (rgba8unorm) | Copy once | By HTMLCanvasElement reference |
| ImageBitmap (NativeHelper) | `texture_2d<f32>` (rgba8unorm) | Copy per frame | Reusable by layer ID (avoids 30+ tex/sec) |

### Video Textures (TextureManager.ts)
```typescript
// Zero-copy import
device.importExternalTexture({ source: video })

// Requirements
- HTMLVideoElement: readyState >= 2 && videoWidth > 0
- VideoFrame: not closed && codedWidth > 0
- Fallback to cached frame on failure
```

### Image Textures
```typescript
copyExternalImageToTexture(image, texture)
- Cached by HTMLImageElement reference
- View caching via cachedImageViews Map
- Uses naturalWidth/naturalHeight
```

### Mask Textures (MaskTextureManager.ts)
- Per-layer mask textures uploaded from ImageData
- White 1x1 fallback texture when no mask is applied
- Single-lookup `getMaskInfo()` returns `{ hasMask, view }`

---

## Compositing Pipeline

### Four GPU Render Pipelines (CompositorPipeline.ts)

1. **Standard Composite** - Image/canvas textures (`texture_2d<f32>`)
2. **External Composite** - Video textures (`texture_external`)
3. **Standard Copy** - Simple texture-to-texture copy (for effect pre-processing)
4. **External Copy** - External texture to rgba8unorm copy (for effect pre-processing)

### Layer Uniform Structure (96 bytes / 24 floats)

```wgsl
// CompositorPipeline uniform layout
[0]  opacity: f32
[1]  blendMode: u32              // 0-36 (37 blend modes)
[2]  positionX: f32
[3]  positionY: f32
[4]  scaleX: f32
[5]  scaleY: f32
[6]  rotationZ: f32              // radians
[7]  sourceAspect: f32
[8]  outputAspect: f32
[9]  time: f32                   // for dissolve effects
[10] hasMask: u32                // 0 or 1
[11] maskInvert: u32             // 0 or 1
[12] rotationX: f32              // radians
[13] rotationY: f32              // radians
[14] perspectiveDistance: f32     // default 2.0
[15] maskFeather: f32            // blur radius in pixels
[16] maskFeatherQuality: u32     // 0=low, 1=med, 2=high
[17] positionZ: f32              // depth position
[18] inlineBrightness: f32       // 0 = no change
[19] inlineContrast: f32         // 1 = no change
[20] inlineSaturation: f32       // 1 = no change
[21] inlineInvert: u32           // 0 or 1
[22] _pad4: f32
[23] _pad5: f32
```

### Inline vs. Complex Effects

Effects are classified at composite time:
- **Inline effects** (brightness, contrast, saturation, invert) are applied as uniforms in the composite shader. No extra render passes.
- **Complex effects** (blur, pixelate, glow, etc.) require separate pre-processing render passes on the source texture before compositing.

### Ping-Pong Rendering

```
Clear Ping → transparent

Layer 1 → Read Ping, Write Pong (composite)
Layer 2 → Read Pong, Write Ping (composite)
Layer 3 → Read Ping, Write Pong (composite)
...
Final → Output Pipeline → Canvas(es)
```

### Render Targets (RenderTargetManager.ts)

7 textures total, all `rgba8unorm`:
- **Ping/Pong** - Main compositing buffers
- **Independent Ping/Pong** - Separate buffers for multi-composition preview
- **Effect Temp 1/2** - For pre-processing complex effects on source layers
- **Black texture** - 1x1 pixel for empty frame output

`createPingPongTextures()` nulls references for GC instead of calling `.destroy()` to avoid 'Destroyed texture used in a submit' warnings (VRAM leak fix, commit 0242668d).

### Nested Composition Rendering (NestedCompRenderer.ts)

- Pre-renders nested compositions to offscreen textures before main composite
- Pooled ping-pong texture pairs (keyed by `widthxheight`) to avoid per-frame allocation
- Frame caching: skips re-render if same time + layer count (quantized to 60fps)
- Recursive up to `MAX_NESTING_DEPTH` levels
- Batches pre-render command buffers with main composite for single GPU submit

---

## Render Loop

### RenderLoop.ts

RAF-based animation loop with:

- **Idle detection**: After 1 second of no activity, stops rendering (keeps RAF alive). Suppressed until first play to allow video GPU surface warmup after page reload.
- **Frame rate limiting**:
  - Playback: ~60fps target (16.67ms)
  - Scrubbing: ~30fps baseline (33ms), but RVFC bypass for immediate fresh-frame display
- **Watchdog**: Checks every 2s, detects 3s stalls, auto-restarts dead RAF loops

### RenderDispatcher.ts

Orchestrates each frame:
1. `compositorPipeline.beginFrame()` - Clear frame-scoped caches
2. `layerCollector.collect()` - Import textures from all layer sources
3. `nestedCompRenderer.preRender()` - Pre-render nested compositions
4. `compositor.composite()` - Ping-pong compositing with effects
5. `outputPipeline.renderToCanvas()` - Output to main preview + all active render targets
6. `slicePipeline.renderSlicedOutput()` - Sliced output for targets with corner-pin slices
7. `device.queue.submit()` - Single batched GPU submit
8. `performanceStats.recordRenderTiming()` - Update stats

**Additional methods:**
- `renderToPreviewCanvas()` - Performs independent ping-pong compositing for multi-composition preview
- `renderCachedFrame()` - Re-renders the last composited frame without re-collecting textures

**Black frame flash prevention:** `lastRenderHadContent` flag holds the last rendered frame during transient playback stalls instead of flashing black (Windows/Linux fix, commit ee7e2329).

### LayerCollector.ts

Imports textures from layer sources in priority order (when `useFullWebCodecsPlayback` is `false`, i.e., the default):
1. **NativeHelper** (ImageBitmap from native decoder)
2. **Direct VideoFrame** (from parallel decode)
3. **HTML Video** (when `allowHtmlVideoPreview` is true — active when not in full WebCodecs mode, during scrub/pause)
4. **WebCodecs** (full mode only, or export)
5. **Cache fallbacks** (scrubbing cache, stall hold frame)
6. **Image** / **Text Canvas** / **Nested Composition**

`getPlaybackStallHoldFrame()` provides last-resort cached frames during decoder stalls, preventing blank output.

`scrubGraceUntil` (~150ms) keeps the HTML preview path active after scrub stops, allowing settle-seek completion before switching back to normal decoding.

GPU warmup tracking: after page reload, `importExternalTexture` returns black until the video plays. A `videoGpuReady` WeakSet tracks which videos have been warmed up.

---

## Video Decoding

### WebCodecsPlayer.ts

Full WebCodecs-based video player with MP4Box demuxing:

```
1. Load file → MP4Box demux → extract video track + samples
2. Configure VideoDecoder with codec from MP4Box track info
3. Frame buffer (max 8 frames) between decoder output and display
4. CTS-sorted sample index for O(log n) time-based seek
5. Seek target filtering: intermediate GOP frames hidden until target arrives
```

**Operating Modes:**
- **Full Mode** (default) - MP4Box demux + WebCodecs decode. Frame-accurate seeking with configurable lookahead.
- **Simple Mode** - Direct VideoFrame extraction from HTMLVideoElement (less accurate).
- **Stream Mode** - MediaStreamTrackProcessor for VideoFrame extraction.
- **Export Mode** - Delegated to `WebCodecsExportMode.ts`. Sequential frame decoding with pre-buffered frames by CTS.

**Seek Behavior:**
- Advance seek: feed decoder from nearest keyframe, filter intermediate frames
- Feed queue target: 5 samples during playback, 24 during advance seek
- Paused seek reuse: within 0.35s tolerance, reuse existing frame
- Pending seek timeout: 2500ms max before aborting

### ParallelDecodeManager.ts

Parallel video decoding for multi-clip exports:
- Separate `VideoDecoder` instance per clip
- Pre-decodes frames ahead of render position
- MP4Box demux per clip with sample extraction

### Firefox HTML Video Preview Fallback

`htmlVideoPreviewFallback.ts` implements a Firefox-specific workaround:
- Copies video frames to persistent `texture_2d<f32>` textures
- Avoids intermittent black frames from `importExternalTexture` on Firefox
- Means Firefox does NOT use zero-copy external textures for HTMLVideoElement

### Fallback Chain
```
NativeHelper → WebCodecs (runtime) → WebCodecs (clip) → HTMLVideoElement (disabled)
```

### Feature Flags (featureFlags.ts)

```typescript
flags = {
  useRenderGraph: false,           // Render Graph executor (stubs)
  useDecoderPool: false,           // Shared decoder pool (not wired)
  useFullWebCodecsPlayback: false, // Preview uses HTML video by default; WebCodecs is used for export and full-mode playback only
}
// Runtime toggle: window.__ENGINE_FLAGS__
```

---

## Shader Capabilities

### Total WGSL Code: ~2,565 lines (files only) or ~3,000 lines (including inline)

| File | Lines | Purpose |
|------|-------|---------|
| `composite.wgsl` | 618 | Blending + 37 modes + inline effects + mask feathering |
| `effects.wgsl` | 243 | Legacy inline GPU effects |
| `opticalflow.wgsl` | 326 | Motion analysis (compute) |
| `output.wgsl` | 83 | Passthrough with optional transparency grid + stacked alpha |
| `slice.wgsl` | 33 | Corner-pin warped slice rendering |
| `common.wgsl` | 154 | Shared effect utilities (located at `src/effects/_shared/common.wgsl`) |
| 30 effect shaders | ~1,108 | Individual effect shaders |

**Inline WGSL:** ~435 lines of WGSL are inlined in `CompositorPipeline.ts` (copyShader ~30 lines, externalCopyShader ~30 lines, externalCompositeShader ~375 lines with all 37 blend modes). These are NOT in separate `.wgsl` files.

Additionally, `HistogramScope.ts`, `WaveformScope.ts`, and `VectorscopeScope.ts` contain inline WGSL compute + render shaders for GPU-accelerated scopes.

### Blend Modes (37 total)

Normal (3), Darken (6), Lighten (6), Contrast (7), Inversion (5), Component (4), Stencil (5), Alpha Add (1)

- HSL/RGB conversion helpers in shader
- Luminosity calculations (BT.601)
- Stencil/silhouette alpha/luma operations

### Effect Shaders

30 individual effect shaders organized by category:
- **blur/** - box, gaussian, motion, radial, zoom
- **color/** - brightness, contrast, exposure, hue-shift, invert, levels, saturation, temperature, vibrance
- **distort/** - bulge, kaleidoscope, mirror, pixelate, rgb-split, twirl, wave
- **keying/** - chroma-key
- **stylize/** - edge-detect, glow, grain, posterize, scanlines, sharpen, threshold, vignette

---

## Optical Flow

### GPU Motion Detection (OpticalFlowAnalyzer.ts)

```wgsl
// opticalflow.wgsl compute shaders
1. Grayscale conversion (BT.601)
2. Gaussian blur 5x5 (sigma=1.0)
3. Pyramid downsampling (3 levels)
4. Spatial gradients (Ix, Iy)
5. Temporal gradient (It)
6. Lucas-Kanade solver
7. Statistics aggregation
```

### Analysis Resolution
160x90 pixels (fast, sufficient for statistics)

### Motion Metrics
```typescript
interface MotionResult {
  total: number;       // Overall motion 0-1
  global: number;      // Camera/scene motion 0-1
  local: number;       // Object motion 0-1
  isSceneCut: boolean; // True if likely a scene cut
}
```

### Thresholds
| Detection | Value |
|-----------|-------|
| Motion | 0.5 magnitude |
| Scene cut | 8.0 magnitude + 0.7 coverage |
| Global coherence | 0.6 |

---

## Scopes & Analysis

### GPU-Accelerated Scopes (analysis/)

Three GPU-accelerated scope types rendered via compute + render shader pairs:

| Scope | Compute | Render | Color Space |
|-------|---------|--------|-------------|
| **Histogram** | Bins pixels into 256-bin R/G/B/Luma histograms via `atomicAdd` | Bar chart visualization | sRGB + BT.709 luma |
| **Waveform** | Accumulates per-column intensity with sub-pixel weighting | Phosphor glow visualization | sRGB + luma |
| **Vectorscope** | Maps pixels to CbCr coordinates via BT.709 coefficients | Dot plot with graticule | BT.709 CbCr |

All use `@workgroup_size(16, 16)` compute shaders with `atomic<u32>` storage buffers.

**ScopeRenderer** delegates to specialized scope classes. **ScopeAnalyzer** provides CPU-based pure functions (histogram computation) that could be moved to a Web Worker.

---

## Caching

### ScrubbingCache (texture/ScrubbingCache.ts)

Three tiers of frame caching:

| Cache | Purpose | Key | Max | Eviction |
|-------|---------|-----|-----|----------|
| **Scrubbing frames** | Instant access during timeline scrub | `videoSrc:quantizedTime` (30fps quantization) | 300 frames (~10s at 30fps) | LRU via Map insertion order |
| **Last frame** | Visible during seeks/pauses | HTMLVideoElement reference | 1 per video | Overwrite |
| **RAM Preview** | Fully composited frames for instant playback | quantized time (30fps) | 900 frames / 512MB | LRU, frame count + memory limit |

Additionally, a **GPU frame cache** (max 60 textures) avoids CPU-to-GPU re-upload for RAM preview playback.

### CacheManager (managers/CacheManager.ts)

Owns `ScrubbingCache` lifecycle, video time tracking (`Map<string, number>`), and RAM playback canvas state.

### Pre-caching

`captureVideoFrameViaImageBitmap()` uses `createImageBitmap(video)` -- the only browser API that forces actual frame decode after page reload (all sync APIs return black).

---

## Output Targets

### Multi-Target Rendering

The engine supports rendering to multiple canvases simultaneously:

- **Main preview canvas** - Primary editor preview
- **Render target canvases** - Registered via `registerTargetCanvas()`, stored in unified `targetCanvases` Map
- **Output windows** - External popup windows via `OutputWindowManager`
- **Export canvas** - OffscreenCanvas for zero-copy VideoFrame creation

### OutputPipeline (pipeline/OutputPipeline.ts)

Renders final composited output to canvases with:
- Three uniform buffers: `uniformBufferGridOn` (mode 0), `uniformBufferGridOff` (mode 1), `uniformBufferStackedAlpha` (mode 2, for transparent video export) — so different targets in the same command encoder can have different transparency grid / alpha states
- Bind group caching per grid state per texture view

#### Stacked Alpha Export

`ExportSettings.stackedAlpha` enables transparent video export:
- OutputPipeline mode 2 renders RGB on the top half and alpha grayscale on the bottom half (double-height canvas)
- `ExportCanvasManager` creates a double-height OffscreenCanvas for the stacked layout
- The `output.wgsl` shader includes stacked alpha logic to split the output vertically

### SlicePipeline (pipeline/SlicePipeline.ts)

Corner-pin warped output slices:
- 16x16 subdivision per slice for perspective-correct warping
- CPU-computed vertex positions (position.xy + uv.xy + maskFlag per vertex)
- Supports inverted and non-inverted mask strips

### OutputWindowManager (managers/OutputWindowManager.ts)

- Creates popup windows with canvas elements
- Tracks open window IDs in sessionStorage for page refresh reconnection
- Supports fullscreen, saved geometry restore, multi-display
- `outputWindowPlacement.ts`: Randomized popup placement with center-exclusion zone logic

---

## Export Pipeline

### FrameExporter (export/FrameExporter.ts)

```typescript
// Frame-by-frame export
1. Initialize VideoEncoderWrapper + AudioExportPipeline
2. Set engine resolution to export resolution
3. Init export OffscreenCanvas for zero-copy path
4. For each frame:
   a. Seek all clips to time
   b. Build layer composition
   c. Render via engine.render()
   d. Create VideoFrame from export canvas (zero-copy) or readPixels fallback
   e. Encode via WebCodecs VideoEncoder
5. Mux to container (mp4-muxer or webm-muxer)
6. Encode audio (if included)
7. Return Blob
```

### Export Modes
- **fast** - WebCodecs sequential decoding per clip
- **precise** - HTMLVideoElement-based seeking (more compatible)

### Codec Support

| Codec | Container | Codec String |
|-------|-----------|------|
| H.264 (AVC) | MP4 | `avc1.4d0028` (Main Profile, Level 4.0) |
| H.265 (HEVC) | MP4 | `hvc1.1.6.L93.B0` (Main Profile, Level 3.1) |
| VP9 | MP4, WebM | `vp09.00.10.08` (Profile 0, Level 1.0, 8-bit) |
| AV1 | MP4, WebM | `av01.0.04M.08` (Main Profile, Level 3.0, 8-bit) |

### Audio Export

Full offline audio pipeline:
- **AudioExtractor**: Decode audio from media files
- **TimeStretchProcessor**: Speed/pitch changes (SoundTouchJS)
- **AudioEffectRenderer**: EQ + volume with keyframe automation
- **AudioMixer**: Multi-track mixing with mute/solo support
- **AudioEncoder**: WebCodecs AAC/Opus encoding

### Settings
- Resolution: 480p, 720p, 1080p, 4K
- Frame rate: 24, 25, 30, 60 fps
- Bitrate: 1-100 Mbps (recommended 5-35 Mbps based on resolution)
- Audio: 44.1kHz/48kHz, 128-320 kbps, optional normalization

---

## Structural Sharing

### SnapshotManager (structuralSharing/SnapshotManager.ts)

Efficient undo/redo snapshots:
- Only changed clips are serialized (cloned); unchanged clips share object references with previous snapshot
- Auto-detects changes via Zustand immutable reference comparison
- DOM refs (video/audio/image elements) are NOT in snapshots; they live in a `DomRefRegistry`
- `SerializedClipState` = `TimelineClip` without DOM references
- `HistorySnapshotV2` = clips + tracks + keyframes + markers + `changedClipIds`

---

## Feature Flags

```typescript
// featureFlags.ts - Runtime toggle via window.__ENGINE_FLAGS__
flags = {
  useRenderGraph: false,           // Render Graph executor (stubs - not ready)
  useDecoderPool: false,           // Shared decoder pool (not wired yet)
  useFullWebCodecsPlayback: false, // Preview uses HTML video by default; WebCodecs is used for export and full-mode playback only
}
```

---

## Performance

### Frame Rate Targets
- **Preview playback**: 60fps target
- **Scrubbing**: 30fps limit (bypassed by RVFC for fresh frames)
- **Frame drop detection**: 2x target time (33ms for playback, 66ms for scrubbing)

### Idle Mode
Idle mode pauses rendering after 1 second of inactivity (keeps RAF alive for wake-up). Idle detection is **suppressed** until the first play event to ensure video GPU surfaces stay warm after page reload. Cleared when `setIsPlaying(true)` is first called.

### Render Loop Watchdog
A watchdog monitors the render loop for crashes and hangs:
- Checks every 2 seconds
- Detects 3-second stalls (no render while running)
- Auto-wakes from idle if stalled
- Restarts dead RAF loop if `animationId` is null but `isRunning` is true
- Skips during device recovery and export

### Statistics Tracking (PerformanceStats.ts)
```typescript
interface EngineStats {
  fps: number;              // Updated every 250ms
  frameTime: number;        // Ring buffer average (60 samples, batched every 10 frames)
  timing: {
    rafGap: number;         // EMA-smoothed RAF gap
    importTexture: number;  // Texture import time
    renderPass: number;     // Composite time
    submit: number;         // GPU submit time
    total: number;          // Total frame time
  };
  drops: {
    count: number;          // Total drops
    lastSecond: number;     // Drops in last second
    reason: 'none' | 'slow_raf' | 'slow_render' | 'slow_import';
  };
  layerCount: number;
  targetFps: number;        // Always 60
  decoder: 'WebCodecs' | 'HTMLVideo' | 'HTMLVideo(VF)' | 'HTMLVideo(cached)' |
           'HTMLVideo(paused-cache)' | 'HTMLVideo(seeking-cache)' |
           'HTMLVideo(scrub-cache)' | 'NativeHelper' | 'ParallelDecode' | 'none';
  webCodecsInfo?: { codec, hwAccel, decodeQueueSize, samplesLoaded, sampleIndex };
  audio: { playing: number; drift: number; status: 'sync' | 'drift' | 'silent' | 'error' };
  gpuMemory: number;
  isIdle: boolean;
  playback?: { ... };       // 30+ field diagnostic object for pipeline debugging
}
```

### Bottleneck Identification
- **slow_import** - Texture upload took >50% of frame budget
- **slow_render** - Compositing took more than 16.67ms
- **slow_raf** - RAF gap exceeded 2x target (missed frames)

### Telemetry Monitors

Three pipeline monitors collect diagnostics used by LayerCollector and RenderDispatcher:
- `vfPipelineMonitor` - VideoFrame pipeline health (frame arrival rate, stalls, drops)
- `wcPipelineMonitor` - WebCodecs pipeline health (decoder queue depth, decode latency)
- `performanceMonitor` - `reportRenderTime()` feeds frame timing into bottleneck detection

### WebCodecs Types and VideoFrameManager

- `webCodecsTypes.ts` - Shared MP4Box / sample types used across WebCodecsPlayer, ExportMode, and ParallelDecodeManager
- `VideoFrameManager.ts` - Tracks per-video `requestVideoFrameCallback` (RVFC) state to determine when a fresh video frame is available for texture import, avoiding redundant re-imports of stale frames

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| 15fps on Linux | Enable Vulkan: `chrome://flags/#enable-vulkan` |
| "Device mismatch" | HMR broke singleton - refresh page |
| Black canvas after reload | Video GPU surfaces not warm - press play once, or wait for `preCacheVideoFrame` |
| WebCodecs fails | Falls back to HTMLVideoElement (visual fallback disabled by default) |
| Device lost | Auto-recovery (up to 3 attempts), then manual page reload |
| Integrated GPU selected | Windows: Graphics Settings > Add Chrome/Edge > Options > High Performance |

### GPU Status
```
chrome://gpu
```

### Debug Commands
```javascript
// In browser devtools:
window.__ENGINE_FLAGS__                     // View/toggle feature flags
window.__ENGINE_FLAGS__.useFullWebCodecsPlayback = false  // Disable WebCodecs
Logger.enable('WebGPU,Compositor,RenderLoop')             // Enable engine logging
Logger.enable('LayerCollector,TextureManager')             // Debug texture import
```

---

## Related Features

- [Preview](./Preview.md) - Rendering output
- [Effects](./Effects.md) - Effect pipeline
- [Export](./Export.md) - Export rendering
- [Masks](./Masks.md) - Mask rendering

---

## Tests

| Test File | Coverage |
|-----------|----------|
| [`transformComposition.test.ts`](../../tests/unit/transformComposition.test.ts) | Transform math, composition, cycle detection |
| [`webCodecsPlayer.test.ts`](../../tests/unit/webCodecsPlayer.test.ts) | WebCodecs player decoding |
| [`webCodecsHelpers.test.ts`](../../tests/unit/webCodecsHelpers.test.ts) | WebCodecs helper utilities |
| [`layerCollector.test.ts`](../../tests/unit/layerCollector.test.ts) | Layer texture collection |
| [`compositor.test.ts`](../../tests/unit/compositor.test.ts) | Ping-pong compositing |
| [`videoSyncManager.test.ts`](../../tests/unit/videoSyncManager.test.ts) | Video sync management |

Run tests: `npx vitest run`

---

*Source: `src/engine/`, `src/effects/EffectsPipeline.ts`, `src/shaders/`*
