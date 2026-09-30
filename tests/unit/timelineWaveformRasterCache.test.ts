import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const softwareCanvas = vi.hoisted(() => vi.fn(() => false));
vi.mock('../../src/components/timeline/utils/timelineCanvasPlatform', () => ({
  prefersSoftwareTimelineCanvas: softwareCanvas,
}));

describe('timeline waveform raster reuse', () => {
  beforeEach(() => { vi.resetModules(); softwareCanvas.mockReturnValue(false); });
  afterEach(() => vi.restoreAllMocks());

  async function setup() {
    const module = await import('../../src/components/timeline/utils/timelineClipCanvasWaveformRasterCache');
    const canvases: Array<{ width: number; height: number; getContext: ReturnType<typeof vi.fn> }> = [];
    vi.spyOn(document, 'createElement').mockImplementation(() => {
      const canvas = { width: 0, height: 0, getContext: vi.fn(() => ({ setTransform: vi.fn() })) };
      canvases.push(canvas);
      return canvas as unknown as HTMLCanvasElement;
    });
    const ctx = {
      canvas: {}, globalAlpha: 1, globalCompositeOperation: 'source-over', filter: 'none',
      shadowBlur: 0, drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    return { ...module, canvases, ctx };
  }

  it('reuses unchanged pixels when the waveform moves or a UI projection is replaced', async () => {
    const { drawCachedTimelineWaveformRaster: draw, ctx, canvases } = await setup();
    const paint = vi.fn();
    const input = { ctx, source: [], dependencies: [0, 8, 'detailed'], x: 0, top: 0, width: 100, height: 60, paint };
    expect(draw(input)).toBe(true);
    expect(draw({ ...input, x: 200, top: 20, dependencies: [...input.dependencies] })).toBe(true);
    expect(paint).toHaveBeenCalledOnce();
    expect(canvases).toHaveLength(1);
    expect(ctx.drawImage).toHaveBeenLastCalledWith(canvases[0], 0, 0, 100, 60, 200, 20, 100, 60);
    draw({ ...input, dependencies: [1, 8, 'detailed'] });
    expect(paint).toHaveBeenCalledTimes(2);
    expect(canvases[0].width).toBe(0);
    expect(canvases[0].height).toBe(0);
  });

  it('releases old backing pixels when the 32 MB raster budget is exceeded', async () => {
    const { drawCachedTimelineWaveformRaster: draw, ctx, canvases } = await setup();
    const sources = Array.from({ length: 9 }, () => ({}));
    const paint = vi.fn();
    for (const source of sources) draw({ ctx, source, dependencies: [], x: 0, top: 0, width: 1024, height: 1024, paint });
    expect(canvases[0].width).toBe(0);
    draw({ ctx, source: sources[0], dependencies: [], x: 0, top: 0, width: 1024, height: 1024, paint });
    expect(paint).toHaveBeenCalledTimes(10);
  });

  it('keeps Mesa on a real main-thread software canvas and falls back for oversized rasters', async () => {
    const { drawCachedTimelineWaveformRaster: draw, ctx, canvases } = await setup();
    softwareCanvas.mockReturnValue(true);
    const paint = vi.fn();
    const input = { ctx, source: {}, dependencies: [], x: 0, top: 0, width: 100, height: 60, paint };
    expect(draw(input)).toBe(true);
    expect(canvases[0].getContext).toHaveBeenCalledWith('2d', { willReadFrequently: true });
    expect(draw({ ...input, width: 9000 })).toBe(false);
    expect(paint).toHaveBeenCalledOnce();
    expect(canvases).toHaveLength(1);
  });
});
