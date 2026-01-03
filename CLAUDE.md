# CLAUDE.md - Development Guide

This file contains development insights and patterns for working with the WebVJ Mixer codebase.

## Build & Run

```bash
npm install    # Install dependencies
npm run dev    # Start dev server (http://localhost:5173)
npm run build  # Production build
npm run lint   # Run ESLint
```

## Architecture Overview

### Core Components

1. **WebGPUEngine** (`src/engine/WebGPUEngine.ts`)
   - Singleton pattern with HMR preservation
   - Ping-pong buffer compositing for layer blending
   - External texture import for zero-copy video rendering

2. **WebCodecsPlayer** (`src/engine/WebCodecsPlayer.ts`)
   - Hardware-accelerated MP4 decoding via WebCodecs API
   - Uses mp4box.js for demuxing
   - Falls back to HTMLVideoElement when WebCodecs unavailable

3. **MixerStore** (`src/stores/mixerStore.ts`)
   - Zustand store with selector subscriptions
   - Manages layers, effects, and engine state

## Common Pitfalls & Solutions

### HMR Double Initialization

**Problem**: React StrictMode + Vite HMR causes multiple WebGPU device creation, leading to "TextureView is associated with [Device]" errors.

**Solution**:
- Use HMR-preserved singleton pattern in WebGPUEngine
- Add initialization guards with promise locks
- Use `useRef` guards in React hooks

```typescript
// HMR singleton preservation
const hot = (import.meta as any).hot;
if (hot?.data?.engine) {
  engineInstance = hot.data.engine;
} else {
  engineInstance = new WebGPUEngine();
  if (hot) hot.data.engine = engineInstance;
}
```

### Stale Closure in Async Callbacks

**Problem**: Video/image loading callbacks capture stale `layers` state.

**Solution**: Always use `get().layers` inside async callbacks:

```typescript
// Bad - stale closure
const { layers } = get();
video.onload = () => {
  set({ layers: layers.map(...) }); // layers is stale!
};

// Good - fresh state
video.onload = () => {
  const currentLayers = get().layers;
  set({ layers: currentLayers.map(...) });
};
```

### Video Texture Timing

**Problem**: Video element not ready when trying to create texture.

**Solution**: Wait for `canplaythrough` event, not just `loadeddata`:

```typescript
video.addEventListener('canplaythrough', () => {
  // Video is now ready for texture creation
}, { once: true });
video.load();
```

### WebCodecs Availability

**Problem**: WebCodecs H.264 not supported on Linux.

**Solution**: Check codec support and fall back gracefully:

```typescript
if ('VideoDecoder' in window && isMp4) {
  const config = { codec: 'avc1.64001f', ... };
  const support = await VideoDecoder.isConfigSupported(config);
  if (!support.supported) {
    // Fall back to HTMLVideoElement
  }
}
```

## Performance Debugging

### Symptoms → Causes

| Symptom | Likely Cause |
|---------|--------------|
| 15fps instead of 60fps | Vulkan disabled, ANGLE/OpenGL fallback |
| "Device mismatch" errors | Multiple GPU device instances |
| Black preview canvas | Texture creation failed, wrong texture format |
| High CPU, low GPU | Video decoding on CPU, not hardware |

### Diagnostic Steps

1. Check `chrome://gpu` for WebGPU status and Vulkan support
2. Add RAF timing logs to identify browser vs code bottleneck:
   ```typescript
   const rafStart = performance.now();
   requestAnimationFrame(() => {
     console.log(`RAF delay: ${performance.now() - rafStart}ms`);
   });
   ```
3. Profile render pass timing separately from total frame time

### Linux GPU Setup

For best performance on Linux with AMD/Intel GPUs:

1. Enable Vulkan: `chrome://flags/#enable-vulkan`
2. Verify at `chrome://gpu`:
   - "Vulkan: Enabled"
   - "WebGPU: Hardware accelerated"

## Shader Development

Shaders are in WGSL format, embedded in WebGPUEngine.ts:

- `compositeShader`: Layer blending with blend modes
- `outputShader`: Final canvas output

Key texture types:
- `texture_external`: For video (zero-copy)
- `texture_2d<f32>`: For images and render targets

## Testing Video Sources

Good test patterns:
- MP4/H.264: Best compatibility
- 1080p @ 30fps: Standard test case
- Multiple videos: Tests compositing performance

## File Structure

```
src/
├── components/     # React UI components
├── engine/         # WebGPU rendering engine
│   ├── WebGPUEngine.ts
│   └── WebCodecsPlayer.ts
├── hooks/          # React hooks
├── stores/         # Zustand state
└── types/          # TypeScript definitions
```
