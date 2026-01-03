# WebVJ Mixer

A real-time GPU-accelerated video mixing application built with WebGPU. Designed for VJ performances, live visuals, and multi-layer video compositing at 60fps.

## Features

- **WebGPU Rendering** - Hardware-accelerated compositing via modern GPU APIs
- **Zero-Copy Video Textures** - Direct `VideoFrame` → `GPUExternalTexture` pipeline
- **WebCodecs Decoding** - Hardware H.264/HEVC/VP9/AV1 decoding bypassing browser limitations
- **Multi-Layer Compositing** - Stack unlimited video/image layers with blend modes
- **Real-time Effects** - GPU-powered effects via WGSL fragment shaders
- **MIDI Control** - Map hardware controllers to mixer parameters
- **Flexible Grid** - Configurable slot grid (default 5x5) with grouping support

---

## Tech Stack

| Technology | Version | Purpose |
|------------|---------|---------|
| React | 19.2.0 | UI framework |
| TypeScript | 5.9.3 | Type safety |
| Vite | 7.2.4 | Build tooling & HMR |
| Zustand | 5.0.9 | State management |
| WebGPU | - | GPU rendering API |
| WGSL | - | GPU shader language |
| WebCodecs | - | Hardware video decoding |
| mp4box.js | 2.3.0 | MP4 demuxing |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         React UI                                 │
│  ┌──────────┐  ┌───────────┐  ┌─────────────┐  ┌──────────┐    │
│  │ Toolbar  │  │ LayerPanel│  │EffectsPanel │  │ Preview  │    │
│  └──────────┘  └───────────┘  └─────────────┘  └──────────┘    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Zustand Store (mixerStore)                    │
│  • Layers[] with source/effects/transform                       │
│  • Grid configuration (columns × rows)                          │
│  • MIDI mappings                                                │
│  • Engine state & stats                                         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      useEngine Hook                              │
│  • Initializes WebGPU device                                    │
│  • Manages render loop (requestAnimationFrame)                  │
│  • Syncs store state to engine                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     WebGPUEngine (Singleton)                     │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │ Ping-Pong       │  │ Composite       │  │ Output          │ │
│  │ Buffers         │  │ Pipeline        │  │ Pipeline        │ │
│  │ (rgba8unorm)    │  │ (WGSL shaders)  │  │ (to canvas)     │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     WebCodecsPlayer                              │
│  • MP4 demuxing via mp4box.js                                   │
│  • VideoDecoder for hardware decoding                           │
│  • Frame-accurate playback with seek                            │
│  • Fallback to HTMLVideoElement when unsupported                │
└─────────────────────────────────────────────────────────────────┘
```

---

## Rendering Pipeline

### 1. Video Source Handling

```
MP4 File
    │
    ├─► WebCodecs Path (preferred)
    │   └─► mp4box.js demux → VideoDecoder → VideoFrame → GPUExternalTexture
    │
    └─► HTMLVideoElement Path (fallback)
        └─► <video> element → GPUExternalTexture
```

**Zero-copy optimization**: `GPUExternalTexture` imports video frames directly from the decoder without CPU-side copies.

### 2. Layer Compositing (Ping-Pong)

Each visible layer is composited onto the previous result:

```
[Black] ──► Composite(Layer N) ──► Ping
                                    │
Ping ──────► Composite(Layer N-1) ─► Pong
                                     │
Pong ──────► Composite(Layer N-2) ─► Ping
                                     │
                    ...              │
                                     ▼
                              Final Composite
