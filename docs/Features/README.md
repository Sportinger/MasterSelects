# MASterSelects Feature Manual

A comprehensive guide to all features in MASterSelects - a professional WebGPU-powered video compositor and timeline editor.

## Quick Navigation

| Category | Description |
|----------|-------------|
| [Timeline](./Timeline.md) | Multi-track editing, clips, compositions, multicam |
| [Keyframes](./Keyframes.md) | Animation system, curve editor, bezier handles |
| [Preview & Playback](./Preview.md) | RAM Preview, scrubbing, multiple previews, edit mode |
| [Effects](./Effects.md) | 9 GPU effects, 37 blend modes, transforms |
| [Masks](./Masks.md) | Shape masks, bezier paths, GPU feathering |
| [AI Integration](./AI-Integration.md) | 50+ AI tools, transcription, multicam EDL |
| [Media Panel](./Media-Panel.md) | Import, folders, compositions, proxies |
| [Audio](./Audio.md) | 10-band EQ, waveforms, multicam sync |
| [Export](./Export.md) | H.264/VP9 export, frame rendering |
| [UI & Panels](./UI-Panels.md) | Dock system, layouts, menus, MIDI |
| [GPU Engine](./GPU-Engine.md) | WebGPU rendering, optical flow, caching |
| [Project Persistence](./Project-Persistence.md) | IndexedDB, auto-save, file handles |
| [Keyboard Shortcuts](./Keyboard-Shortcuts.md) | Complete shortcut reference |

---

## Feature Overview

### Core Capabilities

- **WebGPU Rendering** - Hardware-accelerated compositing with 60fps performance
- **Multi-track Timeline** - Video and audio tracks with nested compositions
- **Keyframe Animation** - Full property animation with bezier curve editor
- **AI-Powered Editing** - 50+ GPT tools for intelligent timeline manipulation
- **Professional Effects** - 9 GPU effects, 37 blend modes, vector masks
- **RAM Preview** - After Effects-style cached playback at 30fps
- **10-Band EQ** - Parametric audio equalization with keyframe support
- **Multicam Sync** - Audio-based cross-correlation synchronization
- **Video Export** - H.264/VP9 encoding with WebCodecs

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        UI Layer                              │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐│
│  │ Timeline │ │ Preview  │ │ Media    │ │ Effects/Props    ││
│  │ (React)  │ │ (Canvas) │ │ Panel    │ │ AI Chat          ││
│  └──────────┘ └──────────┘ └──────────┘ └──────────────────┘│
├─────────────────────────────────────────────────────────────┤
│                      State Layer (Zustand)                   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐│
│  │ Timeline │ │ Mixer    │ │ Media    │ │ Multicam         ││
│  │ Store    │ │ Store    │ │ Store    │ │ Store            ││
│  └──────────┘ └──────────┘ └──────────┘ └──────────────────┘│
├─────────────────────────────────────────────────────────────┤
│                     Engine Layer (WebGPU)                    │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐│
│  │Compositor│ │ Effects  │ │ Texture  │ │ Frame            ││
│  │ Pipeline │ │ Pipeline │ │ Manager  │ │ Exporter         ││
│  └──────────┘ └──────────┘ └──────────┘ └──────────────────┘│
├─────────────────────────────────────────────────────────────┤
│                   Services Layer                             │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐│
│  │ Audio    │ │ Whisper  │ │ Project  │ │ AI Tools         ││
│  │ Manager  │ │ Service  │ │ DB       │ │ (OpenAI)         ││
│  └──────────┘ └──────────┘ └──────────┘ └──────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

---

## Verified Feature Summary

Based on codebase analysis (362 commits):

| Feature | Status | Notes |
|---------|--------|-------|
| WebGPU Compositing | ✅ Full | Zero-copy video textures |
| Multi-track Timeline | ✅ Full | Video + audio tracks |
| Nested Compositions | ✅ Full | Double-click to edit |
| Keyframe Animation | ✅ Full | 9 properties + effects |
| Curve Editor | ✅ Full | Bezier handles |
| 37 Blend Modes | ✅ Full | All After Effects modes |
| 9 GPU Effects | ✅ Full | Hue, levels, pixelate, etc. |
| Vector Masks | ✅ Full | Rect, ellipse, pen tool |
| GPU Feathering | ✅ Full | 61-tap blur at high quality |
| AI Chat + Tools | ✅ Full | 50+ editing functions |
| Transcription | ✅ Full | 4 providers supported |
| Multicam Sync | ✅ Full | Audio cross-correlation |
| RAM Preview | ✅ Full | 30fps, 900 frame cache |
| 10-Band EQ | ✅ Full | -12 to +12dB per band |
| Video Export | ✅ Full | H.264, VP9, frame-by-frame |
| Project Save/Load | ✅ Full | IndexedDB + file handles |
| Proxy Generation | ✅ Full | GPU-accelerated |
| MIDI Control | ✅ Full | Device discovery |

---

## Getting Started

1. **[Media Panel](./Media-Panel.md)** - Import media files
2. **[Timeline](./Timeline.md)** - Drag clips to tracks
3. **[Keyframes](./Keyframes.md)** - Animate properties
4. **[Effects](./Effects.md)** - Apply visual effects
5. **[Export](./Export.md)** - Render your project

---

*Documentation generated from codebase analysis - January 2026*
