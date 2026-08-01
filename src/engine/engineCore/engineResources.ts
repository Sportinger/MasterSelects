// Engine resource construction for WebGPUEngine (extracted, packet 345).
//
// createEngineResources() owns the device-epoch construction sequence that
// previously lived in WebGPUEngine.createResources(). The CALL ORDER below is
// frozen and must not be reordered:
//   managers (texture/mask/cache) -> sampler -> render target manager ->
//   black texture -> ping-pong textures -> pipelines (construct + await) ->
//   output window manager -> layer collector -> motion renderer ->
//   compositor -> nested comp renderer -> render loop.
// The render dispatcher is created by the engine AFTER this function resolves.

import { EffectsPipeline } from '../../effects/EffectsPipeline';
import { ColorPipeline } from '../color/ColorPipeline';
import { RenderTargetManager } from '../core/RenderTargetManager';
import type { CacheManager } from '../managers/CacheManager';
import { OutputWindowManager } from '../managers/OutputWindowManager';
import { MotionRenderer } from '../motion/MotionRenderer';
import { CompositorPipeline } from '../pipeline/CompositorPipeline';
import { OutputPipeline } from '../pipeline/OutputPipeline';
import { SlicePipeline } from '../pipeline/SlicePipeline';
import { Compositor } from '../render/Compositor';
import { LayerCollector } from '../render/LayerCollector';
import { NestedCompRenderer } from '../render/NestedCompRenderer';
import { RenderLoop } from '../render/RenderLoop';
import type { PerformanceStats } from '../stats/PerformanceStats';
import { MaskTextureManager } from '../texture/MaskTextureManager';
import { TextureManager } from '../texture/TextureManager';

/**
 * Device-epoch resource set owned by WebGPUEngine. The whole set is replaced
 * by createEngineResources(); on device loss only the members marked nullable
 * "cleared on device loss" are nulled (matching the historical engine
 * behavior where the remaining members stayed alive until recreation).
 */
export interface EngineResourceSet {
  // Cleared on device loss (WebGPUEngine.handleDeviceLost)
  textureManager: TextureManager | null;
  maskTextureManager: MaskTextureManager | null;
  motionRenderer: MotionRenderer | null;
  compositorPipeline: CompositorPipeline | null;
  effectsPipeline: EffectsPipeline | null;
  colorPipeline: ColorPipeline | null;
  outputPipeline: OutputPipeline | null;
  slicePipeline: SlicePipeline | null;
  // Survive device loss until the next createEngineResources() replaces the set
  sampler: GPUSampler | null;
  renderTargetManager: RenderTargetManager;
  outputWindowManager: OutputWindowManager;
  layerCollector: LayerCollector;
  compositor: Compositor;
  nestedCompRenderer: NestedCompRenderer;
}

export interface EngineRenderLoopHooks {
  performanceStats: PerformanceStats;
  isRecovering: () => boolean;
  isExporting: () => boolean;
}

export interface EngineResourceFactoryDeps {
  device: GPUDevice;
  cacheManager: CacheManager;
  requestRender: () => void;
  createSampler: () => GPUSampler | null;
  createSolidColorTexture: (r: number, g: number, b: number, a: number) => GPUTexture | null;
  renderLoopHooks: EngineRenderLoopHooks;
}

export function buildEngineRenderLoop(hooks: EngineRenderLoopHooks, onRender: () => void): RenderLoop {
  return new RenderLoop(hooks.performanceStats, {
    isRecovering: hooks.isRecovering,
    isExporting: hooks.isExporting,
    onRender,
  });
}

