import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RenderCapabilityProbeResult } from '../../src/services/render/renderCapabilityProbe';
import {
  clearWorkerFirstProofCapturesForTests,
  getWorkerFirstProofCaptures,
} from '../../src/services/aiTools/workerFirstProofCaptures';
import {
  clearWorkerFirstCounterSourcesForTests,
  getWorkerFirstCounterSourceSnapshot,
} from '../../src/services/aiTools/workerFirstCounterSources';
import {
  handleRunWorkerFirstVisiblePresentationStressProof,
  type WorkerFirstVisibleStressBridgeDeps,
} from '../../src/services/aiTools/workerFirstVisibleStressBridge';

const originalElementFromPointDescriptor = Object.getOwnPropertyDescriptor(document, 'elementFromPoint');
const originalHiddenDescriptor = Object.getOwnPropertyDescriptor(document, 'hidden');
const originalVisibilityStateDescriptor = Object.getOwnPropertyDescriptor(document, 'visibilityState');

const capabilityProbe: RenderCapabilityProbeResult = {
  timestamp: 1,
  browserEngine: 'chromium',
  os: 'windows',
  gpuAdapter: null,
  facts: {
    workerNavigatorGpu: true,
    workerWebGpuDevice: true,
    offscreenCanvasTransfer: true,
    offscreenCanvasWebGpuContext: true,
    workerCanvasPresentation: false,
    videoFrameTransfer: true,
    imageBitmapTransfer: true,
    webCodecs: true,
    webCodecsWorker: true,
    copyExternalImageToTexture: true,
    audioContext: true,
  },
  selectedStrategy: 'worker-webgpu-main-present',
  selectionReason: 'test',
};

function createCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 180;
  Object.defineProperty(canvas, 'isConnected', {
    configurable: true,
    value: true,
  });
  canvas.getBoundingClientRect = vi.fn(() => ({
    x: 10,
    y: 20,
    left: 10,
    top: 20,
    right: 330,
    bottom: 200,
    width: 320,
    height: 180,
    toJSON: () => ({}),
  } as DOMRect));
  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    value: vi.fn(() => canvas),
  });
  return canvas;
}

function mockCanvasReadback(): void {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn(),
    getImageData: vi.fn((_x: number, _y: number, width: number, height: number) => {
      const data = new Uint8ClampedArray(width * height * 4);
      for (let offset = 0; offset < data.length; offset += 4) {
        data[offset] = 32;
        data[offset + 1] = 160;
        data[offset + 2] = 96;
        data[offset + 3] = 255;
      }
      return { data, width, height } as ImageData;
    }),
  } as unknown as CanvasRenderingContext2D);
}

function playbackData(overrides: {
  previewFrames?: number;
  stalePreviewFrames?: number;
  stalePreviewWhileTargetMoved?: number;
  previewFreezeFrames?: number;
  initialTargetMovedStaleFrames?: number;
} = {}) {
  return {
    requestedDurationMs: 1000,
    actualDurationMs: 1120,
    framesObserved: 60,
    runDiagnostics: {
      windowMs: 1120,
      startup: {
        initialTargetMovedStaleFrames: overrides.initialTargetMovedStaleFrames ?? 0,
      },
      playback: {
        status: 'healthy',
        pipeline: 'webcodecs',
        previewFrames: overrides.previewFrames ?? 12,
        previewUpdates: 12,
        stalePreviewFrames: overrides.stalePreviewFrames ?? 0,
        stalePreviewWhileTargetMoved: overrides.stalePreviewWhileTargetMoved ?? overrides.stalePreviewFrames ?? 0,
        previewFreezeFrames: overrides.previewFreezeFrames ?? 0,
        previewFreezeEvents: overrides.previewFreezeFrames ? 1 : 0,
      },
    },
  };
}

function deps(
  runPlayback: WorkerFirstVisibleStressBridgeDeps['runPlayback'],
  overrides: Partial<WorkerFirstVisibleStressBridgeDeps> = {},
): WorkerFirstVisibleStressBridgeDeps {
  return {
    getCaptureCanvas: () => ({ canvas: createCanvas(), source: 'renderTarget:program' }),
    getCapabilityProbe: () => capabilityProbe,
    runPlayback,
    ...overrides,
  };
}

