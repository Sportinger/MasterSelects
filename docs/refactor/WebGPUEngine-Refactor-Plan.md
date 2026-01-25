# WebGPUEngine Refactoring Plan

> **Target Audience:** AI Agent performing the refactor
> **Source File:** `src/engine/WebGPUEngine.ts` (2339 LOC)
> **Goal:** Split into 7 focused modules (~150-350 LOC each)

---

## Quick Reference

| New File | LOC | Extract From (Lines) | Purpose |
|----------|-----|---------------------|---------|
| `stats/StatsTracker.ts` | ~120 | 66-98, 2021-2073 | FPS, timing, drops |
| `core/RenderTargetManager.ts` | ~150 | 44-58, 394-458, 2170-2231 | Ping-pong textures |
| `managers/OutputWindowManager.ts` | ~180 | 541-659 | External output windows |
| `render/RenderLoop.ts` | ~180 | 86-89, 137-142, 2075-2168 | RAF, idle, frame limiting |
| `render/LayerCollector.ts` | ~250 | 119, 943-1150 | Texture import per source type |
| `render/Compositor.ts` | ~300 | 116-117, 1219-1411 | Ping-pong compositing loop |
| `render/NestedCompRenderer.ts` | ~350 | 155-158, 1600-2019 | Nested composition rendering |
| `WebGPUEngine.ts` | ~400 | Remainder | Thin facade |

---

## Pre-Refactor Checklist

Before starting, verify:

```bash
# 1. All tests pass
npm run test

# 2. App runs without errors
npm run dev
# Open browser, verify preview renders

# 3. Create backup branch
git checkout -b refactor/webgpu-engine-backup
git checkout -b refactor/webgpu-engine-split
```

---

## File Structure After Refactor

```
src/engine/
├── WebGPUEngine.ts              # MODIFY: Thin facade (~400 LOC)
├── core/
│   ├── WebGPUContext.ts         # UNCHANGED
│   ├── types.ts                 # MODIFY: Add interfaces
│   └── RenderTargetManager.ts   # NEW
├── managers/
│   └── OutputWindowManager.ts   # NEW
├── render/
│   ├── LayerCollector.ts        # NEW
│   ├── Compositor.ts            # NEW
│   ├── NestedCompRenderer.ts    # NEW
│   └── RenderLoop.ts            # NEW
└── stats/
    └── StatsTracker.ts          # NEW
```

---

## Step-by-Step Extraction

### Step 1: Add Interfaces to `core/types.ts`

**File:** `src/engine/core/types.ts`

**Action:** Append these interfaces at the end of the file:

```typescript
// === REFACTOR: New interfaces for module communication ===

export interface DetailedStats {
  rafGap: number;
  importTexture: number;
  renderPass: number;
  submit: number;
  total: number;
  dropsTotal: number;
  dropsLastSecond: number;
  dropsThisSecond: number;
  lastDropReason: string;
  lastRafTime: number;
  decoder: string;
}

export interface ProfileData {
  importTexture: number;
  createBindGroup: number;
  renderPass: number;
  submit: number;
  total: number;
}

export interface RenderTargets {
  pingTexture: GPUTexture | null;
  pongTexture: GPUTexture | null;
  pingView: GPUTextureView | null;
  pongView: GPUTextureView | null;
  independentPingTexture: GPUTexture | null;
  independentPongTexture: GPUTexture | null;
  independentPingView: GPUTextureView | null;
  independentPongView: GPUTextureView | null;
  blackTexture: GPUTexture | null;
}

export interface CompositeResult {
  finalView: GPUTextureView;
  usedPing: boolean;
  layerCount: number;
}
```

**Validation:** File should compile without errors.

---

### Step 2: Create `stats/StatsTracker.ts`

**File:** `src/engine/stats/StatsTracker.ts`

**Action:** Create new file with this exact content:

```typescript
// Stats tracking for WebGPU engine - FPS, timing, frame drops

import type { EngineStats, DetailedStats, ProfileData } from '../core/types';
import { audioStatusTracker } from '../../services/audioManager';

export class StatsTracker {
  // FPS tracking
  private frameCount = 0;
  private fps = 0;
  private fpsUpdateTime = 0;

  // Detailed stats
  private detailedStats: DetailedStats = {
    rafGap: 0,
    importTexture: 0,
    renderPass: 0,
    submit: 0,
    total: 0,
    dropsTotal: 0,
    dropsLastSecond: 0,
    dropsThisSecond: 0,
    lastDropReason: 'none',
    lastRafTime: 0,
    decoder: 'none',
  };

  // Profile data
  private profileData: ProfileData = {
    importTexture: 0,
    createBindGroup: 0,
    renderPass: 0,
    submit: 0,
    total: 0,
  };

  // Frame time buffer (ring buffer for O(1) operations)
  private frameTimeBuffer = new Float32Array(60);
  private frameTimeIndex = 0;
  private frameTimeCount = 0;
  private lastFrameStart = 0;
  private statsCounter = 0;

  // Layer count for stats display
  private lastLayerCount = 0;

  private readonly TARGET_FRAME_TIME = 16.67; // 60fps target

  setDecoder(decoder: string): void {
    this.detailedStats.decoder = decoder;
  }

  setLayerCount(count: number): void {
    this.lastLayerCount = count;
  }

  recordRafGap(gap: number): void {
    this.detailedStats.rafGap = this.detailedStats.rafGap * 0.9 + gap * 0.1;

    // Detect frame drops - gap > 2x target means missed frames
    if (gap > this.TARGET_FRAME_TIME * 2) {
      const missedFrames = Math.max(1, Math.round(gap / this.TARGET_FRAME_TIME) - 1);
      this.detailedStats.dropsTotal += missedFrames;
      this.detailedStats.dropsThisSecond += missedFrames;
      this.detailedStats.lastDropReason = 'slow_raf';
    }
  }

  recordRenderTiming(timing: ProfileData): void {
    this.profileData = timing;

    // Update smoothed stats
    this.detailedStats.importTexture = this.detailedStats.importTexture * 0.9 + timing.importTexture * 0.1;
    this.detailedStats.renderPass = this.detailedStats.renderPass * 0.9 + timing.renderPass * 0.1;
    this.detailedStats.submit = this.detailedStats.submit * 0.9 + timing.submit * 0.1;
    this.detailedStats.total = this.detailedStats.total * 0.9 + timing.total * 0.1;

    // Detect slow render drops
    if (timing.total > this.TARGET_FRAME_TIME) {
      if (timing.importTexture > this.TARGET_FRAME_TIME * 0.5) {
        this.detailedStats.lastDropReason = 'slow_import';
      } else {
        this.detailedStats.lastDropReason = 'slow_render';
      }
    }
  }

  resetPerSecondCounters(): void {
    this.detailedStats.dropsLastSecond = this.detailedStats.dropsThisSecond;
    this.detailedStats.dropsThisSecond = 0;
  }

  updateStats(): void {
    this.frameCount++;
    this.statsCounter++;

    if (this.statsCounter >= 10) {
      this.statsCounter = 0;
      const now = performance.now();

      if (this.lastFrameStart > 0) {
        const frameTime = (now - this.lastFrameStart) / 10;
        this.frameTimeBuffer[this.frameTimeIndex] = frameTime;
        this.frameTimeIndex = (this.frameTimeIndex + 1) % 60;
        if (this.frameTimeCount < 60) this.frameTimeCount++;
      }
      this.lastFrameStart = now;

      if (now - this.fpsUpdateTime >= 1000) {
        this.fps = this.frameCount;
        this.frameCount = 0;
        this.fpsUpdateTime = now;
      }
    }
  }

  getStats(isIdle: boolean): EngineStats {
    let sum = 0;
    for (let i = 0; i < this.frameTimeCount; i++) {
      sum += this.frameTimeBuffer[i];
    }
    const avgFrameTime = this.frameTimeCount > 0 ? sum / this.frameTimeCount : 0;

    return {
      fps: this.fps,
      frameTime: avgFrameTime,
      gpuMemory: 0,
      timing: {
        rafGap: this.detailedStats.rafGap,
        importTexture: this.detailedStats.importTexture,
        renderPass: this.detailedStats.renderPass,
        submit: this.detailedStats.submit,
        total: this.detailedStats.total,
      },
      drops: {
        count: this.detailedStats.dropsTotal,
        lastSecond: this.detailedStats.dropsLastSecond,
        reason: this.detailedStats.lastDropReason,
      },
      layerCount: this.lastLayerCount,
      targetFps: 60,
      decoder: this.detailedStats.decoder,
      audio: audioStatusTracker.getStatus(),
      isIdle,
    };
  }
}
```