export async function createEngineResources(
  deps: EngineResourceFactoryDeps,
): Promise<{ resources: EngineResourceSet; renderLoop: RenderLoop }> {
  const { device } = deps;

  // Initialize managers
  const textureManager = new TextureManager(device);
  const maskTextureManager = new MaskTextureManager(device);
  deps.cacheManager.initialize(device, () => {
    deps.requestRender();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('masterselects:scrub-cache-updated'));
    }
  });

  // Create sampler
  const sampler = deps.createSampler();

  // Initialize render targets
  const renderTargetManager = new RenderTargetManager(device);

  // Create black texture
  renderTargetManager.createBlackTexture((r, g, b, a) => deps.createSolidColorTexture(r, g, b, a));

  // Create ping-pong textures
  renderTargetManager.createPingPongTextures();

  // Create pipelines
  const compositorPipeline = new CompositorPipeline(device);
  const effectsPipeline = new EffectsPipeline(device);
  const colorPipeline = new ColorPipeline(device);
  const outputPipeline = new OutputPipeline(device);
  const slicePipeline = new SlicePipeline(device);
  await compositorPipeline.createPipelines();
  await effectsPipeline.createPipelines();
  await colorPipeline.createPipeline();
  await outputPipeline.createPipeline();
  await slicePipeline.createPipeline();

  const { width, height } = renderTargetManager.getResolution();
  const outputWindowManager = new OutputWindowManager(width, height);

  const layerCollector = new LayerCollector();
  const motionRenderer = new MotionRenderer(device, deps.requestRender);

  const compositor = new Compositor(
    compositorPipeline,
    effectsPipeline,
    maskTextureManager,
    colorPipeline
  );

  const nestedCompRenderer = new NestedCompRenderer(
    device,
    compositorPipeline,
    effectsPipeline,
    textureManager,
    maskTextureManager,
    deps.cacheManager.getScrubbingCache(),
    colorPipeline,
    motionRenderer
  );

  // onRender is set by WebGPUEngine.start()
  const renderLoop = buildEngineRenderLoop(deps.renderLoopHooks, () => {});

  return {
    resources: {
      textureManager,
      maskTextureManager,
      motionRenderer,
      compositorPipeline,
      effectsPipeline,
      colorPipeline,
      outputPipeline,
      slicePipeline,
      sampler,
      renderTargetManager,
      outputWindowManager,
      layerCollector,
      compositor,
      nestedCompRenderer,
    },
    renderLoop,
  };
}

/**
 * Device-loss release: mirrors the historical WebGPUEngine.handleDeviceLost()
 * "Clear managers" block. Members tied to the lost device are destroyed or
 * nulled; the rest of the set stays alive until createEngineResources()
 * replaces it. Order matches the previous inline implementation.
 */
export function releaseEngineResourcesOnDeviceLost(res: EngineResourceSet | null): void {
  if (!res) return;
  res.textureManager = null;
  res.maskTextureManager = null;
  res.motionRenderer?.destroy();
  res.motionRenderer = null;
  res.compositorPipeline = null;
  res.effectsPipeline = null;
  res.colorPipeline = null;
  res.outputPipeline = null;
  res.slicePipeline = null;
}

/** First phase of WebGPUEngine.destroy(): renderers/managers, original order. */
export function destroyEngineRenderers(res: EngineResourceSet | null): void {
  res?.outputWindowManager.destroy();
  res?.renderTargetManager.destroy();
  res?.nestedCompRenderer.destroy();
  res?.motionRenderer?.destroy();
  res?.textureManager?.destroy();
  res?.maskTextureManager?.destroy();
}

/** Second phase of WebGPUEngine.destroy(): pipelines, original order. */
export function destroyEnginePipelines(res: EngineResourceSet | null): void {
  res?.compositorPipeline?.destroy();
  res?.effectsPipeline?.destroy();
  res?.colorPipeline?.destroy();
  res?.outputPipeline?.destroy();
  res?.slicePipeline?.destroy();
}

/**
 * RenderLoop start policy extracted from WebGPUEngine.start().
 * Returns the loop the engine must keep (the existing running loop, or a
 * replacement that has already been started). Behavior is identical to the
 * previous inline implementation.
 */
export function startEngineRenderLoop(
  args: {
    currentLoop: RenderLoop | null;
    hooks: EngineRenderLoopHooks;
    hasEverPlayed: boolean;
    isPlaying: boolean;
    requestRender: () => void;
  },
  renderCallback: () => void,
): RenderLoop {
  const { currentLoop } = args;
  if (currentLoop?.getIsRunning()) {
    currentLoop.setRenderCallback(renderCallback);
    if (args.isPlaying) {
      currentLoop.setIsPlaying(true);
    }
    args.requestRender();
    return currentLoop;
  }

  // Stop a stale loop before replacing it.
  currentLoop?.stop();

  // Create new loop with the callback
  const loop = buildEngineRenderLoop(args.hooks, renderCallback);

  // Suppress idle until user presses play for the first time.
  // After page reload, video GPU surfaces are empty and need the render loop
  // running continuously so syncClipVideo warmup can complete.
  if (!args.hasEverPlayed) {
    loop.suppressIdle();
  }

  // Carry over playing state: when start() is called from a useEffect that
  // re-runs on isPlaying change, React's effect ordering means setIsPlaying()
  // may have already fired on the OLD RenderLoop. Transfer the state so the
  // new RenderLoop has correct frame rate limiting from the first frame.
  if (args.isPlaying) {
    loop.setIsPlaying(true);
  }

  loop.start();
  return loop;
}
