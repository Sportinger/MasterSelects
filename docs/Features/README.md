[Back to Project](../../README.md)

# MasterSelects Documentation

Current feature documentation for the `staging` branch.

Version 1.5.1 | April 2026

---

## Overview

MasterSelects is a browser-based WebGPU compositor and media editor with timeline editing, nested compositions, AI-assisted workflows, project-local media management, and an optional native helper for the browser gaps that still matter.

The docs in this folder were re-audited against the current codebase and now track the active implementation instead of older roadmap claims.

### Current Highlights

| Capability | Description |
|---|---|
| **WebGPU Rendering** | Shared render path for main preview, independent targets, output windows, and export |
| **Timeline Editing** | Multi-track editing, nested compositions, markers, shortcuts, and keyframes |
| **AI Control** | OpenAI chat with 79 exported tools plus local/native bridge access for external agents |
| **AI Video Workspace** | Classic AI Video plus FlashBoard board-mode generation and media import |
| **3D Layers** | Three.js layers, camera clips, Gaussian splats, and splat effectors |
| **Audio** | Element-synced playback, drift correction, waveform extraction, EQ, and audio export |
| **Project Storage** | `project.json` source of truth, RAW-copy-first media flow, autosave, relink, backups |
| **Native Helper** | Firefox storage backend, yt-dlp download flow, local AI bridge, native jobs |
| **Security And Debugging** | Token-gated bridges, allowed-root file policy, playback monitors, logger tooling |

---

## Documentation Index

### Core Editing

| Document | Description |
|---|---|
| [Timeline](./Timeline.md) | Tracks, clips, nested comps, markers, selection, and editing flow |
| [Slot Grid](./Slot-Grid.md) | 12x4 live grid overlay, slot clip trimming, layer triggering, and deck warmup behavior |
| [Keyframes](./Keyframes.md) | Animated properties, effect params, fades, easing, and visibility rules |
| [Preview](./Preview.md) | Main preview, source monitor, output windows, RAM preview, and target routing |
| [UI Panels](./UI-Panels.md) | Dock layout, panel catalog, properties tabs, mobile UI, and workspace surfaces |
| [Keyboard Shortcuts](./Keyboard-Shortcuts.md) | Current shortcut registry, playback controls, and preset behavior |

### Rendering And Media

| Document | Description |
|---|---|
| [GPU Engine](./GPU-Engine.md) | WebGPU engine, render loop, fallback paths, caches, and export boundary |
| [Media Runtime](./Media-Runtime.md) | Shared source/runtime registry, decode sessions, frame-provider reuse, and slot/background playback bindings |
| [Effects](./Effects.md) | Current effect registry, categories, quality controls, and inline effect behavior |
| [Masks](./Masks.md) | Overlay mask editing, feathering, stored modes, and current limitations |
| [Text Clips](./Text-Clips.md) | Canvas-backed text rendering, typography controls, and timeline text items |
| [3D Layers](./3D-Layers.md) | Three.js scene path, native Gaussian splats, cameras, and splat effectors |
| [Audio](./Audio.md) | Playback sync, EQ, waveform extraction, audio clip behavior, and export |
| [Export](./Export.md) | WebCodecs fast/precise export, FFmpeg WASM path, and interchange output |
| [Proxy System](./Proxy-System.md) | Proxy generation, on-disk frame layout, audio proxies, and warmup behavior |
| [Media Panel](./Media-Panel.md) | Import flow, RAW-copy promotion, folders, compositions, and relinking |
| [Project Persistence](./Project-Persistence.md) | Save/load model, IndexedDB handle cache, continuous save, interval save mode, relink, and project roots |
| [Download Panel](./Download-Panel.md) | yt-dlp-backed downloads, platform mapping, and cookie retry behavior |
| [Native Helper](./Native-Helper.md) | Local HTTP/WebSocket APIs, auth startup token, and helper-backed flows |

### AI, Security, And Operations

| Document | Description |
|---|---|
| [AI Integration](./AI-Integration.md) | OpenAI chat, 79 exported tools, segmentation, transcription, and bridge behavior |
| [FlashBoard](./FlashBoard.md) | Board-mode AI canvas for text-to-video, image-to-video, and image generation |
| [Multicam AI](./Multicam-AI.md) | Sync, transcription, multicam analysis, and Anthropic-powered EDL generation |
| [Debugging](./Debugging.md) | Logger service, runtime monitors, log sync, and AI-facing debug tools |
| [Playback Debugging](./Playback-Debugging.md) | Focused workflow for preview stalls, drift, and decode/render mismatches |
| [Security](./Security.md) | Trust boundaries, bridge auth, allowed roots, secret handling, and limitations |
| [Hosted AI Setup](../cloudflare-hosted-ai-setup.md) | Cloudflare Pages/API setup for hosted account, billing, and AI routes |
| [Visitor Notifier](./Visitor-Notifier.md) | Cloudflare visit feed, `/api/visits`, and the Windows tray notifier workflow |

---

## Current Stack

```text
Frontend          React 19 + TypeScript + Vite 7.x
State             Zustand with modular timeline and media slices
Rendering         WebGPU + WGSL + Three.js for 3D layers
Media             MediaBunny, WebCodecs, HTML media fallback paths
Audio             Web Audio API, EQ, drift correction, waveform extraction
AI                OpenAI chat, Kie.ai, hosted cloud, PiAPI catalog, SAM2, MatAnyone2
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
| Native helper | `tools/native-helper/` |

---

## Audit Notes

- The authoritative app version is [`src/version.ts`](../../src/version.ts), currently `1.5.1`.
- Preview quality is wired into engine-backed preview resolution through `useEngine()`; it does not affect export resolution or the HTML-only source monitor.
- `openComposition` and `searchVideos` are still the two known AI dispatch gaps.
- Gaussian AI tool definitions exist in code but are not exported through `AI_TOOLS` yet.
- This index intentionally points to implementation docs, not roadmap claims.

---

## Version History

See [`src/version.ts`](../../src/version.ts) and [`src/changelog-data.json`](../../src/changelog-data.json) for the authoritative changelog.
Current version: 1.5.1.
