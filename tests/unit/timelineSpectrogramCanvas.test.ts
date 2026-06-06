import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearTimelineSpectrogramCanvasCache,
  drawTimelineSpectrogram,
  resolveTimelineSpectrogramSourceRange,
} from '../../src/components/timeline/utils/spectrogramCanvas';
import { writeTimelineSpectralColor } from '../../src/components/timeline/utils/spectralColor';
import { MAX_SPECTROGRAM_DRAW_PIXELS } from '../../src/components/timeline/utils/spectrogramRenderPlan';
import type { TimelineSpectrogramTileSet } from '../../src/services/audio/timelineSpectrogramCache';
import { timelineRuntimeCoordinator } from '../../src/services/timeline/timelineRuntimeCoordinator';
import type { RenderResourceDescriptor } from '../../src/services/timeline/runtimeCoordinatorTypes';

function createTileSet(): TimelineSpectrogramTileSet {
  return {
    sampleRate: 48_000,
    duration: 2,
    fftSize: 1024,
    hopSize: 512,
    minDb: -96,
    maxDb: 0,
    frameCount: 8,
    frequencyBinCount: 4,
    channels: [{
      channelIndex: 0,
      values: new Float32Array(8 * 4).fill(0.25),
    }],
  };
}

function createRetainedInteractiveCanvas(index: number): RenderResourceDescriptor {
  return {
    id: `retained-interactive-canvas-${index}`,
    kind: 'image-canvas',
    policyId: 'interactive',
    owner: {
      ownerId: `retained-interactive-canvas-${index}`,
      ownerType: 'timeline',
    },
    imageKind: 'html-canvas',
    imageId: `retained-interactive-canvas-${index}`,
    diagnostics: {
      status: 'ok',
    },
  };
}

