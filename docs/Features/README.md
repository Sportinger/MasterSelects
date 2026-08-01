[Back to Project](../../README.md)

# MasterSelects Documentation

Feature documentation for the `master` branch.

---

## Overview

MasterSelects is a browser-based WebGPU compositor and media editor with timeline editing, nested compositions, AI-assisted workflows, project-local media management, and an optional native helper for the browser gaps that still matter.

### Current Highlights

| Capability | Description |
|---|---|
| **WebGPU Rendering** | Shared render path for main preview, independent targets, output windows, and export |
| **Timeline Editing** | Multi-track editing, nested compositions, markers, transitions, shortcuts, and keyframes |
| **Node Workspace** | Dockable selected-clip processing graph derived from live timeline state |
| **AI Control** | Hosted Kie.ai chat with a live model-tool registry plus authenticated bridge and MCP access for external agents |
| **Media Generator Tray** | FlashBoard video/image/audio generation embedded in the Media Panel with queue previews and media import |
| **3D Layers** | Shared-scene 3D layers, camera clips, Gaussian splats, and splat effectors |
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
| [Timeline](./Timeline.md) | Tracks, clips, nested comps, markers, selection, and editing flow |
| [Transition Compositions](./Transition-Compositions.md) | Mapped-v3 transition source layout, templates, parity, and explicit legacy upgrades |
| [Timeline Rulers](./Timeline-Rulers.md) | Stacked multi-ruler lanes (time/timecode/frames/bars/tempo) via the **Rulers** checklist, TempoMap-driven bars+beats, and per-composition persistence (#257) |
| [Tempo And Metronome](./Tempo-And-Metronome.md) | Editable tempo track with BPM/meter flags and ramps, tempo-driven grid and snapping, MIDI content that follows tempo, and a metronome click (#299) |
| [Slot Grid](./Slot-Grid.md) | 12x4 live grid overlay, slot clip trimming, layer triggering, and deck warmup behavior |
| [Keyframes](./Keyframes.md) | Animated properties, effect params, masks, fades, easing, and visibility rules |
| [Preview](./Preview.md) | Main preview, source monitor, output windows, RAM preview, and target routing |
| [UI Panels](./UI-Panels.md) | Dock layout, panel catalog, properties tabs, mobile UI, and workspace surfaces |
| [Node Workspace](./Node-Workspace.md) | Selected-clip graph view, Media Board canvas behavior, and current render boundary |
| [Keyboard Shortcuts](./Keyboard-Shortcuts.md) | Current shortcut registry, playback controls, and preset behavior |

### Rendering And Media

| Document | Description |
|---|---|
| [GPU Engine](./GPU-Engine.md) | WebGPU engine, render loop, fallback paths, caches, and export boundary |
| [Linux / Mesa GPU](./Linux-Mesa-GPU.md) | **Read before touching any canvas/GPU code** — Mesa silent-failure modes and the rules/gates that prevent "blank on Linux" regressions |
| [Media Runtime](./Media-Runtime.md) | Shared source/runtime registry, decode sessions, frame-provider reuse, and slot/background playback bindings |
| [Effects](./Effects.md) | Current effect registry, timeline transitions, categories, quality controls, and inline effect behavior |
| [Color Correction](./Color-Correction.md) | Node/list color tab, graph data model, GPU pipeline, scopes, and realtime grading workflow |
| [Masks](./Masks.md) | Overlay mask editing, whole-path keyframes, feathering, and stored modes |
| [Text Clips](./Text-Clips.md) | Canvas-backed text rendering, typography controls, and timeline text items |
| [Motion Design](./Motion-Design.md) | Motion layer schema, property registry, rectangle/ellipse shape editing, GPU renderer, and persistence/export plumbing |
| [3D Layers](./3D-Layers.md) | Shared-scene path, native Gaussian splats, cameras, and splat effectors |
| [Vector Animation](./Vector-Animation.md) | Lottie/Rive import, runtime playback, bounce modes, state-machine keyframes, Rive data binding, and export behavior |
| [Audio](./Audio.md) | Playback sync, clip audio state, waveform/spectral display, recording, and export |
| [Screen Capture](./Screen-Capture.md) | Screen/window/tab recording, audio mixing, recovery, and diagnostics; the WebCodecs crop/scale tier is currently disabled |
| [Live Inputs](./Live-Inputs.md) | Parallel live visual sources, timeline placement, reconnection, and composition feedback |
| [Audio Workstation](./Audio-Workstation.md) | Audio architecture, timeline detail mode, docked mixer, artifact refs, and analysis efficiency |
| [Export](./Export.md) | WebCodecs fast/precise export, animated GIF, FFmpeg intermediates, image frame/sequence export, audio-only export, FCPXML, and project-persistent presets |
| [Proxy System](./Proxy-System.md) | Proxy generation, on-disk frame layout, audio proxies, and warmup behavior |
| [Media Panel](./Media-Panel.md) | Import flow, RAW-copy promotion, folders, compositions, and relinking |
| [Project Persistence](./Project-Persistence.md) | Save/load model, IndexedDB handle cache, continuous save, interval save mode, relink, and project roots |
| [Signal IR](./Signal-IR.md) | Contract layer for universal media signals, capability-gated runtime providers, and the Wasm/WIT ABI |
| [Media Downloads](./Download-Panel.md) | yt-dlp-backed downloads, platform mapping, and cookie retry behavior |
| [Native Helper](./Native-Helper.md) | Local HTTP/WebSocket APIs, auth startup token, and helper-backed flows |

### AI, Security, And Operations

| Document | Description |
|---|---|
| [Landing Page](./Landing-Page.md) | Dev-only front page concept, separate URL strategy, and current landing/editor split |
| [AI Integration](./AI-Integration.md) | Hosted Kie.ai chat, live model-tool registry, segmentation, transcription, and bridge behavior |
| [AI Bridge Control](./AI-Bridge-Control.md) | Authenticated session, schema, execution, replay, history, and MCP access to the live in-app AI tool surface |
| [MuScriptor Music-to-MIDI](./MuScriptor.md) | Local Native Helper audio-to-MIDI transcription, model setup, instrument mapping, and atomic timeline commit |
| [Credit Claims](./Credit-Claims.md) | Cloudflare-backed reward links for manually granted hosted credits |
| [Live Credit Burn Meter](./Credit-Burn-Meter.md) | Always-visible authoritative reserve bar, confirmed run spend, settlement motion, replay safety, and reduced-motion behavior |
| [FlashBoard](./FlashBoard.md) | Media Panel generation tray for video, image, speech, and music generation |
| [Debugging](./Debugging.md) | Logger service, runtime monitors, log sync, and AI-facing debug tools |
| [Playback Debugging](./Playback-Debugging.md) | Focused workflow for preview stalls, drift, and decode/render mismatches |
| [Codex Usage Monitoring](./Codex-Usage-Monitoring.md) | Local Codex session parser for per-turn token usage, stale-run detection, and Git commit attribution |
| [Security](./Security.md) | Trust boundaries, bridge auth, allowed roots, secret handling, and limitations |
| [Visitor Notifier](./Visitor-Notifier.md) | Cloudflare visit feed, `/api/visits`, and the Windows tray notifier workflow |
| [Telegram Dev Chat](./Telegram-Dev-Chat.md) | BotFather, Cloudflare secrets, webhook setup, reply workflow, verification, and recovery for the two-way developer chat |

---

## Current Stack

```text
Frontend          React 19 + TypeScript + Vite 7.x
State             Zustand with modular timeline and media slices
Rendering         WebGPU + WGSL + shared-scene 3D runtime
Media             MediaBunny, WebCodecs, HTML media fallback paths
Audio             Web Audio API, artifact-backed analysis, spectral display, clip/track/master FX, recording
AI                Hosted Kie.ai chat and generation, hosted ElevenLabs/Suno, OpenAI transcription/moderation, MatAnyone2, MuScriptor
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

- The authoritative app version is [`src/version.ts`](../../src/version.ts), currently `2.4.5`.
- Preview quality is wired into engine-backed preview resolution through `useEngine()`; it does not affect export resolution or the HTML-only source monitor.
- `openComposition` and `searchVideos` are mapped through the shared AI tool dispatcher in the current branch.
- `AI_TOOLS` assembles 169 public model-tool definitions, including storyboard, worker-first, and motion-design tools. Gaussian debug definitions remain outside that public registry.