describe('worker-first visible stress bridge', () => {
  afterEach(() => {
    clearWorkerFirstProofCapturesForTests();
    clearWorkerFirstCounterSourcesForTests();
    vi.restoreAllMocks();
    if (originalElementFromPointDescriptor) {
      Object.defineProperty(document, 'elementFromPoint', originalElementFromPointDescriptor);
    } else {
      Reflect.deleteProperty(document, 'elementFromPoint');
    }
    if (originalHiddenDescriptor) {
      Object.defineProperty(document, 'hidden', originalHiddenDescriptor);
    } else {
      Reflect.deleteProperty(document, 'hidden');
    }
    if (originalVisibilityStateDescriptor) {
      Object.defineProperty(document, 'visibilityState', originalVisibilityStateDescriptor);
    } else {
      Reflect.deleteProperty(document, 'visibilityState');
    }
  });

  it('records stress proof from controlled playback diagnostics', async () => {
    mockCanvasReadback();
    const runPlayback = vi.fn(async () => ({
      success: true,
      data: playbackData({
        stalePreviewFrames: 2,
        stalePreviewWhileTargetMoved: 2,
        previewFreezeFrames: 1,
        initialTargetMovedStaleFrames: 1,
      }),
    }));
    const ensureRender = vi.fn(async () => ({ requested: true, waitedMs: 33 }));
    const getCaptureCanvas = vi.fn(() => ({ canvas: createCanvas(), source: 'renderTarget:program' }));
    const setPlayheadPosition = vi.fn();
    const waitAfterCaptureSeek = vi.fn(async () => undefined);

    const result = await handleRunWorkerFirstVisiblePresentationStressProof({
      platform: 'windows-chromium',
      strategy: 'worker-webgpu-main-present',
      durationMs: '1000',
      startTime: 0.5,
      minPreviewFrames: 3,
      captureSettleMs: 1200,
    }, deps(runPlayback, {
      ensureRender,
      getCaptureCanvas,
      setPlayheadPosition,
      waitAfterCaptureSeek,
    }));

    expect(result.success).toBe(true);
    expect(setPlayheadPosition).toHaveBeenCalledWith(0.5);
    expect(waitAfterCaptureSeek).toHaveBeenCalledWith(1200);
    expect(ensureRender).toHaveBeenCalledTimes(1);
    expect(getCaptureCanvas).toHaveBeenCalledTimes(2);
    expect(runPlayback).toHaveBeenCalledWith(expect.objectContaining({
      durationMs: 1000,
      startTime: 0.5,
      settleMs: 150,
      resetDiagnostics: true,
      restorePlaybackState: false,
    }));
    expect(result.data).toMatchObject({
      source: 'renderTarget:program',
      renderDiagnostics: {
        requested: true,
        waitedMs: 33,
      },
      captureTimeSeconds: 0.5,
      captureSettleMs: 1200,
      stress: {
        playbackDurationMs: 1120,
        frameCount: 12,
        staleVisibleFrameCount: 4,
      },
      proof: {
        platform: 'windows-chromium',
        strategy: 'worker-webgpu-main-present',
        proof: {
          fingerprint: expect.objectContaining({
            nonBlankRatio: 1,
          }),
        },
        stress: {
          playbackDurationMs: 1120,
          frameCount: 12,
          staleVisibleFrameCount: 4,
        },
      },
      w5StartPermissionsRemainStatsGuarded: true,
    });
    expect(getWorkerFirstProofCaptures().visibleProofs[0]).toMatchObject({
      platform: 'windows-chromium',
      stress: {
        playbackDurationMs: 1120,
        frameCount: 12,
        staleVisibleFrameCount: 4,
      },
    });
    expect(getWorkerFirstCounterSourceSnapshot().visiblePixels).toEqual({
      nonBlankRatio: 1,
      blackFrameCount: 0,
      freezeCount: 1,
      staleVisibleFrameCount: 4,
    });
  });

  it('does not count static unchanged preview frames as stale visible frames', async () => {
    mockCanvasReadback();
    const runPlayback = vi.fn(async () => ({
      success: true,
      data: playbackData({
        stalePreviewFrames: 12,
        stalePreviewWhileTargetMoved: 0,
      }),
    }));

    const result = await handleRunWorkerFirstVisiblePresentationStressProof({
      platform: 'windows-chromium',
      strategy: 'worker-webgpu-main-present',
      durationMs: 1000,
      minPreviewFrames: 3,
    }, deps(runPlayback));

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      stress: {
        frameCount: 12,
        staleVisibleFrameCount: 0,
        diagnostics: {
          stalePreviewFrames: 12,
          stalePreviewWhileTargetMoved: 0,
        },
      },
      proof: {
        stress: {
          frameCount: 12,
          staleVisibleFrameCount: 0,
        },
      },
    });
    expect(getWorkerFirstCounterSourceSnapshot().visiblePixels).toEqual({
      nonBlankRatio: 1,
      blackFrameCount: 0,
      freezeCount: 0,
      staleVisibleFrameCount: 0,
    });
  });

  it('rejects caller-supplied stress counters', async () => {
    const runPlayback = vi.fn();
    const result = await handleRunWorkerFirstVisiblePresentationStressProof({
      platform: 'windows-chromium',
      staleVisibleFrameCount: 0,
    }, deps(runPlayback));

    expect(result.success).toBe(false);
    expect(result.error).toContain('controlled playback run');
    expect(runPlayback).not.toHaveBeenCalled();
    expect(getWorkerFirstProofCaptures().visibleProofs).toHaveLength(0);
  });

  it('rejects hidden browser tabs before running playback stress proof', async () => {
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: true,
    });
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });
    const runPlayback = vi.fn();

    const result = await handleRunWorkerFirstVisiblePresentationStressProof({
      platform: 'windows-chromium',
      strategy: 'worker-webgpu-main-present',
    }, deps(runPlayback));

    expect(result.success).toBe(false);
    expect(result.error).toContain('foreground browser tab');
    expect(result.data).toMatchObject({
      document: {
        hidden: true,
        visibilityState: 'hidden',
        visible: false,
      },
    });
    expect(runPlayback).not.toHaveBeenCalled();
    expect(getWorkerFirstProofCaptures().visibleProofs).toHaveLength(0);
  });

  it('does not record proof when playback fails', async () => {
    const result = await handleRunWorkerFirstVisiblePresentationStressProof({
      platform: 'windows-chromium',
    }, deps(async () => ({
      success: false,
      error: 'playback failed',
    })));

    expect(result.success).toBe(false);
    expect(result.error).toBe('playback failed');
    expect(getWorkerFirstProofCaptures().visibleProofs).toHaveLength(0);
  });

  it('does not record proof until enough preview frames were observed', async () => {
    const result = await handleRunWorkerFirstVisiblePresentationStressProof({
      platform: 'windows-chromium',
      minPreviewFrames: 3,
    }, deps(async () => ({
      success: true,
      data: playbackData({ previewFrames: 2 }),
    })));

    expect(result.success).toBe(false);
    expect(result.error).toContain('enough visible preview frames');
    expect(result.data).toMatchObject({
      minPreviewFrames: 3,
      stress: {
        frameCount: 2,
      },
    });
    expect(getWorkerFirstProofCaptures().visibleProofs).toHaveLength(0);
  });

  it('rejects platform and strategy claims that do not match the capability probe', async () => {
    const runPlayback = vi.fn();
    const platformResult = await handleRunWorkerFirstVisiblePresentationStressProof({
      platform: 'linux-chromium-mesa',
    }, deps(runPlayback));
    const strategyResult = await handleRunWorkerFirstVisiblePresentationStressProof({
      platform: 'windows-chromium',
      strategy: 'worker-webgpu-present',
    }, deps(runPlayback));

    expect(platformResult.success).toBe(false);
    expect(platformResult.error).toContain('platform does not match');
    expect(strategyResult.success).toBe(false);
    expect(strategyResult.error).toContain('strategy does not match');
    expect(runPlayback).not.toHaveBeenCalled();
  });
});
