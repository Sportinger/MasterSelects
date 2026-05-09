<div align="center">

# MasterSelects

<h3>Browser-based Video Compositor, Vector Animation & 3D Engine</h3>

<br>

<table><tr><td align="center" style="border:none;background:#0d1117;">
<h1>&#9889; ~1.5 MB <sub>gzip</sub></h1>
<sup><b>initial load</b></sup>
</td></tr></table>


<p>
  GPU-first editing with <b>30 effects</b>, <b>37 blend modes</b>, <b>79 AI tools</b>, <b>native WebGPU 3D</b>, and only <b>15 runtime dependencies</b>.<br>
  Built from scratch in <b>2,700+ lines of WGSL</b> and <b>165k lines of TypeScript</b>.<br>
  Import <b>.lottie, Lottie JSON, OBJ, glTF, GLB, PLY, SPLAT, KSPLAT, SPZ, SOG, LCC</b> assets and play <b>PLY / GLB sequences</b> directly on the timeline.
</p>

<p>
  <a href="https://github.com/Sportinger/MasterSelects/releases"><img src="https://img.shields.io/badge/version-1.7.7-blue.svg" alt="Version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green.svg" alt="License"></a>
  <a href="https://app.fossa.com/projects/custom%2b61097%2fmasterselects"><img src="https://app.fossa.com/api/projects/custom%2b61097%2fmasterselects.svg?type=shield" alt="FOSSA Status"></a>
</p>

<p>
  <a href="#"><img src="https://img.shields.io/badge/WebGPU-990000?style=flat-square&logo=webgpu&logoColor=white" alt="WebGPU"></a>
  <a href="#"><img src="https://img.shields.io/badge/React_19-61DAFB?style=flat-square&logo=react&logoColor=black" alt="React 19"></a>
  <a href="#"><img src="https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript"></a>
  <a href="#"><img src="https://img.shields.io/badge/Vite-646CFF?style=flat-square&logo=vite&logoColor=white" alt="Vite"></a>
  <a href="#native-helper"><img src="https://img.shields.io/badge/Rust-000000?style=flat-square&logo=rust&logoColor=white" alt="Rust"></a>
</p>

<p>
  <a href="https://discord.com/invite/K8dApzG3XC"><img src="https://img.shields.io/badge/Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Discord"></a>
  <a href="https://www.reddit.com/r/masterselects/"><img src="https://img.shields.io/badge/Reddit-FF4500?style=for-the-badge&logo=reddit&logoColor=white" alt="Reddit"></a>
</p>

<br>

<video src="https://github.com/user-attachments/assets/24966b2a-064f-49c8-bc7f-88472a5e4cb0" autoplay loop muted playsinline width="100%"></video>

</div>

---

## Supported Formats

Decoding depends on what the **browser** supports — the container is just the wrapper, the codec inside is what matters.

<table>
<tr><th colspan="2">Import (Decode)</th></tr>
<tr><td><b>Video files</b></td><td>MP4, WebM, MOV, AVI, MKV, WMV, M4V, FLV</td></tr>
<tr><td><b>Video codecs</b></td><td>H.264 (AVC), H.265 (HEVC)¹, VP8, VP9, AV1</td></tr>
<tr><td><b>Audio files</b></td><td>WAV, MP3, OGG, FLAC, AAC, M4A, WMA, AIFF, OPUS</td></tr>
<tr><td><b>Image</b></td><td>PNG, JPG/JPEG, WebP, GIF, BMP, SVG</td></tr>
<tr><td><b>Vector animation</b></td><td><code>.lottie</code> packages and Lottie JSON files (content-sniffed)</td></tr>
<tr><td><b>3D Models</b></td><td>OBJ, glTF, GLB - rendered through the native WebGPU shared-scene path</td></tr>
<tr><td><b>3D sequences</b></td><td>PLY and GLB frame sequences played as timeline media</td></tr>
<tr><td><b>Gaussian Splats</b></td><td>PLY, compressed PLY, SPLAT, KSPLAT, SPZ, SOG, LCC, SOG-style ZIP payloads</td></tr>
<tr><td><b>Download</b></td><td>YouTube, TikTok, Instagram, Twitter/X, Vimeo + <a href="https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md">all yt-dlp sites</a> via Native Helper</td></tr>
<tr><th colspan="2">Export (Encode)</th></tr>
<tr><td><b>Video containers</b></td><td>MP4, WebM via WebCodecs / HTMLVideo; MOV, MKV, AVI, MXF via FFmpeg WASM</td></tr>
<tr><td><b>FFmpeg codecs</b></td><td>ProRes, DNxHR, FFV1, UTVideo, MJPEG</td></tr>
<tr><td><b>Video codecs</b></td><td>H.264, H.265¹, VP9, AV1 — GPU-accelerated via WebCodecs</td></tr>
<tr><td><b>Image export</b></td><td>PNG, JPG/JPEG, WebP, BMP (current playhead frame)</td></tr>
<tr><td><b>Audio-only export</b></td><td>AAC or OGG/Opus depending on browser codec support</td></tr>
<tr><td><b>Interchange</b></td><td>FCPXML (Final Cut Pro / DaVinci Resolve)</td></tr>
</table>