```

### 3. Blend Modes

Implemented in WGSL (`composite.wgsl`):

| Mode | Formula |
|------|---------|
| Normal | `blend` |
| Add | `min(base + blend, 1.0)` |
| Multiply | `base * blend` |
| Screen | `1 - (1 - base) * (1 - blend)` |
| Overlay | Conditional multiply/screen |
| Difference | `abs(base - blend)` |

### 4. Effects Pipeline

WGSL fragment shaders in `effects.wgsl`:

- **Hue Shift** - RGB↔HSV conversion with hue rotation
- **Color Adjust** - Brightness, contrast, saturation
- **Pixelate** - UV quantization
- **Kaleidoscope** - Polar coordinate segment mirroring
- **RGB Split** - Chromatic aberration effect
- **Mirror** - Horizontal/vertical reflection
- **Invert** - Color negation

---

## File Structure

```
src/
├── engine/
│   ├── WebGPUEngine.ts      # Core GPU renderer (1000+ lines)
│   │   ├── Singleton with HMR preservation
│   │   ├── Ping-pong buffer management
│   │   ├── Pipeline creation (composite, external, output)
│   │   ├── Bind group caching
│   │   └── Per-layer uniform buffers
│   │
│   └── WebCodecsPlayer.ts   # Hardware video decoder
│       ├── MP4Box integration
│       ├── VideoDecoder configuration
│       ├── Frame extraction & timing
│       └── Seek support
│
├── stores/
│   ├── mixerStore.ts        # Main application state
│   │   ├── Layer CRUD operations
│   │   ├── Grid management
│   │   ├── Slot groups
│   │   └── MIDI mappings
│   │
│   └── timelineStore.ts     # Timeline editing state
│
├── shaders/
│   ├── composite.wgsl       # Layer blending shader
│   ├── effects.wgsl         # Effect processing shaders
│   └── output.wgsl          # Final canvas output
│
├── components/
│   ├── Preview.tsx          # WebGPU canvas display
│   ├── LayerPanel.tsx       # Slot grid UI
│   ├── EffectsPanel.tsx     # Effect parameter controls
│   ├── Toolbar.tsx          # Top toolbar
│   └── dock/                # Dockable panel system
│
├── hooks/
│   ├── useEngine.ts         # WebGPU lifecycle
│   └── useMIDI.ts           # MIDI input handling
│
└── types/
    ├── index.ts             # Core type definitions
    └── mp4box.d.ts          # MP4Box type declarations
```

---

## Getting Started

### Requirements

- Node.js 18+
- Browser with WebGPU support:
  - Chrome 113+ / Edge 113+
  - Firefox 131+ (with flags)
- GPU with WebGPU-compatible drivers

### Installation

```bash
npm install
```

### Development

```bash
npm run dev
```

Opens at `http://localhost:5173`

### Production Build

```bash
npm run build
npm run preview
```

---

## Browser Configuration

### Chrome/Edge (Recommended)

WebGPU enabled by default. Verify at `chrome://gpu`:
- "WebGPU: Hardware accelerated"

### Linux with Vulkan

For optimal performance on Linux:

1. Enable Vulkan: `chrome://flags/#enable-vulkan`
2. Restart browser
3. Verify: `chrome://gpu` shows "Vulkan: Enabled"

**Without Vulkan**: Falls back to ANGLE→OpenGL, causing:
- 60fps → 15fps drops
- Higher CPU usage
- vsync issues

### Firefox

Enable in `about:config`:
- `dom.webgpu.enabled` = `true`
- `gfx.webgpu.force-enabled` = `true`

---

## Performance Characteristics

| Metric | Target | Notes |
|--------|--------|-------|
| Frame Rate | 60fps | Hardware-accelerated path |
| Render Time | <5ms | Per-frame GPU work |
| Video Decode | Hardware | WebCodecs when available |
| Memory | Minimal | Zero-copy textures |

### Bottleneck Indicators

| Symptom | Cause |
|---------|-------|
| 15fps instead of 60 | Vulkan disabled (Linux) |
| High CPU, low GPU | Software video decoding |
| "Device mismatch" errors | Multiple GPU instances |
| Black preview | Texture format mismatch |

---

## Codec Support

| Codec | WebCodecs | HTMLVideo Fallback |
|-------|-----------|-------------------|
| H.264 (AVC) | Yes | Yes |
| H.265 (HEVC) | Platform-dependent | Yes |
| VP9 | Yes | Yes |
| AV1 | Yes | Platform-dependent |

**Note**: WebCodecs H.264 may not work on Linux due to VA-API issues. The app automatically falls back to HTMLVideoElement.

---

## API Overview

### Layer Structure

```typescript
interface Layer {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;           // 0-1
  blendMode: BlendMode;      // 'normal' | 'add' | 'multiply' | ...
  source: {
    type: 'video' | 'image';
    videoElement?: HTMLVideoElement;
    webCodecsPlayer?: WebCodecsPlayer;
    imageElement?: HTMLImageElement;
  } | null;
  effects: Effect[];
  position: { x: number; y: number };
  scale: { x: number; y: number };
  rotation: number;          // radians
}
```

### Store Actions

```typescript
// Layer management
addLayer(): void
removeLayer(id: string): void
setLayerSource(layerId: string, file: File): void
setLayerOpacity(layerId: string, opacity: number): void
setLayerBlendMode(layerId: string, mode: BlendMode): void

// Grid operations
triggerSlot(index: number): void    // Restart video
triggerColumn(index: number): void  // Activate column
triggerRow(index: number): void     // Activate row
swapSlots(from: number, to: number): void

// Effects
addEffect(layerId: string, type: string): void
updateEffect(layerId: string, effectId: string, params: object): void
```

---

## License

MIT
