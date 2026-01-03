# WebVJ Mixer

A real-time video mixing application built with WebGPU for hardware-accelerated compositing. Designed for VJ performances, live visuals, and video mixing.

## Features

- **WebGPU Rendering**: Hardware-accelerated compositing with zero-copy video textures
- **Multi-Layer Support**: Stack multiple video/image layers with blend modes
- **Real-time Effects**: Hue shift, saturation, brightness, contrast, blur, pixelate, kaleidoscope, mirror, invert, RGB split
- **WebCodecs Decoding**: Hardware-accelerated video decoding for MP4 files (when supported)
- **Blend Modes**: Normal, multiply, screen, overlay, darken, lighten, color-dodge, color-burn, hard-light, soft-light, difference, exclusion, hue, saturation, color, luminosity, add
- **Live Preview**: Real-time preview with FPS monitoring

## Requirements

- Modern browser with WebGPU support (Chrome 113+, Edge 113+, Firefox 131+)
- GPU with WebGPU-compatible drivers

### Linux-Specific Requirements

For optimal performance on Linux, enable Vulkan in Chrome:

1. Navigate to `chrome://flags`
2. Search for "Vulkan"
3. Enable "Vulkan" flag
4. Restart Chrome

**Why?** Without Vulkan, Chrome falls back to ANGLE → OpenGL path which can cause:
- Significant FPS drops (60fps → 15fps)
- Higher CPU usage
- vsync throttling issues

You can verify your GPU configuration at `chrome://gpu`

## Getting Started

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

## Architecture

### Engine (`src/engine/`)

- **WebGPUEngine.ts**: Core rendering engine with ping-pong buffer compositing
- **WebCodecsPlayer.ts**: Hardware-accelerated MP4 decoding via WebCodecs API

### State Management (`src/stores/`)

- **mixerStore.ts**: Zustand store managing layers, effects, and engine state

### Components (`src/components/`)

- **Preview.tsx**: Main preview canvas
- **LayerPanel.tsx**: Layer management UI
- **EffectsPanel.tsx**: Effect controls
- **Toolbar.tsx**: Main toolbar

## Rendering Pipeline

1. **Layer Processing**: Each visible layer's source (video/image) is converted to a GPU texture
2. **Effect Application**: Effects are applied via WGSL compute/fragment shaders
3. **Compositing**: Layers are composited using ping-pong buffers with blend modes
4. **Output**: Final composite is rendered to the preview canvas

### Video Sources

- **WebCodecs Path** (preferred): Direct `VideoFrame` → `GPUExternalTexture` for zero-copy
- **HTMLVideoElement Path** (fallback): Video element → `GPUExternalTexture`

### Image Sources

- Images are loaded to `HTMLImageElement` → copied to `GPUTexture` via `copyExternalImageToTexture`

## Known Limitations

- WebCodecs H.264 decoding may not be available on Linux (falls back to HTMLVideoElement)
- WebP/AVIF codec support varies by platform
- Some blend modes may have slight visual differences from CSS/Photoshop equivalents

## Performance Tips

1. **Enable Vulkan** (Linux): See requirements section
2. **Use MP4/H.264**: Best codec support across platforms
3. **Match Output Resolution**: Avoid unnecessary scaling
4. **Limit Active Effects**: Each effect adds GPU overhead

## Tech Stack

- React 19 + TypeScript
- Vite 7
- Zustand (state management)
- WebGPU + WGSL shaders
- WebCodecs API
- mp4box.js (MP4 parsing)

## License

MIT