**Validation:**
```bash
npx tsc src/engine/stats/StatsTracker.ts --noEmit --skipLibCheck
```

---

### Step 3: Create `core/RenderTargetManager.ts`

**File:** `src/engine/core/RenderTargetManager.ts`

**Action:** Create new file. Extract from WebGPUEngine.ts lines 44-58 (instance vars) and 394-458 (createPingPongTextures).

```typescript
// Manages ping-pong render targets for compositing

import type { RenderTargets } from './types';

export class RenderTargetManager {
  private pingTexture: GPUTexture | null = null;
  private pongTexture: GPUTexture | null = null;
  private pingView: GPUTextureView | null = null;
  private pongView: GPUTextureView | null = null;
  private independentPingTexture: GPUTexture | null = null;
  private independentPongTexture: GPUTexture | null = null;
  private independentPingView: GPUTextureView | null = null;
  private independentPongView: GPUTextureView | null = null;
  private blackTexture: GPUTexture | null = null;

  private outputWidth = 640;
  private outputHeight = 360;

  constructor(private device: GPUDevice) {}

  createPingPongTextures(): void {
    // Destroy existing textures
    this.pingTexture?.destroy();
    this.pongTexture?.destroy();
    this.independentPingTexture?.destroy();
    this.independentPongTexture?.destroy();

    // Reset all references
    this.pingTexture = null;
    this.pongTexture = null;
    this.independentPingTexture = null;
    this.independentPongTexture = null;
    this.pingView = null;
    this.pongView = null;
    this.independentPingView = null;
    this.independentPongView = null;

    try {
      // Main render loop ping-pong buffers
      this.pingTexture = this.device.createTexture({
        size: [this.outputWidth, this.outputHeight],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
      });

      this.pongTexture = this.device.createTexture({
        size: [this.outputWidth, this.outputHeight],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
      });

      // Independent preview ping-pong buffers
      this.independentPingTexture = this.device.createTexture({
        size: [this.outputWidth, this.outputHeight],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
      });

      this.independentPongTexture = this.device.createTexture({
        size: [this.outputWidth, this.outputHeight],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
      });

      // Cache views
      if (this.pingTexture && this.pongTexture) {
        this.pingView = this.pingTexture.createView();
        this.pongView = this.pongTexture.createView();
      }
      if (this.independentPingTexture && this.independentPongTexture) {
        this.independentPingView = this.independentPingTexture.createView();
        this.independentPongView = this.independentPongTexture.createView();
      }
    } catch (e) {
      console.error('[RenderTargetManager] Failed to create ping-pong textures:', e);
    }
  }

  createBlackTexture(createSolidColorTexture: (r: number, g: number, b: number, a: number) => GPUTexture): void {
    this.blackTexture = createSolidColorTexture(0, 0, 0, 255);
  }

  setResolution(width: number, height: number): boolean {
    if (this.outputWidth === width && this.outputHeight === height) {
      return false;
    }
    this.outputWidth = width;
    this.outputHeight = height;
    this.createPingPongTextures();
    return true;
  }

  getResolution(): { width: number; height: number } {
    return { width: this.outputWidth, height: this.outputHeight };
  }

  getTargets(): RenderTargets {
    return {
      pingTexture: this.pingTexture,
      pongTexture: this.pongTexture,
      pingView: this.pingView,
      pongView: this.pongView,
      independentPingTexture: this.independentPingTexture,
      independentPongTexture: this.independentPongTexture,
      independentPingView: this.independentPingView,
      independentPongView: this.independentPongView,
      blackTexture: this.blackTexture,
    };
  }

  getPingView(): GPUTextureView | null { return this.pingView; }
  getPongView(): GPUTextureView | null { return this.pongView; }
  getPingTexture(): GPUTexture | null { return this.pingTexture; }
  getPongTexture(): GPUTexture | null { return this.pongTexture; }
  getIndependentPingView(): GPUTextureView | null { return this.independentPingView; }
  getIndependentPongView(): GPUTextureView | null { return this.independentPongView; }
  getBlackTexture(): GPUTexture | null { return this.blackTexture; }

  clearAll(): void {
    this.pingTexture = null;
    this.pongTexture = null;
    this.pingView = null;
    this.pongView = null;
    this.independentPingTexture = null;
    this.independentPongTexture = null;
    this.independentPingView = null;
    this.independentPongView = null;
    this.blackTexture = null;
  }

  destroy(): void {
    this.pingTexture?.destroy();
    this.pongTexture?.destroy();
    this.independentPingTexture?.destroy();
    this.independentPongTexture?.destroy();
    this.blackTexture?.destroy();
    this.clearAll();
  }
}
```

---

### Step 4: Create `managers/OutputWindowManager.ts`

**File:** `src/engine/managers/OutputWindowManager.ts`

**Action:** Create new file. Extract from WebGPUEngine.ts lines 541-659.

```typescript
// Manages external output windows (fullscreen, secondary displays)

import type { OutputWindow } from '../core/types';

export class OutputWindowManager {
  private outputWindows: Map<string, OutputWindow> = new Map();
  private outputWidth: number;
  private outputHeight: number;

  constructor(width: number, height: number) {
    this.outputWidth = width;
    this.outputHeight = height;
  }

  createOutputWindow(id: string, name: string, device: GPUDevice): OutputWindow | null {
    const outputWindow = window.open(
      '',
      `output_${id}`,
      'width=960,height=540,menubar=no,toolbar=no,location=no,status=no'
    );

    if (!outputWindow) {
      console.error('[OutputWindowManager] Failed to open window (popup blocked?)');
      return null;
    }

    outputWindow.document.title = `WebVJ Output - ${name}`;
    outputWindow.document.body.style.cssText =
      'margin:0;padding:0;background:#000;overflow:hidden;width:100vw;height:100vh;';

    const canvas = outputWindow.document.createElement('canvas');
    canvas.width = this.outputWidth;
    canvas.height = this.outputHeight;
    canvas.style.cssText = 'display:block;background:#000;';
    outputWindow.document.body.appendChild(canvas);

    // Aspect ratio locking
    const aspectRatio = this.outputWidth / this.outputHeight;
    let lastWidth = outputWindow.innerWidth;
    let lastHeight = outputWindow.innerHeight;
    let resizing = false;

    const enforceAspectRatio = () => {
      if (resizing) return;
      resizing = true;

      const currentWidth = outputWindow.innerWidth;
      const currentHeight = outputWindow.innerHeight;
      const widthDelta = Math.abs(currentWidth - lastWidth);
      const heightDelta = Math.abs(currentHeight - lastHeight);

      let newWidth: number;
      let newHeight: number;

      if (widthDelta >= heightDelta) {
        newWidth = currentWidth;
        newHeight = Math.round(currentWidth / aspectRatio);
      } else {
        newHeight = currentHeight;
        newWidth = Math.round(currentHeight * aspectRatio);
      }

      if (newWidth !== currentWidth || newHeight !== currentHeight) {
        outputWindow.resizeTo(
          newWidth + (outputWindow.outerWidth - currentWidth),
          newHeight + (outputWindow.outerHeight - currentHeight)
        );
      }

      canvas.style.width = '100%';
      canvas.style.height = '100%';

      lastWidth = newWidth;
      lastHeight = newHeight;

      setTimeout(() => { resizing = false; }, 50);
    };

    canvas.style.width = '100%';
    canvas.style.height = '100%';
    outputWindow.addEventListener('resize', enforceAspectRatio);

    let context: GPUCanvasContext | null = null;

    if (device) {
      context = canvas.getContext('webgpu');
      if (context) {
        context.configure({
          device,
          format: 'bgra8unorm',
          alphaMode: 'premultiplied',
        });
      }
    }

    // Fullscreen button
    const fullscreenBtn = outputWindow.document.createElement('button');
    fullscreenBtn.textContent = 'Fullscreen';
    fullscreenBtn.style.cssText =
      'position:fixed;top:10px;right:10px;padding:8px 16px;cursor:pointer;z-index:1000;opacity:0.7;';
    fullscreenBtn.onclick = () => {
      canvas.requestFullscreen();
    };
    outputWindow.document.body.appendChild(fullscreenBtn);

    outputWindow.document.addEventListener('fullscreenchange', () => {
      fullscreenBtn.style.display = outputWindow.document.fullscreenElement ? 'none' : 'block';
    });

    outputWindow.onbeforeunload = () => {
      this.outputWindows.delete(id);
    };

    const output: OutputWindow = {
      id,
      name,
      window: outputWindow,
      canvas,
      context,
      isFullscreen: false,
    };

    this.outputWindows.set(id, output);
    return output;
  }

  closeOutputWindow(id: string): void {
    const output = this.outputWindows.get(id);
    if (output?.window) {
      output.window.close();
    }
    this.outputWindows.delete(id);
  }

  getOutputWindows(): Map<string, OutputWindow> {
    return this.outputWindows;
  }

  updateResolution(width: number, height: number): void {
    this.outputWidth = width;
    this.outputHeight = height;
  }

  destroy(): void {
    for (const output of this.outputWindows.values()) {
      output.window?.close();
    }
    this.outputWindows.clear();
  }
}
```

