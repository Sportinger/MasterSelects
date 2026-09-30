import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Layer } from '../../src/engine/core/types';
import type { RenderDeps } from '../../src/engine/render/RenderDispatcher';
import { TargetPreviewRenderer } from '../../src/engine/render/dispatcher/targetPreviewRenderer';
import { resolveMulticamPreviewSize } from '../../src/engine/render/dispatcher/multicamPreviewPresentation';
import { useMediaStore } from '../../src/stores/mediaStore';
import { useRenderTargetStore } from '../../src/stores/renderTargetStore';
import type { RenderTarget } from '../../src/types/renderTarget';

interface ObservedCanvas {
  callback: ResizeObserverCallback;
  disconnect: ReturnType<typeof vi.fn>;
}

const observers: ObservedCanvas[] = [];

function makeFrame(timestamp = 0): VideoFrame {
  return { displayWidth: 3840, displayHeight: 2160, timestamp, close: vi.fn() } as unknown as VideoFrame;
}

function makeLayer(frame: VideoFrame): Layer {
  return {
    id: 'camera-1', name: 'Camera 1', visible: true, opacity: 1,
    blendMode: 'normal', effects: [],
    position: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1 }, rotation: 0,
    source: { type: 'video', videoFrame: frame },
  };
}

function setupRenderer() {
  const canvas = {
    width: 3840, height: 2160,
    ownerDocument: { defaultView: { devicePixelRatio: 1 } },
    getBoundingClientRect: vi.fn(() => ({ width: 481, height: 271 })),
  } as unknown as HTMLCanvasElement;
  const context = {} as GPUCanvasContext;
  const target: RenderTarget = {
    id: 'camera-target', name: 'Camera',
    source: { type: 'multicam-angle', compositionId: 'comp-1', angleIndex: 0 },
    destinationType: 'canvas', enabled: true, showTransparencyGrid: false,
    canvas, context, window: null, isFullscreen: false,
  };
  const targetState = useRenderTargetStore.getState();
  vi.spyOn(useRenderTargetStore, 'getState').mockReturnValue({
    ...targetState, targets: new Map([[target.id, target]]),
  });
  const mediaState = useMediaStore.getState();
  vi.spyOn(useMediaStore, 'getState').mockReturnValue({
    ...mediaState,
    activeCompositionId: 'comp-1',
    compositions: [{ id: 'comp-1', width: 3840, height: 2160, frameRate: 25 } as never],
  });
  const textures: Array<{ destroy: ReturnType<typeof vi.fn> }> = [];
  const device = {
    limits: { maxTextureDimension2D: 8192 },
    createTexture: vi.fn(() => {
      const texture = { createView: () => ({}), destroy: vi.fn() };
      textures.push(texture);
      return texture;
    }),
    createCommandEncoder: () => ({ finish: () => ({}) }),
    queue: { submit: vi.fn() },
  };
  const composite = vi.fn(() => ({ finalView: {} }));
  const recordMainFrame = vi.fn();
  const importVideoTexture = vi.fn(() => ({}));
  const outputPipeline = {
    updateResolution: vi.fn(), createOutputBindGroup: vi.fn(), renderToCanvas: vi.fn(),
  };
  const deps = {
    getDevice: () => device, isRecovering: () => false, sampler: {},
    targetCanvases: new Map([[target.id, { canvas, context }]]),
    compositorPipeline: { beginFrame: vi.fn() },
    textureManager: { importVideoTexture },
    outputPipeline,
    renderTargetManager: {
      getResolution: () => ({ width: 3840, height: 2160 }),
      getIndependentPingView: () => ({}), getIndependentPongView: () => ({}),
      getEffectTempTexture: () => ({}), getEffectTempView: () => ({}),
      getEffectTempTexture2: () => ({}), getEffectTempView2: () => ({}),
    },
    compositor: { composite },
  } as unknown as RenderDeps;
  const renderer = new TargetPreviewRenderer(deps, recordMainFrame, vi.fn(), () => 0, () => false);
  const render = (layer: Layer) => renderer.renderToPreviewCanvas(target.id, [layer], {
    compositionId: 'comp-1', timelineTimeSeconds: 0,
  });
  return { renderer, render, canvas, target, device, textures, composite, recordMainFrame, importVideoTexture, outputPipeline };
}

