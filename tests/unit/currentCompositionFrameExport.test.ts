import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  composition: { id: 'comp', width: 4, height: 2, frameRate: 24 },
  timeline: {
    isExporting: false, isPlaying: false, frameRate: 30,
    pause: vi.fn(), play: vi.fn(async () => undefined),
    startExport: vi.fn(), endExport: vi.fn(),
  },
  previewPixels: vi.fn(async () => new Uint8ClampedArray(4)),
  initialize: vi.fn(async () => undefined),
  buildLayers: vi.fn(async () => []),
  cleanup: vi.fn(), begin: vi.fn(async () => undefined), dispose: vi.fn(),
  rendererOptions: vi.fn(), sessionOptions: vi.fn(), renderFrame: vi.fn(),
}));

vi.mock('../../src/stores/timeline', () => ({ useTimelineStore: { getState: () => mocks.timeline } }));
vi.mock('../../src/stores/mediaStore', () => ({
  useMediaStore: { getState: () => ({
    activeCompositionId: 'comp', getActiveComposition: () => mocks.composition,
  }) },
}));
vi.mock('../../src/stores/settingsStore', () => ({
  useSettingsStore: { getState: () => ({ outputResolution: { width: 8, height: 6 }, previewQuality: 0.25 }) },
}));
vi.mock('../../src/services/render/renderHostPort', () => ({
  renderHostPort: { readPixels: mocks.previewPixels, getOutputDimensions: () => ({ width: 1, height: 1 }) },
}));
vi.mock('../../src/components/export/exportHelpers', () => ({
  FFmpegFrameRenderer: class {
    constructor(options: unknown) { mocks.rendererOptions(options); }
    initialize = mocks.initialize;
    buildLayersAtTime = mocks.buildLayers;
    cleanup = mocks.cleanup;
    getRuntimeRunId() { return 'test-frame'; }
  },
}));
vi.mock('../../src/engine/export/ExportRenderSessionImpl', () => ({
  ExportFrameCaptureUnavailableError: class extends Error {},
  ExportRenderSessionImpl: class {
    constructor(options: unknown) { mocks.sessionOptions(options); }
    begin = mocks.begin;
    renderFrame = mocks.renderFrame;
    dispose = mocks.dispose;
  },
}));

import { captureCompositionFrameJpegBlob as captureFrame } from '../../src/components/export/captureCompositionFrame';

const context = {
  putImageData: vi.fn(), fillRect: vi.fn(), fillStyle: '', globalCompositeOperation: 'source-over',
};
let encoded: { width: number; height: number; type?: string } | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.timeline.isExporting = false;
  mocks.timeline.isPlaying = false;
  mocks.timeline.startExport.mockImplementation(() => { mocks.timeline.isExporting = true; });
  mocks.timeline.endExport.mockImplementation(() => { mocks.timeline.isExporting = false; });
  mocks.timeline.pause.mockImplementation(() => { mocks.timeline.isPlaying = false; });
  mocks.previewPixels.mockResolvedValue(new Uint8ClampedArray(4));
  mocks.renderFrame.mockResolvedValue({ kind: 'rgba-pixels', pixels: new Uint8ClampedArray(4 * 2 * 4), width: 4, height: 2 });
  encoded = undefined;
  context.fillStyle = '';
  context.globalCompositeOperation = 'source-over';
  vi.stubGlobal('ImageData', class {
    constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (callback, type) {
    encoded = { width: this.width, height: this.height, type };
    callback(new Blob(['frame'], { type }));
  });
});

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('current composition frame export', () => {
  it('renders at the full composition size instead of the reduced preview size', async () => {
    expect(await captureFrame(1.25)).toBeInstanceOf(Blob);
    expect(encoded).toEqual({ width: 4, height: 2, type: 'image/jpeg' });
    expect(mocks.buildLayers).toHaveBeenCalledWith(1.25);
    expect(mocks.sessionOptions).toHaveBeenCalledWith(expect.objectContaining({ width: 4, height: 2, compositionId: 'comp' }));
    expect(mocks.previewPixels).not.toHaveBeenCalled();
  });

  it('exports through the render session when the preview cannot provide pixels', async () => {
    mocks.previewPixels.mockResolvedValueOnce(null as unknown as Uint8ClampedArray);
    expect(await captureFrame(1.25)).toBeInstanceOf(Blob);
  });

  it('flattens transparent areas over black without capturing preview decorations', async () => {
    await captureFrame(1.25);
    expect(context.globalCompositeOperation).toBe('destination-over');
    expect(context.fillStyle).toBe('#000000');
    expect(context.fillRect).toHaveBeenCalledWith(0, 0, 4, 2);
    expect(context.putImageData.mock.invocationCallOrder[0]).toBeLessThan(context.fillRect.mock.invocationCallOrder[0]);
  });

  it('releases rendering resources and the export lock on failure, then resumes playback', async () => {
    mocks.timeline.isPlaying = true;
    mocks.renderFrame.mockRejectedValueOnce(new Error('GPU readback failed'));
    await expect(captureFrame(1.25)).rejects.toThrow('GPU readback failed');
    expect(mocks.dispose).toHaveBeenCalledOnce();
    expect(mocks.cleanup).toHaveBeenCalledOnce();
    expect(mocks.timeline.isExporting).toBe(false);
    expect(mocks.timeline.pause).toHaveBeenCalledOnce();
    expect(mocks.timeline.play).toHaveBeenCalledOnce();
  });

  it('does not start another render or release another export lock', async () => {
    mocks.timeline.isExporting = true;
    await expect(captureFrame(1.25)).rejects.toThrow('Another export');
    expect(mocks.initialize).not.toHaveBeenCalled();
    expect(mocks.timeline.endExport).not.toHaveBeenCalled();
    expect(mocks.timeline.isExporting).toBe(true);
  });
});