---

### Step 5: Create `render/RenderLoop.ts`

**File:** `src/engine/render/RenderLoop.ts`

**Action:** Create new file. Extract RAF loop logic from lines 2075-2168.

```typescript
// Animation loop with idle detection and frame rate limiting

import type { StatsTracker } from '../stats/StatsTracker';

export interface RenderLoopCallbacks {
  isRecovering: () => boolean;
  isExporting: () => boolean;
  onRender: () => void;
}

export class RenderLoop {
  private animationId: number | null = null;
  private isRunning = false;

  // Idle mode
  private lastActivityTime = 0;
  private isIdle = false;
  private renderRequested = false;
  private lastRenderedPlayhead = -1;

  // Frame rate limiting
  private hasActiveVideo = false;
  private lastRenderTime = 0;

  private readonly IDLE_TIMEOUT = 1000; // 1s before idle
  private readonly VIDEO_FRAME_TIME = 16.67; // ~60fps target
  private readonly TARGET_FRAME_TIME = 16.67;

  private lastFpsReset = 0;

  constructor(
    private statsTracker: StatsTracker,
    private callbacks: RenderLoopCallbacks
  ) {}

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.lastActivityTime = performance.now();
    this.isIdle = false;
    console.log('[RenderLoop] Starting');

    let lastTimestamp = 0;

    const loop = (timestamp: number) => {
      if (!this.isRunning) return;

      const rafGap = lastTimestamp > 0 ? timestamp - lastTimestamp : 0;
      lastTimestamp = timestamp;

      // Idle detection
      const timeSinceActivity = timestamp - this.lastActivityTime;
      if (!this.isIdle && !this.renderRequested && timeSinceActivity > this.IDLE_TIMEOUT) {
        this.isIdle = true;
        console.log('[RenderLoop] Entering idle mode');
      }

      if (this.isIdle && this.renderRequested) {
        this.isIdle = false;
        console.log('[RenderLoop] Waking from idle');
      }

      this.renderRequested = false;

      // Skip during device recovery
      if (this.callbacks.isRecovering()) {
        this.animationId = requestAnimationFrame(loop);
        return;
      }

      // Call render callback (unless exporting)
      if (!this.callbacks.isExporting()) {
        this.callbacks.onRender();
      }

      // Skip stats when idle
      if (this.isIdle) {
        this.animationId = requestAnimationFrame(loop);
        return;
      }

      // Frame rate limiting for video
      if (this.hasActiveVideo) {
        const timeSinceLastRender = timestamp - this.lastRenderTime;
        if (timeSinceLastRender < this.VIDEO_FRAME_TIME) {
          this.animationId = requestAnimationFrame(loop);
          return;
        }
        this.lastRenderTime = timestamp;
      }

      // Record RAF gap for stats
      if (lastTimestamp > 0) {
        this.statsTracker.recordRafGap(rafGap);
      }

      // Reset per-second counters
      if (timestamp - this.lastFpsReset >= 1000) {
        this.statsTracker.resetPerSecondCounters();
        this.lastFpsReset = timestamp;
      }

      this.animationId = requestAnimationFrame(loop);
    };

    this.animationId = requestAnimationFrame(loop);
  }

  stop(): void {
    this.isRunning = false;
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  requestRender(): void {
    this.lastActivityTime = performance.now();
    this.renderRequested = true;
    if (this.isIdle) {
      this.isIdle = false;
    }
  }

  getIsIdle(): boolean {
    return this.isIdle;
  }

  updatePlayheadTracking(playhead: number): boolean {
    const changed = Math.abs(playhead - this.lastRenderedPlayhead) > 0.0001;
    if (changed) {
      this.lastRenderedPlayhead = playhead;
      this.requestRender();
    }
    return changed;
  }

  setHasActiveVideo(hasVideo: boolean): void {
    this.hasActiveVideo = hasVideo;
  }
}
```

---

### Step 6: Create `render/LayerCollector.ts`

**File:** `src/engine/render/LayerCollector.ts`

**Action:** Create new file. Extract texture import logic from lines 943-1150.