beforeEach(() => {
  observers.length = 0;
  vi.stubGlobal('GPUTextureUsage', { COPY_SRC: 1, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16 });
  vi.stubGlobal('ResizeObserver', class {
    disconnect = vi.fn();
    constructor(callback: ResizeObserverCallback) { observers.push({ callback, disconnect: this.disconnect }); }
    observe() {}
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('multicam preview presentation', () => {
  it('uses display pixels with a 720p ceiling and preserves composition coordinates', () => {
    const scene = setupRenderer();
    scene.render(makeLayer(makeFrame()));
    expect([scene.canvas.width, scene.canvas.height]).toEqual([481, 271]);
    expect(scene.composite.mock.calls[0]?.[2]).toMatchObject({
      outputWidth: 481, outputHeight: 271, referenceWidth: 3840, referenceHeight: 2160,
    });
    expect(scene.device.createTexture).toHaveBeenCalledTimes(4);
    expect(scene.recordMainFrame).not.toHaveBeenCalled();
    expect(resolveMulticamPreviewSize({ width: 3840, height: 2160 }, { width: 481, height: 271 }, 2, 8192))
      .toEqual({ width: 962, height: 541 });
    expect(resolveMulticamPreviewSize({ width: 3840, height: 2160 }, { width: 3840, height: 2160 }, 2, 8192))
      .toEqual({ width: 1280, height: 720 });
    scene.renderer.releaseTarget(scene.target.id);
  });

  it('reuses an unchanged decoded picture without another GPU import or submission', () => {
    const scene = setupRenderer();
    const frame = makeFrame();
    const layer = makeLayer(frame);
    scene.render(layer);
    scene.render({ ...layer, position: { ...layer.position } });
    expect(scene.device.queue.submit).toHaveBeenCalledOnce();
    expect(scene.importVideoTexture).toHaveBeenCalledOnce();
    expect(scene.canvas.getBoundingClientRect).toHaveBeenCalledOnce();

    // A new decoder-owned picture is new output even at an identical timestamp.
    scene.render(makeLayer(makeFrame()));
    expect(scene.device.queue.submit).toHaveBeenCalledTimes(2);
    expect(frame.close).not.toHaveBeenCalled();
    scene.renderer.releaseTarget(scene.target.id);
  });

  it('updates paused transforms, transparency and pane resizes without a new video frame', () => {
    const scene = setupRenderer();
    const layer = makeLayer(makeFrame());
    scene.render(layer);
    layer.position.x = 0.2;
    scene.render(layer);
    scene.target.showTransparencyGrid = true;
    scene.render(layer);
    observers[0].callback([{
      target: scene.canvas, contentRect: { width: 640, height: 360 },
    } as ResizeObserverEntry], {} as ResizeObserver);
    scene.render(layer);
    expect(scene.device.queue.submit).toHaveBeenCalledTimes(4);
    expect([scene.canvas.width, scene.canvas.height]).toEqual([640, 360]);
    expect(scene.textures.slice(0, 4).every((texture) => texture.destroy.mock.calls.length === 1)).toBe(true);
    scene.renderer.releaseTarget(scene.target.id);
  });

  it('continues evaluating effects and invalidates a prior static picture', () => {
    const scene = setupRenderer();
    const layer = makeLayer(makeFrame());
    scene.render(layer);
    layer.effects = [{ id: 'feedback', type: 'blur', enabled: true, params: {} } as never];
    scene.render(layer);
    scene.render(layer);
    layer.effects = [];
    scene.render(layer);
    expect(scene.device.queue.submit).toHaveBeenCalledTimes(4);
    scene.renderer.releaseTarget(scene.target.id);
  });

  it('restores the reused canvas for ordinary previews and keeps their full resolution', () => {
    const scene = setupRenderer();
    const layer = makeLayer(makeFrame());
    scene.render(layer);
    scene.target.source = { type: 'composition', compositionId: 'comp-1' };
    scene.render(layer);
    expect([scene.canvas.width, scene.canvas.height]).toEqual([3840, 2160]);
    expect(scene.composite.mock.calls[1]?.[2]).toMatchObject({ outputWidth: 3840, outputHeight: 2160 });
    expect(scene.recordMainFrame).toHaveBeenCalledOnce();
    expect(observers[0].disconnect).toHaveBeenCalledOnce();
    expect(scene.textures.every((texture) => texture.destroy.mock.calls.length === 1)).toBe(true);
  });

  it('releases observers and buffers on unregister, without owning the decoded frame', () => {
    const scene = setupRenderer();
    const frame = makeFrame();
    scene.render(makeLayer(frame));
    scene.renderer.releaseTarget(scene.target.id);
    expect([scene.canvas.width, scene.canvas.height]).toEqual([3840, 2160]);
    expect(observers[0].disconnect).toHaveBeenCalledOnce();
    expect(scene.textures.every((texture) => texture.destroy.mock.calls.length === 1)).toBe(true);
    expect(frame.close).not.toHaveBeenCalled();
    scene.render(makeLayer(frame));
    expect(scene.device.queue.submit).toHaveBeenCalledTimes(2);
    scene.renderer.releaseTarget(scene.target.id);
  });

  it('preserves caller resolution changes when leaving multicam', () => {
    const scene = setupRenderer();
    const layer = makeLayer(makeFrame());
    scene.render(layer);
    scene.canvas.width = 1920;
    scene.canvas.height = 1080;
    scene.render(layer);
    scene.renderer.releaseTarget(scene.target.id);
    expect([scene.canvas.width, scene.canvas.height]).toEqual([1920, 1080]);
    scene.render(layer);
    scene.canvas.width = 960;
    scene.canvas.height = 540;
    scene.renderer.releaseTarget(scene.target.id);
    expect([scene.canvas.width, scene.canvas.height]).toEqual([960, 540]);
  });
});
