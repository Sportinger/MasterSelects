[Back to Project](../../README.md)

# MasterSelects Documentation

Feature documentation for the `master` branch.

[Android App](./Android-App.md): bundled offline editor, Android file import and export, build/signing instructions, and device limits.

---

## Overview

MasterSelects is a browser-based WebGPU compositor and media editor with timeline editing, nested compositions, AI-assisted workflows, project-local media management, and an optional native helper for the browser gaps that still matter.

### Current Highlights

| Capability | Description |
|---|---|
| **Notebook** | [Write project notes, mark scenes and link passages](Documents.md), with document import, original views and screenplay layout |
| **Time Stack** | [Blend delayed video instances](Time-Stack.md) in a compact editable node group with deterministic source sampling |
| **AI Depth Map** | [Local depth estimation](Depth-Estimation.md), live source preview and reusable depth-video baking |
| **WebGPU Rendering** | Shared render path for main preview, independent targets, output windows, and export |
| **Timeline Editing** | Multi-track editing, nested compositions, markers, transitions, shortcuts, and keyframes |
| **Editable Motion Graphics** | FlashBoard can compile animated lower thirds into native text, Motion shapes, and keyframes with temporal review and one-step undo |
| **Node Workspace** | One clip canvas with collapsible Color, Flock, Face Cables and 3D groups |
| **AI Control** | Private hosted-agent kernel with a public atomic-tool execution boundary, plus authenticated bridge and MCP access for external agents |
| **AI Generation Workspaces** | The compact Media generator remains available, while AI Studio adds parallel tabs, Media-drop references, local prompt dictation, fitted result tiles, Source Monitor opening, and timeline drag-out |
| **3D Layers** | Shared-scene 3D layers, camera clips, Gaussian splats, splat effectors, and local browser training |
| **Flock Clips** | Node-graph-defined GPU swarms with instanced animals, neighbor links, curved trails and technical glyphs in the shared 3D scene |
| **Weave** | Woven fabric, yarns, ropes and knots from general curve nodes, drawn as lit fibers in the shared 3D scene |
| **Vector Animation** | Lottie and Rive clips with canvas playback, bounce modes, render resolution overrides, keyframed state/data inputs, and export |
| **Audio** | Timeline-native workstation audio with artifact-backed analysis, spectral editing, local music-to-MIDI, mixer, recording, and export parity |
| **Screen Capture** | Browser-picker screen/window/tab recording with audio mixing, durable recovery, and optional timeline placement; the WebCodecs crop/scale tier is currently disabled |
| **Image Mode** | [Still-image workspace](Image-Mode.md) with a layers panel, canvas edit mode, new-image presets, frame-to-image, and PNG save on the shared composition model |
| **Live Inputs** | Parallel screen, camera/capture-device, and composition-feedback sources as timeline clips |
| **Storyboard And MIDI** | Timeline storyboard scene cards and MIDI tracks/clips with tempo-aware editing and export support |
| **Multicam And Batch Export** | Audio-synced multicam assembly and queued source-media batch export |
| **Project Storage** | Continuous repository saves, durable branching history, immutable artifacts, relink and independent backups |
| **Native Helper** | Firefox storage backend, yt-dlp download flow, and local media-analysis jobs |
| **Security And Debugging** | Token-gated bridges, allowed-root file policy, playback monitors, logger tooling |

---

## Documentation Index

<!-- Each section below is one sidebar group of the documentation site, in this order (docs-site/scripts/sync-features.mjs).
     The site puts its Welcome and Overview pages first in Getting Started; the link text is the sidebar label.
     A "docs-sidebar: collapsed" comment under a heading starts that group collapsed. Pages without a row land in a final
     "More" group, except Effects-*.md and Transitions-*.md pages, which join the Effects or Transitions group. -->

### Getting Started

| Document | Description |
|---|---|
| [UI Panels](./UI-Panels.md) | Dock layout, panel catalog, properties tabs, shared touch support, and workspace surfaces |
| [Keyboard Shortcuts](./Keyboard-Shortcuts.md) | Current shortcut registry, playback controls, and preset behavior |
| [Android App](./Android-App.md) | Bundled offline editor, Android file import and export, build/signing instructions, and device limits |

### Editing