```typescript
// Collects layer render data by importing textures from various sources

import type { Layer, LayerRenderData } from '../core/types';
import type { TextureManager } from '../texture/TextureManager';
import type { ScrubbingCache } from '../texture/ScrubbingCache';

export interface LayerCollectorDeps {
  textureManager: TextureManager;
  scrubbingCache: ScrubbingCache | null;
  getLastVideoTime: (key: string) => number | undefined;
  setLastVideoTime: (key: string, time: number) => void;
  isExporting: boolean;
}

export class LayerCollector {
  private layerRenderData: LayerRenderData[] = [];
  private currentDecoder = 'none';
  private hasVideo = false;

  collect(layers: Layer[], deps: LayerCollectorDeps): LayerRenderData[] {
    this.layerRenderData.length = 0;
    this.hasVideo = false;
    this.currentDecoder = 'none';

    // Process layers in reverse order (lower slots render on top)
    for (let i = layers.length - 1; i >= 0; i--) {
      const layer = layers[i];
      if (!layer?.visible || !layer.source || layer.opacity === 0) continue;

      const data = this.collectLayerData(layer, deps);
      if (data) {
        this.layerRenderData.push(data);
      }
    }

    return this.layerRenderData;
  }

  private collectLayerData(layer: Layer, deps: LayerCollectorDeps): LayerRenderData | null {
    // 1. Try Native Helper decoder (turbo mode)
    if (layer.source.nativeDecoder) {
      const bitmap = layer.source.nativeDecoder.getCurrentFrame();
      if (bitmap) {
        const texture = deps.textureManager.createImageBitmapTexture(bitmap);
        if (texture) {
          this.currentDecoder = 'NativeHelper';
          return {
            layer,
            isVideo: false,
            externalTexture: null,
            textureView: texture.createView(),
            sourceWidth: bitmap.width,
            sourceHeight: bitmap.height,
          };
        }
      }
    }

    // 2. Try direct VideoFrame (parallel decoder)
    if (layer.source.videoFrame) {
      const frame = layer.source.videoFrame;
      const extTex = deps.textureManager.importVideoTexture(frame);
      if (extTex) {
        this.currentDecoder = 'ParallelDecode';
        this.hasVideo = true;
        return {
          layer,
          isVideo: true,
          externalTexture: extTex,
          textureView: null,
          sourceWidth: frame.displayWidth,
          sourceHeight: frame.displayHeight,
        };
      }
    }

    // 3. Try WebCodecs VideoFrame
    if (layer.source.webCodecsPlayer) {
      const frame = layer.source.webCodecsPlayer.getCurrentFrame();
      if (frame) {
        const extTex = deps.textureManager.importVideoTexture(frame);
        if (extTex) {
          this.currentDecoder = 'WebCodecs';
          this.hasVideo = true;
          return {
            layer,
            isVideo: true,
            externalTexture: extTex,
            textureView: null,
            sourceWidth: frame.displayWidth,
            sourceHeight: frame.displayHeight,
          };
        }
      }
    }

    // 4. Try HTMLVideoElement
    if (layer.source.videoElement) {
      const data = this.tryHTMLVideo(layer, deps);
      if (data) return data;
    }

    // 5. Try Image
    if (layer.source.imageElement) {
      const data = this.tryImage(layer, deps);
      if (data) return data;
    }

    // 6. Try Text Canvas
    if (layer.source.textCanvas) {
      const data = this.tryTextCanvas(layer, deps);
      if (data) return data;
    }

    // 7. Nested Composition (placeholder - actual texture set later)
    if (layer.source.nestedComposition) {
      const nestedComp = layer.source.nestedComposition;
      return {
        layer,
        isVideo: false,
        externalTexture: null,
        textureView: null, // Set after pre-render
        sourceWidth: nestedComp.width,
        sourceHeight: nestedComp.height,
      };
    }

    return null;
  }

  private tryHTMLVideo(layer: Layer, deps: LayerCollectorDeps): LayerRenderData | null {
    const video = layer.source.videoElement!;
    const videoKey = video.src || layer.id;

    if (video.readyState >= 2) {
      const lastTime = deps.getLastVideoTime(videoKey);
      const currentTime = video.currentTime;
      const videoTimeChanged = lastTime === undefined || Math.abs(currentTime - lastTime) > 0.001;

      // Use cache for paused videos (skip during export)
      if (!videoTimeChanged && !deps.isExporting) {
        const lastFrame = deps.scrubbingCache?.getLastFrame(video);
        if (lastFrame) {
          this.currentDecoder = 'HTMLVideo(paused-cache)';
          return {
            layer,
            isVideo: false,
            externalTexture: null,
            textureView: lastFrame.view,
            sourceWidth: lastFrame.width,
            sourceHeight: lastFrame.height,
          };
        }
      }

      // Import external texture
      const extTex = deps.textureManager.importVideoTexture(video);
      if (extTex) {
        deps.setLastVideoTime(videoKey, currentTime);

        // Cache frame for pause fallback
        const now = performance.now();
        const lastCapture = deps.scrubbingCache?.getLastCaptureTime(video) || 0;
        if (now - lastCapture > 200) {
          deps.scrubbingCache?.captureVideoFrame(video);
          deps.scrubbingCache?.setLastCaptureTime(video, now);
        }

        this.currentDecoder = 'HTMLVideo';
        this.hasVideo = true;
        return {
          layer,
          isVideo: true,
          externalTexture: extTex,
          textureView: null,
          sourceWidth: video.videoWidth,
          sourceHeight: video.videoHeight,
        };
      }

      // Fallback to cache
      const lastFrame = deps.scrubbingCache?.getLastFrame(video);
      if (lastFrame) {
        this.currentDecoder = 'HTMLVideo(cached)';
        return {
          layer,
          isVideo: false,
          externalTexture: null,
          textureView: lastFrame.view,
          sourceWidth: lastFrame.width,
          sourceHeight: lastFrame.height,
        };
      }
    } else {
      // Video not ready - try cache
      const lastFrame = deps.scrubbingCache?.getLastFrame(video);
      if (lastFrame) {
        return {
          layer,
          isVideo: false,
          externalTexture: null,
          textureView: lastFrame.view,
          sourceWidth: lastFrame.width,
          sourceHeight: lastFrame.height,
        };
      }
    }

    return null;
  }

  private tryImage(layer: Layer, deps: LayerCollectorDeps): LayerRenderData | null {
    const img = layer.source.imageElement!;
    let texture = deps.textureManager.getCachedImageTexture(img);
    if (!texture) {
      texture = deps.textureManager.createImageTexture(img) ?? undefined;
    }
    if (texture) {
      return {
        layer,
        isVideo: false,
        externalTexture: null,
        textureView: deps.textureManager.getImageView(texture),
        sourceWidth: img.naturalWidth,
        sourceHeight: img.naturalHeight,
      };
    }
    return null;
  }

  private tryTextCanvas(layer: Layer, deps: LayerCollectorDeps): LayerRenderData | null {
    const canvas = layer.source.textCanvas!;
    const texture = deps.textureManager.createCanvasTexture(canvas);
    if (texture) {
      return {
        layer,
        isVideo: false,
        externalTexture: null,
        textureView: deps.textureManager.getImageView(texture),
        sourceWidth: canvas.width,
        sourceHeight: canvas.height,
      };
    }
    return null;
  }

  getDecoder(): string {
    return this.currentDecoder;
  }

  hasActiveVideo(): boolean {
    return this.hasVideo;
  }
}
```

---

### Step 7: Create `render/Compositor.ts`

**File:** `src/engine/render/Compositor.ts`

**Action:** Create new file. Extract compositing loop from lines 1219-1411.

```typescript
// Ping-pong compositing with effects

import type { Layer, LayerRenderData, CompositeResult } from '../core/types';
import type { CompositorPipeline } from '../pipeline/CompositorPipeline';
import type { EffectsPipeline } from '../../effects/EffectsPipeline';
import type { MaskTextureManager } from '../texture/MaskTextureManager';

export interface CompositorState {
  device: GPUDevice;
  sampler: GPUSampler;
  pingView: GPUTextureView;
  pongView: GPUTextureView;
  outputWidth: number;
  outputHeight: number;
}

export class Compositor {
  private lastRenderWasPing = false;

  constructor(
    private compositorPipeline: CompositorPipeline,
    private effectsPipeline: EffectsPipeline,
    private maskTextureManager: MaskTextureManager
  ) {}

  composite(
    layerData: LayerRenderData[],
    commandEncoder: GPUCommandEncoder,
    state: CompositorState
  ): CompositeResult {
    let readView = state.pingView;
    let writeView = state.pongView;
    let usePing = true;

    // Clear first buffer to transparent
    const clearPass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: readView,
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    clearPass.end();

    // Composite each layer
    for (let i = 0; i < layerData.length; i++) {
      const data = layerData[i];
      const layer = data.layer;

      // Get uniform buffer
      const uniformBuffer = this.compositorPipeline.getOrCreateUniformBuffer(layer.id);

      // Calculate aspect ratios
      const sourceAspect = data.sourceWidth / data.sourceHeight;
      const outputAspect = state.outputWidth / state.outputHeight;

      // Get mask texture
      const maskLookupId = layer.maskClipId || layer.id;
      const hasMask = this.maskTextureManager.hasMaskTexture(maskLookupId);
      const maskTextureView = this.maskTextureManager.getMaskTextureView(maskLookupId) ??
                              this.maskTextureManager.getWhiteMaskView()!;

      this.maskTextureManager.logMaskState(maskLookupId, hasMask);

      // Update uniforms
      this.compositorPipeline.updateLayerUniforms(layer, sourceAspect, outputAspect, hasMask, uniformBuffer);

      let pipeline: GPURenderPipeline;
      let bindGroup: GPUBindGroup;

      if (data.isVideo && data.externalTexture) {
        pipeline = this.compositorPipeline.getExternalCompositePipeline()!;
        bindGroup = this.compositorPipeline.createExternalCompositeBindGroup(
          state.sampler,
          readView,
          data.externalTexture,
          uniformBuffer,
          maskTextureView
        );
      } else if (data.textureView) {
        pipeline = this.compositorPipeline.getCompositePipeline()!;
        bindGroup = this.compositorPipeline.createCompositeBindGroup(
          state.sampler,
          readView,
          data.textureView,
          uniformBuffer,
          maskTextureView
        );
      } else {
        continue;
      }

      // Render pass
      const compositePass = commandEncoder.beginRenderPass({
        colorAttachments: [{
          view: writeView,
          loadOp: 'clear',
          storeOp: 'store',
        }],
      });
      compositePass.setPipeline(pipeline);
      compositePass.setBindGroup(0, bindGroup);
      compositePass.draw(6);
      compositePass.end();

      // Apply effects
      if (layer.effects && layer.effects.length > 0) {
        const result = this.effectsPipeline.applyEffects(
          commandEncoder,
          layer.effects,
          state.sampler,
          writeView,
          readView,
          state.pingView,
          state.pongView,
          state.outputWidth,
          state.outputHeight
        );

        if (result.swapped) {
          const tempView = readView;
          readView = writeView;
          writeView = tempView;
          usePing = !usePing;
        }
      }

      // Swap buffers
      const temp = readView;
      readView = writeView;
      writeView = temp;
      usePing = !usePing;
    }

    this.lastRenderWasPing = usePing;

    return {
      finalView: readView,
      usedPing: !usePing,
      layerCount: layerData.length,
    };
  }

  getLastRenderWasPing(): boolean {
    return this.lastRenderWasPing;
  }
}
```

---

### Step 8: Create `render/NestedCompRenderer.ts`

**File:** `src/engine/render/NestedCompRenderer.ts`

