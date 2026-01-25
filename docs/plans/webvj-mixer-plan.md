# WebVJ Mixer — Technical Architecture Plan

**Project:** Browser-based VJ/Video Mixing Application  
**Architecture:** SaaS Website with Local GPU Rendering  
**Date:** December 2025

---

## Executive Summary

A web-based video mixing application (similar to Resolume) where:
- Users login to the website — no downloads required
- All video processing runs locally using the user's GPU via **WebGPU**
- Video files stay local — never uploaded to servers
- Output windows open as separate browser windows for multi-monitor projection

---

## Core Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  USER'S BROWSER (Single Origin)                             │
│                                                             │
│  ┌─────────────────┐      ┌──────────────────┐             │
│  │  Main Tab       │      │  Output Window 1 │ → Projector │
│  │  (Control UI)   │─────▶│  (Fullscreen)    │             │
│  │                 │      └──────────────────┘             │
│  │  WebGPU Device  │      ┌──────────────────┐             │
│  │  Video Engine   │─────▶│  Output Window 2 │ → LED Wall  │
│  │                 │      │  (Fullscreen)    │             │
│  └────────┬────────┘      └──────────────────┘             │
│           │                                                 │
│           ▼                                                 │
│  Local Video Files (File System Access API)                │
└─────────────────────────────────────────────────────────────┘
            │
            ▼ (minimal cloud traffic)
    ☁️  Cloud: Auth, Presets, Collaboration
```

### Key Insight: Single Device, Multiple Canvases
WebGPU supports rendering to multiple `<canvas>` elements from a single `GPUDevice`. Output windows spawned via `window.open()` share the same origin, enabling efficient multi-output rendering without texture copying.

---

## Technology Stack (Latest Versions — December 2025)

### Frontend Core

| Technology | Version | Purpose |
|------------|---------|---------|
| **React** | 19.2.0 (Oct 2025) | UI framework with Activity API for hidden rendering |
| **TypeScript** | 5.9.3 (Aug 2025) | Type safety, deferred imports |
| **Vite** | 7.x (2025) | Build tool, ESM-only, Node 20.19+ required |

### GPU / Video Processing

| Technology | Version | Purpose |
|------------|---------|---------|
| **WebGPU API** | W3C CR (Nov 2025) | GPU compute & rendering |
| **WGSL** | W3C Standard | WebGPU Shading Language |

#### WebGPU Browser Support (Dec 2025)
| Browser | Status |
|---------|--------|
| Chrome/Edge | ✅ 113+ (Stable since Apr 2023) |
| Firefox | ✅ 141+ Windows, 145+ macOS ARM |
| Safari | ✅ 26+ (macOS Tahoe, iOS 26, iPadOS 26) |

### AI/ML (Optional Features)

| Technology | Version | Purpose |
|------------|---------|---------|
| **Transformers.js** | 3.x / 4.x preview | In-browser ML (effects, speech-to-text) |
| **ONNX Runtime Web** | 1.18+ | WebGPU-accelerated inference |

### Backend (Minimal)

| Technology | Version | Purpose |
|------------|---------|---------|
| **Node.js** | 22.x LTS | API server |
| **Hono / Elysia** | Latest | Lightweight API framework |
| **PostgreSQL** | 16+ | User data, presets |
| **Auth.js** | 5.x | Authentication |

### Deployment

| Technology | Purpose |
|------------|---------|
| **Vercel / Cloudflare Pages** | Static frontend hosting |
| **Cloudflare Workers / Deno Deploy** | Edge API |
| **Turso / Neon** | Serverless database |

---

## Browser APIs Required

| API | Purpose | Support |
|-----|---------|---------|
| **WebGPU** | GPU rendering & compute | ~85% desktop browsers |
| **File System Access API** | Read local video files | Chrome/Edge only |
| **Web Codecs API** | Decode video frames | Chrome/Edge/Safari |
| **SharedArrayBuffer** | Cross-tab sync (if needed) | Requires COOP/COEP headers |
| **BroadcastChannel** | Tab-to-tab messaging | All modern browsers |
| **Fullscreen API** | Output windows | All modern browsers |

---

## Feature Roadmap

### Phase 1: Core Engine
- [ ] WebGPU rendering pipeline
- [ ] Multi-canvas output (main + output windows)
- [ ] Local video file loading (File System Access)
- [ ] Basic layer compositing (blend modes)
- [ ] MIDI input for control

### Phase 2: Effects & Mixing
- [ ] WGSL shader effects library
- [ ] Audio reactivity (Web Audio API)
- [ ] Beat detection / BPM sync
- [ ] Transition effects
- [ ] Effect parameters automation

### Phase 3: Cloud Features
- [ ] User authentication
- [ ] Project save/load (cloud + local)
- [ ] Preset sharing / marketplace
- [ ] Collaboration features

### Phase 4: AI Features (Optional)
- [ ] AI-powered effects (style transfer)
- [ ] Speech-to-text for live captions
- [ ] Beat/scene detection

---

## Multi-Output Architecture

### Option A: window.open() with Shared Device (Recommended)
```
Main Tab:
  - Creates GPUDevice
  - Spawns output windows via window.open()
  - Each output window contains a <canvas>
  - Main tab renders to all canvases using same device
