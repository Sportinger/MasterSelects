import { describe, expect, it, vi } from 'vitest';

import { engine } from '../../src/engine/WebGPUEngine';
import { renderHostPort } from '../../src/services/render/renderHostPort';
import { playheadState } from '../../src/services/layerBuilder/PlayheadState';
import { playbackHealthMonitor } from '../../src/services/playbackHealthMonitor';
import { useEngineStore } from '../../src/stores/engineStore';
import { useRenderTargetStore } from '../../src/stores/renderTargetStore';
import type { RenderTarget } from '../../src/types/renderTarget';

describe('renderHostPort', () => {
  it('reports the current main-thread renderer ownership mode', () => {
    expect(renderHostPort.getTelemetry()).toEqual({
      mode: 'main',
      presentationStrategy: 'main-host-dev',
      lifecycleOwner: 'renderHostPort',
      statsOwner: 'renderHostPort',
      watchdogOwner: 'renderHostPort',
    });
  });

  it('initializes the engine lifecycle once through the host', async () => {
    const first = await renderHostPort.initialize();
    const second = await renderHostPort.initialize();

    expect(first).toBe(true);
    expect(second).toBe(true);
    expect(engine.initialize).toHaveBeenCalledTimes(1);
    expect(engine.getGPUInfo).toHaveBeenCalledTimes(1);
    expect(useEngineStore.getState().isEngineReady).toBe(true);
  });

  it('starts the render loop and playback health lifecycle through the host', async () => {
    const startHealth = vi.spyOn(playbackHealthMonitor, 'start').mockImplementation(() => undefined);
    const renderFrame = vi.fn();

    try {
      renderHostPort.startRenderLoop(renderFrame);

      expect(engine.start).toHaveBeenCalledWith(renderFrame);
      await vi.waitFor(() => {
        expect(startHealth).toHaveBeenCalledTimes(1);
      });
    } finally {
      startHealth.mockRestore();
    }
  });

  it('delegates target, output, and video frame commands to the current engine singleton', async () => {
    const canvas = document.createElement('canvas');
    const gpuContext = { label: 'context' } as unknown as GPUCanvasContext;
    vi.mocked(engine.registerTargetCanvas).mockReturnValueOnce(gpuContext);
    vi.mocked(engine.createOutputWindow).mockReturnValueOnce({ id: 'output-a' } as never);
    vi.mocked(engine.restoreOutputWindow).mockReturnValueOnce(true as never);
    vi.mocked(engine.renderCachedFrame).mockReturnValueOnce(true);
    vi.mocked(engine.cacheCompositeFrame).mockResolvedValue(undefined as never);
    vi.mocked(engine.getOutputDimensions).mockReturnValueOnce({ width: 1280, height: 720 });
    const pixels = new Uint8ClampedArray([255, 0, 0, 255]);
    vi.mocked(engine.readPixels).mockResolvedValueOnce(pixels);
    const device = { label: 'device' } as unknown as GPUDevice;
    const texture = { label: 'texture' } as unknown as GPUTexture;
    vi.mocked(engine.getDevice).mockReturnValueOnce(device);
    vi.mocked(engine.getLastRenderedTexture).mockReturnValueOnce(texture);
    vi.mocked(engine.getScrubbingCachedRanges).mockReturnValueOnce([{ start: 1, end: 2 }]);
    vi.mocked(engine.getIsExporting).mockReturnValueOnce(true);
    vi.mocked(engine.copyNestedCompTextureToPreview).mockReturnValueOnce(true);
    const diagnosticRenderLoopStart = vi.fn();
    const renderLoop = { getIsRunning: () => true, start: diagnosticRenderLoopStart } as never;
    const layerCollector = { isVideoGpuReady: () => true } as never;
    const debugState = { initialized: true } as never;
    const dispatcherSnapshot = { frameId: 1 } as never;
    vi.mocked(engine.getRenderLoop).mockReturnValue(renderLoop);
    vi.mocked(engine.getLayerCollector).mockReturnValueOnce(layerCollector);
    vi.mocked(engine.getDebugInfrastructureState).mockReturnValueOnce(debugState);
    vi.mocked(engine.getRenderDispatcherDebugSnapshot).mockReturnValueOnce(dispatcherSnapshot);
    const textureManager = { updateCanvasTexture: vi.fn().mockReturnValue(true) };
    vi.mocked(engine.getTextureManager).mockReturnValueOnce(textureManager as never);
    vi.mocked(engine.preCacheVideoFrame).mockResolvedValueOnce(true as never);
    vi.mocked(engine.captureVideoFrameAtTime).mockReturnValueOnce(true);
    vi.mocked(engine.getLastPresentedVideoTime).mockReturnValueOnce(1.25);
    const invalidateBindGroupCache = vi.fn();
    (engine as unknown as {
      compositorPipeline?: { invalidateBindGroupCache: (layerId?: string) => void };
    }).compositorPipeline = { invalidateBindGroupCache };
    const video = document.createElement('video');
    const maskImageData = {
      data: new Uint8ClampedArray(4),
      width: 1,
      height: 1,
    } as ImageData;
    const layers = [{ id: 'layer-a' }] as never;

    renderHostPort.setTimelineVisualDemand(true);
    renderHostPort.setIsPlaying(true);
    renderHostPort.setIsScrubbing(true);
    renderHostPort.setContinuousRender(true);
    renderHostPort.render(layers);
    const ramPreviewRenderEngine = renderHostPort.getRamPreviewRenderEngine();
    ramPreviewRenderEngine.render(layers);
    expect(renderHostPort.renderCachedFrame(1.25)).toBe(true);
    await expect(renderHostPort.cacheCompositeFrame(1.25)).resolves.toBeUndefined();
    await expect(ramPreviewRenderEngine.cacheCompositeFrame(2.5)).resolves.toBeUndefined();
    renderHostPort.cacheActiveCompOutput('comp-a');
    renderHostPort.setResolution(1280, 720);
    expect(renderHostPort.getOutputDimensions()).toEqual({ width: 1280, height: 720 });
    await expect(renderHostPort.readPixels()).resolves.toBe(pixels);
    expect(renderHostPort.getIsExporting()).toBe(true);
    renderHostPort.renderToPreviewCanvas('target-a', layers);
    expect(renderHostPort.copyNestedCompTextureToPreview('target-a', 'comp-a')).toBe(true);
    (engine as unknown as { mainPreviewCanvas?: HTMLCanvasElement | null }).mainPreviewCanvas = canvas;
    expect(renderHostPort.getCaptureCanvas()).toEqual({ canvas, source: 'mainPreviewCanvas' });
    expect(renderHostPort.getDevice()).toBe(device);
    expect(renderHostPort.getLastRenderedTexture()).toBe(texture);
    renderHostPort.updateMaskTexture('clip-a', maskImageData);
    renderHostPort.removeMaskTexture('clip-a');
    expect(renderHostPort.updateCanvasTexture(canvas)).toBe(true);
    renderHostPort.invalidateCompositorBindings('clip-a');
    expect(renderHostPort.registerTargetCanvas('target-a', canvas)).toBe(gpuContext);
    renderHostPort.unregisterTargetCanvas('target-a');
    renderHostPort.setPreviewCanvas(canvas);
    renderHostPort.requestRender();
    renderHostPort.requestNewFrameRender();
    renderHostPort.stopRenderLoopForDiagnostics();
    renderHostPort.startExistingRenderLoopForDiagnostics();
    renderHostPort.clearVideoCache();
    renderHostPort.clearScrubbingCache();
    renderHostPort.clearCompositeCache();
    renderHostPort.clearCaches();
    renderHostPort.clearFrame();
    renderHostPort.setGeneratingRamPreview(true);
    expect(renderHostPort.getScrubbingCachedRanges('video-src')).toEqual([{ start: 1, end: 2 }]);
    expect(renderHostPort.getStats()).toBe(engine.getStats());
    expect(renderHostPort.getLayerCollector()).toBe(layerCollector);
    expect(renderHostPort.getScrubbingCacheStats()).toEqual({});
    expect(renderHostPort.getCompositeCacheStats()).toEqual({});
    expect(renderHostPort.getRenderLoop()).toBe(renderLoop);
    expect(renderHostPort.getDebugInfrastructureState()).toBe(debugState);
    expect(renderHostPort.getRenderDispatcherDebugSnapshot()).toBe(dispatcherSnapshot);
    renderHostPort.cleanupVideo(video);
    await expect(renderHostPort.preCacheVideoFrame(video, 'owner-a')).resolves.toBe(true);
    renderHostPort.ensureVideoFrameCached(video, 'owner-a');
    renderHostPort.cacheFrameAtTime(video, 1.25);
    expect(renderHostPort.captureVideoFrameAtTime(video, 1.25, 'owner-a')).toBe(true);
    renderHostPort.markVideoFramePresented(video, 1.25, 'owner-a');
    expect(renderHostPort.getLastPresentedVideoTime(video)).toBe(1.25);
    renderHostPort.markVideoGpuReady(video);
    expect(renderHostPort.createOutputWindow('output-a', 'Output A')).toEqual({ id: 'output-a' });
    renderHostPort.closeOutputWindow('output-a');
    expect(renderHostPort.restoreOutputWindow('output-a')).toBe(true);
    renderHostPort.removeOutputTarget('output-a');

    expect(engine.setTimelineVisualDemand).toHaveBeenCalledWith(true);
    expect(engine.setIsPlaying).toHaveBeenCalledWith(true);
    expect(engine.setIsScrubbing).toHaveBeenCalledWith(true);
    expect(engine.setContinuousRender).toHaveBeenCalledWith(true);
    expect(engine.render).toHaveBeenCalledWith(layers);
    expect(engine.renderCachedFrame).toHaveBeenCalledWith(1.25);
    expect(engine.cacheCompositeFrame).toHaveBeenCalledWith(1.25);
    expect(engine.cacheCompositeFrame).toHaveBeenCalledWith(2.5);
    expect(engine.cacheActiveCompOutput).toHaveBeenCalledWith('comp-a');
    expect(engine.setResolution).toHaveBeenCalledWith(1280, 720);
    expect(engine.getOutputDimensions).toHaveBeenCalledTimes(1);
    expect(engine.readPixels).toHaveBeenCalledTimes(1);
    expect(engine.getIsExporting).toHaveBeenCalledTimes(1);
    expect(engine.renderToPreviewCanvas).toHaveBeenCalledWith('target-a', layers);
    expect(engine.copyNestedCompTextureToPreview).toHaveBeenCalledWith('target-a', 'comp-a');
    expect(engine.getDevice).toHaveBeenCalledTimes(1);
    expect(engine.getLastRenderedTexture).toHaveBeenCalledTimes(1);
    expect(engine.updateMaskTexture).toHaveBeenCalledWith('clip-a', maskImageData);
    expect(engine.removeMaskTexture).toHaveBeenCalledWith('clip-a');
    expect(textureManager.updateCanvasTexture).toHaveBeenCalledWith(canvas);
    expect(invalidateBindGroupCache).toHaveBeenCalledWith('clip-a');
    expect(engine.registerTargetCanvas).toHaveBeenCalledWith('target-a', canvas);
    expect(engine.unregisterTargetCanvas).toHaveBeenCalledWith('target-a');
    expect(engine.setPreviewCanvas).toHaveBeenCalledWith(canvas);
    expect(engine.requestRender).toHaveBeenCalledTimes(1);
    expect(engine.requestNewFrameRender).toHaveBeenCalledTimes(1);
    expect(engine.stop).toHaveBeenCalledTimes(1);
    expect(diagnosticRenderLoopStart).toHaveBeenCalledTimes(1);
    expect(engine.clearVideoCache).toHaveBeenCalledTimes(1);
    expect(engine.clearScrubbingCache).toHaveBeenCalledWith(undefined);
    expect(engine.clearCompositeCache).toHaveBeenCalledTimes(1);
    expect(engine.clearCaches).toHaveBeenCalledTimes(1);
    expect(engine.clearFrame).toHaveBeenCalledTimes(1);
    expect(engine.setGeneratingRamPreview).toHaveBeenCalledWith(true);
    expect(engine.getScrubbingCachedRanges).toHaveBeenCalledWith('video-src');
    expect(engine.getStats).toHaveBeenCalledTimes(2);
    expect(engine.getLayerCollector).toHaveBeenCalledTimes(1);
    expect(engine.getScrubbingCacheStats).toHaveBeenCalledTimes(1);
    expect(engine.getCompositeCacheStats).toHaveBeenCalledTimes(1);
    expect(engine.getRenderLoop).toHaveBeenCalledTimes(2);
    expect(engine.getDebugInfrastructureState).toHaveBeenCalledTimes(1);
    expect(engine.getRenderDispatcherDebugSnapshot).toHaveBeenCalledTimes(1);
    expect(engine.cleanupVideo).toHaveBeenCalledWith(video);
    expect(engine.preCacheVideoFrame).toHaveBeenCalledWith(video, 'owner-a');
    expect(engine.ensureVideoFrameCached).toHaveBeenCalledWith(video, 'owner-a');
    expect(engine.cacheFrameAtTime).toHaveBeenCalledWith(video, 1.25);
    expect(engine.captureVideoFrameAtTime).toHaveBeenCalledWith(video, 1.25, 'owner-a');
    expect(engine.markVideoFramePresented).toHaveBeenCalledWith(video, 1.25, 'owner-a');
    expect(engine.getLastPresentedVideoTime).toHaveBeenCalledWith(video);
    expect(engine.markVideoGpuReady).toHaveBeenCalledWith(video);
    expect(engine.createOutputWindow).toHaveBeenCalledWith('output-a', 'Output A');
    expect(engine.closeOutputWindow).toHaveBeenCalledWith('output-a');
    expect(engine.restoreOutputWindow).toHaveBeenCalledWith('output-a');
    expect(engine.removeOutputTarget).toHaveBeenCalledWith('output-a');
  });

  it('prefers a DOM-visible preview target over an offscreen output-slice capture target', () => {
    const originalElementFromPoint = Object.getOwnPropertyDescriptor(document, 'elementFromPoint');
    const offscreenCanvas = document.createElement('canvas');
    const previewCanvas = document.createElement('canvas');
    const context = {} as GPUCanvasContext;
    offscreenCanvas.width = 1280;
    offscreenCanvas.height = 720;
    previewCanvas.width = 1280;
    previewCanvas.height = 720;
    offscreenCanvas.getBoundingClientRect = vi.fn(() => ({
      x: -2000,
      y: 20,
      left: -2000,
      top: 20,
      right: -720,
      bottom: 740,
      width: 1280,
      height: 720,
      toJSON: () => ({}),
    } as DOMRect));
    previewCanvas.getBoundingClientRect = vi.fn(() => ({
      x: 10,
      y: 20,
      left: 10,
      top: 20,
      right: 1290,
      bottom: 740,
      width: 1280,
      height: 720,
      toJSON: () => ({}),
    } as DOMRect));
    document.body.appendChild(offscreenCanvas);
    document.body.appendChild(previewCanvas);
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => previewCanvas),
    });
    (engine as unknown as { mainPreviewCanvas?: HTMLCanvasElement | null }).mainPreviewCanvas = null;

    const makeTarget = (id: string, canvas: HTMLCanvasElement): RenderTarget => ({
      id,
      name: id,
      source: { type: 'program' },
      destinationType: 'canvas',
      enabled: true,
      showTransparencyGrid: false,
      canvas,
      context,
      window: null,
      isFullscreen: false,
    });

    try {
      useRenderTargetStore.getState().registerTarget(makeTarget('wfg-output-slice-target-a', offscreenCanvas));
      useRenderTargetStore.getState().registerTarget(makeTarget('preview', previewCanvas));

      expect(renderHostPort.getCaptureCanvas()).toEqual({
        canvas: previewCanvas,
        source: 'renderTarget:preview',
      });
    } finally {
      useRenderTargetStore.getState().unregisterTarget('wfg-output-slice-target-a');
      useRenderTargetStore.getState().unregisterTarget('preview');
      offscreenCanvas.remove();
      previewCanvas.remove();
      if (originalElementFromPoint) {
        Object.defineProperty(document, 'elementFromPoint', originalElementFromPoint);
      } else {
        Reflect.deleteProperty(document, 'elementFromPoint');
      }
    }
  });

  it('publishes stats through the host-managed interval', () => {
    vi.useFakeTimers();
    const stopStatsAndWatchdog = renderHostPort.startStatsAndWatchdog(vi.fn());
    const stats = {
      ...useEngineStore.getState().engineStats,
      fps: 24,
      decoder: 'WebCodecs' as const,
    };
    vi.mocked(engine.getStats).mockReturnValueOnce(stats);

    try {
      vi.advanceTimersByTime(1000);

      expect(engine.getStats).toHaveBeenCalledTimes(1);
      expect(useEngineStore.getState().engineStats.fps).toBe(24);
      expect(useEngineStore.getState().engineStats.decoder).toBe('WebCodecs');
    } finally {
      stopStatsAndWatchdog();
      vi.useRealTimers();
    }
  });

  it('restarts the render loop when playback is active and the loop is stopped', () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const renderFrame = vi.fn();
    playheadState.isUsingInternalPosition = true;
    vi.mocked(engine.getRenderLoop).mockReturnValueOnce({ getIsRunning: () => false } as never);
    const stopStatsAndWatchdog = renderHostPort.startStatsAndWatchdog(renderFrame);

    try {
      vi.advanceTimersByTime(1000);

      expect(engine.start).toHaveBeenCalledWith(renderFrame);
      expect(engine.setIsPlaying).toHaveBeenCalledWith(true);
      expect(engine.requestRender).toHaveBeenCalledTimes(1);
    } finally {
      stopStatsAndWatchdog();
      playheadState.isUsingInternalPosition = false;
      warnSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('keeps one stats interval and uses the latest render callback for watchdog restart', () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const firstRenderFrame = vi.fn();
    const secondRenderFrame = vi.fn();
    playheadState.isUsingInternalPosition = true;
    vi.mocked(engine.getRenderLoop).mockReturnValue({ getIsRunning: () => false } as never);
    const stopFirst = renderHostPort.startStatsAndWatchdog(firstRenderFrame);
    const stopSecond = renderHostPort.startStatsAndWatchdog(secondRenderFrame);

    try {
      vi.advanceTimersByTime(1000);

      expect(engine.getStats).toHaveBeenCalledTimes(1);
      expect(engine.start).toHaveBeenCalledTimes(1);
      expect(engine.start).toHaveBeenCalledWith(secondRenderFrame);
    } finally {
      stopSecond();
      stopFirst();
      playheadState.isUsingInternalPosition = false;
      warnSpy.mockRestore();
      vi.useRealTimers();
    }
  });
});