**Action:** Create new file. Extract from lines 1600-2019. This is the largest extraction.

```typescript
// Pre-renders nested compositions to offscreen textures

import type { Layer, LayerRenderData } from '../core/types';
import type { CompositorPipeline } from '../pipeline/CompositorPipeline';
import type { EffectsPipeline } from '../../effects/EffectsPipeline';
import type { OutputPipeline } from '../pipeline/OutputPipeline';
import type { TextureManager } from '../texture/TextureManager';
import type { MaskTextureManager } from '../texture/MaskTextureManager';

interface NestedCompTexture {
  texture: GPUTexture;
  view: GPUTextureView;
}

export class NestedCompRenderer {
  private nestedCompTextures: Map<string, NestedCompTexture> = new Map();
  private pendingTextureCleanup: GPUTexture[] = [];

  constructor(
    private device: GPUDevice,
    private compositorPipeline: CompositorPipeline,
    private effectsPipeline: EffectsPipeline,
    private textureManager: TextureManager,
    private maskTextureManager: MaskTextureManager
  ) {}

  preRender(
    compositionId: string,
    nestedLayers: Layer[],
    width: number,
    height: number,
    commandEncoder: GPUCommandEncoder,
    sampler: GPUSampler
  ): GPUTextureView | null {
    // Get or create output texture
    let compTexture = this.nestedCompTextures.get(compositionId);
    if (!compTexture || compTexture.texture.width !== width || compTexture.texture.height !== height) {
      if (compTexture) compTexture.texture.destroy();

      const texture = this.device.createTexture({
        size: { width, height },
        format: 'rgba8unorm',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
      });
      compTexture = { texture, view: texture.createView() };
      this.nestedCompTextures.set(compositionId, compTexture);
    }

    // Create temporary ping-pong textures
    const nestedPingTexture = this.device.createTexture({
      size: { width, height },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    const nestedPongTexture = this.device.createTexture({
      size: { width, height },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    const nestedPingView = nestedPingTexture.createView();
    const nestedPongView = nestedPongTexture.createView();

    // Collect layer data
    const nestedLayerData = this.collectNestedLayerData(nestedLayers);

    // Handle empty composition
    if (nestedLayerData.length === 0) {
      const clearPass = commandEncoder.beginRenderPass({
        colorAttachments: [{
          view: compTexture.view,
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'clear',
          storeOp: 'store',
        }],
      });
      clearPass.end();
      nestedPingTexture.destroy();
      nestedPongTexture.destroy();
      return compTexture.view;
    }

    // Ping-pong compositing
    let readView = nestedPingView;
    let writeView = nestedPongView;

    // Clear first buffer
    const clearPass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: readView,
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    clearPass.end();

    // Composite nested layers
    const outputAspect = width / height;
    for (const data of nestedLayerData) {
      const layer = data.layer;
      const uniformBuffer = this.compositorPipeline.getOrCreateUniformBuffer(`nested-${compositionId}-${layer.id}`);
      const sourceAspect = data.sourceWidth / data.sourceHeight;

      const maskLookupId = layer.maskClipId || layer.id;
      const hasMask = this.maskTextureManager.hasMaskTexture(maskLookupId);
      const maskTextureView = this.maskTextureManager.getMaskTextureView(maskLookupId) ??
                              this.maskTextureManager.getWhiteMaskView()!;

      this.compositorPipeline.updateLayerUniforms(layer, sourceAspect, outputAspect, hasMask, uniformBuffer);

      let pipeline: GPURenderPipeline;
      let bindGroup: GPUBindGroup;

      if (data.isVideo && data.externalTexture) {
        pipeline = this.compositorPipeline.getExternalCompositePipeline()!;
        bindGroup = this.compositorPipeline.createExternalCompositeBindGroup(
          sampler, readView, data.externalTexture, uniformBuffer, maskTextureView
        );
      } else if (data.textureView) {
        pipeline = this.compositorPipeline.getCompositePipeline()!;
        bindGroup = this.compositorPipeline.createCompositeBindGroup(
          sampler, readView, data.textureView, uniformBuffer, maskTextureView
        );
      } else {
        continue;
      }

      const pass = commandEncoder.beginRenderPass({
        colorAttachments: [{ view: writeView, loadOp: 'clear', storeOp: 'store' }],
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.draw(6);
      pass.end();

      // Apply effects
      if (layer.effects?.length && this.effectsPipeline) {
        const result = this.effectsPipeline.applyEffects(
          commandEncoder, layer.effects, sampler,
          writeView, readView, nestedPingView, nestedPongView, width, height
        );
        if (result.swapped) {
          [readView, writeView] = [writeView, readView];
        }
      }

      // Swap
      [readView, writeView] = [writeView, readView];
    }

    // Copy result to output texture
    this.copyToOutput(commandEncoder, readView, compTexture, compositionId, sampler);

    // Queue cleanup
    this.pendingTextureCleanup.push(nestedPingTexture, nestedPongTexture);

    return compTexture.view;
  }

  private collectNestedLayerData(layers: Layer[]): LayerRenderData[] {
    const result: LayerRenderData[] = [];

    for (let i = layers.length - 1; i >= 0; i--) {
      const layer = layers[i];
      if (!layer?.visible || !layer.source || layer.opacity === 0) continue;

      // VideoFrame
      if (layer.source.videoFrame) {
        const frame = layer.source.videoFrame;
        const extTex = this.textureManager.importVideoTexture(frame);
        if (extTex) {
          result.push({
            layer, isVideo: true, externalTexture: extTex, textureView: null,
            sourceWidth: frame.displayWidth, sourceHeight: frame.displayHeight,
          });
          continue;
        }
      }

      // WebCodecs
      if (layer.source.webCodecsPlayer) {
        const frame = layer.source.webCodecsPlayer.getCurrentFrame();
        if (frame) {
          const extTex = this.textureManager.importVideoTexture(frame);
          if (extTex) {
            result.push({
              layer, isVideo: true, externalTexture: extTex, textureView: null,
              sourceWidth: frame.displayWidth, sourceHeight: frame.displayHeight,
            });
            continue;
          }
        }
      }

      // HTMLVideo
      if (layer.source.videoElement) {
        const video = layer.source.videoElement;
        if (video.readyState >= 2) {
          const extTex = this.textureManager.importVideoTexture(video);
          if (extTex) {
            result.push({
              layer, isVideo: true, externalTexture: extTex, textureView: null,
              sourceWidth: video.videoWidth, sourceHeight: video.videoHeight,
            });
            continue;
          }
        }
      }

      // Image
      if (layer.source.imageElement) {
        const img = layer.source.imageElement;
        let texture = this.textureManager.getCachedImageTexture(img);
        if (!texture) texture = this.textureManager.createImageTexture(img) ?? undefined;
        if (texture) {
          result.push({
            layer, isVideo: false, externalTexture: null,
            textureView: this.textureManager.getImageView(texture),
            sourceWidth: img.naturalWidth, sourceHeight: img.naturalHeight,
          });
          continue;
        }
      }

      // Text
      if (layer.source.textCanvas) {
        const canvas = layer.source.textCanvas;
        const texture = this.textureManager.createCanvasTexture(canvas);
        if (texture) {
          result.push({
            layer, isVideo: false, externalTexture: null,
            textureView: this.textureManager.getImageView(texture),
            sourceWidth: canvas.width, sourceHeight: canvas.height,
          });
        }
      }
    }

    return result;
  }

  private copyToOutput(
    commandEncoder: GPUCommandEncoder,
    sourceView: GPUTextureView,
    compTexture: NestedCompTexture,
    compositionId: string,
    sampler: GPUSampler
  ): void {
    const copyUniformBuffer = this.compositorPipeline.getOrCreateUniformBuffer(`nested-copy-${compositionId}`);
    const passthroughLayer: Layer = {
      id: 'passthrough', name: 'passthrough', visible: true, opacity: 1,
      blendMode: 'normal', source: { type: 'image' }, effects: [],
      position: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1 }, rotation: { x: 0, y: 0, z: 0 },
    };
    this.compositorPipeline.updateLayerUniforms(passthroughLayer, 1, 1, false, copyUniformBuffer);

    const copyBindGroup = this.compositorPipeline.createCompositeBindGroup(
      sampler, sourceView, sourceView, copyUniformBuffer, this.maskTextureManager.getWhiteMaskView()!
    );

    const copyPass = commandEncoder.beginRenderPass({
      colorAttachments: [{ view: compTexture.view, loadOp: 'clear', storeOp: 'store' }],
    });
    copyPass.setPipeline(this.compositorPipeline.getCompositePipeline()!);
    copyPass.setBindGroup(0, copyBindGroup);
    copyPass.draw(6);
    copyPass.end();
  }

  hasTexture(compositionId: string): boolean {
    return this.nestedCompTextures.has(compositionId);
  }

  getTexture(compositionId: string): NestedCompTexture | undefined {
    return this.nestedCompTextures.get(compositionId);
  }

  cleanupPendingTextures(): void {
    for (const texture of this.pendingTextureCleanup) {
      texture.destroy();
    }
    this.pendingTextureCleanup = [];
  }

  cleanupTexture(compositionId: string): void {
    const tex = this.nestedCompTextures.get(compositionId);
    if (tex) {
      tex.texture.destroy();
      this.nestedCompTextures.delete(compositionId);
    }
  }

  destroy(): void {
    for (const tex of this.nestedCompTextures.values()) {
      tex.texture.destroy();
    }
    this.nestedCompTextures.clear();
    this.cleanupPendingTextures();
  }
}
```