describe('drawTimelineSpectrogram', () => {
  let createImageData: ReturnType<typeof vi.fn>;
  let putImageData: ReturnType<typeof vi.fn>;
  let drawImage: ReturnType<typeof vi.fn>;
  let getContextSpy: ReturnType<typeof vi.spyOn>;
  let destinationContext: CanvasRenderingContext2D;

  beforeEach(() => {
    vi.stubGlobal('OffscreenCanvas', undefined);
    timelineRuntimeCoordinator.clearResources();
    clearTimelineSpectrogramCanvasCache();
    createImageData = vi.fn((width: number, height: number) => ({
      width,
      height,
      data: new Uint8ClampedArray(width * height * 4),
      colorSpace: 'srgb',
    }));
    putImageData = vi.fn();
    drawImage = vi.fn();

    getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({
      createImageData,
      putImageData,
      save: vi.fn(),
      restore: vi.fn(),
      fillRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      globalCompositeOperation: 'source-over',
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
    } as unknown as CanvasRenderingContext2D));

    destinationContext = {
      drawImage,
    } as unknown as CanvasRenderingContext2D;
  });

  afterEach(() => {
    clearTimelineSpectrogramCanvasCache();
    timelineRuntimeCoordinator.clearResources();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('rasterizes once and reuses the cached raster for identical visible spans', () => {
    const tileSet = createTileSet();
    const input = {
      tileSet,
      cacheKey: 'spectrogram-ref-1',
      x: 12,
      y: 4,
      clipWidth: 480,
      height: 64,
      inPoint: 0,
      outPoint: 2,
      naturalDuration: 2,
      renderStartPx: 120,
      renderWidth: 240,
      dpr: 1,
    };

    const first = drawTimelineSpectrogram(destinationContext, input);
    const second = drawTimelineSpectrogram(destinationContext, input);

    expect(first).toMatchObject({ drawn: true, cacheHit: false });
    expect(second).toMatchObject({ drawn: true, cacheHit: true });
    expect(getContextSpy).toHaveBeenCalledTimes(1);
    expect(createImageData).toHaveBeenCalledTimes(1);
    expect(putImageData).toHaveBeenCalledTimes(1);
    expect(drawImage).toHaveBeenCalledTimes(2);
    expect(drawImage.mock.calls[0][1]).toBe(132);
    expect(drawImage.mock.calls[0][2]).toBe(4);
    expect(drawImage.mock.calls[0][3]).toBe(240);
    expect(drawImage.mock.calls[0][4]).toBe(64);
  });

  it('reports retained spectrogram rasters to the interactive runtime coordinator and releases them on clear', () => {
    const tileSet = createTileSet();
    const result = drawTimelineSpectrogram(destinationContext, {
      tileSet,
      cacheKey: 'spectrogram-runtime-resource',
      x: 0,
      y: 0,
      clipWidth: 320,
      height: 32,
      inPoint: 0,
      outPoint: 2,
      naturalDuration: 2,
      dpr: 1,
    });

    expect(result.drawn).toBe(true);

    let stats = timelineRuntimeCoordinator.getBridgeStats().policies.interactive;
    expect(stats.budgetReport.usage).toMatchObject({
      resources: 1,
      imageBitmaps: 1,
    });
    expect(stats.budgetReport.usage.heapBytes).toBeGreaterThan(0);
    expect(stats.resources[0]).toMatchObject({
      kind: 'image-canvas',
      imageKind: 'html-canvas',
      owner: {
        ownerId: 'timeline:spectrogram-raster-cache',
      },
      source: {
        sourceId: 'spectrogram-runtime-resource',
      },
      tags: ['timeline', 'spectrogram', 'raster-cache'],
    });

    clearTimelineSpectrogramCanvasCache();

    stats = timelineRuntimeCoordinator.getBridgeStats().policies.interactive;
    expect(stats.resources).toHaveLength(0);
  });

  it('draws transient rasters without caching them when runtime admission is denied', () => {
    for (let index = 0; index < 48; index += 1) {
      timelineRuntimeCoordinator.retainResource(createRetainedInteractiveCanvas(index));
    }

    const tileSet = createTileSet();
    const input = {
      tileSet,
      cacheKey: 'denied-spectrogram-runtime-resource',
      x: 0,
      y: 0,
      clipWidth: 320,
      height: 32,
      inPoint: 0,
      outPoint: 2,
      naturalDuration: 2,
      dpr: 1,
    };

    const first = drawTimelineSpectrogram(destinationContext, input);
    const second = drawTimelineSpectrogram(destinationContext, input);

    expect(first).toMatchObject({ drawn: true, cacheHit: false });
    expect(second).toMatchObject({ drawn: true, cacheHit: false });
    expect(getContextSpy).toHaveBeenCalledTimes(2);
    expect(createImageData).toHaveBeenCalledTimes(2);
    expect(timelineRuntimeCoordinator.getBridgeStats().policies.interactive.resources).toHaveLength(48);
  });

  it('draws the full visible CSS span while keeping raster pixels bounded', () => {
    const tileSet = createTileSet();
    const result = drawTimelineSpectrogram(destinationContext, {
      tileSet,
      cacheKey: 'wide-spectrogram-ref',
      x: 0,
      y: 0,
      clipWidth: 120_000,
      height: 180,
      inPoint: 0,
      outPoint: 2,
      naturalDuration: 2,
      renderStartPx: 0,
      renderWidth: 120_000,
      dpr: 2,
    });

    expect(result.drawn).toBe(true);
    expect(result.plan?.cssCanvasWidth).toBe(120_000);
    expect((result.plan?.drawWidth ?? 0) * (result.plan?.drawHeight ?? 0)).toBeLessThanOrEqual(MAX_SPECTROGRAM_DRAW_PIXELS);
    expect(drawImage.mock.calls[0][1]).toBe(0);
    expect(drawImage.mock.calls[0][3]).toBe(120_000);
    expect(drawImage.mock.calls[0][4]).toBe(180);
  });

  it('maps processed spectrogram clips to the processed tile duration', () => {
    const range = resolveTimelineSpectrogramSourceRange({
      variant: 'processed',
      visibleSourceInPoint: 30,
      visibleSourceOutPoint: 45,
      tileDuration: 2,
      visibleStartRatio: 0.25,
      visibleEndRatio: 0.75,
    });

    expect(range).toEqual({
      inPoint: 0.5,
      outPoint: 1.5,
      naturalDuration: 2,
    });
  });

  it('skips invalid tile sets without touching the canvas', () => {
    const result = drawTimelineSpectrogram(destinationContext, {
      tileSet: null,
      x: 0,
      y: 0,
      clipWidth: 480,
      height: 64,
      inPoint: 0,
      outPoint: 2,
      naturalDuration: 2,
    });

    expect(result).toEqual({ drawn: false, cacheHit: false });
    expect(getContextSpy).not.toHaveBeenCalled();
    expect(drawImage).not.toHaveBeenCalled();
  });

  it('uses the shared timeline spectral color LUT', () => {
    const pixels = new Uint8ClampedArray(8);

    writeTimelineSpectralColor(pixels, 0, 0);
    writeTimelineSpectralColor(pixels, 4, 1);

    expect(Array.from(pixels.slice(0, 4))).toEqual([3, 7, 14, 236]);
    expect(Array.from(pixels.slice(4, 8))).toEqual([245, 248, 255, 236]);
  });
});
