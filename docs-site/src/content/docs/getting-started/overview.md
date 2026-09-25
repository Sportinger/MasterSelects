---
title: "Overview"
---

Feature documentation for the `master` branch.

[Android App](/features/android-app/): bundled offline editor, Android file import and export, build/signing instructions, and device limits.

---

## Overview

MasterSelects is a browser-based WebGPU compositor and media editor with timeline editing, nested compositions, AI-assisted workflows, project-local media management, and an optional native helper for the browser gaps that still matter.

### Current Highlights

| Capability | Description |
|---|---|
| **Notebook** | [Write project notes, mark scenes and link passages](/features/documents/), with document import, original views and screenplay layout |
| **Time Stack** | [Blend delayed video instances](/features/time-stack/) in a compact editable node group with deterministic source sampling |
| **AI Depth Map** | [Local depth estimation](/features/depth-estimation/), live source preview and reusable depth-video baking |
| **WebGPU Rendering** | Shared render path for main preview, independent targets, output windows, and export |
| **Timeline Editing** | Multi-track editing, nested compositions, markers, transitions, shortcuts, and keyframes |
| **Editable Motion Graphics** | FlashBoard can compile animated lower thirds into native text, Motion shapes, and keyframes with temporal review and one-step undo |
| **Node Workspace** | One clip canvas with collapsible Color, Flock, Face Cables and 3D groups |
| **AI Control** | Private hosted-agent kernel with a public atomic-tool execution boundary, plus authenticated bridge and MCP access for external agents |
| **AI Generation Workspaces** | The compact Media generator remains available, while AI Studio adds parallel tabs, Media-drop references, local prompt dictation, fitted result tiles, Source Monitor opening, and timeline drag-out |
| **3D Layers** | Shared-scene 3D layers, camera clips, Gaussian splats, splat effectors, and local browser training |
| **Flock Clips** | Node-graph-defined GPU swarms with instanced animals, neighbor links, curved trails and technical glyphs in the shared 3D scene |
| **Vector Animation** | Lottie and Rive clips with canvas playback, bounce modes, render resolution overrides, keyframed state/data inputs, and export |
| **Audio** | Timeline-native workstation audio with artifact-backed analysis, spectral editing, local music-to-MIDI, mixer, recording, and export parity |
| **Screen Capture** | Browser-picker screen/window/tab recording with audio mixing, durable recovery, and optional timeline placement; the WebCodecs crop/scale tier is currently disabled |
| **Live Inputs** | Parallel screen, camera/capture-device, and composition-feedback sources as timeline clips |
| **Storyboard And MIDI** | Timeline storyboard scene cards and MIDI tracks/clips with tempo-aware editing and export support |
| **Multicam And Batch Export** | Audio-synced multicam assembly and queued source-media batch export |
| **Project Storage** | `project.json` source of truth, RAW-copy-first media flow, autosave, relink, backups |
| **Native Helper** | Firefox storage backend, yt-dlp download flow, and local media-analysis jobs |
| **Security And Debugging** | Token-gated bridges, allowed-root file policy, playback monitors, logger tooling |

---

## Documentation Index

### Core Editing