---

### Step 9: Update `WebGPUEngine.ts` (Facade)

**File:** `src/engine/WebGPUEngine.ts`

**Action:** Replace entire file content. This is the final facade that wires everything together.

**Key changes:**
1. Import new modules
2. Instantiate them in `createResources()`
3. Delegate to them in public methods
4. Keep canvas management inline (simple Map operations)
5. Keep device recovery callbacks inline

```typescript
// WebGPU Rendering Engine - Thin Facade
// Orchestrates: StatsTracker, RenderTargetManager, OutputWindowManager,
//               RenderLoop, LayerCollector, Compositor, NestedCompRenderer

import type { Layer, OutputWindow, EngineStats, LayerRenderData } from './core/types';
import { WebGPUContext, type GPUPowerPreference } from './core/WebGPUContext';
import { TextureManager } from './texture/TextureManager';
import { MaskTextureManager } from './texture/MaskTextureManager';
import { ScrubbingCache } from './texture/ScrubbingCache';
import { CompositorPipeline } from './pipeline/CompositorPipeline';
import { EffectsPipeline } from '../effects/EffectsPipeline';
import { OutputPipeline } from './pipeline/OutputPipeline';
import { VideoFrameManager } from './video/VideoFrameManager';
import { useMediaStore } from '../stores/mediaStore';
import { useSettingsStore } from '../stores/settingsStore';
import { reportRenderTime } from '../services/performanceMonitor';

// New modules
import { StatsTracker } from './stats/StatsTracker';
import { RenderTargetManager } from './core/RenderTargetManager';
import { OutputWindowManager } from './managers/OutputWindowManager';
import { RenderLoop } from './render/RenderLoop';
import { LayerCollector } from './render/LayerCollector';
import { Compositor } from './render/Compositor';
import { NestedCompRenderer } from './render/NestedCompRenderer';

export class WebGPUEngine {
  // Core context
  private context: WebGPUContext;

  // Extracted modules
  private statsTracker: StatsTracker;
  private renderTargetManager: RenderTargetManager | null = null;
  private outputWindowManager: OutputWindowManager | null = null;
  private renderLoop: RenderLoop | null = null;
  private layerCollector: LayerCollector | null = null;
  private compositor: Compositor | null = null;
  private nestedCompRenderer: NestedCompRenderer | null = null;

  // Existing managers (unchanged)
  private textureManager: TextureManager | null = null;
  private maskTextureManager: MaskTextureManager | null = null;
  private scrubbingCache: ScrubbingCache | null = null;
  private videoFrameManager: VideoFrameManager;

  // Pipelines
  private compositorPipeline: CompositorPipeline | null = null;
  private effectsPipeline: EffectsPipeline | null = null;
  private outputPipeline: OutputPipeline | null = null;

  // Resources
  private sampler: GPUSampler | null = null;

  // Canvas management (kept inline - simple Map operations)
  private previewContext: GPUCanvasContext | null = null;
  private previewCanvases: Map<string, GPUCanvasContext> = new Map();
  private independentPreviewCanvases: Map<string, GPUCanvasContext> = new Map();
  private independentCanvasCompositions: Map<string, string> = new Map();
  private previewCanvasElements: Map<string, HTMLCanvasElement> = new Map();
  private independentCanvasElements: Map<string, HTMLCanvasElement> = new Map();
  private mainPreviewCanvas: HTMLCanvasElement | null = null;

  // State flags
  private isRecoveringFromDeviceLoss = false;
  private isGeneratingRamPreview = false;
  private isExporting = false;
  private showTransparencyGrid = false;

  // Video time tracking (for optimization)
  private lastVideoTime: Map<string, number> = new Map();

  // RAM preview playback
  private ramPlaybackCanvas: HTMLCanvasElement | null = null;
  private ramPlaybackCtx: CanvasRenderingContext2D | null = null;

  constructor() {
    this.context = new WebGPUContext();
    this.videoFrameManager = new VideoFrameManager();
    this.statsTracker = new StatsTracker();

    // Device recovery handlers
    this.context.onDeviceLost((reason) => {
      console.log('[WebGPUEngine] Device lost:', reason);
      this.isRecoveringFromDeviceLoss = true;
      this.handleDeviceLost();
    });

    this.context.onDeviceRestored(() => {
      console.log('[WebGPUEngine] Device restored');
      this.handleDeviceRestored();
      this.isRecoveringFromDeviceLoss = false;
    });
  }

  // === INITIALIZATION ===

  async initialize(): Promise<boolean> {
    const preference = useSettingsStore.getState().gpuPowerPreference;
    const success = await this.context.initialize(preference);
    if (!success) return false;

    await this.createResources();
    console.log('[WebGPU] Engine initialized');
    return true;
  }

  private async createResources(): Promise<void> {
    const device = this.context.getDevice();
    if (!device) return;

    // Initialize managers
    this.textureManager = new TextureManager(device);
    this.maskTextureManager = new MaskTextureManager(device);
    this.scrubbingCache = new ScrubbingCache(device);

    // Create sampler
    this.sampler = this.context.createSampler();

    // Create pipelines
    this.compositorPipeline = new CompositorPipeline(device);
    this.effectsPipeline = new EffectsPipeline(device);
    this.outputPipeline = new OutputPipeline(device);
    await this.compositorPipeline.createPipelines();
    await this.effectsPipeline.createPipelines();
    await this.outputPipeline.createPipeline();

    await new Promise(resolve => setTimeout(resolve, 100));

    // Initialize extracted modules
    this.renderTargetManager = new RenderTargetManager(device);
    this.renderTargetManager.createBlackTexture((r, g, b, a) =>
      this.context.createSolidColorTexture(r, g, b, a)
    );
    this.renderTargetManager.createPingPongTextures();

    const { width, height } = this.renderTargetManager.getResolution();
    this.outputWindowManager = new OutputWindowManager(width, height);

    this.layerCollector = new LayerCollector();

    this.compositor = new Compositor(
      this.compositorPipeline,
      this.effectsPipeline,
      this.maskTextureManager
    );

    this.nestedCompRenderer = new NestedCompRenderer(
      device,
      this.compositorPipeline,
      this.effectsPipeline,
      this.textureManager,
      this.maskTextureManager
    );

    this.renderLoop = new RenderLoop(this.statsTracker, {
      isRecovering: () => this.isRecoveringFromDeviceLoss || this.context.recovering,
      isExporting: () => this.isExporting,
      onRender: () => {}, // Set by start()
    });
  }

  // === DEVICE RECOVERY ===

  private handleDeviceLost(): void {
    this.renderLoop?.stop();

    // Clear GPU resources
    this.renderTargetManager?.clearAll();
    this.previewContext = null;
    this.previewCanvases.clear();
    this.independentPreviewCanvases.clear();
    this.lastVideoTime.clear();

    // Clear managers
    this.textureManager = null;
    this.maskTextureManager = null;
    this.scrubbingCache = null;
    this.compositorPipeline = null;
    this.effectsPipeline = null;
    this.outputPipeline = null;

    console.log('[WebGPUEngine] Resources cleaned after device loss');
  }

  private async handleDeviceRestored(): Promise<void> {
    await this.createResources();

    // Reconfigure canvases
    if (this.mainPreviewCanvas) {
      this.previewContext = this.context.configureCanvas(this.mainPreviewCanvas);
    }
    for (const [id, canvas] of this.previewCanvasElements) {
      const ctx = this.context.configureCanvas(canvas);
      if (ctx) this.previewCanvases.set(id, ctx);
    }
    for (const [id, canvas] of this.independentCanvasElements) {
      const ctx = this.context.configureCanvas(canvas);
      if (ctx) this.independentPreviewCanvases.set(id, ctx);
    }

    this.renderLoop?.start();
    this.requestRender();
    console.log('[WebGPUEngine] Recovery complete');
  }

  // === CANVAS MANAGEMENT ===

  setPreviewCanvas(canvas: HTMLCanvasElement): void {
    this.mainPreviewCanvas = canvas;
    this.previewContext = this.context.configureCanvas(canvas);
  }

  registerPreviewCanvas(id: string, canvas: HTMLCanvasElement): void {
    this.previewCanvasElements.set(id, canvas);
    const ctx = this.context.configureCanvas(canvas);
    if (ctx) this.previewCanvases.set(id, ctx);
  }

  unregisterPreviewCanvas(id: string): void {
    this.previewCanvases.delete(id);
    this.previewCanvasElements.delete(id);
  }

  registerIndependentPreviewCanvas(id: string, canvas: HTMLCanvasElement, compositionId?: string): void {
    this.independentCanvasElements.set(id, canvas);
    const ctx = this.context.configureCanvas(canvas);
    if (ctx) {
      this.independentPreviewCanvases.set(id, ctx);
      if (compositionId) this.independentCanvasCompositions.set(id, compositionId);
    }
  }

  unregisterIndependentPreviewCanvas(id: string): void {
    this.independentPreviewCanvases.delete(id);
    this.independentCanvasElements.delete(id);
    this.independentCanvasCompositions.delete(id);
  }

  setIndependentCanvasComposition(canvasId: string, compositionId: string): void {
    this.independentCanvasCompositions.set(canvasId, compositionId);
  }

  // === OUTPUT WINDOWS ===

  createOutputWindow(id: string, name: string): OutputWindow | null {
    const device = this.context.getDevice();
    if (!device || !this.outputWindowManager) return null;
    return this.outputWindowManager.createOutputWindow(id, name, device);
  }

  closeOutputWindow(id: string): void {
    this.outputWindowManager?.closeOutputWindow(id);
  }

  // === MASK MANAGEMENT ===

  updateMaskTexture(layerId: string, imageData: ImageData | null): void {
    this.maskTextureManager?.updateMaskTexture(layerId, imageData);
  }

  removeMaskTexture(layerId: string): void {
    this.maskTextureManager?.removeMaskTexture(layerId);
  }

  hasMaskTexture(layerId: string): boolean {
    return this.maskTextureManager?.hasMaskTexture(layerId) ?? false;
  }

  // === VIDEO MANAGEMENT ===

  registerVideo(video: HTMLVideoElement): void {
    this.videoFrameManager.registerVideo(video);
  }

  setActiveVideo(video: HTMLVideoElement | null): void {
    this.videoFrameManager.setActiveVideo(video);
  }

  cleanupVideo(video: HTMLVideoElement): void {
    this.scrubbingCache?.cleanupVideo(video);
    this.videoFrameManager.cleanupVideo(video);
    if (video.src) this.lastVideoTime.delete(video.src);
  }

  // === TEXTURE MANAGEMENT ===

  createImageTexture(image: HTMLImageElement): GPUTexture | null {
    return this.textureManager?.createImageTexture(image) ?? null;
  }

  importVideoTexture(source: HTMLVideoElement | VideoFrame): GPUExternalTexture | null {
    return this.textureManager?.importVideoTexture(source) ?? null;
  }

  // === CACHING ===

  clearCaches(): void {
    this.scrubbingCache?.clearAll();
    this.textureManager?.clearCaches();
  }

  clearVideoCache(): void {
    this.lastVideoTime.clear();
  }

  setGeneratingRamPreview(generating: boolean): void {
    this.isGeneratingRamPreview = generating;
  }

  setExporting(exporting: boolean): void {
    this.isExporting = exporting;
    if (exporting) this.lastVideoTime.clear();
  }

  getIsExporting(): boolean {
    return this.isExporting;
  }

  // === RENDER LOOP ===

  requestRender(): void {
    this.renderLoop?.requestRender();
  }

  getIsIdle(): boolean {
    return this.renderLoop?.getIsIdle() ?? false;
  }

  updatePlayheadTracking(playhead: number): boolean {
    return this.renderLoop?.updatePlayheadTracking(playhead) ?? false;
  }

  start(renderCallback: () => void): void {
    if (!this.renderLoop) return;

    // Create new loop with the callback
    this.renderLoop = new RenderLoop(this.statsTracker, {
      isRecovering: () => this.isRecoveringFromDeviceLoss || this.context.recovering,
      isExporting: () => this.isExporting,
      onRender: renderCallback,
    });
    this.renderLoop.start();
  }

  stop(): void {
    this.renderLoop?.stop();
  }

  // === MAIN RENDER ===

  render(layers: Layer[]): void {
    if (this.isRecoveringFromDeviceLoss || this.context.recovering) return;

    const device = this.context.getDevice();
    if (!device || !this.compositorPipeline || !this.outputPipeline || !this.sampler) return;
    if (!this.renderTargetManager || !this.layerCollector || !this.compositor) return;

    const pingView = this.renderTargetManager.getPingView();
    const pongView = this.renderTargetManager.getPongView();
    if (!pingView || !pongView) return;

    const t0 = performance.now();
    const { width, height } = this.renderTargetManager.getResolution();

    // Collect layer data
    const t1 = performance.now();
    const layerData = this.layerCollector.collect(layers, {
      textureManager: this.textureManager!,
      scrubbingCache: this.scrubbingCache,
      getLastVideoTime: (key) => this.lastVideoTime.get(key),
      setLastVideoTime: (key, time) => this.lastVideoTime.set(key, time),
      isExporting: this.isExporting,
    });
    const importTime = performance.now() - t1;

    // Update stats
    this.statsTracker.setDecoder(this.layerCollector.getDecoder());
    this.renderLoop?.setHasActiveVideo(this.layerCollector.hasActiveVideo());

    // Handle empty layers
    if (layerData.length === 0) {
      this.renderEmptyFrame(device);
      this.statsTracker.setLayerCount(0);
      return;
    }

    // Pre-render nested compositions
    const preRenderEncoder = device.createCommandEncoder();
    for (const data of layerData) {
      if (data.layer.source?.nestedComposition) {
        const nc = data.layer.source.nestedComposition;
        const view = this.nestedCompRenderer!.preRender(
          nc.compositionId, nc.layers, nc.width, nc.height, preRenderEncoder, this.sampler
        );
        if (view) data.textureView = view;
      }
    }
    device.queue.submit([preRenderEncoder.finish()]);
    this.nestedCompRenderer!.cleanupPendingTextures();

    // Composite
    const t2 = performance.now();
    const commandEncoder = device.createCommandEncoder();
    const result = this.compositor.composite(layerData, commandEncoder, {
      device, sampler: this.sampler, pingView, pongView, outputWidth: width, outputHeight: height,
    });
    const renderTime = performance.now() - t2;

    // Output
    const finalIsPing = result.usedPing;
    const outputBindGroup = this.outputPipeline.getOutputBindGroup(this.sampler, result.finalView, finalIsPing);
    this.outputPipeline.updateUniforms(this.showTransparencyGrid, width, height);

    const skipCanvas = this.isGeneratingRamPreview || this.isExporting;
    if (!skipCanvas) {
      if (this.previewContext) {
        this.outputPipeline.renderToCanvas(commandEncoder, this.previewContext, outputBindGroup);
      }
      for (const ctx of this.previewCanvases.values()) {
        this.outputPipeline.renderToCanvas(commandEncoder, ctx, outputBindGroup);
      }
      // Independent canvases showing active comp
      const activeCompId = useMediaStore.getState().activeCompositionId;
      for (const [canvasId, compId] of this.independentCanvasCompositions) {
        if (compId === activeCompId) {
          const ctx = this.independentPreviewCanvases.get(canvasId);
          if (ctx) this.outputPipeline.renderToCanvas(commandEncoder, ctx, outputBindGroup);
        }
      }
      // Output windows
      for (const output of this.outputWindowManager!.getOutputWindows().values()) {
        if (output.context) this.outputPipeline.renderToCanvas(commandEncoder, output.context, outputBindGroup);
      }
    }

    const t3 = performance.now();
    device.queue.submit([commandEncoder.finish()]);
    const submitTime = performance.now() - t3;

    // Stats
    const totalTime = performance.now() - t0;
    this.statsTracker.recordRenderTiming({
      importTexture: importTime,
      createBindGroup: 0,
      renderPass: renderTime,
      submit: submitTime,
      total: totalTime,
    });
    this.statsTracker.setLayerCount(result.layerCount);
    this.statsTracker.updateStats();
    reportRenderTime(totalTime);
  }

  private renderEmptyFrame(device: GPUDevice): void {
    const commandEncoder = device.createCommandEncoder();
    if (this.previewContext) {
      const pass = commandEncoder.beginRenderPass({
        colorAttachments: [{
          view: this.previewContext.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        }],
      });
      pass.end();
    }
    for (const ctx of this.previewCanvases.values()) {
      const pass = commandEncoder.beginRenderPass({
        colorAttachments: [{
          view: ctx.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        }],
      });
      pass.end();
    }
    device.queue.submit([commandEncoder.finish()]);
  }

  // === RESOLUTION ===

  setResolution(width: number, height: number): void {
    if (this.renderTargetManager?.setResolution(width, height)) {
      this.scrubbingCache?.clearCompositeCache();
      this.scrubbingCache?.clearScrubbingCache();
      this.outputWindowManager?.updateResolution(width, height);
      this.outputPipeline?.invalidateCache();
      this.compositorPipeline?.invalidateBindGroupCache();
    }
  }

  setShowTransparencyGrid(show: boolean): void {
    this.showTransparencyGrid = show;
  }

  getOutputDimensions(): { width: number; height: number } {
    return this.renderTargetManager?.getResolution() ?? { width: 640, height: 360 };
  }

  // === STATS ===

  getStats(): EngineStats {
    return this.statsTracker.getStats(this.getIsIdle());
  }

  // === ACCESSORS ===

  getDevice(): GPUDevice | null {
    return this.context.getDevice();
  }

  isDeviceValid(): boolean {
    return this.context.initialized && this.context.getDevice() !== null;
  }

  getGPUInfo(): { vendor: string; device: string; description: string } | null {
    return this.context.getGPUInfo();
  }

  getPowerPreference(): GPUPowerPreference {
    return this.context.getPowerPreference();
  }

  async reinitializeWithPreference(preference: GPUPowerPreference): Promise<boolean> {
    this.stop();
    this.handleDeviceLost();
    const success = await this.context.reinitializeWithPreference(preference);
    if (!success) return false;
    await this.handleDeviceRestored();
    return true;
  }

  // === PIXEL READBACK ===

  async readPixels(): Promise<Uint8ClampedArray | null> {
    const device = this.context.getDevice();
    const pingTex = this.renderTargetManager?.getPingTexture();
    const pongTex = this.renderTargetManager?.getPongTexture();
    if (!device || !pingTex || !pongTex) return null;

    const { width, height } = this.renderTargetManager!.getResolution();
    const sourceTexture = this.compositor?.getLastRenderWasPing() ? pingTex : pongTex;

    const bytesPerPixel = 4;
    const unalignedBytesPerRow = width * bytesPerPixel;
    const bytesPerRow = Math.ceil(unalignedBytesPerRow / 256) * 256;
    const bufferSize = bytesPerRow * height;

    const stagingBuffer = device.createBuffer({
      size: bufferSize,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    const commandEncoder = device.createCommandEncoder();
    commandEncoder.copyTextureToBuffer(
      { texture: sourceTexture },
      { buffer: stagingBuffer, bytesPerRow, rowsPerImage: height },
      [width, height]
    );
    device.queue.submit([commandEncoder.finish()]);

    await stagingBuffer.mapAsync(GPUMapMode.READ);
    const arrayBuffer = stagingBuffer.getMappedRange();
    const result = new Uint8ClampedArray(width * height * bytesPerPixel);
    const srcView = new Uint8Array(arrayBuffer);

    if (bytesPerRow === unalignedBytesPerRow) {
      result.set(srcView.subarray(0, result.length));
    } else {
      for (let y = 0; y < height; y++) {
        const srcOffset = y * bytesPerRow;
        const dstOffset = y * unalignedBytesPerRow;
        result.set(srcView.subarray(srcOffset, srcOffset + unalignedBytesPerRow), dstOffset);
      }
    }

    stagingBuffer.unmap();
    stagingBuffer.destroy();
    return result;
  }

  // === CLEANUP ===

  destroy(): void {
    this.stop();
    this.outputWindowManager?.destroy();
    this.renderTargetManager?.destroy();
    this.nestedCompRenderer?.destroy();
    this.textureManager?.destroy();
    this.maskTextureManager?.destroy();
    this.scrubbingCache?.destroy();
    this.videoFrameManager.destroy();
    this.compositorPipeline?.destroy();
    this.effectsPipeline?.destroy();
    this.outputPipeline?.destroy();
    this.context.destroy();
    this.lastVideoTime.clear();
  }
}

// === HMR SINGLETON ===

let engineInstance: WebGPUEngine;

const hot = typeof import.meta !== 'undefined'
  ? (import.meta as { hot?: { data: Record<string, unknown> } }).hot
  : undefined;

if (hot) {
  const existing = hot.data.engine as WebGPUEngine | undefined;
  if (existing) {
    console.log('[WebGPU] Reusing engine from HMR');
    existing.clearVideoCache();
    engineInstance = existing;
  } else {
    console.log('[WebGPU] Creating new engine');
    engineInstance = new WebGPUEngine();
    hot.data.engine = engineInstance;
  }
} else {
  engineInstance = new WebGPUEngine();
}

export const engine = engineInstance;
```