¹ H.265 decode/encode depends on OS & hardware — full support on Windows, partial on macOS/Linux.

> **MOV** files work because they share the same ISO BMFF container as MP4 — any MOV with H.264/H.265 inside plays fine. **MKV** works if it contains browser-decodable codecs (H.264, VP9, etc.). Files with unsupported codecs (e.g. ProRes in MOV) fall back to the Native Helper decode path when available.

---

## What Makes This Different

Most browser-based video editors share a pattern: Canvas 2D compositing, heavyweight dependency trees, and CPU-bound rendering that falls apart at scale. This project takes a fundamentally different approach.

**GPU-first architecture.** Preview, scrubbing, and export all run through the same **WebGPU ping-pong compositor**. Video textures are imported as `texture_external` (**zero-copy**, no CPU roundtrip). **37 blend modes**, 3D rotation, and inline color effects all execute in a **single WGSL composite shader** per layer. The 3D layer system now renders through the native WebGPU shared-scene path for 3D planes, primitive meshes, 3D text, OBJ/glTF/GLB models, camera clips, and gaussian splats - no GSAP, no Canvas 2D fallback in the hot path.

**Current startup footprint.** The production app shell is currently about **1.5 MB gzip** on first load. The largest contributors are the native 3D / gaussian-splat render path, browser-side media parsing/runtime code, and AI/media helper modules. Reducing the initial bundle again is an active optimization target.

**Zero-copy export pipeline.** Frames are captured as `new VideoFrame(offscreenCanvas)` directly from the GPU canvas. **No `readPixels()`**, no `getImageData()`, no staging buffers in the default path. The GPU renders, **WebCodecs encodes**. That's it.

**3-tier scrubbing cache.** **300 GPU textures in VRAM** for instant scrub (Tier 1), per-video last-frame cache for seek transitions (Tier 2), and a **900-frame RAM Preview** with CPU/GPU promotion (Tier 3). When the cache is warm, **scrubbing doesn't decode at all**.

**15 runtime dependencies.** React/React DOM, Zustand, MediaBunny, mp4box, PlayCanvas / splat-transform helpers, dotLottie, HuggingFace Transformers, ONNX Runtime, SoundTouch, WebGPU types, plus an **experimental FFmpeg WASM path**. **Everything else is custom-built from scratch**: the WebGPU compositor, all 30 effect shaders, the keyframe animation system, the export engine, the audio mixer, the text renderer, the mask engine, the video scope renderers, the dock/panel system, the timeline UI, and the native shared 3D scene path. Zero runtime abstraction layers between your timeline and the GPU.

**Nested composition rendering.** Compositions within compositions, each with their own resolution. Rendered to **pooled GPU textures** with frame-level caching, composited in the parent's ping-pong pass, all in a **single `device.queue.submit()`**.

**On-device AI.** SAM2 (Segment Anything Model 2) runs entirely in-browser via ONNX Runtime. Click to select objects in the preview, propagate masks across frames. No server, no API key, no upload. ~220MB model loaded on demand.