| Document | Description |
|---|---|
| [Timeline](./Timeline.md) | Tracks, clips, nested comps, markers, selection, and editing flow |
| [Preview](./Preview.md) | Main preview, source monitor, output windows, RAM preview, and target routing |
| [Keyframes](./Keyframes.md) | Animated properties, shared keyframe nodes, effect params, masks, fades, easing, and visibility rules |
| [Masks](./Masks.md) | Overlay mask editing, whole-path keyframes, feathering, and stored modes |
| [Text Clips](./Text-Clips.md) | Canvas-backed text rendering, typography controls, and timeline text items |
| [Dynamic Captions](./Captions.md) | Transcript-driven text clips, cut-aware grouping, strict line paging, highlights, direct word correction, and preview/export parity |
| [Motion Design](./Motion-Design.md) | Motion layer schema, property registry, rectangle/ellipse shape editing, GPU renderer, and persistence/export plumbing |
| [Vector Animation](./Vector-Animation.md) | Lottie/Rive import, runtime playback, bounce modes, state-machine keyframes, Rive data binding, and export behavior |
| [Image Mode](./Image-Mode.md) | Image documents as still compositions, Image workspace layout, Layers panel, entry points, and current limitations |
| [Notebook](./Documents.md) | Project notes, scene and label marks, linked passages, document import with original views, and screenplay layout and export |
| [Annotations](./Annotations.md) | Timed notes on compositions and source media: Annotations panel, ruler bars with drag/trim/keyboard nudge, clip linking, reader popover, project persistence |
| [Timeline Rulers](./Timeline-Rulers.md) | Stacked multi-ruler lanes (time/timecode/frames/bars/tempo) via the **Rulers** checklist, TempoMap-driven bars+beats, and per-composition persistence (#257) |
| [Slot Grid](./Slot-Grid.md) | 12x4 live grid overlay, slot clip trimming, layer triggering, and deck warmup behavior |

### Effects

| Document | Description |
|---|---|
| [Effects Overview](./Effects.md) | 98-effect registry, live media thumbnails, fisheye lens correction, glyph/compute/tracking runtimes, physical PAL/RF/VHS emulation, split compare, and timeline transitions |
| [Blur Effects](./Effects-Blur.md) | The five blurs with before/after pictures, their controls in the editor, the node graphs behind them, and technical notes |
| [Color Effects](./Effects-Color.md) | Brightness, Contrast, Exposure, Levels, Saturation, Vibrance, Temperature, Hue Shift and Invert with split-screen pictures, their controls, the colour recipes behind them, and technical notes |
| [Distort Effects](./Effects-Distort.md) | Bulge & Pinch, Twirl, Wave, Fisheye Lens, Lens Correction, Guided Perspective and AI Edge Fill with before/after pictures, their controls, the read-position graph behind them, and technical notes |
| [Mirror, Split and Pixel Effects](./Effects-Mirror-Pixel.md) | Kaleidoscope, Mirror, RGB Split, Pixelate, Blockify and Block Mosaic with before/after pictures, their controls, the graphs behind them, and technical notes |
| [Keying and Time Effects](./Effects-Keying-Time.md) | Chroma Key, Time Stack and Slit Scan with before/after pictures, inspector, graph recipes and technical notes |
| [Stylize Effects](./Effects-Stylize.md) | Glow, Film Grain, Vignette, Sharpen, Edge Detect, Posterize, Threshold and Scanlines with before/after pictures, their controls, the recipes behind them, and technical notes |
| [Analog Effects](./Effects-Analog.md) | CRT Screen, Glitch, Film Prism, Analog Signal Lab, Crystal Glass, Glass Dispersion, Holo, Ribbon Scan, Wave Lines and Pixel Sort with before/after pictures, their controls, the recipes behind them, and technical notes |
| [Color Correction](./Color-Correction.md) | Node/list color tab, graph data model, GPU pipeline, scopes, and realtime grading workflow |
| [Time Stack](./Time-Stack.md) | Delayed video instances blended in an editable node group: instance count, time offset, blend modes, and the GPU frame cache |
| [Slit Scan 3D](./Slit-Scan-3D.md) | Reference time surfaces, DIS deformation, source-pair motion bands, scene cameras and geometry settings |
| [Memory Leak](./Memory-Leak.md) | Generator that shows real leftover bytes of the FFmpeg wasm heap as 8/16/32-bit pixels, with clip feeding, per-frame motion, and freezable blocks |
| [Node Workspace](./Node-Workspace.md) | Unified clip nodes, reusable operators, effect-order synchronization, 3D dependencies and execution boundaries |
| [Node Catalog](./Node-Catalog.md) | Registered building blocks, typed contracts, implementation ownership and reuse boundaries |

### Transitions

| Document | Description |
|---|---|
| [Dissolve Transitions](./Transitions-Dissolve.md) | Crossfade with a filmstrip: how to apply it, its controls, and how picture and sound fade |
| [Transition Compositions](./Transition-Compositions.md) | Mapped-v3 transition source layout, templates, parity, and explicit legacy upgrades |

### Audio

| Document | Description |
|---|---|
| [Audio Overview](./Audio.md) | Playback sync, clip audio state, waveform/spectral display, recording, and export |
| [Audio Workstation](./Audio-Workstation.md) | Audio architecture, timeline detail mode, docked mixer, artifact refs, and analysis efficiency |
| [Audio Intelligence](./Audio-Intelligence.md) | Persisted audio analysis as source-time evidence for the Analysis workspace, Agent Timeline, AI tools, and non-destructive audio edits |
| [Tempo And Metronome](./Tempo-And-Metronome.md) | Editable tempo track with BPM/meter flags and ramps, tempo-driven grid and snapping, MIDI content that follows tempo, and a metronome click (#299) |
| [Score Tracks](./Score-Tracks.md) | Audio-section score tracks with pencil-drawn score clips and a detached score-editor window — scorewriter infrastructure (#366) |
| [MuScriptor Music-to-MIDI](./MuScriptor.md) | Local Native Helper audio-to-MIDI transcription, model setup, instrument mapping, and atomic timeline commit |

### 3D and Scans

| Document | Description |
|---|---|
| [3D Layers](./3D-Layers.md) | Shared-scene path, native Gaussian splats, cameras, and splat effectors |
| [Flock Clips](./Flock-Clips.md) | GPU particle swarms defined by an editable node graph: presets, Properties/Node Workspace editing, source-time keyframes, deterministic seek, precompute cache, links/trails/glyphs, and export |
| [Weave](./Weave.md) | Curve-node fabric, knots and threading, fiber rendering (Hashed, 4x Coverage, Analytic), shadows and cloth |
| [Path Tracing](./Path-Tracing.md) | Path traced 3D scene: fiber BVH, hair BSDF, ReSTIR, radiance cache, SVGF and upscaler preview, OIDN, export Render Quality, physical camera |
| [Browser 3D Scan](./3D-Scan.md) | Browser-local Camera Solve, FPS-aligned camera/stabilization tracks, project-backed COLMAP data, sparse previews, and capability-gated Brush WebGPU training |
| [Surface Tracking](./Surface-Tracking.md) | Reusable tracking assets, ordinary clip attachments, preview editing, sparse/dense geometry inspection, editable camera/mesh scenes, and native footprint sequences |

### Media and Export

| Document | Description |
|---|---|
| [Media Panel](./Media-Panel.md) | Import flow, RAW-copy promotion, folders, compositions, and relinking |
| [Media Discovery](./Media-Discovery.md) | Open-media catalogs, meme templates, source attribution, and local Native Helper web downloads |
| [Media Downloads](./Download-Panel.md) | yt-dlp-backed downloads, platform mapping, and cookie retry behavior |
| [Screen Capture](./Screen-Capture.md) | Screen/window/tab recording, audio mixing, recovery, and diagnostics; the WebCodecs crop/scale tier is currently disabled |
| [Live Inputs](./Live-Inputs.md) | Parallel live visual sources, timeline placement, reconnection, composition feedback, and real-time export |
| [Proxy System](./Proxy-System.md) | Proxy generation, on-disk frame layout, audio proxies, and warmup behavior |
| [Scene-Cut Detection](./Scene-Cut-Detection.md) | Frame-accurate hard-cut detection during proxy generation and its timeline display |
| [Export](./Export.md) | WebCodecs fast/precise export, animated GIF, FFmpeg intermediates, image frame/sequence export, audio-only export, FCPXML, and project-persistent presets |
| [Project Persistence](./Project-Persistence.md) | Continuous saving, project handoff, storage backends, media relinking, archives and recovery |
| [Project Repository and Durable History](./Project-Repository.md) | Immutable revisions, branching undo, worker publication, workspace views, journals and artifact retention |
| [Native Helper](./Native-Helper.md) | Local HTTP/WebSocket APIs, auth startup token, and helper-backed flows |
| [H.265 / HEVC Decoding](./HEVC-Decoding.md) | Native-first H.265 playback with a local WASM fallback, shared consumers, and diagnostics |
| [ProRes Browser Decode](./ProRes-Browser-Decode.md) | Experimental TurboRes-backed progressive ProRes 422 import, preview, Source Monitor, proxy, audio, export, and lifecycle gates |
| [MXF Browser Decode](./MXF-Browser-Decode.md) | In development (flag `mxfBrowserDecode`): TypeScript MXF demux and metadata, per-essence decode via WebCodecs, TurboRes, or an LGPL libavcodec WASM build |

### AI

| Document | Description |
|---|---|
| [AI Integration](./AI-Integration.md) | Hosted kernel chat, public editor-tool boundary, segmentation, transcription, and bridge behavior |
| [FlashBoard](./FlashBoard.md) | Media Panel generation plus Auto/Story prompt paths with default Codex Direct and optional hosted Fast |
| [AI Studio](./AI-Studio.md) | Parallel AI workspaces with Media-drop references, local dictation, fitted result tiles, Source Monitor opening, and direct timeline drag-out |
| [Story Workflow](./Seedance-Preproduction.md) | Docked preproduction workflow for directions, treatment, sources, master looks, keyframes, progress, and review |
| [Editable Motion Graphics](./Editable-Motion-Graphics.md) | Native animated lower thirds compiled from chat into editable text, Motion shapes, keyframes, and six-frame temporal review |
| [Scene Streams](./Scene-Streams.md) | Named, re-runnable `ms-scene-v1` timeline blocks, live streaming in FlashBoard and `runEditorStream` |
| [AI Depth Map](./Depth-Estimation.md) | Local Depth Anything V2 depth estimation for the current frame or live playback, and reusable depth-video baking |
| [Face Analysis](./Face-Analysis.md) | Browser-local face detection and anonymous identity grouping with YuNet and SFace, without uploading frames |
| [Guest Hosted AI Access](./Guest-Hosted-AI-Access.md) | Anonymous hosted-AI sessions, 400 welcome credits, correct sign-in state, and hashed abuse limits |
| [Live Credit Burn Meter](./Credit-Burn-Meter.md) | Always-visible authoritative reserve bar, confirmed run spend, settlement motion, replay safety, and reduced-motion behavior |

### Developers
<!-- docs-sidebar: collapsed -->

| Document | Description |
|---|---|
| [GPU Engine](./GPU-Engine.md) | WebGPU engine, render loop, fallback paths, caches, and export boundary |
| [Linux / Mesa GPU](./Linux-Mesa-GPU.md) | **Read before touching any canvas/GPU code** — Mesa silent-failure modes and the rules/gates that prevent "blank on Linux" regressions |
| [Media Runtime](./Media-Runtime.md) | Shared source/runtime registry, decode sessions, frame-provider reuse, and slot/background playback bindings |
| [Signal IR](./Signal-IR.md) | Contract layer for universal media signals, capability-gated runtime providers, and the Wasm/WIT ABI |
| [Operator Graph Compiler](./Operator-Graph-Compiler.md) | Initial local image DAG IR, fused Invert lowering, reuse decisions and current integration boundary |
| [Inspector Performance](./Inspector-Performance.md) | Worker-prepared image graph controls, bounded drag updates, and shared undo transactions |
| [Kernel Client](./Kernel-Client.md) | Public Cloudflare routes, Hosted Agent V2 lifecycle, deterministic compile flow, authentication, and recovery behavior |
| [AI Bridge Control](./AI-Bridge-Control.md) | Authenticated session, schema, execution, replay, history, and MCP access to the live in-app AI tool surface |
| [Security](./Security.md) | Trust boundaries, bridge auth, allowed roots, secret handling, and limitations |
| [Debugging](./Debugging.md) | Logger service, runtime monitors, log sync, and AI-facing debug tools |
| [Playback Debugging](./Playback-Debugging.md) | Focused workflow for preview stalls, drift, and decode/render mismatches |
| [OCR Analysis](./OCR-Analysis.md) | Agent Timeline contracts and a tested local OCR pipeline that is not yet wired into the analysis job |
| [Documentation Website](./Documentation-Site.md) | The /docs site: page sync from docs/Features, sidebar groups from this index, build integration, hosting, and checks |
| [Landing Page](./Landing-Page.md) | Disabled landing chooser, direct editor routing, and the retained Chat/Medium entry routes |

### Testing and Operations
<!-- docs-sidebar: collapsed -->

| Document | Description |
|---|---|
| [LAN Device Testing](./LAN-Device-Testing.md) | HTTPS dev server for real iPad/phone testing over Wi-Fi — certificate rules (Apple's 398-day limit), device trust setup, and bridge access |
| [Windows Beta Testing](./Windows-Beta-Testing.md) | Unattended native project dialogs, editing, exact export verification, playback and cleanup |
| [Flex EQ Visual QA](./Flex-EQ-Visual-QA.md) | Deterministic dev-server route with seeded flexible-equalizer fixtures for visual checks |
| [Agent Timeline Benchmarking](./Agent-Timeline-Benchmarking.md) | Development-bridge runner that collects local-media Agent Timeline benchmarks |
| [Product Analytics](./Product-Analytics.md) | Privacy-controlled semantic events, D1 funnels, effect/slider usage, sessions, and feature engagement |
| [Codex Usage Monitoring](./Codex-Usage-Monitoring.md) | Local Codex session parser for per-turn token usage, stale-run detection, and Git commit attribution |
| [Social Operations](./Social-Operations.md) | Private Fassandra console with Stats, Accounts, and Planning plus an aggregate-only server-to-server data boundary |
| [Visitor Notifier](./Visitor-Notifier.md) | Cloudflare visit feed, `/api/visits`, and the Windows tray notifier workflow |
| [Telegram Dev Chat](./Telegram-Dev-Chat.md) | BotFather, Cloudflare secrets, webhook setup, reply workflow, verification, and recovery for the two-way developer chat |
| [Credit Claims](./Credit-Claims.md) | Cloudflare-backed reward links for manually granted hosted credits |
| [Consumer Contract](./Consumer-Contract.md) | Checkout consent (Terms, Withdrawal Policy, immediate performance), contract confirmation email, online withdrawal form, and the §312k cancellation button |

---

## Current Stack

```text
Frontend          React 19 + TypeScript + Vite 7.x
State             Zustand with modular timeline and media slices
Rendering         WebGPU + WGSL + shared-scene 3D runtime
Media             MediaBunny, WebCodecs, experimental TurboRes, HTML media fallback paths
Audio             Web Audio API, artifact-backed analysis, spectral display, clip/track/master FX, recording
AI                Private hosted-agent kernel, hosted media generation, ElevenLabs/Suno, OpenAI transcription/moderation, MatAnyone2, MuScriptor
Persistence       File System Access API, project-local RAW copies, IndexedDB handle/cache storage
Native Helper     Rust service with HTTP/WebSocket bridge, yt-dlp, helper-backed jobs
```

---

## Source Map

| Area | Location |
|---|---|
| UI components | `src/components/` |
| Timeline UI and interactions | `src/components/timeline/` |
| Preview and output surfaces | `src/components/preview/`, `src/components/outputManager/` |
| Panels and workspace shells | `src/components/panels/` |
| State stores | `src/stores/`, `src/stores/mediaStore/` |
| GPU engine | `src/engine/` |
| Effects and shaders | `src/effects/`, `src/shaders/`, `src/transitions/` |
| Services and bridges | `src/services/` |
| Kernel client | `src/services/kernelClient/` |
| Native helper | `tools/native-helper/` |

---

## Audit Notes

- The authoritative app version is [`src/version.ts`](../../src/version.ts), currently `3.1.0`.
- Preview quality is wired into engine-backed preview resolution through `useEngine()`; it does not affect export resolution or the HTML-only source monitor.
- `openComposition` and `searchVideos` are mapped through the shared AI tool dispatcher in the current branch.
- `AI_TOOLS` assembles 169 public model-tool definitions, including storyboard, worker-first, and motion-design tools. Gaussian debug definitions remain outside that public registry.

- [HEVC decoding](HEVC-Decoding.md): native-first H.265 playback with a local WASM fallback.