| Document | Description |
|---|---|
| [Timeline](/features/timeline/) | Tracks, clips, nested comps, markers, selection, and editing flow |
| [Transition Compositions](/features/transition-compositions/) | Mapped-v3 transition source layout, templates, parity, and explicit legacy upgrades |
| [Timeline Rulers](/features/timeline-rulers/) | Stacked multi-ruler lanes (time/timecode/frames/bars/tempo) via the **Rulers** checklist, TempoMap-driven bars+beats, and per-composition persistence (#257) |
| [Tempo And Metronome](/features/tempo-and-metronome/) | Editable tempo track with BPM/meter flags and ramps, tempo-driven grid and snapping, MIDI content that follows tempo, and a metronome click (#299) |
| [Annotations](/features/annotations/) | Timed notes on compositions and source media: Annotations panel, ruler bars with drag/trim/keyboard nudge, clip linking, reader popover, project persistence |
| [Consumer Contract](/features/consumer-contract/) | Checkout consent (Terms, Withdrawal Policy, immediate performance), contract confirmation email, online withdrawal form, and the §312k cancellation button |
| [Slot Grid](/features/slot-grid/) | 12x4 live grid overlay, slot clip trimming, layer triggering, and deck warmup behavior |
| [Keyframes](/features/keyframes/) | Animated properties, shared keyframe nodes, effect params, masks, fades, easing, and visibility rules |
| [Preview](/features/preview/) | Main preview, source monitor, output windows, RAM preview, and target routing |
| [UI Panels](/features/ui-panels/) | Dock layout, panel catalog, properties tabs, shared touch support, and workspace surfaces |
| [Inspector Performance](/features/inspector-performance/) | Worker-prepared image graph controls, bounded drag updates, and shared undo transactions |
| [Node Workspace](/features/node-workspace/) | Unified clip nodes, reusable operators, effect-order synchronization, 3D dependencies and execution boundaries |
| [Node Catalog](/features/node-catalog/) | Registered building blocks, typed contracts, implementation ownership and reuse boundaries |
| [Operator Graph Compiler](/features/operator-graph-compiler/) | Initial local image DAG IR, fused Invert lowering, reuse decisions and current integration boundary |
| [Keyboard Shortcuts](/features/keyboard-shortcuts/) | Current shortcut registry, playback controls, and preset behavior |

### Rendering And Media

| Document | Description |
|---|---|
| [GPU Engine](/features/gpu-engine/) | WebGPU engine, render loop, fallback paths, caches, and export boundary |
| [Linux / Mesa GPU](/features/linux-mesa-gpu/) | **Read before touching any canvas/GPU code** — Mesa silent-failure modes and the rules/gates that prevent "blank on Linux" regressions |
| [Media Runtime](/features/media-runtime/) | Shared source/runtime registry, decode sessions, frame-provider reuse, and slot/background playback bindings |
| [ProRes Browser Decode](/features/prores-browser-decode/) | Experimental TurboRes-backed progressive ProRes 422 import, preview, Source Monitor, proxy, audio, export, and lifecycle gates |
| [Effects](/features/effects/) | 98-effect registry, live media thumbnails, fisheye lens correction, glyph/compute/tracking runtimes, physical PAL/RF/VHS emulation, split compare, and timeline transitions |
| [Slit Scan 3D](/features/slit-scan-3d/) | Reference time surfaces, DIS deformation, source-pair motion bands, scene cameras and geometry settings |
| [Memory Leak](/features/memory-leak/) | Generator that shows real leftover bytes of the FFmpeg wasm heap as 8/16/32-bit pixels, with clip feeding, per-frame motion, and freezable blocks |
| [Color Correction](/features/color-correction/) | Node/list color tab, graph data model, GPU pipeline, scopes, and realtime grading workflow |
| [Masks](/features/masks/) | Overlay mask editing, whole-path keyframes, feathering, and stored modes |
| [Surface Tracking](/features/surface-tracking/) | Reusable tracking assets, ordinary clip attachments, preview editing, sparse/dense geometry inspection, editable camera/mesh scenes, and native footprint sequences |
| [Text Clips](/features/text-clips/) | Canvas-backed text rendering, typography controls, and timeline text items |
| [Dynamic Captions](/features/captions/) | Transcript-driven text clips, cut-aware grouping, strict line paging, highlights, direct word correction, and preview/export parity |
| [Motion Design](/features/motion-design/) | Motion layer schema, property registry, rectangle/ellipse shape editing, GPU renderer, and persistence/export plumbing |
| [3D Layers](/features/3d-layers/) | Shared-scene path, native Gaussian splats, cameras, and splat effectors |
| [Flock Clips](/features/flock-clips/) | GPU particle swarms defined by an editable node graph: presets, Properties/Node Workspace editing, source-time keyframes, deterministic seek, precompute cache, links/trails/glyphs, and export |
| [Browser 3D Scan](/features/3d-scan/) | Browser-local Camera Solve, FPS-aligned camera/stabilization tracks, project-backed COLMAP data, sparse previews, and capability-gated Brush WebGPU training |
| [Vector Animation](/features/vector-animation/) | Lottie/Rive import, runtime playback, bounce modes, state-machine keyframes, Rive data binding, and export behavior |
| [Audio](/features/audio/) | Playback sync, clip audio state, waveform/spectral display, recording, and export |
| [Screen Capture](/features/screen-capture/) | Screen/window/tab recording, audio mixing, recovery, and diagnostics; the WebCodecs crop/scale tier is currently disabled |
| [Live Inputs](/features/live-inputs/) | Parallel live visual sources, timeline placement, reconnection, composition feedback, and real-time export |
| [Audio Workstation](/features/audio-workstation/) | Audio architecture, timeline detail mode, docked mixer, artifact refs, and analysis efficiency |
| [Export](/features/export/) | WebCodecs fast/precise export, animated GIF, FFmpeg intermediates, image frame/sequence export, audio-only export, FCPXML, and project-persistent presets |
| [Proxy System](/features/proxy-system/) | Proxy generation, on-disk frame layout, audio proxies, and warmup behavior |
| [Media Panel](/features/media-panel/) | Import flow, RAW-copy promotion, folders, compositions, and relinking |
| [Media Discovery](/features/media-discovery/) | Open-media catalogs, meme templates, source attribution, and local Native Helper web downloads |
| [Project Persistence](/features/project-persistence/) | Save/load model, IndexedDB handle cache, manual saves, timed autosave, incremental linked artifacts, relink, and project roots |
| [Signal IR](/features/signal-ir/) | Contract layer for universal media signals, capability-gated runtime providers, and the Wasm/WIT ABI |
| [Media Downloads](/features/download-panel/) | yt-dlp-backed downloads, platform mapping, and cookie retry behavior |
| [Native Helper](/features/native-helper/) | Local HTTP/WebSocket APIs, auth startup token, and helper-backed flows |

### AI, Security, And Operations

| Document | Description |
|---|---|
| [Landing Page](/features/landing-page/) | Disabled landing chooser, direct editor routing, and the retained Chat/Medium entry routes |
| [AI Integration](/features/ai-integration/) | Hosted kernel chat, public editor-tool boundary, segmentation, transcription, and bridge behavior |
| [Kernel Client](/features/kernel-client/) | Public Cloudflare routes, Hosted Agent V2 lifecycle, deterministic compile flow, authentication, and recovery behavior |
| [Editable Motion Graphics](/features/editable-motion-graphics/) | Native animated lower thirds compiled from chat into editable text, Motion shapes, keyframes, and six-frame temporal review |
| [AI Bridge Control](/features/ai-bridge-control/) | Authenticated session, schema, execution, replay, history, and MCP access to the live in-app AI tool surface |
| [LAN Device Testing](/features/lan-device-testing/) | HTTPS dev server for real iPad/phone testing over Wi-Fi — certificate rules (Apple's 398-day limit), device trust setup, and bridge access |
| [MuScriptor Music-to-MIDI](/features/muscriptor/) | Local Native Helper audio-to-MIDI transcription, model setup, instrument mapping, and atomic timeline commit |
| [Credit Claims](/features/credit-claims/) | Cloudflare-backed reward links for manually granted hosted credits |
| [Guest Hosted AI Access](/features/guest-hosted-ai-access/) | Anonymous hosted-AI sessions, 400 welcome credits, correct sign-in state, and hashed abuse limits |
| [Live Credit Burn Meter](/features/credit-burn-meter/) | Always-visible authoritative reserve bar, confirmed run spend, settlement motion, replay safety, and reduced-motion behavior |
| [FlashBoard](/features/flashboard/) | Media Panel generation plus Auto/Story prompt paths with default Codex Direct and optional hosted Fast |
| [AI Studio](/features/ai-studio/) | Parallel AI workspaces with Media-drop references, local dictation, fitted result tiles, Source Monitor opening, and direct timeline drag-out |
| [Story Workflow](/features/seedance-preproduction/) | Docked preproduction workflow for directions, treatment, sources, master looks, keyframes, progress, and review |
| [Debugging](/features/debugging/) | Logger service, runtime monitors, log sync, and AI-facing debug tools |
| [Playback Debugging](/features/playback-debugging/) | Focused workflow for preview stalls, drift, and decode/render mismatches |
| [Windows Beta Testing](/features/windows-beta-testing/) | Unattended native project dialogs, editing, exact export verification, playback and cleanup |
| [Codex Usage Monitoring](/features/codex-usage-monitoring/) | Local Codex session parser for per-turn token usage, stale-run detection, and Git commit attribution |
| [Product Analytics](/features/product-analytics/) | Privacy-controlled semantic events, D1 funnels, effect/slider usage, sessions, and feature engagement |
| [Social Operations](/features/social-operations/) | Private Fassandra console with Stats, Accounts, and Planning plus an aggregate-only server-to-server data boundary |
| [Security](/features/security/) | Trust boundaries, bridge auth, allowed roots, secret handling, and limitations |
| [Visitor Notifier](/features/visitor-notifier/) | Cloudflare visit feed, `/api/visits`, and the Windows tray notifier workflow |
| [Telegram Dev Chat](/features/telegram-dev-chat/) | BotFather, Cloudflare secrets, webhook setup, reply workflow, verification, and recovery for the two-way developer chat |

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

- The authoritative app version is `src/version.ts`, currently `3.1.0`.
- Preview quality is wired into engine-backed preview resolution through `useEngine()`; it does not affect export resolution or the HTML-only source monitor.
- `openComposition` and `searchVideos` are mapped through the shared AI tool dispatcher in the current branch.
- `AI_TOOLS` assembles 169 public model-tool definitions, including storyboard, worker-first, and motion-design tools. Gaussian debug definitions remain outside that public registry.