---

## Why I Built This

No Adobe subscription, no patience for cracks, and every free online editor felt like garbage. I wanted something that actually works: fast in the browser, GPU-first, built for real editing instead of templates, and open enough that AI can steer the timeline instead of just suggesting ideas.

**The vision:** an editor where AI can directly operate the tool. The built-in chat connects to OpenAI/Cloud or a local Lemonade Server and exposes **79 exported editing tools**. External agents can steer the running editor over the local/native HTTP bridge, and in development the Vite bridge still exists too. Live outputs still matter too - I've been doing video art for 16 years, so multi-output routing was never optional.

Built with Claude as my pair-programmer. Every feature gets debugged, refactored, and beaten into shape until it does what I need. ~165k lines of TypeScript, ~2,700 lines of WGSL, and a Rust native helper for the stuff browsers still can't do cleanly.

---

## AI Control

MasterSelects is being built around the idea that AI should be able to *do the edit*, not just talk about it.

- **Built-in editor chat:** OpenAI/Cloud or local Lemonade chat, compact provider/model menus, project-saved system prompts, and direct access to 79 exported timeline/media/editing tools
- **Local Lemonade provider:** OpenAI-compatible Lemonade Server support for local chat models such as `gemma4-it-e2b-FLM`; model discovery comes from `/models`, and the endpoint is restricted to loopback hosts
- **External agent bridge:** Claude Code or any other local agent can drive the running editor via the Native Helper HTTP bridge, and in development the same tool surface is also available through the Vite bridge and `window.aiTools`
- **AI video and image generation:** Classic AI Video plus FlashBoard route through Kie.ai, hosted cloud, and PiAPI-backed catalogs depending on account and key setup
- **Experimental multicam AI:** Claude/Anthropic generates edit decision lists for the multicam workflow
- **On-device AI:** SAM2 segmentation in-browser via ONNX Runtime, MatAnyone2 via Native Helper, plus local Whisper transcription via Transformers.js

Example Native Helper bridge call:

```bash
curl -X POST http://127.0.0.1:9877/api/ai-tools \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <startup-token>" \
  -d '{"tool":"_list","args":{}}'
```

This requires the Native Helper to be running, a MasterSelects editor tab to be connected, and the helper startup token. The Vite `/api/ai-tools` bridge still exists in development, but it is now gated by a per-session token as well.

---

## What It Does