```

**Advantages:**
- True zero-copy GPU rendering
- All canvases share textures, buffers, pipelines
- Efficient memory usage

### Option B: SharedArrayBuffer Sync (Fallback)
For browsers that don't share GPU context across windows:
```
Main Tab:
  - Renders to offscreen canvas
  - Copies pixels to SharedArrayBuffer
  
Output Tabs:
  - Read from SharedArrayBuffer
  - Draw to local canvas
```

---

## Security Headers Required

For SharedArrayBuffer support (cross-tab sync):
```http
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

---

## Limitations & Considerations

### Known Constraints
1. **File System Access API** — Chrome/Edge only; Firefox/Safari need `<input type="file">`
2. **WebGPU mobile** — Limited (Android Chrome 121+, no iOS Safari yet)
3. **Cross-tab GPU sharing** — Same-origin windows only
4. **Video codecs** — Browser-dependent; H.264 universal, HEVC limited

### Fallback Strategy
- Detect WebGPU support → fall back to WebGL 2 if unavailable
- Detect File System Access → fall back to file input
- Provide clear browser requirements on landing page

---

## Competitive Advantages vs. Desktop Apps

| Aspect | Desktop (Resolume) | This Project |
|--------|-------------------|--------------|
| Installation | Download + License | Zero — just login |
| Updates | Manual | Instant |
| Cross-platform | Separate builds | Universal |
| Collaboration | None | Built-in |
| Price model | One-time $299+ | Subscription |
| Privacy | Full local | Full local (same!) |

---

## Recommended Development Setup

```bash
# Prerequisites
node --version  # v22.x
npm --version   # v10.x

# Create project
npm create vite@latest webvj-mixer -- --template react-ts

# Key dependencies
npm install @webgpu/types    # WebGPU TypeScript types
npm install zustand          # State management
npm install @tanstack/react-query  # Server state
```

### tsconfig.json additions
```json
{
  "compilerOptions": {
    "lib": ["ES2024", "DOM", "DOM.Iterable"],
    "types": ["@webgpu/types"]
  }
}
```

---

## Next Steps

1. **Prototype WebGPU multi-canvas rendering** — Prove the architecture
2. **Build basic video playback** — WebCodecs + WebGPU
3. **Implement layer compositing** — Blend modes in WGSL
4. **Add MIDI support** — Web MIDI API
5. **Design UI** — Control surface layout
6. **Set up auth/backend** — Minimal cloud infrastructure

---

## References

- [WebGPU Specification (W3C)](https://www.w3.org/TR/webgpu/)
- [WebGPU Implementation Status](https://github.com/gpuweb/gpuweb/wiki/Implementation-Status)
- [WebGPU Fundamentals](https://webgpufundamentals.org/)
- [Transformers.js Documentation](https://huggingface.co/docs/transformers.js)
- [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API)
- [Web Codecs API](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API)

---

*Document generated: December 2025*
