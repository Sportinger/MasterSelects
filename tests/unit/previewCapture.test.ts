import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  renderHostPort: {
    readPixels: vi.fn(),
    getOutputDimensions: vi.fn(() => ({ width: 320, height: 180 })),
    getCaptureCanvas: vi.fn(),
    requestRender: vi.fn(),
  },
}));

vi.mock('../../src/services/render/renderHostPort', () => ({
  renderHostPort: mocks.renderHostPort,
}));

import {
  captureRenderHostFrame,
  captureStableRenderHostFrame,
} from '../../src/services/aiTools/previewCapture';

function createCanvas(dataUrl: string): HTMLCanvasElement {
  return {
    width: 320,
    height: 180,
    toDataURL: vi.fn(() => dataUrl),
  } as unknown as HTMLCanvasElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.renderHostPort.readPixels.mockResolvedValue(null);
  mocks.renderHostPort.getCaptureCanvas.mockReturnValue(null);
});

describe('preview capture', () => {
  it('falls back to the visible preview canvas when auto GPU readback is unavailable', async () => {
    const canvas = createCanvas('data:image/png;base64,dom');
    mocks.renderHostPort.getCaptureCanvas.mockReturnValue({
      canvas,
      source: 'workerRenderHost:preview',
    });

    const result = await captureRenderHostFrame();

    expect(result).toEqual({
      success: true,
      width: 320,
      height: 180,
      mode: 'dom',
      canvasSource: 'workerRenderHost:preview',
      dataUrl: 'data:image/png;base64,dom',
    });
    expect(mocks.renderHostPort.readPixels).toHaveBeenCalledTimes(1);
  });

  it('keeps explicit GPU mode strict when readback is unavailable', async () => {
    mocks.renderHostPort.getCaptureCanvas.mockReturnValue({
      canvas: createCanvas('data:image/png;base64,dom'),
      source: 'workerRenderHost:preview',
    });

    const result = await captureRenderHostFrame('gpu');

    expect(result).toEqual({
      success: false,
      error: 'Failed to capture frame - GPU readback unavailable',
    });
    expect(mocks.renderHostPort.getCaptureCanvas).not.toHaveBeenCalled();
  });

  it('uses explicit DOM mode without attempting GPU readback', async () => {
    const canvas = createCanvas('data:image/png;base64,dom');
    mocks.renderHostPort.getCaptureCanvas.mockReturnValue({
      canvas,
      source: 'workerRenderHost:preview',
    });

    const result = await captureRenderHostFrame('dom');

    expect(result).toEqual(expect.objectContaining({
      success: true,
      mode: 'dom',
      dataUrl: 'data:image/png;base64,dom',
    }));
    expect(mocks.renderHostPort.readPixels).not.toHaveBeenCalled();
  });

  it('waits until a newly edited frame repeats after the minimum observation window', async () => {
    for (const dataUrl of [
      'data:image/png;base64,partial',
      'data:image/png;base64,partial',
      'data:image/png;base64,complete',
      'data:image/png;base64,complete',
    ]) {
      mocks.renderHostPort.getCaptureCanvas.mockReturnValueOnce({
        canvas: createCanvas(dataUrl),
        source: 'workerRenderHost:preview',
      });
    }

    const result = await captureStableRenderHostFrame('dom', {
      settleMs: 0,
      pollIntervalMs: 1,
      minimumStableWindowMs: 2,
      maximumWaitMs: 10,
    });

    expect(result).toMatchObject({
      attempts: 4,
      stable: true,
      capture: {
        success: true,
        dataUrl: 'data:image/png;base64,complete',
      },
    });
    expect(mocks.renderHostPort.requestRender).toHaveBeenCalledTimes(4);
  });
});