| Feature | Description |
|---|---|
| [**Multi-track Timeline**](docs/Features/Timeline.md) | Cut, copy, paste, multi-select, JKL shuttle, nested compositions |
| [**30 GPU Effects**](docs/Features/Effects.md) | Color correction, blur, distort, stylize, keying - all real-time |
| [**Video Scopes**](docs/Features/UI-Panels.md#video-scopes-panels) | GPU-accelerated Histogram, Vectorscope, Waveform monitor |
| [**Keyframe Animation**](docs/Features/Keyframes.md) | Bezier curves, copy/paste, tick marks, 5 easing modes |
| [**Vector Masks**](docs/Features/Masks.md) | Pen tool, edge dragging, feathering, multiple masks per clip |
| [**SAM2 Segmentation**](docs/Features/AI-Integration.md) | AI object selection in preview - click to mask, propagate across frames |
| [**Transitions**](docs/Features/UI-Panels.md#transitions-panel) | Crossfade transitions with GPU-accelerated rendering *(experimental)* |
| [**AI Integration**](docs/Features/AI-Integration.md) | Built-in OpenAI/Cloud or local Lemonade chat, 79 exported tool-callable edit actions, and local/native bridges for external agents |
| [**FlashBoard**](docs/Features/FlashBoard.md) | Node-based AI canvas for text-to-video, image-to-video, and image generation |
| [**Multicam AI**](docs/Features/Multicam-AI.md) | Sync cameras, transcribe footage, and generate Claude-powered multicam EDLs *(experimental)* |
| [**Export Pipeline**](docs/Features/Export.md) | WebCodecs Fast/Precise, FFmpeg intermediates, image/audio-only export, FCPXML, and project-persistent presets |
| [**Live EQ & Audio**](docs/Features/Audio.md) | 10-band parametric EQ with real-time Web Audio preview |
| [**Download Panel**](docs/Features/Download-Panel.md) | YouTube, TikTok, Instagram, Twitter/X, Vimeo, and other yt-dlp-supported sites via Native Helper |
| [**Vector Animation**](docs/Features/Vector-Animation.md) | `.lottie` and Lottie JSON clips with bounce playback, render resolution overrides, keyframed state machines, and deterministic preview/export |
| [**Text & Solids**](docs/Features/Text-Clips.md) | 50 Google Fonts, stroke, shadow, and solid color clips |
| [**Proxy System**](docs/Features/Proxy-System.md) | GPU-accelerated proxies with resume and cache indicator |
| [**Output Manager**](docs/Features/Preview.md) | Multi-window outputs, source routing, corner pin warping, slice masks |
| [**Slot Grid**](docs/Features/Slot-Grid.md) | Resolume-style 12x4 grid with multi-layer live playback and slot-clip trims |
| [**Preview & Playback**](docs/Features/Preview.md) | RAM Preview, transform handles, multiple render targets |
| [**Project Storage**](docs/Features/Project-Persistence.md) | Local folders, raw media auto-copy, continuous save by default, interval mode, backups |
| [**Interactive Tutorial**](docs/Features/UI-Panels.md) | Guided onboarding with animated Clippy mascot |

<details>
<summary><b>See Keyframe Editor</b></summary>
<br>
<img src="docs/images/screenshot-curves.png" alt="Bezier Curve Editor" width="400">
</details>

---

## Quick Start

```bash
npm install
npm run dev     # http://localhost:5173
```

**Requirements:** Chrome 113+ with WebGPU support is the main target. Dedicated GPU recommended.

> **Firefox:** project storage requires the Native Helper backend because Firefox does not support the File System Access API flow used by Chrome.

> **Linux:** Enable Vulkan for smooth 60fps: `chrome://flags/#enable-vulkan`

---

## Native Helper

Cross-platform Rust companion app for the parts browsers still can't do well. Required for Firefox project storage and for yt-dlp-based downloads.

```bash
cd tools/native-helper
cargo run --release    # WebSocket :9876, HTTP :9877
```

| Capability | Details |
|---|---|
| **Storage** | Native project persistence backend for Firefox |
| **AI Control** | Local HTTP bridge for external agents to steer the running editor |
| **Download** | yt-dlp integration for YouTube, TikTok, Instagram, Twitter/X, Vimeo, and other supported sites |

**Platforms:** Windows, Linux, macOS. Building the Native Helper requires Rust. Downloads also require `yt-dlp`. See [Native Helper docs](tools/native-helper/README.md) for platform-specific setup.

---

## Security

MasterSelects is a **local-first editor**. Editing, rendering, caching, and most analysis stay in the browser unless you explicitly invoke an external provider or the Native Helper.

- **API keys:** stored in IndexedDB with per-browser Web Crypto encryption
- **Native Helper:** binds to `127.0.0.1` only, requires a random startup Bearer token for HTTP and WebSocket
- **Dev bridge:** Vite `/api/ai-tools` and local file routes require a per-session token and reject non-loopback origins
- **Lemonade local chat:** endpoint is restricted to `localhost`, `127.0.0.1`, or `::1`; Lemonade can suggest tool calls but execution still goes through the normal chat approval and dispatcher path
- **Local file access:** restricted to explicit allowed roots (project root, temp, Desktop, Documents, Downloads, Videos)
- **AI tool policy:** external bridge calls run through caller restrictions and approval gates
- **Secret handling:** logs redact common secret/token patterns; `.keys.enc` export disabled
- **CI checks:** secret scanning, JS and Rust security audits, dedicated tests for bridge auth and file access policy

**Known boundary:** this is not perfect sandboxing. Same-user local processes, malicious browser extensions, and compromised same-origin code can still be dangerous. The goal is **clear, test-covered local trust boundaries**.

See [Security.md](docs/Features/Security.md) for the full trust model and limitations.

---

## Known Issues

This is alpha software. Features get added fast, things break.

- FFmpeg WASM export is still work in progress
- Multicam AI is experimental
- Transitions are experimental
- Firefox project storage requires the Native Helper backend
- Video downloads require Native Helper with yt-dlp installed
- Audio waveforms may not display for some video formats
- Very long videos (>2 hours) may cause performance issues

If something breaks, refresh. If it's still broken, [open an issue](https://github.com/Sportinger/MasterSelects/issues).

---

## Tech Stack

- **Frontend:** React 19, TypeScript, Zustand, Vite 7.3
- **Rendering:** WebGPU + 2,700+ lines of WGSL shaders
- **Video:** WebCodecs, MediaBunny, mp4box, HTMLVideo fallback, and experimental FFmpeg WASM export path
- **Audio:** Web Audio API with 10-band live EQ, element-synced playback, drift correction, and waveform extraction
- **AI:** Built-in OpenAI/Cloud or local Lemonade editor chat with 79 exported tools, Native Helper HTTP bridge for Claude Code / external agents, Claude/Anthropic for experimental multicam EDLs, SAM2 via ONNX Runtime, MatAnyone2 via Native Helper, local Whisper via Hugging Face Transformers, and Kie.ai / hosted cloud / PiAPI-backed generation flows
- **Native:** Rust helper for Firefox storage backend, native decode/encode, and yt-dlp downloads
- **Storage:** File System Access API on Chrome, Native Helper backend on Firefox, IndexedDB, local project folders with raw media

---

## Shortcuts

| Key | Action |
|-----|--------|
| `Space` | Play/Pause |
| `J` / `K` / `L` | Reverse / Pause / Forward (shuttle) |
| `C` | Cut at playhead |
| `I` / `O` | Set in/out points |
| `Ctrl+C/V` | Copy/Paste clips or keyframes |
| `Shift+Click` | Multi-select clips |
| `Tab` | Toggle edit mode |
| `Ctrl+Z/Y` | Undo/Redo |
| `Ctrl+S` | Save project |

[All 89 shortcuts](docs/Features/Keyboard-Shortcuts.md)

---

## Documentation

Detailed docs for each feature: **[docs/Features/](docs/Features/README.md)**

---

## Development

```bash
npm run dev              # Dev server with HMR
npm run dev:changelog    # Dev server with changelog dialog
npm run build            # Production build (tsc + vite)
npm run build:deploy     # Production build (vite only, skip tsc)
npm run lint             # ESLint
npm run preview          # Preview production build
npm run test             # Run tests (vitest)
npm run test:security    # Security-focused test suite
npm run test:watch       # Run tests in watch mode
npm run test:ui          # Run tests with UI
npm run test:coverage    # Run tests with coverage
npm run test:unit        # Run unit tests only
```

<details>
<summary><b>Project Structure</b></summary>

```
src/
├── components/          # React UI
│   ├── timeline/        # Timeline editor (hooks/, components/, utils/)
│   ├── panels/          # Properties, Media, AI, Download, Export, Scopes, Transitions
│   ├── preview/         # Canvas + overlays + transform handles + SAM2 overlay
│   ├── outputManager/   # Multi-window output with slices
│   ├── export/          # Export dialog, codec selector, FFmpeg section
│   ├── dock/            # Panel/tab system
│   ├── common/          # Dialogs, tutorial, settings, shared components
│   └── mobile/          # Mobile-responsive layout
├── stores/              # Zustand state management
│   ├── timeline/        # Slices: track, clip, keyframe, mask, playback, selection, transitions, ...
│   └── mediaStore/      # Slices: import, folder, proxy, composition, slot, selection
├── engine/              # WebGPU rendering pipeline
│   ├── core/            # WebGPUContext, RenderTargetManager
│   ├── render/          # Compositor, RenderLoop, LayerCollector, NestedCompRenderer
│   ├── export/          # FrameExporter, VideoEncoder, ClipPreparation
│   ├── audio/           # AudioMixer, AudioEncoder, TimeStretch
│   ├── ffmpeg/          # FFmpegBridge, codecs
│   ├── pipeline/        # CompositorPipeline, EffectsPipeline, OutputPipeline, SlicePipeline
│   ├── texture/         # TextureManager, ScrubbingCache, MaskTextureManager
│   ├── managers/        # CacheManager, ExportCanvasManager, OutputWindowManager
│   ├── analysis/        # Histogram, Vectorscope, Waveform scopes
│   ├── video/           # VideoFrameManager
│   ├── stats/           # PerformanceStats
│   └── structuralSharing/ # SnapshotManager for undo/redo
├── effects/             # 30 GPU effects (color/, blur/, distort/, stylize/, keying/)
├── transitions/         # Transition definitions (crossfade)
├── services/            # Audio, AI, Project, NativeHelper, Logger, LayerBuilder, MediaRuntime
│   ├── aiTools/         # 79 exported AI tool definitions + handlers
│   ├── sam2/            # SAM2 model manager + service
│   ├── project/         # Project persistence, save/load
│   ├── nativeHelper/    # Native decoder + WebSocket client
│   ├── layerBuilder/    # Layer building + video sync
│   ├── mediaRuntime/    # Media runtime bindings + playback
│   ├── vectorAnimation/ # Lottie metadata sniffing + runtime canvas playback
│   └── export/          # FCPXML export
├── shaders/             # WGSL (composite, effects, output, optical flow, slice)
├── hooks/               # React hooks (useEngine, useGlobalHistory, useMIDI, useTheme)
├── utils/               # Keyframe interpolation, mask renderer, file loader
├── types/               # TypeScript type definitions
├── workers/             # Transcription worker
└── test/                # In-browser test components
```

```
tools/
├── native-helper/       # Rust binary (FFmpeg + yt-dlp bridge)
│   └── src/             # WebSocket server, decode/encode sessions
├── ffmpeg-build/        # FFmpeg build scripts
├── ffmpeg-wasm-build/   # FFmpeg WASM build configuration
└── qwen3vl-server/      # Qwen3 VL server for scene description
```

</details>

---

<details>
<summary><b>License Scan (FOSSA)</b></summary>

[![FOSSA Status](https://app.fossa.com/api/projects/custom%2b61097%2fmasterselects.svg?type=large)](https://app.fossa.com/projects/custom%2b61097%2fmasterselects)

The linked FOSSA report tracks direct and transitive dependencies across npm, Cargo, and pip. The current npm runtime surface in `package.json` has **15 direct runtime dependencies**.

| Category | Count | Status |
|----------|-------|--------|
| License Issues | 35 flagged | All reviewed — no violations |
| Vulnerabilities | 6 | All in dev-dependencies, fixable via `npm audit fix` |
| Outdated Deps | 4 | Non-critical |

**Flagged licenses (all compliant):**

| Package | License | Why it's OK |
|---------|---------|-------------|
| `soundtouch-ts` | LGPL-2.1 | Used as unmodified npm dependency |
| `sharp` / `libvips` (15 platform binaries) | LGPL-3.0 | Used as unmodified prebuilt binary |
| `mediabunny` | MPL-2.0 | Used as unmodified npm dependency |
| `torch`, `pillow` | BSD/PIL | Python tooling only (`tools/qwen3vl-server`), not shipped |
| Cargo crates (`r-efi`, `ring`, `rustix`, `wit-bindgen`, ...) | Apache-2.0 / MIT | Standard Rust ecosystem, no copyleft issues |

No source code of any dependency has been modified. No GPL/AGPL dependencies. All copyleft packages (LGPL, MPL) are used strictly as libraries via their published APIs.

[View full FOSSA report](https://app.fossa.com/projects/custom%2B61097%2Fmasterselects?utm_source=share_link) · [Attribution report (HTML)](docs/FOSSA-Attribution.html)

</details>

---

<div align="center">

**MIT License** · Built by a video artist who got tired of waiting for Adobe to load

</div>
