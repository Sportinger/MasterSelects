# CLAUDE.md

## Workflow

**Always commit and push after completing changes:**
```bash
git add . && git commit -m "description" && git push
```

## Quick Start

```bash
npm install && npm run dev   # http://localhost:5173
npm run build                 # Production build
npm run lint                  # ESLint check
```

## Key Files

| File | Purpose |
|------|---------|
| `src/engine/WebGPUEngine.ts` | GPU renderer singleton, ping-pong compositing |
| `src/engine/WebCodecsPlayer.ts` | Hardware video decoding via WebCodecs |
| `src/stores/mixerStore.ts` | Zustand state (layers, effects, grid) |
| `src/shaders/*.wgsl` | WGSL shaders (composite, effects, output) |

## Critical Patterns

### HMR Singleton

Engine must survive hot reloads to prevent "Device mismatch" errors:

```typescript
const hot = import.meta.hot;
if (hot?.data?.engine) {
  engineInstance = hot.data.engine;
} else {
  engineInstance = new WebGPUEngine();
  hot.data.engine = engineInstance;
}
```

### Stale Closure Fix

Always use `get().layers` inside async callbacks:

```typescript
// WRONG - stale closure
const { layers } = get();
video.onload = () => set({ layers: layers.map(...) });

// CORRECT - fresh state
video.onload = () => {
  const current = get().layers;
  set({ layers: current.map(...) });
};
```

### Video Ready State

Wait for `canplaythrough`, not `loadeddata`:

```typescript
video.addEventListener('canplaythrough', () => {
  // Video ready for texture creation
}, { once: true });
```

## Texture Types

| Source | Texture Type |
|--------|-------------|
| Video (HTMLVideoElement) | `texture_external` (zero-copy) |
| Video (WebCodecs VideoFrame) | `texture_external` (zero-copy) |
| Image | `texture_2d<f32>` (copied once) |

## Common Issues

| Problem | Solution |
|---------|----------|
| 15fps on Linux | Enable Vulkan: `chrome://flags/#enable-vulkan` |
| "Device mismatch" | HMR broke singleton - refresh page |
| Black canvas | Check `readyState >= 2` before texture import |
| WebCodecs fails | Falls back to HTMLVideoElement automatically |

## Render Loop

```
useEngine hook
    └─► engine.start(callback)
            └─► requestAnimationFrame loop
                    └─► engine.render(layers)
                            ├─► Import external textures
                            ├─► Ping-pong composite each layer
                            └─► Output to canvas(es)
```

## Adding Effects

1. Add shader in `src/shaders/effects.wgsl`
2. Add params type and defaults in `mixerStore.ts:getDefaultEffectParams()`
3. Add UI controls in `EffectsPanel.tsx`

## Debugging

```typescript
// Profile output (automatic, every 1s)
// [PROFILE] FPS=60 | gap=16ms | layers=3 | render=2.50ms

// Check GPU status
chrome://gpu

// Slow frame warnings (automatic)
// [RAF] Very slow frame: rafDelay=150ms
```