---

## Post-Refactor Validation

### Step 10: Verify Compilation

```bash
# Check all new files compile
npx tsc --noEmit

# If errors, fix imports and types
```

### Step 11: Run Tests

```bash
npm run test
```

### Step 12: Manual Testing

1. `npm run dev`
2. Open browser at `http://localhost:5173`
3. Verify:
   - [ ] Preview renders
   - [ ] FPS display works
   - [ ] Video playback works
   - [ ] Effects apply correctly
   - [ ] Nested compositions render
   - [ ] Export works
   - [ ] Device recovery (simulate by opening chrome://gpu)

### Step 13: Commit

```bash
git add -A
git commit -m "refactor: Split WebGPUEngine into focused modules

- Extract StatsTracker (stats/StatsTracker.ts)
- Extract RenderTargetManager (core/RenderTargetManager.ts)
- Extract OutputWindowManager (managers/OutputWindowManager.ts)
- Extract RenderLoop (render/RenderLoop.ts)
- Extract LayerCollector (render/LayerCollector.ts)
- Extract Compositor (render/Compositor.ts)
- Extract NestedCompRenderer (render/NestedCompRenderer.ts)
- Refactor WebGPUEngine as thin facade

No functional changes. All modules ~150-350 LOC."

git push origin staging
```

---

## File Size Summary

| File | Target LOC | Purpose |
|------|-----------|---------|
| `stats/StatsTracker.ts` | ~120 | FPS, timing, drops |
| `core/RenderTargetManager.ts` | ~150 | Ping-pong textures |
| `managers/OutputWindowManager.ts` | ~130 | External windows |
| `render/RenderLoop.ts` | ~130 | RAF, idle, frame limit |
| `render/LayerCollector.ts` | ~220 | Texture import |
| `render/Compositor.ts` | ~150 | Compositing loop |
| `render/NestedCompRenderer.ts` | ~280 | Nested comp render |
| `WebGPUEngine.ts` | ~450 | Thin facade |
| **Total** | **~1630** | (was 2339) |

---

## Rollback

If issues occur:

```bash
git checkout refactor/webgpu-engine-backup
git branch -D refactor/webgpu-engine-split
```

---

## Notes for AI Agent

1. **Execute steps in order** - Each step depends on previous
2. **Validate after each step** - Run `npx tsc --noEmit` frequently
3. **Don't skip the facade** - Step 9 is critical, wires everything
4. **Keep imports consistent** - Use relative paths within `engine/`
5. **Test manually** - Automated tests may not catch GPU issues
6. **Commit after validation** - Don't commit broken state
